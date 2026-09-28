import type { Bindings } from '../types';

export const expoTokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
const knownErrors = new Set(['DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials','UNAUTHORIZED']);
function safeCode(value: unknown) { return typeof value === 'string' && knownErrors.has(value) ? value : 'PUSH_PROVIDER_FAILED'; }
export type PushResult = { status: 'ACCEPTED' | 'FAILED' | 'UNKNOWN'; ticketId?: string; errorCode?: string };
function headers(env: Bindings) {
 return { 'Content-Type': 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) };
}

function presentationFor(preferenceCategory:string){
 if(preferenceCategory==='messages')return{channelId:'kampusone-messages-v1',categoryId:'KAMPUSONE_MESSAGE'};
 if(preferenceCategory==='newsletter')return{channelId:'kampusone-newsletter-v1',categoryId:'KAMPUSONE_NEWSLETTER'};
 if(['likes','commentLikes','comments','replies','reposts','quotes','follows','profilePosts'].includes(preferenceCategory))
  return{channelId:'kampusone-social-v1',categoryId:'KAMPUSONE_SOCIAL'};
 return{channelId:'kampusone-updates-v2',categoryId:'KAMPUSONE_UPDATE'};
}

export async function sendTestPush(env: Bindings, token: string, attemptId: string): Promise<PushResult> {
 try {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
   method: 'POST', headers: headers(env), signal: AbortSignal.timeout(8000),
   body: JSON.stringify({
    to: token,
    title: 'KampusOne notification test',
    body: 'This is the test requested for this device.',
    sound: 'default',
    priority: 'high',
    channelId: 'kampusone-updates-v2',
    categoryId: 'KAMPUSONE_UPDATE',
    data: { kind: 'notification-test', preferenceCategory:'campusUpdates', attemptId, path:'/notifications' }
   }),
  });
  if (!response.ok) return { status: response.status >= 500 ? 'UNKNOWN' : 'FAILED', errorCode: `PUSH_HTTP_${response.status}` };
  const result = await response.json() as { data?: {status?:string;id?:string;details?:{error?:string}} };
  if (result.data?.status === 'ok' && typeof result.data.id === 'string') return { status: 'ACCEPTED', ticketId: result.data.id };
  return { status: 'FAILED', errorCode: safeCode(result.data?.details?.error) };
 } catch { return { status: 'UNKNOWN', errorCode: 'PUSH_NETWORK_UNCERTAIN' }; }
}
export async function fetchPushReceipt(env: Bindings, ticketId: string): Promise<{status:'RECEIPT_OK'|'FAILED'|'PENDING';errorCode?:string}> {
 try {
  const response=await fetch('https://exp.host/--/api/v2/push/getReceipts', {method:'POST',headers:headers(env),signal:AbortSignal.timeout(8000),body:JSON.stringify({ids:[ticketId]})});
  if(!response.ok)return {status:'PENDING',errorCode:`RECEIPT_HTTP_${response.status}`};
  const result=await response.json() as {data?:Record<string,{status?:string;details?:{error?:string}}>};
  const receipt=result.data?.[ticketId];
  if(!receipt)return {status:'PENDING'};
  return receipt.status==='ok'?{status:'RECEIPT_OK'}:{status:'FAILED',errorCode:safeCode(receipt.details?.error)};
 }catch{return {status:'PENDING',errorCode:'RECEIPT_NETWORK_UNAVAILABLE'};}
}
export async function sendCampusPush(
 env:Bindings,
 token:string,
 message:{
  title:string;
  body:string;
  path:string;
  id:string;
  notificationId?:string;
  preferenceCategory:string;
 }
):Promise<PushResult>{
 if(!expoTokenPattern.test(token))return{status:'FAILED',errorCode:'INVALID_TOKEN'};
 const presentation=presentationFor(message.preferenceCategory);
 try{
  const response=await fetch('https://exp.host/--/api/v2/push/send',{
   method:'POST',
   headers:headers(env),
   signal:AbortSignal.timeout(8000),
   body:JSON.stringify({
    to:token,
    title:message.title.slice(0,140),
    body:message.body.slice(0,1500),
    sound:'default',
    priority:'high',
    channelId:presentation.channelId,
    categoryId:presentation.categoryId,
    data:{
     kind:'kampusone-notification',
     path:message.path,
     deliveryId:message.id,
     ...(message.notificationId?{notificationId:message.notificationId}:{}),
     preferenceCategory:message.preferenceCategory,
    }
   })
  });
  if(!response.ok)return{status:response.status>=500?'UNKNOWN':'FAILED',errorCode:`PUSH_HTTP_${response.status}`};
  const payload=await response.json() as{data?:{status?:string;id?:string;details?:{error?:string}}};
  return payload.data?.status==='ok'&&payload.data.id?{status:'ACCEPTED',ticketId:payload.data.id}:{status:'FAILED',errorCode:safeCode(payload.data?.details?.error)};
 }catch{return{status:'UNKNOWN',errorCode:'PUSH_NETWORK_UNCERTAIN'};}
}
