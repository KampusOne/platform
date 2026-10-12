import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function load(file,mocks={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,module:{exports},require:name=>mocks[name],setTimeout,clearTimeout,AbortController,Error,Math,Date});return exports;}
const {TextRetryCoordinator}=load('text-retry-coordinator.ts');
function clock(){let time=0,id=0;const timers=new Map();return{timers,now:()=>time,schedule:(callback,delay)=>{timers.set(++id,{callback,at:time+delay});return id;},cancel:id=>timers.delete(id),async advance(delay){time+=delay;const due=[...timers].filter(([,value])=>value.at<=time);for(const [id,value]of due){timers.delete(id);value.callback();}for(let i=0;i<30;i++)await Promise.resolve();}};}
const account='11111111-1111-4111-8111-111111111111',thread='22222222-2222-4222-8222-222222222222',intent='33333333-3333-4333-8333-333333333333';
function queued(){return {threadId:thread,message:{id:intent,body:'Where is the lecture?',retry:{attempts:0,nextAttemptAt:0,blocked:false}}};}
test('text recovery sleeps offline/background and coalesces changes while a persisted text is sending',async()=>{
 const time=clock();let values=[queued()],sent=0,acknowledged=0,finish;
 const coordinator=new TextRetryCoordinator(async()=>values,async()=>{sent++;await new Promise(resolve=>{finish=resolve;});},async()=>{acknowledged++;values=[];},async()=>{},time.now,time.schedule,time.cancel,()=>0.5);
 await time.advance(60000);assert.equal(sent,0);
 coordinator.setAvailable(true);await time.advance(0);assert.equal(sent,1);
 for(let i=0;i<1000;i++)coordinator.wake();finish();for(let i=0;i<30;i++)await Promise.resolve();await time.advance(0);
 assert.equal(sent,1);assert.equal(acknowledged,1);assert.equal(time.timers.size,0);
 coordinator.setAvailable(false);coordinator.wake();await time.advance(60000);assert.equal(sent,1);coordinator.stop();
});
test('transient failures persist capped backoff; a permission failure stops until deliberate retry',async()=>{
 const time=clock();let value=queued(),sent=0,ack=0;const attempts=[];
 const coordinator=new TextRetryCoordinator(async()=>value?[value]:[],async()=>{sent++;if(sent===1)throw Object.assign(Error('Offline'),{code:'NETWORK_UNAVAILABLE'});if(sent===2)throw Object.assign(Error('Access denied'),{status:403});},async()=>{ack++;value=null;},async(_value,retry)=>{value.message.retry=retry;attempts.push(retry);},time.now,time.schedule,time.cancel,()=>0.5);
 coordinator.setAvailable(true);await time.advance(0);assert.equal(sent,1);assert.equal(attempts[0].nextAttemptAt,4000);
 await time.advance(0);await time.advance(3999);assert.equal(sent,1);await time.advance(1);assert.equal(sent,2);assert.equal(attempts[1].blocked,true);
 await time.advance(0);await time.advance(300000);assert.equal(sent,2);
 value.message.retry={attempts:0,nextAttemptAt:time.now(),blocked:false};coordinator.wake();await time.advance(0);assert.equal(sent,3);assert.equal(ack,1);coordinator.stop();
});
test('leaving the session aborts recovery and a late server response cannot acknowledge another session',async()=>{
 const time=clock();let finish,signal,ack=0;
 const coordinator=new TextRetryCoordinator(async()=>[queued()],async(_value,current)=>{signal=current;await new Promise(resolve=>{finish=resolve;});},async()=>{ack++;},async()=>{},time.now,time.schedule,time.cancel,()=>0.5);
 coordinator.setAvailable(true);await time.advance(0);coordinator.stop();assert.equal(signal.aborted,true);finish();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(ack,0);assert.equal(time.timers.size,0);
});
test('storage failures cannot cause an unbounded resend loop',async()=>{
 const time=clock();let sent=0;
 const coordinator=new TextRetryCoordinator(async()=>[queued()],async()=>{sent++;throw Object.assign(Error('Unavailable'),{status:503});},async()=>{},async()=>{throw Error('Storage full');},time.now,time.schedule,time.cancel,()=>0.5);
 coordinator.setAvailable(true);for(let i=0;i<12;i++)await time.advance(30000);assert.equal(sent,4);assert.equal(time.timers.size,0);coordinator.stop();
});
test('initial send and recovery share one text intent; A to B to A invalidates a delayed send',async()=>{
 let revision=1,owner=account,finish,sent=0;
 const {transferTextOnce}=load('text-transfer.ts',{'./device-cache':{getDeviceCacheRevision:()=>revision,isDeviceCacheOwner:account=>account===owner}});
 const message=queued().message;
 const first=transferTextOnce(account,thread,message,async check=>{await new Promise(resolve=>{finish=resolve;});check();sent++;});
 const shared=transferTextOnce(account,thread,message,async()=>{sent++;});assert.equal(first,shared);
 const rejected=assert.rejects(first,error=>error.code==='SESSION_CHANGED');for(let i=0;i<4;i++)await Promise.resolve();owner='B';revision++;owner=account;revision++;finish();await rejected;assert.equal(sent,0);
 await transferTextOnce(account,thread,message,async check=>{check();sent++;});assert.equal(sent,1);
});
test('invalid identifiers, injected thread paths and oversized or empty text never execute a transfer',async()=>{
 let sent=0;const {transferTextOnce}=load('text-transfer.ts',{'./device-cache':{getDeviceCacheRevision:()=>0,isDeviceCacheOwner:()=>true}});
 for(const [user,destination,message]of [['bad',thread,queued().message],[account,'../../payments',queued().message],[account,thread,{...queued().message,id:'fake'}],[account,thread,{...queued().message,body:' '}],[account,thread,{...queued().message,body:'x'.repeat(5001)}],[account,thread,{...queued().message,replyToMessageId:'bad'}]])await assert.rejects(transferTextOnce(user,destination,message,async()=>{sent++;}));
 assert.equal(sent,0);
});
