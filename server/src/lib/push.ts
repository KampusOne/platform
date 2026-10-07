import type { Bindings } from '../types';

export const expoTokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
const knownErrors = new Set(['DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials','UNAUTHORIZED']);
function safeCode(value: unknown) { return typeof value === 'string' && knownErrors.has(value) ? value : 'PUSH_PROVIDER_FAILED'; }
export type PushResult = { status: 'ACCEPTED' | 'FAILED' | 'UNKNOWN'; ticketId?: string; errorCode?: string };
function headers(env: Bindings) {
 return { 'Content-Type': 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) };
}

type FcmServiceAccount={project_id:string;client_email:string;private_key:string;token_uri?:string};
let cachedFcmToken:{key:string;token:string;expiresAt:number}|null=null;
function base64Url(value:string|Uint8Array){
 const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function privateKeyBytes(pem:string){
 const body=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 const binary=atob(body),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes.buffer;
}
async function fcmAccessToken(env:Bindings):Promise<{token?:string;errorCode?:string;uncertain?:boolean}>{
 if(!env.FCM_SERVICE_ACCOUNT_JSON)return{};
 let account:FcmServiceAccount;
 try{account=JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as FcmServiceAccount;}catch{return{errorCode:'InvalidCredentials'};}
 if(!account.project_id||!account.client_email||!account.private_key)return{errorCode:'InvalidCredentials'};
 const now=Math.floor(Date.now()/1000),key=account.client_email+'@'+account.project_id;
 if(cachedFcmToken?.key===key&&cachedFcmToken.expiresAt>now+90)return{token:cachedFcmToken.token};
 try{
  const header=base64Url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claims=base64Url(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:account.token_uri||'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const signingInput=header+'.'+claims;
  const privateKey=await crypto.subtle.importKey('pkcs8',privateKeyBytes(account.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(signingInput)));
  const response=await fetch(account.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(8000),body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signingInput+'.'+base64Url(signature)}).toString()});
  if(!response.ok)return{errorCode:response.status>=500?`PUSH_HTTP_${response.status}`:'InvalidCredentials',uncertain:response.status>=500};
  const payload=await response.json() as{access_token?:string;expires_in?:number};
  if(!payload.access_token)return{errorCode:'InvalidCredentials'};
  cachedFcmToken={key,token:payload.access_token,expiresAt:now+Math.max(300,Number(payload.expires_in)||3600)};
  return{token:payload.access_token};
 }catch{return{errorCode:'PUSH_NETWORK_UNCERTAIN',uncertain:true};}
}
function fcmError(status:number,payload:any){
 const codes=Array.isArray(payload?.error?.details)?payload.error.details.map((detail:any)=>detail?.errorCode).filter(Boolean):[];
 if(status===401||status===403)return'InvalidCredentials';
 if(status===429||codes.includes('QUOTA_EXCEEDED'))return'MessageRateExceeded';
 if(codes.includes('UNREGISTERED'))return'DeviceNotRegistered';
 if(codes.includes('SENDER_ID_MISMATCH'))return'MismatchSenderId';
 if(status===413)return'MessageTooBig';
 return `PUSH_HTTP_${status}`;
}
async function sendFcmPush(env:Bindings,nativeToken:string,message:{title:string;body:string;path:string;id:string;notificationId?:string;preferenceCategory:string}):Promise<PushResult>{
 let account:FcmServiceAccount;try{account=JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON||'') as FcmServiceAccount;}catch{return{status:'FAILED',errorCode:'InvalidCredentials'};}
 if(!account.project_id)return{status:'FAILED',errorCode:'InvalidCredentials'};
 const access=await fcmAccessToken(env);if(!access.token)return{status:access.uncertain?'UNKNOWN':'FAILED',errorCode:access.errorCode??'InvalidCredentials'};
 const presentation=presentationFor(message.preferenceCategory),ttl=message.preferenceCategory==='newsletter'?86400:message.preferenceCategory==='classReminders'?900:3600;
 try{
  const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${access.token}`},signal:AbortSignal.timeout(8000),
   body:JSON.stringify({message:{token:nativeToken,notification:{title:message.title.slice(0,140),body:message.body.slice(0,1500)},android:{priority:'HIGH',ttl:`${ttl}s`,notification:{channel_id:presentation.channelId,sound:'default'}},data:{kind:'kampusone-notification',path:message.path,deliveryId:message.id,...(message.notificationId?{notificationId:message.notificationId}:{}),preferenceCategory:message.preferenceCategory,categoryId:presentation.categoryId}}})
  });
  if(response.ok){await response.json().catch(()=>null);return{status:'ACCEPTED'};}
  const payload=await response.json().catch(()=>null);const errorCode=fcmError(response.status,payload);
  return{status:response.status>=500?'UNKNOWN':'FAILED',errorCode};
 }catch{return{status:'UNKNOWN',errorCode:'PUSH_NETWORK_UNCERTAIN'};}
}
export type PushDeviceTarget={expoToken:string;nativeToken?:string|null;platform?:string|null};
function presentationFor(preferenceCategory:string){
 if(preferenceCategory==='messages')return{channelId:'kampusone-messages-v1',categoryId:'KAMPUSONE_MESSAGE'};
 if(preferenceCategory==='newsletter')return{channelId:'kampusone-newsletter-v1',categoryId:'KAMPUSONE_NEWSLETTER'};
 if(['likes','commentLikes','comments','replies','reposts','quotes','follows','profilePosts','mentions'].includes(preferenceCategory))
  return{channelId:'kampusone-social-v1',categoryId:'KAMPUSONE_SOCIAL'};
 return{channelId:'kampusone-updates-v2',categoryId:'KAMPUSONE_UPDATE'};
}

export async function sendTestPush(env: Bindings, token: string, attemptId: string, nativeToken?: string | null, platform?: string | null): Promise<PushResult> {
 if(platform==='android'&&nativeToken&&env.FCM_SERVICE_ACCOUNT_JSON)return sendFcmPush(env,nativeToken,{title:'KampusOne notification test',body:'This is the test requested for this device.',path:'/notifications',id:attemptId,preferenceCategory:'campusUpdates'});
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
    ttl:message.preferenceCategory==='newsletter'?86400:message.preferenceCategory==='classReminders'?900:3600,
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

export async function sendDevicePush(
 env:Bindings,
 device:PushDeviceTarget,
 message:{title:string;body:string;path:string;id:string;notificationId?:string;preferenceCategory:string}
):Promise<PushResult>{
 if(device.platform==='android'&&device.nativeToken&&env.FCM_SERVICE_ACCOUNT_JSON)
  return sendFcmPush(env,device.nativeToken,message);
 return sendCampusPush(env,device.expoToken,message);
}
