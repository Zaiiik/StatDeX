const CACHE='leveling-app-v15-18-0';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(CORE))
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(key=>key.startsWith('leveling-app-')&&key!==CACHE)
          .map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const res=await fetch(req);

        if(res&&res.ok){
          const copy=res.clone();
          event.waitUntil(
            caches.open(CACHE).then(cache=>cache.put('./index.html',copy))
          );
        }

        return res;
      }catch(e){
        return (await caches.match('./index.html'))
          || (await caches.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  if(url.origin!==self.location.origin){
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(req);

    const networkPromise=(async()=>{
      try{
        const res=await fetch(req);

        if(res&&(res.ok||res.type==='opaque')){
          const copy=res.clone();
          event.waitUntil(
            caches.open(CACHE).then(cache=>cache.put(req,copy))
          );
        }

        return res;
      }catch(e){
        return cached||Response.error();
      }
    })();

    return cached||networkPromise;
  })());
});

self.addEventListener('push',event=>{
  let d={};

  try{
    d=event.data?event.data.json():{};
  }catch(e){
    d={
      title:'LEVELING-APP',
      body:event.data?.text()||'Nouvelle notification'
    };
  }

  event.waitUntil(
    self.registration.showNotification(
      d.title||'LEVELING-APP',
      {
        body:d.body||'',
        icon:'./icon-192.png',
        badge:'./icon-192.png',
        tag:d.tag||'leveling',
        data:{url:d.url||'./'},
        vibrate:[120,60,120]
      }
    )
  );
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'./';

  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const client of list){
        if('focus' in client){
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow?clients.openWindow(url):null;
    })
  );
});
