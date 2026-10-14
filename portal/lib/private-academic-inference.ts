import type {JWTVerifyGetKey} from 'jose';
import {privateWorkerBody,workerSigningKey} from './private-worker-request';

const headers={'Cache-Control':'no-store'};
const gateway='https://ai-gateway.vercel.sh/v1';
// Fixed, verified vision model. Never accept model, tools or upstream URLs from a caller.
export const academicGatewayModel='google/gemini-2.5-flash-lite';
type Message={role:'system'|'user';content:string|({type:'text';text:string}|{type:'image_url';image_url:{url:string}})[]};
function validMessages(value:unknown):value is Message[] {
  if(!Array.isArray(value)||value.length!==2||value[0]?.role!=='system'||value[1]?.role!=='user')return false;
  let images=0;
  return value.every(message=>{
    if(Object.keys(message).some(key=>!['role','content'].includes(key)))return false;
    if(typeof message.content==='string')return message.content.length>0&&message.content.length<=60000;
    if(message.role!=='user'||!Array.isArray(message.content)||message.content.length<1||message.content.length>3)return false;
    return message.content.every((part:Record<string,unknown>)=>{
      if(part?.type==='text')return Object.keys(part).every(key=>['type','text'].includes(key))&&typeof part.text==='string'&&part.text.length>0&&part.text.length<=60000;
      if(part?.type!=='image_url'||++images>1||Object.keys(part).some(key=>!['type','image_url'].includes(key)))return false;
      const image=part.image_url as Record<string,unknown>|undefined;
      return !!image&&Object.keys(image).every(key=>key==='url')&&typeof image.url==='string'
        &&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.url)&&image.url.length<=4_000_000;
    });
  });
}

/** Private relay: app quotas/idempotency remain in the Worker; this service
 * accepts only body-bound 60-second Worker signatures and existing credits. */
export async function privateAcademicInference(request:Request,getKey:JWTVerifyGetKey=workerSigningKey,fetcher:typeof fetch=fetch) {
  const body=await privateWorkerBody(request,'kampusone:private:academic-inference',4_200_000,getKey);
  if(body instanceof Response)return body;
  let input:{messages:Message[];maxTokens:number;timeoutMs:number};
  try {
    input=JSON.parse(body);
    if(Object.keys(input).some(key=>!['messages','maxTokens','timeoutMs'].includes(key))||!validMessages(input.messages)
      ||!Number.isInteger(input.maxTokens)||input.maxTokens<1||input.maxTokens>4096
      ||!Number.isInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>60000)return new Response(null,{status:400,headers});
  }catch{return new Response(null,{status:400,headers});}
  // Vercel injects and rotates request OIDC tokens. Never cache or expose them.
  const token=request.headers.get('x-vercel-oidc-token')??process.env.VERCEL_OIDC_TOKEN;
  if(!token)return new Response(null,{status:503,headers});
  const deadline=Date.now()+input.timeoutMs;
  try {
    const credits=await fetcher(gateway+'/credits',{headers:{Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(Math.min(5000,input.timeoutMs))});
    if(!credits.ok){await credits.body?.cancel();return new Response(null,{status:[402,429].includes(credits.status)?429:503,headers});}
    const balance=await credits.json() as {balance?:unknown};
    if(!Number.isFinite(Number(balance.balance))||Number(balance.balance)<.05)return new Response(null,{status:429,headers});
    if(deadline<=Date.now())return new Response(null,{status:504,headers});
    const response=await fetcher(gateway+'/chat/completions',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),
      body:JSON.stringify({model:academicGatewayModel,messages:input.messages,max_tokens:input.maxTokens,temperature:0,response_format:{type:'json_object'},reasoning:{effort:'none'},stream:false}),
    });
    if(!response.ok){
      console.warn(JSON.stringify({event:'ai.academic.gateway_failed',httpStatus:response.status}));
      await response.body?.cancel();return new Response(null,{status:[402,429].includes(response.status)?429:503,headers});
    }
    const output=await response.json() as {choices?:{finish_reason?:unknown;message?:{content?:unknown}}[]};
    const choice=output.choices?.[0],text=choice?.message?.content;
    if(!['stop','length'].includes(String(choice?.finish_reason))||typeof text!=='string'||!text.trim()||text.length>50000)return new Response(null,{status:502,headers});
    return Response.json({choices:[{finish_reason:choice!.finish_reason,message:{content:text}}]},{headers});
  }catch(error){return new Response(null,{status:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?504:503,headers});}
}
