import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const ts = createRequire(new URL('../server/package.json', import.meta.url))('typescript');
class ApiError extends Error { constructor(status, code, message, details) { super(message); Object.assign(this, {status,code,details}); } }
function harness() {
  let now=Date.now(),next=0;const timers=new Map(),exports={};
  const schedule=(callback,delay)=>{const id=++next;timers.set(id,{callback,at:now+delay});return id;};
  class Clock extends Date { static now(){ return now; } }
  const source=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/ai-request.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,module:{exports},require:()=>({ApiError}),Date:Clock,AbortController,Error,JSON,setTimeout:schedule,clearTimeout:id=>timers.delete(id)});
  return {submit:exports.submitTrackedAIRequest,timers,async advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}for(let i=0;i<30;i++)await Promise.resolve();}};
}
const id='11111111-1111-4111-8111-111111111111';
const input={method:'POST',timeoutMs:180000,body:JSON.stringify({mode:'timetable',idempotencyKey:id,consent:true})};
test('a completed timetable receipt wins over a lost upload response without resubmitting or charging again',async()=>{
  const h=harness(),calls=[],stages=[];let read=0;
  const pending=h.submit(async(path,init)=>{calls.push({path,init});if(init.method==='POST')return new Promise(()=>{});return ++read===1?{requestId:id,status:'processing',stage:'reading'}:{requestId:id,status:'completed',entries:[{courseCode:'MTH 201'}]};},input,stage=>stages.push(stage));
  await h.advance(1000);await h.advance(2500);
  assert.equal((await pending).entries[0].courseCode,'MTH 201');assert.deepEqual(stages,['reading']);assert.equal(calls.filter(c=>c.init.method==='POST').length,1);assert.equal(calls[0].init.signal.aborted,true);assert.equal(h.timers.size,0);
});
test('retrying an already-processing academic calendar follows its receipt to completion',async()=>{
  const h=harness();let posts=0;
  const pending=h.submit(async(_path,init)=>{if(init.method==='POST'){posts++;throw new ApiError(409,'CONFLICT','Still processing',{reason:'AI_PROCESSING'});}return {requestId:id,status:'completed',documentType:'academic_calendar',events:[{title:'Registration'}]};},input,()=>{});
  await h.advance(1000);assert.equal((await pending).events.length,1);assert.equal(posts,1);assert.equal(h.timers.size,0);
});
test('provider failures remain visible with their retry instructions rather than becoming a fabricated result',async()=>{
  const h=harness();let posts=0;
  const pending=h.submit(async(_path,init)=>{if(init.method==='POST'){posts++;return new Promise(()=>{});}throw new ApiError(503,'PROVIDER_UNAVAILABLE','Image could not be read',{reason:'AI_UNREADABLE_DOCUMENT',retryWithNewKey:true});},input,()=>{});
  const rejected=assert.rejects(pending,error=>error.details?.reason==='AI_UNREADABLE_DOCUMENT');await h.advance(1000);await rejected;assert.equal(posts,1);assert.equal(h.timers.size,0);
});
test('leaving the exam import cancels receipt polling and preserves the draft key',async()=>{
  const h=harness(),controller=new AbortController();let reads=0;
  const pending=h.submit(async(_path,init)=>{if(init.method==='POST')return new Promise(()=>{});reads++;return {requestId:id,status:'processing',stage:'analysing'};},{...input,signal:controller.signal},()=>{});
  const rejected=assert.rejects(pending,/Left screen/);controller.abort(new Error('Left screen'));await rejected;await h.advance(60000);assert.equal(reads,0);assert.equal(h.timers.size,0);
});
