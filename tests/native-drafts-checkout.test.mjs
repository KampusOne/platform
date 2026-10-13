import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const ts = createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
function load(file,mocks={}) {
  const exports={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing dependency '+name);},Uint8Array,TextEncoder,TextDecoder,Date,Error,Number,Promise,setTimeout,clearTimeout});
  return exports;
}
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333';
const snapshots=load('secure-snapshots.ts'),bytes=load('snapshot-ciphertext.ts');
function nativeFixture() {
  const data=new Map(),keys=new Map();let bridgeReads=0;
  const storage={getItem:async key=>data.get(key)??null,setItem:async(key,value)=>data.set(key,value),removeItem:async key=>data.delete(key),getAllKeys:async()=>[...data.keys()],multiRemove:async list=>list.forEach(key=>data.delete(key))};
  const encryptionKey=value=>({value,encoded:async()=>value.toString('base64')});
  const crypto={CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,value)=>createHash('sha256').update(value).digest('hex'),AESEncryptionKey:{generate:async()=>encryptionKey(randomBytes(32)),import:async value=>encryptionKey(Buffer.from(value,'base64'))},
    AESSealedData:{fromCombined(value){assert.ok(value instanceof Uint8Array,'The Android bridge rejects a string argument');bridgeReads++;return Buffer.from(value);}},
    aesEncryptAsync:async(plaintext,key,{additionalData})=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key.value,iv);cipher.setAAD(Buffer.from(additionalData));const result=Buffer.concat([iv,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);return{combined:async()=>result.toString('base64')};},
    aesDecryptAsync:async(sealed,key,{additionalData})=>{const cipher=createDecipheriv('aes-256-gcm',key.value,sealed.subarray(0,12));cipher.setAAD(Buffer.from(additionalData));cipher.setAuthTag(sealed.subarray(-16));return Uint8Array.from(Buffer.concat([cipher.update(sealed.subarray(12,-16)),cipher.final()]));},
  };
  const secureStore={isAvailableAsync:async()=>true,getItemAsync:async id=>keys.get(id)??null,setItemAsync:async(id,value)=>keys.set(id,value),deleteItemAsync:async id=>keys.delete(id),WHEN_UNLOCKED_THIS_DEVICE_ONLY:4};
  const adapter=()=>load('secure-snapshots.native-adapter.ts',{'@react-native-async-storage/async-storage':{__esModule:true,default:storage},'react-native':{Platform:{OS:'android'}},'./secure-snapshots':snapshots,'./snapshot-ciphertext':bytes,'expo-crypto':crypto,'expo-secure-store':secureStore}).secureSnapshots;
  return {data,keys,storage,adapter,bridgeReads:()=>bridgeReads};
}
test('production native adapter uses bytes and restores authenticated Unicode after fresh key import',async()=>{
  const f=nativeFixture(),key='ai-workspace-v3.'+owner,scope=JSON.stringify([owner,'A',['STUDENT'],[]]);
  const first=f.adapter();first.activate(scope,owner);const value={prompt:'GST ₦6,000 café 🥂'};await first.write(key,value,60000);
  const restart=f.adapter();restart.activate(scope,owner);assert.equal((await restart.read(key,{requireIntegrity:true})).data.prompt,value.prompt);assert.ok(f.bridgeReads()>0);
  assert.equal([...f.data.values()].join('').includes('GST'),false);assert.equal(f.keys.size,1);
  restart.activate(JSON.stringify([owner,'B',[],[]]),owner);assert.equal(await restart.read(key),null);
  restart.activate(scope,owner);const location=[...f.data.keys()].find(k=>!k.endsWith('.index')&&!k.endsWith('.scopes')),raw=JSON.parse(f.data.get(location)),decoded=Buffer.from(raw.sealed,'base64');decoded[decoded.length-1]^=1;raw.sealed=decoded.toString('base64');f.data.set(location,JSON.stringify(raw));
  const before=f.data.get(location);await assert.rejects(restart.read(key,{requireIntegrity:true}),/saved copy has been kept/);assert.equal(f.data.get(location),before);
});
test('base64 ciphertext conversion rejects malformed or truncated envelopes',()=>{
  for(const raw of ['', 'a'.repeat(31),'!!!!','YWJjZA==','a'.repeat(800000)])assert.throws(()=>bytes.snapshotCiphertextBytes(raw));
  for(const n of [28,29,30,4097,131073,262172]){const input=randomBytes(n);assert.deepEqual(Buffer.from(bytes.snapshotCiphertextBytes(input.toString('base64'))),input);}
});
const {readKiraCheckoutQuote}=load('kira-checkout-quote.ts');
const quote={quoteId:product,tier:'pro',version:'synthetic',amountKobo:600000,paystackAmountKobo:581000,estimatedProcessingKobo:19000,feeBearer:'CUSTOMER_PASSTHROUGH',expiresAt:'2026-10-13T00:30:00Z'};
test('the actual production Pro amount breakdown is accepted without changing its total',()=>{
  assert.equal(readKiraCheckoutQuote(quote,'pro').amountKobo,600000);
  assert.equal(readKiraCheckoutQuote({...quote,feeBearer:'LEGACY_INCLUSIVE',paystackAmountKobo:600000},'pro').amountKobo,600000);
});
test('Kira rejects mismatched money, other tiers and malformed or unbounded quote fields',()=>{
  for(const changed of [{paystackAmountKobo:600000},{amountKobo:600000.5},{estimatedProcessingKobo:-1},{tier:'standard'},{expiresAt:'invalid'},{quoteId:'invalid'},{feeBearer:'unknown'}])assert.throws(()=>readKiraCheckoutQuote({...quote,...changed},'pro'));
});
function cartFixture() {
  let revision=1,stored=null,fail=false,held,delay=false;const saves=[];
  const device={getDeviceCacheRevision:()=>revision,readOwnedDraft:async()=>stored,saveOwnedDraft:async(key,items,scope)=>{if(delay)await new Promise(resolve=>{held=resolve;});if(fail)throw Error('Storage is full');saves.push({key,items,scope});stored=items;return'device';}};
  let effectDeps=[];
  const react={useCallback:fn=>fn,useEffect:(fn,deps)=>{if(deps.some((value,i)=>value!==effectDeps[i])){effectDeps=deps;fn();}},useSyncExternalStore:(_subscribe,snapshot)=>snapshot()};
  const {useMarketplaceCart}=load('marketplace-cart.ts',{'react':react,'./device-cache':device});
  const render=(user=owner)=>useMarketplaceCart(user),settle=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
  return {render,settle,saves,setFail:value=>{fail=value;},setDelay:value=>{delay=value;},release:()=>held(),switchAccount:()=>revision++,setStored:value=>{stored=value;}};
}
test('catalogue and checkout share immediate quantity changes and payment removal',async()=>{
  const f=cartFixture();f.render();await f.settle();const catalogue=f.render();catalogue.update({[product]:1});const checkout=f.render();assert.equal(checkout.items[product],1);checkout.update(current=>({...current,[product]:2}));assert.equal(f.render().items[product],2);await f.settle();await f.render().flush();assert.equal(f.saves.at(-1).items[product],2);f.render().update({});await f.settle();assert.equal(f.render().items[product],undefined);
});
test('a genuine cart storage failure stays visible and retry proves the saved cart',async()=>{
  const f=cartFixture();f.render();await f.settle();f.setFail(true);f.render().update({[product]:1});await f.settle();assert.match(f.render().error,/Storage is full/);assert.equal(f.render().items[product],1);await assert.rejects(f.render().flush(),/Storage is full/);f.setFail(false);await f.render().flush();assert.equal(f.render().error,'');assert.equal(f.saves.at(-1).items[product],1);
});
test('failed cart restore blocks edits and retains the saved payload for recovery',async()=>{
  const f=cartFixture();f.setStored({[product]:'malformed'});f.render();await f.settle();assert.equal(f.render().ready,false);assert.match(f.render().error,/needs recovery/);f.render().update({[product]:1});assert.equal(f.saves.length,0);f.setStored({[product]:2});f.render().retry();await f.settle();assert.equal(f.render().items[product],2);
});
test('late save failures from the previous account cannot change another account cart',async()=>{
  const f=cartFixture();f.render();await f.settle();f.setDelay(true);f.render().update({[product]:1});await f.settle();f.switchAccount();f.setStored(null);f.render(other);await f.settle();f.setFail(true);f.release();await f.settle();assert.equal(f.render(other).error,'');assert.equal(f.render(other).items[product],undefined);
});
