import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as policy from '../portal/lib/api-cache-policy.ts';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function load(file,mocks={},globals={}){
 const exports={};const source=ts.transpileModule(readFileSync(new URL('../portal/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(source,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing mock '+name);},process:{env:{}},setTimeout,clearTimeout,AbortController,AbortSignal,Error,TypeError,Headers,Response,FormData,Date,Math,...globals});return exports;
}
const {ForegroundPoller}=load('foreground-poller.ts');
function clock(){let time=0,id=0;const timers=new Map();return{timers,now:()=>time,schedule:(callback,delay)=>{timers.set(++id,{callback,at:time+delay});return id;},cancel:id=>timers.delete(id),async advance(delay){time+=delay;for(const [key,timer]of [...timers])if(timer.at<=time){timers.delete(key);timer.callback();}for(let i=0;i<30;i++)await Promise.resolve();}};}
test('status polling sleeps hidden/offline, serializes requests and coalesces rapid resume events',async()=>{
 const time=clock();let sent=0,finish,signal;
 const poller=new ForegroundPoller(async current=>{sent++;signal=current;await new Promise(resolve=>{finish=resolve;});return 'unchanged';},{intervalMs:3000,maxAttempts:6,immediate:true},()=>{},time.schedule,time.cancel,()=>0.5);
 await time.advance(60000);assert.equal(sent,0);poller.setAvailable(true);await time.advance(0);assert.equal(sent,1);
 for(let i=0;i<1000;i++){poller.setAvailable(false);poller.setAvailable(true);}await time.advance(0);assert.equal(sent,1);assert.equal(signal.aborted,true);
 finish();for(let i=0;i<30;i++)await Promise.resolve();await time.advance(0);assert.equal(sent,2);poller.stop();finish();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(time.timers.size,0);
});
test('unchanged status backs off, terminal states stop and manual retry creates a new bounded read budget',async()=>{
 const time=clock();let sent=0,limit=0;
 const poller=new ForegroundPoller(async()=>{sent++;return 'unchanged';},{intervalMs:3000,maxAttempts:3,idleBackoff:true,immediate:true},()=>limit++,time.schedule,time.cancel,()=>0.5);
 poller.setAvailable(true);await time.advance(0);assert.equal(sent,1);await time.advance(5999);assert.equal(sent,1);await time.advance(1);assert.equal(sent,2);await time.advance(12000);assert.equal(sent,3);assert.equal(limit,1);
 for(let i=0;i<20;i++){poller.setAvailable(false);poller.setAvailable(true);await time.advance(60000);}assert.equal(sent,3);
 poller.restart();await time.advance(0);assert.equal(sent,4);poller.stop();assert.equal(time.timers.size,0);
 let done=0;const terminal=new ForegroundPoller(async()=>{done++;return 'done';},{intervalMs:2500,maxAttempts:6,immediate:true},()=>{},time.schedule,time.cancel);terminal.setAvailable(true);await time.advance(0);await time.advance(60000);assert.equal(done,1);terminal.stop();
});
test('transient status errors back off while permission failures stop automatically',async()=>{
 const time=clock();let sent=0;
 const poller=new ForegroundPoller(async()=>{sent++;throw Object.assign(Error(sent===1?'Service unavailable':'Denied'),{status:sent===1?503:403});},{intervalMs:3000,maxAttempts:6,immediate:true},()=>{},time.schedule,time.cancel,()=>0.5);
 poller.setAvailable(true);await time.advance(0);await time.advance(5999);assert.equal(sent,1);await time.advance(1);assert.equal(sent,2);await time.advance(300000);assert.equal(sent,2);assert.equal(time.timers.size,0);poller.stop();
});
test('payment status reads have at most six attempts despite visibility changes',async()=>{
 const time=clock();let sent=0,limit=0;
 const poller=new ForegroundPoller(async()=>{sent++;return 'unchanged';},{intervalMs:2500,maxAttempts:6,immediate:true},()=>limit++,time.schedule,time.cancel);
 poller.setAvailable(true);await time.advance(0);for(let i=0;i<15;i++){poller.setAvailable(false);poller.setAvailable(true);await time.advance(2500);}assert.equal(sent,6);assert.equal(limit,1);poller.stop();
});
test('browser availability shares listeners and releases them after the last reader',()=>{
 const events=new Map();let adds=0,removes=0;const target={addEventListener(name,callback){adds++;events.set(name,callback);},removeEventListener(name){removes++;events.delete(name);}};
 const document={...target,visibilityState:'hidden'},navigator={onLine:true};const values=[];const browser=load('browser-availability.ts',{}, {document,navigator,window:target});
 const one=browser.observeBrowserAvailability(value=>values.push(value)),two=browser.observeBrowserAvailability(value=>values.push(value));assert.equal(adds,3);assert.deepEqual(values,[false,false]);document.visibilityState='visible';events.get('visibilitychange')();assert.deepEqual(values.slice(-2),[true,true]);navigator.onLine=false;events.get('offline')();assert.deepEqual(values.slice(-2),[false,false]);one();assert.equal(removes,0);two();assert.equal(removes,3);
});
function portal(fetch,globals={}){return load('api.ts',{'./api-cache-policy':policy,'./session-lock':{withSessionLock:operation=>operation()}},{fetch,window:{location:{hostname:'localhost'},addEventListener(){}},...globals});}
const user={id:'A',email:'synthetic@example.invalid',universityId:'tenant',roles:['STUDENT'],operatorRoles:[]};
const session={accessToken:'synthetic',refreshToken:'synthetic-refresh',expiresIn:900,user};
test('portal focus and a single-resource reload preserve unrelated cached data',async()=>{
 const events=new Map();let calls=0;const api=portal(async()=>Response.json({revision:++calls}),{window:{location:{hostname:'localhost'},addEventListener(name,handler){events.set(name,handler);}}});api.applySession(session);
 await api.portalApi('/v1/student/timetable');await api.portalApi('/v1/student/gpa');events.get('focus')?.();assert.equal((await api.portalApi('/v1/student/timetable')).revision,1);
 assert.equal((await api.portalApi('/v1/student/gpa',{cache:'reload'})).revision,3);assert.equal((await api.portalApi('/v1/student/timetable')).revision,1);assert.equal(calls,3);
});
test('late portal read cannot overwrite a newer reloaded representation',async()=>{
 const pending=[];const api=portal(()=>new Promise(resolve=>pending.push(resolve)));api.applySession(session);
 const old=api.portalApi('/v1/student/gpa'),fresh=api.portalApi('/v1/student/gpa',{cache:'reload'});assert.equal(pending.length,2);pending[1](Response.json({revision:2}));await fresh;pending[0](Response.json({revision:1}));await old;assert.equal((await api.portalApi('/v1/student/gpa')).revision,2);
});
test('portal caller deadline also bounds refresh and a retry does not acquire a new deadline',async()=>{
 const deadlines=[];let finishRefresh,refreshStarted=false,calls=0;
 const signal={timeout(ms){const controller=new AbortController();deadlines.push({ms,controller});return controller.signal;},any:AbortSignal.any};
 const api=portal(url=>{calls++;if(url.includes('/auth/refresh')){refreshStarted=true;return new Promise(resolve=>{finishRefresh=()=>resolve(Response.json(session));});}return Promise.resolve(Response.json({error:{code:'UNAUTHENTICATED',message:'Expired'}},{status:401}));},{AbortSignal:signal});api.applySession(session);
 const pending=api.portalApi('/v1/student/gpa',{cache:'no-store'}),rejected=assert.rejects(pending,error=>error.code==='REQUEST_TIMEOUT');for(let i=0;i<15&&!refreshStarted;i++)await Promise.resolve();assert.equal(refreshStarted,true);
 deadlines.find(value=>value.ms===20000).controller.abort(Object.assign(Error('Deadline expired'),{name:'TimeoutError'}));await rejected;finishRefresh();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(calls,2);assert.equal(deadlines.filter(value=>value.ms===20000).length,1);
});
test('portal provided abort signals keep a request deadline and programming errors retain their classification',async()=>{
 const deadlines=[],signal={timeout(ms){const controller=new AbortController();deadlines.push({ms,controller});return controller.signal;},any:AbortSignal.any};
 const api=portal((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})),{AbortSignal:signal});api.applySession(session);const caller=new AbortController();
 const pending=api.portalApi('/v1/payments/status/synthetic',{cache:'no-store',signal:caller.signal}),rejected=assert.rejects(pending,error=>error.code==='REQUEST_TIMEOUT');assert.equal(deadlines.length,1);deadlines[0].controller.abort(Object.assign(Error('Timed out'),{name:'TimeoutError'}));await rejected;assert.equal(caller.signal.aborted,false);
 const broken=portal(async()=>{throw new TypeError('Cannot read properties of undefined');});await assert.rejects(broken.portalApi('/v1/student/gpa'),error=>error instanceof TypeError);
});
test('foreground usage sampling cancels its clock in the background and does not count inactive time',async()=>{
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/foreground-usage.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,module:{exports},Date,Math,setTimeout,clearTimeout});
 const time=clock(),samples=[];const sampler=new exports.ForegroundUsageSampler((start,end,seconds)=>samples.push({start,end,seconds}),time.now,time.schedule,time.cancel);
 sampler.setForeground(true);await time.advance(30000);assert.equal(samples[0].seconds,30);await time.advance(20000);sampler.setForeground(false);assert.equal(samples[1].seconds,20);assert.equal(time.timers.size,0);await time.advance(600000);assert.equal(samples.length,2);
 sampler.setForeground(true);await time.advance(10000);sampler.stop();assert.equal(samples[2].seconds,10);assert.equal(time.timers.size,0);
 const valid={id:'11111111-1111-4111-8111-111111111111',ownerUserId:'A',platform:'android',screen:'feed',startedAt:new Date(time.now()-30000).toISOString(),endedAt:new Date(time.now()).toISOString(),seconds:30};assert.equal(exports.validUsageSample(valid,'A',time.now()),true);
 for(const bad of [null,{}, {...valid,ownerUserId:'B'},{...valid,id:'not-uuid'},{...valid,seconds:60},{...valid,screen:'?private query'}])assert.equal(exports.validUsageSample(bad,'A',time.now()),false);
});
test('usage collection coalesces reconnect bursts, sends a bounded backlog and cancels on background or account change',async()=>{
 const time=clock();const base=Date.now();class Clock extends Date{static now(){return base+time.now();}}
 const account='11111111-1111-4111-8111-111111111111';let owner=account,revision=0,cleanup,appChanged,networkChanged,finish,sends=0;const deleted=[],saved=[];
 const app={currentState:'active',addEventListener(_name,callback){appChanged=callback;return {remove(){}};}};
 const pending=Array.from({length:5},(_,i)=>({id:'22222222-2222-4222-8222-'+String(i).padStart(12,'0'),ownerUserId:account,platform:'android',screen:'feed',startedAt:new Date(base-30000).toISOString(),endedAt:new Date(base).toISOString(),seconds:30}));
 let cached=pending;
 const module=(file,mocks)=>{const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,module:{exports},require:name=>mocks[name],Date:Clock,Math,AbortController,setTimeout:time.schedule,clearTimeout:time.cancel});return exports;};
 const usage=module('lib/foreground-usage.ts',{});
 const component=module('components/foreground-usage-tracker.tsx',{'react':{useEffect(callback){cleanup=callback();}},'react-native':{AppState:app,Platform:{OS:'android'}},'expo-router':{usePathname:()=>'/feed'},'expo-crypto':{randomUUID:()=> '33333333-3333-4333-8333-333333333333'},'expo-network':{addNetworkStateListener(callback){networkChanged=callback;return {remove(){}};},getNetworkStateAsync:async()=>({isConnected:true,isInternetReachable:true})},'@react-native-async-storage/async-storage':{__esModule:true,default:{removeItem:async key=>deleted.push(key)}},'../auth/auth-context':{useAuth:()=>({user:{id:account}})},'../lib/api':{ApiError:class extends Error{},api:async()=>{sends++;if(sends===1)await new Promise(resolve=>{finish=resolve;});return {saved:true};}},'../lib/analytics':{analyticsScreenName:()=> 'feed'},'../lib/request-policy':{cacheScopeForUser:()=> 'verified-A'},'../lib/device-cache':{getDeviceCacheRevision:()=>revision,isDeviceCacheOwner:id=>id===owner,readCache:async()=>cached,writeCache:async(_key,value)=>{cached=value;saved.push(value);}},'../lib/foreground-usage':usage});
 component.ForegroundUsageTracker();await time.advance(2500);assert.equal(sends,1);
 for(let i=0;i<1000;i++){networkChanged({isConnected:false});networkChanged({isConnected:true});}assert.equal(sends,1);finish();for(let i=0;i<60;i++)await Promise.resolve();assert.equal(sends,1);assert.equal(cached.length,5);
 await time.advance(30000);assert.equal(sends,4);assert.equal(cached.length,3);assert.ok(deleted.includes('k1-foreground-usage:'+account));assert.ok(saved.length);
 app.currentState='background';appChanged('background');await time.advance(120000);assert.equal(sends,4);owner='B';revision++;app.currentState='active';appChanged('active');await time.advance(30000);assert.equal(sends,4);cleanup();assert.equal(time.timers.size,0);
});
