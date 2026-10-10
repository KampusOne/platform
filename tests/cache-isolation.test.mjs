import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {nativeTransport} from './helpers/native-transport.mjs';
import {cacheScopeForUser,cacheExpiry,readCachePolicy,invalidationTargets} from '../mobile/src/lib/request-policy.ts';
import * as portalPolicy from '../portal/lib/api-cache-policy.ts';
const require=createRequire(new URL('../server/package.json',import.meta.url)),ts=require('typescript');
const a={id:'a',universityId:'tenant-a',roles:['STUDENT'],operatorRoles:[]};
const b={...a,id:'b',universityId:'tenant-b'};
function session(user,token='synthetic'){return {accessToken:token,refreshToken:'synthetic-refresh',expiresIn:900,user};}
function module(file,mocks,globals={}){
  const exports={};const text=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(text,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing mock '+name);},process:{env:{}},Headers,FormData,Response,AbortController,AbortSignal,Error,TypeError,Date,setTimeout,clearTimeout,window:{location:{hostname:'localhost'},addEventListener(){}},...globals});return exports;
}
function portal(fetch){return module('portal/lib/api.ts',{'./api-cache-policy':portalPolicy,'./session-lock':{withSessionLock:fn=>fn()}},{fetch});}
test('late mobile private responses cannot resolve across logout/login, including bypass modes',async()=>{
  for(const options of [{},{cache:'no-store'},{headers:{'X-Test-Variant':'x'}}]){
    let finish;const api=nativeTransport(()=>new Promise(resolve=>{finish=()=>resolve(Response.json({private:'A'}));}));
    api.setAccessToken('A',a.id,cacheScopeForUser(a));const pending=api.api('/v1/student/gpa',options);
    const rejected=assert.rejects(pending,error=>error.code==='SESSION_CHANGED');
    api.setAccessToken(null);api.setAccessToken('B',b.id,cacheScopeForUser(b));finish();await rejected;
    assert.equal(api.peekTransportCache('/v1/student/gpa',{allowStale:true}),undefined);
  }
});
test('same user changing institution or trusted roles invalidates pending and completed reads',async()=>{
  let finish;const api=nativeTransport(url=>url.includes('gpa')?new Promise(resolve=>{finish=()=>resolve(Response.json({grades:'old'}));}):Promise.resolve(Response.json({profile:'old'})));
  api.setAccessToken('A',a.id,cacheScopeForUser(a));await api.api('/v1/student/me');const pending=api.api('/v1/student/gpa');
  const rejected=assert.rejects(pending,error=>error.code==='SESSION_CHANGED');
  api.setAccessToken('A2',a.id,cacheScopeForUser({...a,universityId:'tenant-new',operatorRoles:['UNIVERSITY_ADMIN']}));finish();await rejected;
  assert.equal(api.peekTransportCache('/v1/student/me'),undefined);
});
test('reload starts a new read and an older response cannot replace it',async()=>{
  const pending=[];const api=nativeTransport(()=>new Promise(resolve=>pending.push(resolve)));api.setAccessToken('A',a.id);
  const old=api.api('/v1/student/gpa'),fresh=api.api('/v1/student/gpa',{cache:'reload'});
  assert.equal(pending.length,2);pending[1](Response.json({revision:2}));await fresh;pending[0](Response.json({revision:1}));await old;
  assert.equal(api.peekTransportCache('/v1/student/gpa').revision,2);
});
test('WAT midnight expires Today snapshots and unknown or sensitive paths are fresh',async()=>{
  const before=Date.parse('2026-10-10T22:59:59.500Z'),midnight=Date.parse('2026-10-10T23:00:00Z');
  assert.equal(cacheExpiry('/v1/student/home',before,120000),midnight);
  assert.equal(portalPolicy.portalCacheExpiry('/v1/student/home',before,8000),midnight);
  for(const path of ['/v1/new-feature','/v1/account/sessions','/v1/account/support','/v1/account/restrictions','/v1/student/publishing/capabilities','/v1/trusted-vendors/context','/v1/notifications/devices','/v1/notifications/runtime','/v1/agents/products','/v1/payments/status/reference','/v1/ai/subscription','/v1/maps/admin/campuses/id/review']){
    assert.equal(readCachePolicy(path).freshMs,0,path);assert.equal(portalPolicy.portalReadCacheTtl(path),0,path);
  }
  for(const prefix of ['/v1/people','/v1/student/feed','/v1/discovery','/v1/messages','/v1/notifications','/v1/communities']) assert.ok(invalidationTargets('/v1/people/person/block').includes(prefix));
});
test('completed payment and quota reads are never reused; cancellation stays caller scoped',async()=>{
  let calls=0;const api=nativeTransport(async()=>Response.json({revision:++calls}));
  for(const path of ['/v1/payments/summary','/v1/ai/status','/v1/agents/earnings']){
    const one=await api.api(path),two=await api.api(path);assert.notEqual(one.revision,two.revision);assert.equal(api.peekTransportCache(path,{allowStale:true}),undefined);
  }
  let finish;const shared=nativeTransport(()=>new Promise(resolve=>{finish=()=>resolve(Response.json({ok:true}));}));
  const controller=new AbortController(),one=shared.api('/v1/student/gpa',{signal:controller.signal}),two=shared.api('/v1/student/gpa');
  const rejected=assert.rejects(one,/left/);controller.abort(new Error('left'));finish();await rejected;assert.equal((await two).ok,true);
});
test('portal rejects old-session payloads after an A -> B -> A switch and scope changes',async()=>{
  for(const options of [{},{cache:'no-store'},{headers:{'X-Test':'1'}}]){
    let finish;const api=portal(()=>new Promise(resolve=>{finish=()=>resolve(Response.json({private:'old A'}));}));
    api.applySession(session(a));const pending=api.portalApi('/v1/student/gpa',options);const rejected=assert.rejects(pending,error=>error.code==='SESSION_CHANGED');
    api.applySession(session(b));api.applySession(session(a,'new-A'));finish();await rejected;
  }
});
test('portal token rotation preserves safe reads while roles and institution changes clear them',async()=>{
  let calls=0;const api=portal(async()=>Response.json({revision:++calls}));api.applySession(session(a));
  await api.portalApi('/v1/student/gpa');api.applySession(session(a,'rotated'));assert.equal((await api.portalApi('/v1/student/gpa')).revision,1);
  api.applySession(session({...a,universityId:'new-tenant'}));assert.equal((await api.portalApi('/v1/student/gpa')).revision,2);
  api.applySession(session({...a,operatorRoles:['ADMIN']}));assert.equal((await api.portalApi('/v1/student/gpa')).revision,3);
});
test('portal reports corrupt successful JSON as an API error instead of caching null',async()=>{
  let calls=0;const api=portal(async()=>{calls++;return new Response('unreadable',{status:200});});api.applySession(session(a));
  for(let n=0;n<2;n++)await assert.rejects(api.portalApi('/v1/student/gpa'),error=>error.code==='INVALID_RESPONSE');assert.equal(calls,2);
});
test('device cache never writes profiles/session or hydrates legacy private disk data',async()=>{
  const storage=new Map([['k1.cache.v2.profile.a',JSON.stringify({data:{private:'legacy'},expires:Date.now()+100000})]]);
  const asyncStorage={getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>{storage.set(key,value);},removeItem:async key=>{storage.delete(key);},getAllKeys:async()=>[...storage.keys()],multiRemove:async keys=>{for(const key of keys)storage.delete(key);}};
  const cache=module('mobile/src/lib/device-cache.ts',{'@react-native-async-storage/async-storage':{__esModule:true,default:asyncStorage}});
  assert.equal(await cache.readCache('profile.a'),null);await cache.writeCache('profile.a',{private:'new'});await cache.writeCache('last-session',{user:a});
  assert.equal((await cache.readCache('profile.a')).private,'new');
  assert.equal(storage.has('k1.cache.v2.last-session'),false);assert.equal(storage.has('k1.cache.v2.profile.a'),false);
  await cache.clearDeviceCache();assert.equal(await cache.readCache('profile.a'),null);
});
