import{afterEach,describe,expect,it,vi}from'vitest';
import{sendCampusPush,sendDevicePush}from'./push';
import{retryablePushError,pushRetryDelaySeconds}from'./push-retry';
import{notificationChannels}from'../services/notification-preferences';
import type{Bindings}from'../types';
const env={}as Bindings,token='ExpoPushToken[syntheticToken123456]';
const notice={title:'Campus update',body:'Lecture venue changed.',path:'/community?id=synthetic',id:'synthetic-delivery',preferenceCategory:'announcements'};
afterEach(()=>vi.unstubAllGlobals());
describe('push provider acknowledgement boundary',()=>{
 it('uses the native update channel and carries the delivery and deep link identifiers',async()=>{
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{expect(JSON.parse(String(init.body))).toMatchObject({to:token,channelId:'kampusone-updates-v2',data:{deliveryId:notice.id,path:notice.path,preferenceCategory:'announcements'}});return Response.json({data:{status:'ok',id:'ticket'}});});
  vi.stubGlobal('fetch',fetcher);expect(await sendCampusPush(env,token,notice)).toEqual({status:'ACCEPTED',ticketId:'ticket'});
 });
 it('retries explicit throttling but preserves ambiguous network acknowledgement',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:429})));
  const result=await sendCampusPush(env,token,notice);expect(result.status).toBe('FAILED');expect(retryablePushError(result.errorCode)).toBe(true);
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
  const uncertain=await sendCampusPush(env,token,notice);expect(uncertain.status).toBe('UNKNOWN');expect(retryablePushError(uncertain.errorCode)).toBe(false);
  expect(retryablePushError('DeviceNotRegistered')).toBe(false);expect(retryablePushError('InvalidCredentials')).toBe(false);
  expect([1,2,3,6].map(pushRetryDelaySeconds)).toEqual([30,60,120,960]);
 });
 it('fails invalid devices without contacting the provider',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(await sendCampusPush(env,'invalid',notice)).toEqual({status:'FAILED',errorCode:'INVALID_TOKEN'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('keeps Android delivery compatible without a server FCM key and surfaces malformed FCM credentials',async()=>{
  const expo=vi.fn().mockResolvedValue(Response.json({data:{status:'ok',id:'android-expo-ticket'}}));vi.stubGlobal('fetch',expo);
  expect(await sendDevicePush(env,{expoToken:token,nativeToken:'native-fcm-token-123456',platform:'android'},notice)).toEqual({status:'ACCEPTED',ticketId:'android-expo-ticket'});
  expect(String(expo.mock.calls[0]![0])).toContain('exp.host');
  const brokenEnv={...env,FCM_SERVICE_ACCOUNT_JSON:'not-json'} as Bindings,never=vi.fn();vi.stubGlobal('fetch',never);
  expect(await sendDevicePush(brokenEnv,{expoToken:token,nativeToken:'native-fcm-token-123456',platform:'android'},notice)).toEqual({status:'FAILED',errorCode:'InvalidCredentials'});
  expect(never).not.toHaveBeenCalled();
 });
 it('treats mention delivery as a social notification with independent channel preferences',async()=>{
  expect(notificationChannels(undefined,{}).mentions).toEqual({in_app_enabled:true,push_enabled:true});
  expect(notificationChannels(undefined,{mentions:false,pushMentions:false}).mentions).toEqual({in_app_enabled:false,push_enabled:false});
  expect(notificationChannels({mentions:{in_app_enabled:false,push_enabled:true}}).mentions).toEqual({in_app_enabled:false,push_enabled:true});
  const fetcher=vi.fn().mockResolvedValue(Response.json({data:{status:'ok',id:'mention-ticket'}}));vi.stubGlobal('fetch',fetcher);
  await sendCampusPush(env,token,{...notice,preferenceCategory:'mentions'});
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({channelId:'kampusone-social-v1',categoryId:'KAMPUSONE_SOCIAL',data:{preferenceCategory:'mentions'}});
 });
});
