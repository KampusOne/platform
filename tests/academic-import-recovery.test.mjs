import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { normalizeApiTimestamp, apiDate, formatApiDate } from '../mobile/src/lib/api-date.ts';

test('purchase timestamps use the ISO grammar Android supports, including SQL microseconds and offsets', () => {
  assert.equal(normalizeApiTimestamp('2026-09-15 13:31:40.722796+00'), '2026-09-15T13:31:40.722+00:00');
  assert.equal(apiDate('2026-09-16 15:00:00+00').toISOString(), '2026-09-16T15:00:00.000Z');
  assert.equal(apiDate('2026-09-16 16:00:00.999999+0100').toISOString(), '2026-09-16T15:00:00.999Z');
  for (const value of [null, undefined, '', 'broken-date']) assert.equal(formatApiDate(value, {day:'numeric'}), 'Date unavailable');
  assert.match(formatApiDate('2026-09-16 15:00:00+00', {month:'long'}), /September/);
});

class ApiError extends Error { constructor(status, code, details) { super(code); this.status=status; this.code=code; this.details=details; } }
function client(transport) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../mobile/src/lib/api.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source, {exports,module:{exports},Date,Promise,WeakMap,AbortController,setTimeout,clearTimeout,require:name => ({
    './api-transport':{api:transport,ApiError,currentApiUrl:()=>'/api'},
    './media-links':{normalizeMediaLinks:v=>v},
    './request-policy':{waitForRequest:async(p,signal)=>{if(signal?.aborted)throw Error('cancelled');return p;}},
  })[name]});
  return exports.api;
}
const id='11111111-1111-4111-8111-111111111111';
test('a lost AI response recovers the saved preview through GET without resubmitting POST',async()=>{
  const calls=[];
  const api=client(async(path,init)=>{calls.push([path,init.method ?? 'GET']);if(init.method==='POST')throw new ApiError(0,'NETWORK_UNAVAILABLE');return {status:'completed',entries:[{title:'MTH 201'}]};});
  const result=await api('/v1/ai',{method:'POST',body:JSON.stringify({idempotencyKey:id}),timeoutMs:50});
  assert.equal(result.entries[0].title,'MTH 201');
  assert.deepEqual(calls,[['/v1/ai','POST'],['/v1/ai/requests/'+id,'GET']]);
});
test('a duplicate AI submission checks its existing result and preserves a classified provider failure',async()=>{
  let writes=0;
  const api=client(async(path,init)=>{if(init.method==='POST'){writes++;throw new ApiError(409,'CONFLICT',{reason:'AI_PROCESSING'});}throw new ApiError(503,'PROVIDER_UNAVAILABLE',{reason:'AI_PROVIDER_BUSY',retryWithNewKey:false});});
  await assert.rejects(api('/v1/ai',{method:'POST',body:JSON.stringify({idempotencyKey:id}),timeoutMs:50}),e=>e.details.reason==='AI_PROVIDER_BUSY' && e.details.retryWithNewKey===false);
  assert.equal(writes,1);
});
test('navigation cancellation never recovers AI into an abandoned screen',async()=>{
  const controller=new AbortController();let reads=0;
  const api=client(async(path,init)=>{if(init.method==='POST'){controller.abort();throw new ApiError(0,'NETWORK_UNAVAILABLE');}reads++;return {status:'completed'};});
  await assert.rejects(api('/v1/ai',{method:'POST',signal:controller.signal,body:JSON.stringify({idempotencyKey:id}),timeoutMs:50}));
  assert.equal(reads,0);
});
