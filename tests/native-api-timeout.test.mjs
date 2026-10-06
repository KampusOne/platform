import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {waitForRequest,invalidationTargets,matchesRead} from '../mobile/src/lib/request-policy.ts';

const require=createRequire(new URL('../server/package.json',import.meta.url));
const ts=require('typescript');
function nativeTransport(fetcher) {
  const policy={waitForRequest,invalidationTargets,matchesRead};
  const load=(file,mocks)=>{
    const exports={};
    const compiled=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(compiled,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing mock '+name);},process:{env:{EXPO_PUBLIC_KAMPUSONE_API_URL:'https://primary.invalid',EXPO_PUBLIC_KAMPUSONE_API_FALLBACK_URL:'https://backup.invalid'}},fetch:fetcher,Headers,FormData,Response,AbortController,Error,TypeError,Date,setTimeout,clearTimeout});
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
