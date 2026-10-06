import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {extname,resolve} from 'node:path';
import {renderTransactionalEmail,renderBroadcastEmail} from '../server/src/lib/email-template.ts';

// These are explicitly local fixtures. No production login, upload, email,
// checkout, migration or deployment is performed by this verification job.
const root=resolve(import.meta.dirname,'..');
const evidence=resolve(root,'browser-evidence');mkdirSync(evidence,{recursive:true});
const user={id:'00000000-0000-4000-8000-000000000001',email:'browser-fixture@example.test',roles:['STUDENT'],universityId:'00000000-0000-4000-8000-000000000002',operatorRoles:[]};
const university={id:user.universityId,name:'University of Benin'};
const draft={step:0,updated_at:new Date().toISOString(),values:{legalName:'Osas Egharevba',displayName:'Osas Kitchen',birthDate:'2000-01-15',phoneE164:'+2348012345678',address:'12 Uselu Road, Benin City',universityId:user.universityId,campus:'Ugbowo',serviceLocation:'June 12 shopping complex',department:'Computer Science',matricNumber:'SCI2200123',clientRequestId:'00000000-0000-4000-8000-000000000003'}};
const fixtures={
 '/v1/auth/refresh':{accessToken:'local-browser-fixture',refreshToken:'local-browser-fixture',expiresIn:3600,user},
 '/v1/student/catalog':{universities:[university],faculties:[],departments:[]},
 '/v1/student/me':{profile:{first_name:'Osas',last_name:'Egharevba',display_name:'Osas Kitchen',university_id:user.universityId,department_name:'Computer Science',matriculation_number:'SCI2200123'}},
 '/v1/applications':{applications:[]},
 '/v1/applications/draft':{draft},
 '/v1/applications/requirements':{privateIdentityReady:true},
 '/v1/trusted-vendors/invite':{invite:{university_name:'University of Benin',application_id:null}},
 '/v1/trusted-vendors/availability':{enabled:true},
 '/v1/admin/access':{permissions:[],universities:[university],allUniversities:false},
};
const api=createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://localhost:3100');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','authorization,content-type,x-device-label');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const path=new URL(req.url,'http://localhost:8787').pathname;
 if(req.method==='PUT'&&path==='/v1/applications/draft'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({draft:{...draft,updated_at:new Date().toISOString()}}));return;}
 res.setHeader('Content-Type','application/json');res.writeHead(fixtures[path]?200:404);res.end(JSON.stringify(fixtures[path]??{error:{code:'FIXTURE_NOT_FOUND',message:path}}));
});
const data=JSON.parse(readFileSync(resolve(root,'database/imports/uniben-osm-2026-10-01.json'),'utf8'));
const campuses={ugbowo:[5.618838,6.398255],ekehuan:[5.60015,6.3337]};
function mapPayload(slug){const source=data.features.filter(f=>f.slug===slug&&f.kind==='BUILDING').slice(0,300);return {campusId:slug,centre:campuses[slug],places:source.filter(f=>f.name).map(f=>({id:f.source_feature_id,name:f.name,category:'ACADEMIC',latitude:f.geometry.coordinates[0][0][1],longitude:f.geometry.coordinates[0][0][0]})),features:{type:'FeatureCollection',features:source.map(f=>({type:'Feature',geometry:f.geometry,properties:{heightMetres:Number(f.tags.height)||Number(f.tags['building:levels'])*3||0}}))},layer:'osm'};}
const harness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;font-family:Arial}iframe{width:100%;height:100%;border:0}</style></head><body><iframe title="Campus renderer" src="/maps/view.html"></iframe><script>window.mapReady=false;window.mapErrors=[];window.payloads=${JSON.stringify(Object.fromEntries(Object.keys(campuses).map(s=>[s,mapPayload(s)])))};window.showCampus=slug=>document.querySelector('iframe').contentWindow.postMessage({type:'kampusone-map',payload:window.payloads[slug]},location.origin);window.addEventListener('message',e=>{if(e.origin!==location.origin)return;let d;try{d=JSON.parse(e.data)}catch{return}if(d.type==='ready'){window.mapReady=true;window.showCampus('ugbowo')}if(d.type==='error')window.mapErrors.push(d.message)});</script></body></html>`;
const web=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost:8100').pathname;
 if(path==='/__verify-email.html'){res.setHeader('Content-Type','text/html');res.end(renderTransactionalEmail({subject:'Your purchase is confirmed',label:'Payment receipt',heading:'You’re all set',intro:'Your Kira Pro payment of ₦6,000 is confirmed. Open KampusOne to use your plan.',firstName:'Osas',note:'Example receipt for browser verification only. No purchase was made.'}).html);return;}
 if(path==='/__verify-campaign.html'){res.setHeader('Content-Type','text/html');res.end(renderBroadcastEmail({subject:'A little more from your campus',body:'A new update is ready. Your invited vendor profile has been approved.\n\nOpen your dashboard: https://agents.kampusone.app/agents/dashboard',senderName:'KampusOne',kind:'OPERATIONAL',isTest:true}).html);return;}
 if(path==='/__verify-map.html'){res.setHeader('Content-Type','text/html');res.end(harness);return;}
 const file=resolve(root,'mobile/dist',path==='/'?'index.html':`.${path}`);
 if(!file.startsWith(resolve(root,'mobile/dist')+'/')||!existsSync(file)){res.writeHead(404);res.end();return;}
 const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.ttf':'font/ttf'};
 res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
});
const portal=spawn('npm',['run','start','--','--port','3100'],{cwd:resolve(root,'portal'),stdio:'pipe',detached:true,env:process.env});let portalLog='';for(const stream of [portal.stdout,portal.stderr])stream.on('data',b=>portalLog+=b.toString());
const execute=promisify(execFile);
async function browser(...args){console.log('Browser check:',args[0],args[1]??'');return (await execute('agent-browser',args,{encoding:'utf8',timeout:60000,env:process.env})).stdout;}
async function check(js){const out=await browser('eval','-b',Buffer.from(js).toString('base64'));writeFileSync(resolve(evidence,'checks.log'),out,{flag:'a'});return out;}
async function awaitServer(url){for(let i=0;i<45;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error('Local build did not start: '+url);}
try{
 await new Promise(r=>api.listen(8787,r));await new Promise(r=>web.listen(8100,r));await awaitServer('http://localhost:3100/agents');
 await browser('set','viewport','390','844');await browser('open','http://localhost:3100/agents');await browser('wait','--fn',"Boolean(document.querySelector('.agent-onboarding-form'))");
 writeFileSync(resolve(evidence,'agent-mobile-snapshot.txt'),await browser('snapshot','-i'));
 await check("(()=>{if(document.documentElement.scrollWidth>innerWidth+2)throw new Error('Agent screen overflows');const form=document.querySelector('.agent-onboarding-form');if(!form)throw new Error('Onboarding form missing');if(!document.querySelector('[role=progressbar]'))throw new Error('Step progress missing');return 'Mobile agent form fits and step progress is available'})()");
 await browser('screenshot',resolve(evidence,'agent-mobile.png'),'--full');await browser('find','role','button','click','--name','Continue','--exact');await browser('wait','--text','Your campus');
 await browser('screenshot',resolve(evidence,'agent-campus-mobile.png'),'--full');
 await check("(()=>{if(document.documentElement.scrollWidth>innerWidth+2)throw new Error('Campus step overflows');if(!document.querySelector('select'))throw new Error('Campus choices missing');return 'Continue advances the saved draft to campus choices'})()");
 await browser('set','viewport','1440','1000');await browser('screenshot',resolve(evidence,'agent-desktop.png'),'--full');
 await browser('set','viewport','390','844');await browser('open',`http://localhost:3100/exclusive?invite=${'f'.repeat(64)}`);await browser('wait','--fn',"Boolean(document.querySelector('[aria-label=\"Exclusive application progress\"]'))");await browser('wait','--fn',"Array.from(document.querySelectorAll('.agent-illustration')).every(i=>i.complete&&i.naturalWidth>0)");await browser('screenshot',resolve(evidence,'trusted-vendor-mobile.png'),'--full');
 await check("(()=>{if(document.documentElement.scrollWidth>innerWidth+2)throw new Error('Trusted vendor form overflows');if(document.querySelector('input[name=nin]'))throw new Error('Unwaived document field present');if(document.querySelector('[aria-label=\"Exclusive application progress\"]').getAttribute('aria-valuenow')!=='1')throw new Error('Invitation did not open its first application step');return 'A valid local invitation opens the mobile vendor wizard'})()");
 await browser('open','http://localhost:8100/__verify-email.html');await browser('screenshot',resolve(evidence,'receipt-email-mobile.png'),'--full');await check("(()=>{if(document.documentElement.scrollWidth>innerWidth+2)throw new Error('Receipt email overflows');return 'Receipt email fits on mobile'})()");
 await browser('open','http://localhost:8100/__verify-campaign.html');await browser('screenshot',resolve(evidence,'approval-email-mobile.png'),'--full');
 await browser('open','http://localhost:8100/__verify-map.html');await browser('wait','--fn','window.mapReady===true');
 await check("(()=>{const d=document.querySelector('iframe').contentDocument;const c=d.querySelector('canvas');if(!c||c.width<300||c.height<600)throw new Error('Map canvas failed');if(!d.querySelector('.maplibregl-ctrl-attrib').textContent.includes('OpenStreetMap'))throw new Error('Map credit missing');return 'Real MapLibre canvas and OSM attribution are visible'})()");
 await browser('wait','1000');await browser('screenshot',resolve(evidence,'ugbowo-map-mobile.png'));writeFileSync(resolve(evidence,'map-snapshot.txt'),await browser('snapshot','-i'));
 await browser('mouse','move','180','350');await browser('mouse','wheel','-350');await browser('mouse','down','left');await browser('mouse','move','260','390','--duration','350','--steps','12');await browser('mouse','up','left');await browser('screenshot',resolve(evidence,'ugbowo-map-after-gestures.png'));
 await check("window.showCampus('ekehuan');'Switched renderer to sourced Ekehuan features'");await browser('wait','1000');await browser('screenshot',resolve(evidence,'ekehuan-map-mobile.png'));
 await check("(()=>{if(window.mapErrors.length)throw new Error(window.mapErrors.join('; '));return 'Both campus payloads render without tile error notices'})()");
 const errors=await browser('errors','--json');writeFileSync(resolve(evidence,'browser-errors.json'),errors);const parsed=JSON.parse(errors);assert.equal(parsed.success,true);assert.equal(parsed.data?.errors?.length??0,0,'Browser reported runtime errors');
 writeFileSync(resolve(evidence,'result.json'),JSON.stringify({sourceSha:process.env.GITHUB_SHA,verifiedAt:new Date().toISOString(),result:'passed',scope:'Compiled agent form with local draft fixture; real two-campus MapLibre renderer; desktop/mobile layout; map wheel and pan. Native APK gestures, live payments, camera, native push and gallery require separate verification.'},null,2));
}catch(error){try{writeFileSync(resolve(evidence,'failure-snapshot.txt'),await browser('snapshot','-i'));await browser('screenshot',resolve(evidence,'failure.png'),'--full');writeFileSync(resolve(evidence,'failure-errors.json'),await browser('errors','--json'));}catch{}throw error;
}finally{try{await browser('close');}catch{}try{process.kill(-portal.pid,'SIGTERM');}catch{}portal.stdout.destroy();portal.stderr.destroy();api.closeAllConnections();web.closeAllConnections();api.close();web.close();writeFileSync(resolve(evidence,'portal.log'),portalLog);}
