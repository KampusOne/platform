import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';

const ownerA='11111111-1111-4111-8111-111111111111';
const ownerB='22222222-2222-4222-8222-222222222222';
const thread='33333333-3333-4333-8333-333333333333';
function secureModule() {
  const exports={};
  const source=readFileSync(new URL('../mobile/src/lib/secure-snapshots.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,module:{exports},require(){throw Error('Unexpected dependency');},TextEncoder,Date,Error,Number,Promise});
  return exports;
}
const {SecureSnapshots,isStorageCapacityError}=secureModule();
const scope=(owner)=>JSON.stringify([owner,'campus',[],[]]);
const dmKey=owner=>'message-draft.'+owner+'.'+thread;
function fixture() {
  const data=new Map();let quota=Infinity;
  const bytes=()=>[...data].reduce((n,[k,v])=>n+Buffer.byteLength(k)+Buffer.byteLength(v),0);
  const io={
    keys:async()=>[...data.keys()],
    get:async k=>data.get(k)??null,
    set:async(k,v)=>{
      const previous=data.get(k);
      const after=bytes()-(previous==null?0:Buffer.byteLength(k)+Buffer.byteLength(previous))+Buffer.byteLength(k)+Buffer.byteLength(v);
      if(after>quota)throw Error('database or disk is full (code 13 SQLITE_FULL[13])');
      data.set(k,v);
    },
    remove:async k=>{data.delete(k);},
    hash:async x=>createHash('sha256').update(x).digest('hex'),
    seal:async(_id,text)=>Buffer.from(text).toString('base64'),
    open:async(_id,sealed)=>Buffer.from(sealed,'base64').toString(),
    destroyKey:async()=>{},
  };
  return {data,bytes,store:new SecureSnapshots(io),setQuota:value=>{quota=value;}};
}
test('recognises SQLite quota errors rather than ordinary network failures',()=>{
  assert.equal(isStorageCapacityError(Error('database or disk is full (code 13 SQLITE_FULL[13])')),true);
  assert.equal(isStorageCapacityError('SQLITE_FULL'),true);
  assert.equal(isStorageCapacityError(Error('Unable to connect')),false);
});
test('full store deletes disposable signed snapshots, then retries an unsent DM once',async()=>{
  const f=fixture();
  f.store.activate(scope(ownerA),ownerA);
  await f.store.write('snapshot./v1/student/feed',{body:'x'.repeat(2400)},1000000);
  f.store.activate(scope(ownerB),ownerB);
  await f.store.write(dmKey(ownerB),JSON.stringify({version:1,text:'Old unsent DM',media:[],batches:[]}),1000000);
  f.setQuota(f.bytes()+200);
  await f.store.write(dmKey(ownerB),JSON.stringify({version:1,text:'Newest unsent DM '+'y'.repeat(1250),media:[],batches:[]}),1000000);
  assert.match((await f.store.read(dmKey(ownerB),{requireIntegrity:true})).data,/Newest unsent DM/);
  f.store.activate(scope(ownerA),ownerA);
  assert.equal(await f.store.read('snapshot./v1/student/feed'),null);
});
test('quota recovery preserves protected drafts and damaged ciphertext across accounts',async()=>{
  const f=fixture();
  f.store.activate(scope(ownerA),ownerA);
  await f.store.write(dmKey(ownerA),JSON.stringify({version:1,text:'Keep me',pendingText:{id:thread},media:[],batches:[]}),1000000);
  f.store.activate(scope(ownerB),ownerB);
  await f.store.write('snapshot./v1/student/feed',{body:'z'.repeat(1800)},1000000);
  const broken='k1.encrypted.v1.'+'a'.repeat(64)+'.'+'b'.repeat(64);
  f.data.set(broken,'{broken');
  f.setQuota(f.bytes()+20);
  await f.store.write('snapshot./v1/student/home',{now:1},1000000);
  assert.equal(f.data.get(broken),'{broken');
  f.store.activate(scope(ownerA),ownerA);
  assert.match((await f.store.read(dmKey(ownerA),{requireIntegrity:true})).data,/Keep me/);
});
test('no reclaimable cache means failure is surfaced and existing draft is unchanged',async()=>{
  const f=fixture();
  f.store.activate(scope(ownerA),ownerA);
  await f.store.write(dmKey(ownerA),JSON.stringify({version:1,text:'Important offline send',media:[],batches:[]}),1000000);
  const before=new Map(f.data);
  const location=[...before.keys()].find(key=>!key.endsWith('.scopes')&&!key.endsWith('.index'));
  f.setQuota(f.bytes()+10);
  await assert.rejects(f.store.write(dmKey(ownerA),JSON.stringify({version:1,text:'New important offline message content',media:[],batches:[]}),1000000),/SQLITE_FULL/);
  assert.equal(f.data.get(location),before.get(location));
});
test('Android APK prebuild enables an explicit bounded 16 MB limit',()=>{
  const config=JSON.parse(readFileSync(new URL('../mobile/app.json',import.meta.url),'utf8'));
  assert.ok(config.expo.plugins.includes('./plugins/with-kampus-async-storage'));
  const source=readFileSync(new URL('../mobile/plugins/with-kampus-async-storage.js',import.meta.url),'utf8');
  assert.match(source,/AsyncStorage_db_size_in_MB/);assert.match(source,/value: '16'/);
});
