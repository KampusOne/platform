import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';
import { waitForRequest } from '../mobile/src/lib/request-policy.ts';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function load(file,mocks={},globals={}) {
  const exports={},code=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,module:{exports},require:key=>{if(key in mocks)return mocks[key];throw Error('Missing dependency '+key);},setTimeout,clearTimeout,Date,Error,TextEncoder,AbortController,...globals});return exports;
}
const snapshots=load('secure-snapshots.ts'),fields=load('draft-fields.ts'),photos=load('listing-photos.ts',{'./draft-fields':fields});
const editor=load('calendar-editor.ts',{'./draft-fields':fields});
const forms=load('form-drafts.ts',{'./draft-fields':fields,'./listing-photos':photos,'./calendar-editor':editor});
const account='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function fixture() {
  const data=new Map(),keys=new Map();let now=1000;
  const io={get:async key=>data.get(key)??null,set:async(key,value)=>{data.set(key,value);},remove:async key=>{data.delete(key);},keys:async()=>[...data.keys()],hash:async text=>createHash('sha256').update(text).digest('hex'),destroyKey:async id=>{keys.delete(id);},
    seal:async(id,text,aad)=>{const key=keys.get(id)??randomBytes(32);keys.set(id,key);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]).toString('base64');},
    open:async(id,raw,aad)=>{if(!keys.has(id))return null;const bytes=Buffer.from(raw,'base64'),cipher=createDecipheriv('aes-256-gcm',keys.get(id),bytes.subarray(0,12));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();},
  };
  const store=new snapshots.SecureSnapshots(io,()=>now),storage={getAllKeys:async()=>[],getItem:async()=>null,removeItem:async()=>{},multiRemove:async()=>{}};
  const cache=load('device-cache.ts',{'react-native':{Platform:{OS:'android'}},'./secure-snapshots':snapshots,'./secure-snapshots.native-adapter':{secureSnapshots:store},'@react-native-async-storage/async-storage':{__esModule:true,default:storage}});
  cache.setDeviceCacheScope(JSON.stringify([account,'A',[],[]]),account);
  return {data,keys,io,store,cache,advance:n=>{now+=n;},cold:()=>cache.setDeviceCacheScope(JSON.stringify([account,'A',['TUTOR'],[]]),account)};
}
test('primary restore distinguishes no draft from encrypted unreadable work and preserves ciphertext',async()=>{
  for(const corruption of ['envelope','ciphertext','missing-key','oversize']){
    const f=fixture(),key='listing-draft.'+account;assert.equal(await f.cache.readOwnedDraft(key),null);await f.cache.saveOwnedDraft(key,{name:'My existing work'});f.cold();
    const location=[...f.data.keys()].find(key=>!key.endsWith('.index')&&!key.endsWith('.scopes'));
    if(corruption==='envelope')f.data.set(location,'{bad-json');
    if(corruption==='ciphertext'){const envelope=JSON.parse(f.data.get(location)),bytes=Buffer.from(envelope.sealed,'base64');bytes[20]^=1;envelope.sealed=bytes.toString('base64');f.data.set(location,JSON.stringify(envelope));}
    if(corruption==='missing-key')f.keys.clear();
    if(corruption==='oversize')f.data.set(location,'x'.repeat(600000));
    const before=new Map(f.data);await assert.rejects(f.cache.readOwnedDraft(key),/saved copy has been kept/);assert.deepEqual(f.data,before);
    assert.equal(await f.store.read(key),null);await assert.rejects(f.cache.readOwnedDraft('listing-draft.'+other),/different session/);
  }
});
test('expired unsubmitted work is retained for recovery while expired completion markers may be empty',async()=>{
  const f=fixture(),key='exam-draft.'+account;await f.store.write(key,{text:'Unsubmitted exam notes'},50);f.advance(51);
  const before=new Map(f.data);await assert.rejects(f.cache.readOwnedDraft(key),/saved copy has been kept/);assert.deepEqual(f.data,before);
  await f.store.write(key,null,50);f.advance(51);assert.equal(await f.cache.readOwnedDraft(key),null);
});
test('a delayed decrypt cannot replace newer primary work in memory after a save',async()=>{
  const f=fixture(),key='timetable-draft.'+account;await f.cache.saveOwnedDraft(key,{text:'Original'});f.cold();
  const open=f.io.open;let finish,first=true;f.io.open=(...args)=>{if(first){first=false;return new Promise(resolve=>{finish=()=>open(...args).then(resolve);});}return open(...args);};
  const pending=f.cache.readOwnedDraft(key);while(!finish)await Promise.resolve();
  await f.cache.saveOwnedDraft(key,{text:'Latest edit'});finish();assert.equal((await pending).text,'Latest edit');assert.equal((await f.cache.readOwnedDraft(key)).text,'Latest edit');
});
test('unrelated primary writes do not interrupt a cold draft restore',async()=>{
  const f=fixture(),key='onboarding.'+account;await f.cache.saveOwnedDraft(key,{firstName:'Existing'});f.cold();
  const open=f.io.open;let finish,first=true;f.io.open=(...args)=>{if(first){first=false;return new Promise(resolve=>{finish=()=>open(...args).then(resolve);});}return open(...args);};
  const pending=f.cache.readOwnedDraft(key);while(!finish)await Promise.resolve();await f.cache.saveOwnedDraft('cart.'+account,{items:[]});finish();assert.equal((await pending).firstName,'Existing');
});
test('corrupted modern onboarding does not fall back to or delete a plaintext legacy copy',async()=>{
  const f=fixture(),key='onboarding.'+account;await f.cache.saveOwnedDraft(key,JSON.stringify({firstName:'Existing'}));f.cold();f.keys.clear();let legacyReads=0,removals=0;
  const migration=load('private-cache-migration.ts',{'@react-native-async-storage/async-storage':{__esModule:true,default:{getItem:async()=>{legacyReads++;return '{}';},removeItem:async()=>{removals++;}}},'react-native':{Platform:{OS:'android'}},'./device-cache':f.cache,'./secure-snapshots':snapshots,'./secure-snapshots.native-adapter':{secureSnapshots:f.store}});
  const before=new Map(f.data);await assert.rejects(migration.readMigratedPrivateCache('legacy',key,account),/saved copy has been kept/);assert.equal(legacyReads,0);assert.equal(removals,0);assert.deepEqual(f.data,before);
});
test('a legacy read crossing A to B to A never imports the old plaintext into the new session',async()=>{
  const f=fixture();let finish,removals=0;
  const migration=load('private-cache-migration.ts',{'@react-native-async-storage/async-storage':{__esModule:true,default:{getItem:()=>new Promise(resolve=>{finish=resolve;}),removeItem:async()=>{removals++;}}},'react-native':{Platform:{OS:'android'}},'./device-cache':f.cache,'./secure-snapshots':snapshots,'./secure-snapshots.native-adapter':{secureSnapshots:f.store}});
  const pending=migration.readMigratedPrivateCache('legacy','onboarding.'+account,account);while(!finish)await Promise.resolve();
  f.cache.setDeviceCacheScope('B',other);f.cache.setDeviceCacheScope('A again',account);finish('{"firstName":"Old session"}');assert.equal(await pending,null);assert.equal(f.data.size,0);assert.equal(removals,0);
});
test('shape validation preserves partial inputs and stable request IDs but rejects unsafe saved structures',()=>{
  const exam=forms.restoreExamDraft({papers:[{title:'Draft title',date:'2026-',startsAt:'09:',endsAt:'',courseCode:'',venue:''}],text:'My notes',requestId:account,saveId:other});assert.equal(exam.papers[0].date,'2026-');assert.equal(exam.saveId,other);
  assert.deepEqual(Array.from(forms.restoreListingDraft({image:'https://image.invalid/cover.jpg',images:[],requestId:account}).images),['https://image.invalid/cover.jpg']);
  for(const [parse,value]of [[forms.restoreExamDraft,{papers:[null]}],[forms.restoreExamDraft,{papers:[],requestId:'../injected'}],[forms.restoreTimetableDraft,{entries:[{dayOfWeek:9}]}],[forms.restoreListingDraft,{images:[42]}],[forms.restoreCampusDraft,{kind:'OTHER'}],[forms.restoreOnboardingDraft,'{"step":"2"}']])assert.throws(()=>parse(value));
});
function recoveryHarness(reader,apply) {
  const time=virtualClock(),host=hookRenderer();let revision=0,writes=[],value={text:''};
  const device={getDeviceCacheRevision:()=>revision,readOwnedDraft:reader,saveOwnedDraft:async(key,next)=>{writes.push({key,value:next});return'device';}};
  const dependencies={'react':host.react,'./device-cache':device,'./request-policy':{waitForRequest}};
  const restore=load('use-owned-draft-restore.ts',dependencies,{setTimeout:time.schedule,clearTimeout:time.cancel});
  const save=load('use-owned-draft-save.ts',dependencies,{setTimeout:time.schedule,clearTimeout:time.cancel});
  function render(){return host.render(()=>{const result=restore.useOwnedDraftRestore('exam-draft.'+account,next=>{apply?.(next);value=next??{text:''};});save.useOwnedDraftSave('exam-draft.'+account,value,result.ready);return result;});}
  return {time,host,render,writes,setRevision:n=>{revision=n;}};
}
test('failed restoration never enables blank autosave; explicit retry restores the existing draft',async()=>{
  let calls=0;const h=recoveryHarness(async()=>{if(++calls===1)throw Error('Saved copy unavailable');return{text:'Original notes'};});h.render();await h.time.advance(0);let view=h.render();assert.equal(view.ready,false);assert.equal(view.error,'Saved copy unavailable');await h.time.advance(10000);assert.equal(h.writes.length,0);
  view.retry();h.render();await h.time.advance(0);view=h.render();assert.equal(view.ready,true);await h.time.advance(300);assert.equal(h.writes.length,1);assert.equal(h.writes[0].value.text,'Original notes');h.host.unmount();assert.equal(h.time.timers.size,0);
});
test('restore deadlines expose recovery and late results cannot publish after retry, owner change or unmount',async()=>{
  const applied=[];let finish,calls=0;const h=recoveryHarness(()=>++calls===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({text:'Current draft'}),value=>applied.push(value));h.render();await h.time.advance(5000);let view=h.render();assert.equal(view.ready,false);assert.match(view.error,/took too long/);assert.equal(h.writes.length,0);
  view.retry();h.render();await h.time.advance(0);view=h.render();assert.equal(view.ready,true);finish({text:'Delayed old copy'});await h.time.advance(0);assert.equal(applied.length,1);assert.equal(applied[0].text,'Current draft');h.host.unmount();assert.equal(h.time.timers.size,0);
  let release;const changed=recoveryHarness(()=>new Promise(resolve=>{release=resolve;}),value=>applied.push(value));changed.render();changed.setRevision(1);changed.host.unmount();release({text:'Old owner'});await changed.time.advance(0);assert.equal(applied.length,1);assert.equal(changed.writes.length,0);assert.equal(changed.time.timers.size,0);
});
test('a malformed restored payload keeps editing and autosave locked',async()=>{
  const h=recoveryHarness(async()=>({papers:[null]}),value=>forms.restoreExamDraft(value));h.render();await h.time.advance(0);const view=h.render();assert.equal(view.ready,false);assert.match(view.error,/saved copy has been kept/);await h.time.advance(10000);assert.equal(h.writes.length,0);h.host.unmount();
});
test('an explicitly opened new exam draft can autosave after the previous draft completed',async()=>{
  const host=hookRenderer(),time=virtualClock(),written=[];
  const save=load('use-owned-draft-save.ts',{'react':host.react,'./device-cache':{getDeviceCacheRevision:()=>0,saveOwnedDraft:async(_key,value)=>{written.push(value);return'device';}}},{setTimeout:time.schedule,clearTimeout:time.cancel});
  const render=value=>host.render(()=>save.useOwnedDraftSave('exam-draft.'+account,value,true));
  let view=render({text:'Completed paper'});await time.advance(300);view.discard();render({text:''});await time.advance(300);assert.equal(written.length,1);
  view=render({text:'New paper'});view.begin();render({text:'New paper'});await time.advance(300);assert.equal(written.length,2);assert.equal(written[1].text,'New paper');host.unmount();assert.equal(time.timers.size,0);
});
test('draft saves have a deadline and a late storage completion cannot erase the timeout warning',async()=>{
  const host=hookRenderer(),time=virtualClock();let finish;
  const save=load('use-owned-draft-save.ts',{'react':host.react,'./device-cache':{getDeviceCacheRevision:()=>0,saveOwnedDraft:()=>new Promise(resolve=>{finish=resolve;})}},{setTimeout:time.schedule,clearTimeout:time.cancel});
  const render=()=>host.render(()=>save.useOwnedDraftSave('exam-draft.'+account,{text:'My work'},false));
  const view=render(),pending=view.persist({text:'My work'});const rejected=assert.rejects(pending,/took too long/);await time.advance(5000);await rejected;assert.match(render().warning,/took too long/);finish('device');await time.advance(0);assert.match(render().warning,/took too long/);view.discard();host.unmount();assert.equal(time.timers.size,0);
});
test('a receipt persisted during submission wins the unmount flush over an older autosave snapshot',async()=>{
  const host=hookRenderer(),time=virtualClock(),written=[];
  const save=load('use-owned-draft-save.ts',{'react':host.react,'./device-cache':{getDeviceCacheRevision:()=>0,saveOwnedDraft:async(_key,value)=>{written.push(value);return'device';}}},{setTimeout:time.schedule,clearTimeout:time.cancel});
  const view=host.render(()=>save.useOwnedDraftSave('listing-draft.'+account,{image:null},true));await view.persist({image:other});host.unmount();await time.advance(0);assert.equal(written.at(-1).image,other);assert.equal(time.timers.size,0);
});
