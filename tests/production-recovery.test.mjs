import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv,createDecipheriv,randomBytes,createHash } from 'node:crypto';
import { importProgress } from '../mobile/src/lib/import-progress.ts';
import { nativeTransport } from './helpers/native-transport.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require=createRequire(new URL('../server/package.json',import.meta.url)),ts=require('typescript');
function load(file,mocks={}){const exports={};const source=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;runInNewContext(source,{exports,module:{exports},require:name=>mocks[name],setTimeout,clearTimeout,Date,Math,AbortController,URL,TextEncoder});return exports;}
const {SecureSnapshots}=load('secure-snapshots.ts');
const {ReadCoordinator}=load('read-coordinator.ts',{'./request-policy':{matchesRead:(path,prefix)=>path===prefix||path.startsWith(prefix+'/')||path.startsWith(prefix+'?')}});
const {LiveConnection}=load('live-connection.ts');
function fixture(){
 const data=new Map(),keys=new Map();let now=1_000_000;
 const io={get:async k=>data.get(k)??null,set:async(k,v)=>{data.set(k,v);},remove:async k=>{data.delete(k);},keys:async()=>[...data.keys()],hash:async text=>createHash('sha256').update(text).digest('hex'),
 seal:async(id,text,aad)=>{const key=keys.get(id)??randomBytes(32);keys.set(id,key);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]).toString('base64');},
 open:async(id,sealed,aad)=>{const key=keys.get(id);if(!key)return null;const bytes=Buffer.from(sealed,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString();},destroyKey:async id=>{keys.delete(id);}};
 return {store:new SecureSnapshots(io,()=>now),data,keys,io,now:()=>now,advance:n=>{now+=n;}};
}
const account='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('encrypted snapshots survive a restart and do not expose private text or another tenant',async()=>{
 const f=fixture(),key='timetable-draft.'+account;f.store.activate(JSON.stringify([account,'A']),account);await f.store.write(key,{private:'matriculation and personal courses'},60_000);
 assert.equal([...f.data.values()].join('').includes('matriculation'),false);
 const restart=new SecureSnapshots(f.io,f.now);restart.activate(JSON.stringify([account,'A']),account);assert.equal((await restart.read(key)).data.private,'matriculation and personal courses');
 restart.activate(JSON.stringify([account,'B']),account);assert.equal(await restart.read(key),null);
 restart.activate(JSON.stringify([other,'A']),other);assert.equal(await restart.read(key),null);
});
test('tampered and swapped ciphertext, expired records and finance reads fail closed',async()=>{
 const f=fixture();f.store.activate('trusted-scope',account);const a='snapshot./v1/student/gpa',b='snapshot./v1/student/timetable';await f.store.write(a,{grades:[5]},500);await f.store.write(b,{entries:[]},500);
 const records=[...f.data.keys()].filter(k=>!k.endsWith('.index')&&!k.endsWith('.scopes'));const first=f.data.get(records[0]);f.data.set(records[1],first);assert.equal(await f.store.read(b),null);
 f.advance(501);assert.equal(await f.store.read(a),null);
 await f.store.write('snapshot./v1/payments/balance',{balance:9000},1000);assert.equal(await f.store.read('snapshot./v1/payments/balance'),null);
});
test('sign-out destroys keys and ignores in-flight writes during A -> B -> A',async()=>{
 const f=fixture();f.store.activate('scopeA',account);await f.store.write('cart.'+account,{items:1},1000);
 let unblock;const original=f.io.seal;f.io.seal=(...args)=>new Promise(resolve=>{unblock=()=>original(...args).then(resolve);});
 const pending=f.store.write('timetable-draft.'+account,{pending:true},1000);while(!unblock)await Promise.resolve();
 f.store.activate('scopeB',other);f.store.activate('scopeA',account);unblock();await pending;assert.equal(await f.store.read('timetable-draft.'+account),null);
 await f.store.clear();assert.equal(f.keys.size,0);assert.equal(f.data.size,0);
});
test('snapshot disk quotas and record limits are bounded',async()=>{
 const f=fixture();f.store.activate('scope',account);for(let i=0;i<75;i++)await f.store.write('message-draft.'+account+'.'+i,{text:'hello'},1000);
 assert.ok([...f.data.keys()].filter(k=>!k.endsWith('.index')&&!k.endsWith('.scopes')).length<=60);
 await f.store.write('cart.'+account,'x'.repeat(270000),1000);assert.equal(await f.store.read('cart.'+account),null);
});
test('AI processing, review, failure and saving never reuse an upload percentage',()=>{
 assert.equal(importProgress('uploading','exam timetable',0.421).percent,42);
 for(const stage of ['uploaded','reading','analysing','review','saving','failed']){const state=importProgress(stage,'academic calendar',1);assert.equal(state.percent,null);assert.ok(state.title.length);}
 assert.equal(importProgress('uploading','file',NaN).percent,null);
 assert.equal(importProgress('completed','file').busy,false);
});
function clock(){let now=0,id=0;const timers=new Map();const schedule=(callback,delay)=>{timers.set(++id,{callback,at:now+delay});return id;},cancel=id=>timers.delete(id);return{schedule,cancel,timers,now:()=>now,async advance(n){now+=n;const tasks=[...timers].filter(([,task])=>task.at<=now);for(const [id,task]of tasks){timers.delete(id);await task.callback();}for(let i=0;i<12;i++)await Promise.resolve();}};}
test('focused reconciliation suspends offline/background and coalesces event bursts',async()=>{
 const time=clock(),invalidated=[];let count=0,finish;const coordinator=new ReadCoordinator(p=>invalidated.push(p),time.now,time.schedule,time.cancel,()=>0.5);
 const remove=coordinator.subscribe('/v1/messages/inbox',()=>{count++;return new Promise(r=>{finish=r;});});coordinator.setAvailable(false,true);await time.advance(120_000);assert.equal(count,0);
 coordinator.setAvailable(true,true);await time.advance(0);assert.equal(count,1);
 for(let i=0;i<1000;i++)coordinator.event(['/v1/messages/inbox']);assert.equal(count,1);finish();for(let i=0;i<12;i++)await Promise.resolve();await time.advance(0);assert.equal(count,2);finish();remove();assert.equal(time.timers.size,0);
});
test('live stream rejects unknown resources and duplicate sequence; background closes it',async()=>{
 const time=clock(),sockets=[],changes=[];let reconciles=0;
 const connection=new LiveConnection(async()=>({ticket:'test',url:'wss://live.invalid/v1/live',expiresAt:Date.now()+60000}),()=>{const socket={close(){this.closed=true;}};sockets.push(socket);return socket;},()=>reconciles++,p=>changes.push(p),()=>{},time.schedule,time.cancel,()=>0.5);
 connection.setAvailable(true);for(let i=0;i<6;i++)await Promise.resolve();const socket=sockets[0];socket.onopen();socket.onmessage({data:JSON.stringify({type:'ready',sequence:0})});
 socket.onmessage({data:JSON.stringify({type:'change',sequence:1,prefixes:['/v1/messages/inbox']})});socket.onmessage({data:JSON.stringify({type:'change',sequence:1,prefixes:['/v1/messages/inbox']})});socket.onmessage({data:JSON.stringify({type:'change',sequence:2,prefixes:['/v1/payments/balance']})});assert.equal(changes.length,1);
 socket.onmessage({data:JSON.stringify({type:'change',sequence:3,prefixes:['/v1/messages/inbox']})});assert.equal(reconciles,2);
 connection.setAvailable(false);assert.equal(socket.closed,true);assert.equal(time.timers.size,0);
});
test('a socket that closes before opening replaces its handshake timeout with bounded retry',async()=>{
 const time=clock(),sockets=[];
 const connection=new LiveConnection(async()=>({ticket:'test',url:'wss://live.invalid/v1/live',expiresAt:Date.now()+60000}),()=>{const socket={close(){}};sockets.push(socket);return socket;},()=>{},()=>{},()=>{},time.schedule,time.cancel,()=>0.5);
 connection.setAvailable(true);for(let i=0;i<6;i++)await Promise.resolve();sockets[0].onclose();
 assert.equal(time.timers.size,1);await time.advance(1000);assert.equal(sockets.length,2);
 connection.stop();assert.equal(time.timers.size,0);
});
test('optional screen clocks share one foreground listener and remove it after the last consumer',()=>{
 let registrations=0,removals=0,notify=0,callback;const cleanups=[];
 const app={currentState:'active',addEventListener(_event,listener){registrations++;callback=listener;return{remove(){removals++;}};}};
 const hooks=load('use-active-screen.ts',{'react':{useState:()=>[true,()=>{}],useCallback:fn=>fn,useSyncExternalStore(subscribe,snapshot){cleanups.push(subscribe(()=>notify++));return snapshot();}},'react-native':{AppState:app,Platform:{OS:'android'}},'expo-router':{useFocusEffect:()=>{}}});
 assert.equal(hooks.useActiveScreen(),true);assert.equal(hooks.useActiveScreen(),true);assert.equal(registrations,1);
 app.currentState='background';callback();assert.equal(notify,2);assert.equal(hooks.useActiveScreen(),false);assert.equal(registrations,1);
 for(const cleanup of cleanups)cleanup();assert.equal(removals,1);
});
test('authentication refresh and retry consume one caller deadline',async()=>{
 let elapsed=0;class Clock extends Date {static now(){return elapsed;}}
 const transport=nativeTransport(async url=>{if(url.includes('/auth/refresh')){elapsed=110;return Response.json({accessToken:'next',refreshToken:'next-refresh',expiresIn:900,refreshExpiresIn:900,user:{id:account,email:'test@example.invalid',roles:[],universityId:null,operatorRoles:[]}});}return Response.json({error:{code:'UNAUTHENTICATED',message:'Expired'}},{status:401});},Clock,{readRefreshToken:async()=> 'synthetic-refresh'});
 transport.setAccessToken('old',account,JSON.stringify([account,null,[],[]]));await assert.rejects(transport.api('/v1/student/gpa',{timeoutMs:100}),e=>e.code==='REQUEST_TIMEOUT');
});

test('a programming TypeError is not reclassified as an internet failure or sent to another origin',async()=>{
 let calls=0;const transport=nativeTransport(async()=>{calls++;throw new TypeError('Cannot read properties of undefined');});transport.setAccessToken('test',account);
 await assert.rejects(transport.api('/v1/student/gpa'),e=>e instanceof TypeError&&e.message.includes('undefined'));assert.equal(calls,1);
});

test('custom read deadlines still retain eligible fresh data without caching quota or payment state',async()=>{
 let calls=0;const transport=nativeTransport(async()=>Response.json({revision:++calls}));transport.setAccessToken('test',account);
 await transport.api('/v1/student/gpa',{timeoutMs:8000});await transport.api('/v1/student/gpa',{timeoutMs:12000});assert.equal(calls,1);
 await transport.api('/v1/ai/status',{timeoutMs:8000});await transport.api('/v1/ai/status',{timeoutMs:8000});assert.equal(calls,3);
});
