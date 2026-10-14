import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {typescript as ts} from './helpers/typescript.mjs';
function registration({projectId='00000000-0000-4000-8000-000000000001',native=async()=>({data:'native_fcm_token_for_fixture_device'}),expo=async()=>{throw Error('Expo unavailable');}}={}){
  let revision=1;const calls=[],saved=[],channels=[];
  const notifications={AndroidImportance:{HIGH:4},setNotificationChannelAsync:async(id,options)=>channels.push({id,...options}),setNotificationCategoryAsync:async()=>{},getPermissionsAsync:async()=>({granted:true}),getDevicePushTokenAsync:native,getExpoPushTokenAsync:expo};
  const modules={'expo-constants':{__esModule:true,default:{appOwnership:'standalone',easConfig:{projectId},expoConfig:{version:'fixture'}}},'@react-native-async-storage/async-storage':{__esModule:true,default:{}},'react-native':{Platform:{OS:'android'}},'./api':{api:async(path,options)=>{calls.push({path,payload:JSON.parse(options.body)});return{device:{id:'fixture-id'}};}},'./device-cache':{getDeviceCacheRevision:()=>revision,isDeviceCacheOwner:owner=>owner==='fixture-owner',writeCache:async(...args)=>saved.push(args)},'./request-deadline':{withRequestDeadline:operation=>operation(new AbortController().signal)},'expo-notifications':notifications};
  const exports={};const code=ts.transpileModule(readFileSync(new URL('../mobile/src/lib/push-registration.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,module:{exports},require:name=>{if(name in modules)return modules[name];throw Error(name);},process:{env:{}},Promise,Error,Date});
  return{...exports,calls,saved,channels,switchAccount(){revision++;}};
}
test('Android registers its native token even when the Expo relay token fails',async()=>{
  const r=registration();assert.equal(await r.registerPushDevice('fixture-owner'),'fixture-id');assert.equal(r.calls.length,1);assert.equal(r.calls[0].payload.expoPushToken,undefined);assert.equal(r.calls[0].payload.nativeToken,'native_fcm_token_for_fixture_device');
});
test('direct Android push does not require an EAS project id',async()=>{
  const r=registration({projectId:null});assert.equal(r.pushSetupAvailability().available,true);await r.registerPushDevice('fixture-owner');assert.equal(r.calls.length,1);
});
test('paid purchases and order updates register an audible high-importance Android channel',async()=>{
  const r=registration();await r.configureNativeNotifications();
  const channel=r.channels.find(row=>row.id==='kampusone-orders-v1');
  assert.equal(channel.sound,'default');assert.equal(channel.importance,4);assert.equal(channel.enableVibrate,true);
});
test('a slow native registration cannot attach an old account’s token to the new session',async()=>{
  let finish;const r=registration({native:()=>new Promise(resolve=>finish=resolve)});const pending=r.registerPushDevice('fixture-owner');
  for(let i=0;i<20;i++)await Promise.resolve();r.switchAccount();finish({data:'native_fcm_token_for_fixture_device'});
  await assert.rejects(pending,/account changed/);assert.equal(r.calls.length,0);assert.equal(r.saved.length,0);
});
