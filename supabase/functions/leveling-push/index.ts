import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC=Deno.env.get('VAPID_PUBLIC_KEY')||'BGqj9_iTVNJ7PuV1mASKuOh77NFARda3gbDVAqXFyGtCEJ11f_ii41_6a7benfeUO2fEmBkagI-exnsKVzX9ypA';
const VAPID_PRIVATE=Deno.env.get('VAPID_PRIVATE_KEY')!;
const CRON_SECRET=Deno.env.get('CRON_SECRET')||'';
webpush.setVapidDetails('mailto:admin@leveling-app.local',VAPID_PUBLIC,VAPID_PRIVATE);
const admin=createClient(SUPABASE_URL,SERVICE);

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-cron-secret'};
const json=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,'Content-Type':'application/json'}});
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function userFromReq(req:Request){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token)return null;const {data,error}=await admin.auth.getUser(token);return error?null:data.user;
}
async function sendToUser(userId:string,payload:any){
 const {data:pref}=await admin.from('notification_preferences').select('*').eq('user_id',userId).maybeSingle();
 if(!pref?.enabled)return 0;
 const {data:subs}=await admin.from('push_subscriptions').select('*').eq('user_id',userId);
 let sent=0;
 for(const s of subs||[])try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload));sent++}catch(e:any){
   if(e?.statusCode===404||e?.statusCode===410)await admin.from('push_subscriptions').delete().eq('id',s.id);
 }
 return sent;
}
async function areFriends(a:string,b:string){
 const filter=`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`;
 const {data,error}=await admin.from('friendships').select('id').eq('status','accepted').or(filter).limit(1);
 if(error)throw error;
 return Array.isArray(data)&&data.length>0;
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const body=await req.json().catch(()=>({}));
 if(body.action==='scheduled'){
   if(!CRON_SECRET||req.headers.get('x-cron-secret')!==CRON_SECRET)return json({error:'forbidden'},403);
   const {data:prefs}=await admin.from('notification_preferences').select('*').eq('enabled',true);
   let count=0;
   for(const p of prefs||[]){
     const now=new Date();
     const local=new Intl.DateTimeFormat('en-CA',{timeZone:p.timezone||'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).reduce((a:any,x:any)=>(a[x.type]=x.value,a),{});
     const day=`${local.year}-${local.month}-${local.day}`,hour=Number(local.hour);
     if(hour!==Number(p.reminder_hour||19)||p.last_daily_push===day)continue;
     let title='⚔️ LEVELING-APP',msg='Tes quêtes quotidiennes t’attendent. Continue ton ascension.';
     if(p.workout)msg='🏋️ Ta séance du jour t’attend. Ouvre LEVELING-APP et continue ton ascension.';
     else if(!p.quests&&!p.streak)continue;
     count+=await sendToUser(p.user_id,{title,body:msg,tag:'daily-'+day,url:'./'});
     await admin.from('notification_preferences').update({last_daily_push:day}).eq('user_id',p.user_id);
   }
   return json({ok:true,sent:count});
 }
 const user=await userFromReq(req);if(!user)return json({error:'unauthorized'},401);
 if(body.action==='subscribe'){
   const sub=body.subscription;if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return json({error:'bad subscription'},400);
   await admin.from('push_subscriptions').upsert({user_id:user.id,endpoint:sub.endpoint,p256dh:sub.keys.p256dh,auth:sub.keys.auth,timezone:body.timezone||'Europe/Paris',updated_at:new Date().toISOString()},{onConflict:'endpoint'});
   const p=body.prefs||{};await admin.from('notification_preferences').upsert({user_id:user.id,enabled:true,dm:p.dm!==false,quests:p.quests!==false,workout:p.workout!==false,streak:p.streak!==false,timezone:body.timezone||'Europe/Paris',updated_at:new Date().toISOString()});
   return json({ok:true});
 }
 if(body.action==='preferences'){
   const p=body.prefs||{};await admin.from('notification_preferences').upsert({user_id:user.id,enabled:p.enabled===true,dm:p.dm!==false,quests:p.quests!==false,workout:p.workout!==false,streak:p.streak!==false,timezone:body.timezone||'Europe/Paris',updated_at:new Date().toISOString()});
   return json({ok:true});
 }
 if(body.action==='unsubscribe'){await admin.from('push_subscriptions').delete().eq('user_id',user.id);await admin.from('notification_preferences').update({enabled:false}).eq('user_id',user.id);return json({ok:true})}
 if(body.action==='dm'){
   const target=String(body.target_user_id||'').trim();
   if(!UUID_RE.test(target)||target===user.id)return json({error:'invalid target'},400);
   if(!(await areFriends(user.id,target)))return json({error:'friend required'},403);
   const {data:pref}=await admin.from('notification_preferences').select('enabled,dm').eq('user_id',target).maybeSingle();if(!pref?.enabled||!pref?.dm)return json({ok:true,sent:0});
   const {data:profile}=await admin.from('profiles').select('username').eq('id',user.id).maybeSingle();
   const sent=await sendToUser(target,{title:'💬 '+(profile?.username||'Un chasseur'),body:String(body.preview||'Nouveau message').slice(0,120),tag:'dm-'+user.id,url:'./'});
   return json({ok:true,sent});
 }
 return json({error:'unknown action'},400);
});