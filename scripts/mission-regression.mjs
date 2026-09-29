import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const contentTypes = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png' };
const action = `<script>window.addEventListener('load',()=>setTimeout(async()=>{const html=document.documentElement,wait=ms=>new Promise(r=>setTimeout(r,ms));try{
window.v15BuildSettings?.();window.v15SelectSetting?.('personalization');document.querySelector('[data-group="personalize"]')?.click();await wait(50);window.LevelingPersonalizationV25613?.mount?.();
const click=(selector,value)=>document.querySelector(selector+'="'+value+'"]')?.click();click('[data-v25612-color','red');click('[data-v25612-skin','system');click('[data-v25612-color','blue');click('[data-v25612-skin','none');click('[data-v25612-color','green');await wait(30);
const personalization=document.body.dataset.theme==='green'&&document.body.dataset.cleanTheme==='none'&&document.querySelectorAll('.v25612-personalization').length===1&&document.querySelector('[data-v25612-color="green"]')?.classList.contains('active');
const pplReq=window.LevelingProgramAI.parse('Fais-moi un programme PPL sur 3 jours'),ppl=window.LevelingProgramAI.build(pplReq),allowed=[['chest','shoulders','triceps'],['back','biceps'],['quads','hamstrings','glutes','calves']];
const pplOk=pplReq.split==='ppl'&&ppl.days.length===3&&/PUSH/.test(ppl.days[0].title)&&/PULL/.test(ppl.days[1].title)&&/LEGS/.test(ppl.days[2].title)&&ppl.days.every((day,i)=>day.exercises.every(ex=>allowed[i].includes(ex.group)));
const legacy=normalizeCustomProgramData({name:'Legacy',days:[{dayName:'Jour 1',exercises:[{name:'Squat',sets:3,defaultReps:8,defaultWeight:0}]}]}),multi=normalizeCustomProgramData({name:'Multi',blocks:[{name:'Bloc 1',days:[{dayName:'Jour 1',exercises:[]}]},{name:'Bloc 2',days:[{dayName:'Jour 1',exercises:[]}]}]}),triple=normalizeCustomProgramData(JSON.parse(JSON.stringify({name:'Triple',blocks:[1,2,3].map(i=>({name:'Bloc '+i,days:[{dayName:'Jour 1',exercises:[{name:'Exercice '+i}]}]}))})));
const originalProgram=activeProgramKey,originalCustom=customProgramData;customProgramData=multi;activeProgramKey='custom';const multiPrograms=getPrograms();customProgramData=originalCustom;activeProgramKey=originalProgram;
const merged=window.LevelingCloudMergeV2214.merge({activeProgramKey:'fitgirl',activeProgramSelection:{key:'fitgirl',updatedAt:100},customProgramData:legacy,customProgramUpdatedAt:100,cycleNumber:2,userData:{workoutsCompleted:10},v10:{totalXp:1000,sessions:[]}},{activeProgramKey:'custom',activeProgramSelection:{key:'custom',updatedAt:200},customProgramData:triple,customProgramUpdatedAt:200,cycleNumber:1,userData:{workoutsCompleted:2},v10:{totalXp:200,sessions:[]}});
const recoveryPerfect=window.LevelingRecoveryV1622.score({sleep:10,energy:10,motivation:10,soreness:0,pain:0})===100,recoveryMedium=window.LevelingRecoveryV1622.score({sleep:6,energy:6,motivation:6,soreness:4,pain:4}),recoveryBad=window.LevelingRecoveryV1622.score({sleep:3,energy:2,motivation:2,soreness:9,pain:8})<40;
window.LevelingRecoveryV1622.setEvaluation({sleep:10,energy:10,motivation:10,soreness:0,pain:0});await wait(80);const recoverySync=window.LevelingRecoveryV1622.today().score===100&&document.querySelector('#system-ai-hub')?.textContent.includes('100/100');
const oldInfo=currentAccessInfo,oldPlan=currentSubscriptionPlan;currentAccessInfo={...oldInfo,access_state:'SUBSCRIBED',plan_code:'1y',access_source:'access_key',commercial_subscription:false,can_purchase_lifetime:true};currentSubscriptionPlan='1y';const accessOk=window.v2220CanPurchasePlan('life')===true&&window.v2220CanPurchasePlan('1y')===false;currentAccessInfo=oldInfo;currentSubscriptionPlan=oldPlan;
const checks={personalization,ppl:pplOk,legacy:legacy.blocks.length===1&&legacy.blocks[0].days.length===1,multi:multi.blocks.length===2&&multiPrograms.length===2,triple:triple.blocks.length===3&&merged.customProgramData.blocks.length===3,programSelection:merged.activeProgramKey==='custom',recoveryPerfect,recoveryMedium:recoveryMedium>40&&recoveryMedium<90,recoveryBad,recoverySync,access:accessOk};html.dataset.missionChecks=JSON.stringify(checks);html.dataset.missionTests=String(Object.values(checks).every(Boolean));
}catch(error){html.dataset.missionError=String(error?.stack||error)}},2600))<\/script>`;

const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),path=normalize(join(root,url.pathname==='/'?'index.html':url.pathname.slice(1)));if(relative(root,path).startsWith('..'))throw new Error('path');let body=await readFile(path);if(extname(path)==='.html')body=Buffer.from(body.toString('utf8').replace('<head>',`<head>${action}`));res.setHeader('Content-Type',contentTypes[extname(path)]||'application/octet-stream');res.end(body)}catch{res.statusCode=404;res.end('Not found')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'leveling-mission-'));
try{
 const result=await new Promise((resolveResult,reject)=>{const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--window-size=390,844','--virtual-time-budget=9000',`--user-data-dir=${profile}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/index.html`],{windowsHide:true});let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',x=>stdout+=x);child.stderr.setEncoding('utf8').on('data',x=>stderr+=x);const timer=setTimeout(()=>{child.kill();reject(new Error('Chrome timeout'))},20000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolveResult({code,stdout,stderr})})});
 assert.equal(result.code,0,'Chrome runtime');
 assert.equal(result.stdout.includes('data-mission-tests="true"'),true,result.stdout.match(/data-mission-(?:checks|error)="[^"]*/)?.[0]||'mission state missing');
 assert.equal(/Uncaught|SyntaxError|ReferenceError|TypeError/i.test(result.stderr),false,'runtime console');
 const checkout=await readFile(join(root,'supabase/functions/create-checkout/index.ts'),'utf8'),provenance=await readFile(join(root,'supabase/functions/access-provenance/index.ts'),'utf8');
 assert.match(checkout,/plan !== "lifetime" \|\| hasCommercial/);assert.match(checkout,/SUPABASE_SERVICE_ROLE_KEY/);assert.match(provenance,/can_purchase_lifetime/);assert.doesNotMatch(await readFile(join(root,'index.html'),'utf8'),/SUPABASE_SERVICE_ROLE_KEY/);
 console.log('LEVELING-APP mission regression — personnalisation répétée, splits stricts, custom legacy/1/2/3 blocs, choix actif horodaté, récupération 100/sync et clé temporaire→Lifetime validés');
}finally{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true})}
