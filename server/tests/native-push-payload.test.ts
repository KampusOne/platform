import {generateKeyPairSync} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {sendDevicePush,sendTestPush} from '../src/lib/push';
import type {Bindings} from '../src/types';
afterEach(()=>vi.unstubAllGlobals());
it('the FCM request preserves the application data that Expo Android decodes from data.body',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const env={FCM_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'fixture-project',client_email:'fixture-'+crypto.randomUUID()+'@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})})} as Bindings;
  let request:any;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic',expires_in:3600});
    request=JSON.parse(String(init.body));return Response.json({name:'synthetic-acceptance'});
  }));
  const messageId=crypto.randomUUID(),deliveryId=crypto.randomUUID(),notificationId=crypto.randomUUID();
  expect(await sendDevicePush(env,{expoToken:'fcm:fixture',nativeToken:'fixture-native-token',platform:'android'},{title:'New message',body:'Hello',path:'/conversation?id='+crypto.randomUUID(),id:deliveryId,notificationId,messageId,preferenceCategory:'messages'})).toEqual({status:'ACCEPTED'});
  expect(request.message.android.notification.channel_id).toBe('kampusone-messages-v1');
  expect(request.message.data.categoryId).toBe('KAMPUSONE_MESSAGE');
  const decoded=JSON.parse(request.message.data.body);
  expect(decoded).toMatchObject({kind:'kampusone-notification',deliveryId,notificationId,messageId,preferenceCategory:'messages'});
  expect(decoded.path).toMatch(/^\/conversation\?id=/);
});
it('a native-only device cannot be reported as accepted without the native provider credential',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(await sendTestPush({} as Bindings,'fcm:fixture',crypto.randomUUID(),'fixture-native','android')).toEqual({status:'FAILED',errorCode:'NativeCredentialsMissing'});
  expect(fetcher).not.toHaveBeenCalled();
});
