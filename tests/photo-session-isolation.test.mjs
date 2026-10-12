import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function uploads({editor=async photo=>photo,picker,bytes}={}){
 let revision=0,picks=0,edits=0,reads=0,sends=0;
 const chosen={canceled:false,assets:[{uri:'file://synthetic.jpg',width:600,height:400,fileSize:128}]};
 const rendered={saveAsync:async()=>({uri:'file://prepared.jpg',width:600,height:400}),release(){}};
 const context={resize(){},renderAsync:async()=>rendered,release(){}};
 class ApiError extends Error{}
 const modules={'expo-image-picker':{launchImageLibraryAsync:async()=>{picks++;return picker?picker():chosen;},launchCameraAsync:async()=>chosen,requestCameraPermissionsAsync:async()=>({granted:true})},'expo-document-picker':{},'expo-image-manipulator':{ImageManipulator:{manipulate:()=>context},SaveFormat:{JPEG:'jpeg'}},'react-native':{Platform:{OS:'web'},Image:{getSize:(_url,success)=>success(600,400)}},'./api':{ApiError,api:async(_path,init)=>{sends++;assert.equal(init.body instanceof Blob,true);return{id:'11111111-1111-4111-8111-111111111111',url:'https://fixture.invalid/photo',kind:'product',private:false};},invalidateApiReads(){},currentApiUrl:()=> 'https://fixture.invalid'},'./photo-edit-session':{requestPhotoEdit:async(kind,photo)=>{edits++;assert.equal(kind,'product');return editor(photo);}},'./video-edit-session':{},'./post-video-processing':{},'./media-downloads':{},'./message-upload':{},'./document-read-session':{},'./device-cache':{getDeviceCacheRevision:()=>revision}};
 const exports={},code=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/uploads.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,module:{exports},require:key=>{if(key in modules)return modules[key];throw Error(key);},setTimeout,clearTimeout,Error,Blob,ArrayBuffer,FormData,fetch:async()=>{reads++;return bytes?bytes():new Response(new Blob(['synthetic-image']));}});
 return {exports,setRevision:n=>{revision=n;},counts:()=>({picks,edits,reads,sends})};
}
test('product crop cancellation sends no file bytes or media request',async()=>{
 const h=uploads({editor:async()=>null});assert.equal(await h.exports.pickAndUpload('product'),null);assert.deepEqual(h.counts(),{picks:1,edits:1,reads:0,sends:0});
});
test('product crop completes before raw upload and returns only the verified uploaded photo',async()=>{
 const h=uploads();assert.equal((await h.exports.pickAndUpload('product')).kind,'product');assert.deepEqual(h.counts(),{picks:1,edits:1,reads:1,sends:1});
});
test('account changes during selection, crop or byte loading prevent an upload under the next session',async()=>{
 for(const stage of ['selection','crop','bytes']){
  let finish;const delayed=()=>new Promise(resolve=>{finish=resolve;});
  const h=uploads(stage==='selection'?{picker:delayed}:stage==='crop'?{editor:delayed}:{bytes:delayed});
  const pending=h.exports.pickAndUpload('product'),rejection=assert.rejects(pending,/sign-in changed/);while(!finish)await Promise.resolve();h.setRevision(2);
  finish(stage==='selection'?{canceled:false,assets:[{uri:'file://old.jpg',width:100,height:100}]}:stage==='crop'?{uri:'file://old.jpg',width:100,height:100}:new Response(new Blob(['old-file'])));
  await rejection;assert.equal(h.counts().sends,0);
 }
});
test('a prepared photo is bound to the selection session across later upload attempts',async()=>{
 const h=uploads(),photo=await h.exports.pickPhoto('product');h.setRevision(1);await assert.rejects(h.exports.uploadPreparedPhoto('product',photo),/sign-in changed/);assert.equal(h.counts().reads,0);assert.equal(h.counts().sends,0);
});
