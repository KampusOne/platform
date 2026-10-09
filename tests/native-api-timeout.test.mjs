import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {waitForRequest,invalidationTargets,matchesRead} from '../mobile/src/lib/request-policy.ts';

const require=createRequire(new URL('../server/package.json',import.meta.url));
const ts=require('typescript');
function nativeTransport(fetcher, clock = Date) {
  const policy={waitForRequest,invalidationTargets,matchesRead};
  const load=(file,mocks)=>{
    const exports={};
    const compiled=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(compiled,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing mock '+name);},process:{env:{EXPO_PUBLIC_KAMPUSONE_API_URL:'https://primary.invalid',EXPO_PUBLIC_KAMPUSONE_API_FALLBACK_URL:'https://backup.invalid'}},fetch:fetcher,Headers,FormData,Response,AbortController,Error,TypeError,Date:clock,setTimeout,clearTimeout});
    return exports;
  };
  const deadline=load('request-deadline.ts',{'./request-policy':policy});
  return load('api-transport.ts',{'./request-policy':policy,'./request-deadline':deadline,'./session-lock':{withSessionLock:fn=>fn()},'expo-constants':{default:{expoConfig:{extra:{}}}},'react-native':{Platform:{OS:'android'}},'./analytics-bridge':{emitFeatureLifecycle(){}},'./session-storage':{readRefreshToken:async()=>null,removeRefreshToken:async()=>{},saveRefreshToken:async()=>{}}});
}
test('a timed-out native read reaches its backup within the original deadline and keeps authentication',async()=>{
  const calls=[];
  const api=nativeTransport((url,init)=>{
    calls.push({url,init});
    if(url.startsWith('https://primary.invalid'))return new Promise(()=>{}); // Native fetch may not settle on abort.
    return Promise.resolve(Response.json({name:'Campus business'}));
  });
  api.setAccessToken('synthetic-session');
  const started=Date.now();
  assert.deepEqual(await api.api('/v1/people/services/fixture',{cache:'no-store',timeoutMs:1000},false),{name:'Campus business'});
  assert.equal(calls.length,2);assert.equal(calls[0].init.signal.aborted,true);
  assert.equal(calls[1].init.headers.get('Authorization'),'Bearer synthetic-session');
  assert.equal(api.currentApiUrl(),'https://backup.invalid');
  assert.ok(Date.now()-started<1000,'backup was left part of the original deadline');
});
test('two stalled read origins still stop within a single total deadline',async()=>{
  const calls=[];const api=nativeTransport((url)=>{calls.push(url);return new Promise(()=>{});});
  const started=Date.now();
  await assert.rejects(api.api('/v1/ai/status',{cache:'no-store',timeoutMs:1000},false),e=>e.code==='REQUEST_TIMEOUT');
  assert.equal(calls.length,2);assert.ok(Date.now()-started<1500);
});
test('a stalled write is never replayed on the alternate origin',async()=>{
  const calls=[];const api=nativeTransport(url=>{calls.push(url);return new Promise(()=>{});});
  await assert.rejects(api.api('/v1/agents/products',{method:'POST',body:'{}',timeoutMs:50},false),e=>e.code==='REQUEST_TIMEOUT');
  assert.equal(calls.length,1);
});
test('leaving a screen cancels its read without starting a fallback',async()=>{
  const calls=[];const api=nativeTransport(url=>{calls.push(url);return new Promise(()=>{});});
  const controller=new AbortController();
  const pending=api.api('/v1/exams',{cache:'no-store',timeoutMs:1000,signal:controller.signal},false);
  controller.abort(new Error('left exam screen'));
  await assert.rejects(pending,/left exam screen/);assert.equal(calls.length,1);
});

test('reading a DM does not evict a pending GPA read or the open conversation',async()=>{
  let finish; const api=nativeTransport((url,init)=>{
    if(url.endsWith('/v1/student/gpa'))return new Promise(resolve=>{finish=()=>resolve(Response.json({cgpa:4.5}));});
    return Promise.resolve(Response.json({ok:true}));
  });
  const gpa=api.api('/v1/student/gpa');
  await api.api('/v1/messages/threads/fixture');
  await api.api('/v1/messages/threads/fixture/read',{method:'PUT'});
  finish(); await gpa;
  assert.equal(api.peekTransportCache('/v1/student/gpa').cgpa,4.5);
  assert.equal(api.peekTransportCache('/v1/messages/threads/fixture').ok,true);
});

test('token renewal preserves only the same account cache and account switches discard it',async()=>{
  const api=nativeTransport(async()=>Response.json({private:'account A'}));
  api.setAccessToken('first-token','account-a');
  await api.api('/v1/student/gpa');
  api.setAccessToken('renewed-token','account-a');
  assert.equal(api.peekTransportCache('/v1/student/gpa').private,'account A');
  api.setAccessToken('another-token','account-b');
  assert.equal(api.peekTransportCache('/v1/student/gpa',{allowStale:true}),undefined);
});

test('rendering can read recent cached data while live reads still honor freshness and mutations',async()=>{
  let now=Date.now(); const clock=class extends Date {static now(){return now;}};
  let reads=0;const api=nativeTransport(async(_url,init)=>Response.json(init.method==='POST'?{ok:true}:{revision:++reads}),clock);
  api.setAccessToken('token','account-a');
  await api.api('/v1/student/gpa');now+=21_000;
  assert.equal(api.peekTransportCache('/v1/student/gpa'),undefined);
  assert.equal(api.peekTransportCache('/v1/student/gpa',{allowStale:true}).revision,1);
  assert.equal((await api.api('/v1/student/gpa')).revision,2);
  await api.api('/v1/student/gpa',{method:'POST',body:'{}'});
  assert.equal(api.peekTransportCache('/v1/student/gpa',{allowStale:true}),undefined);
});

test('an invalidated late read cannot resurrect after its replacement fails',async()=>{
  const pending=[]; const api=nativeTransport(async(_url,init)=>{
    if(init.method==='POST')return Response.json({ok:true});
    return new Promise((resolve,reject)=>pending.push({resolve,reject}));
  });
  const old=api.api('/v1/student/gpa');
  await api.api('/v1/student/gpa',{method:'POST',body:'{}'});
  const next=api.api('/v1/student/gpa');
  pending[1].reject(new Error('server rejected the refreshed read'));
  await assert.rejects(next,/server rejected/);
  pending[0].resolve(Response.json({revision:'obsolete'})); await old;
  assert.equal(api.peekTransportCache('/v1/student/gpa',{allowStale:true}),undefined);
});
