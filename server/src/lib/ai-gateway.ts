import {AIProviderError} from './ai-error.ts';
import type {AIEnvironment,AIInput,AIMessage} from './ai-provider.ts';
import {academicInferenceAudience,imageProcessingToken} from './image-processing-auth.ts';

const processor='https://agents.kampusone.app/internal-processing/timetable-image';
const relay='https://agents.kampusone.app/internal-processing/academic-inference';
export function academicGatewayConfigured(env:AIEnvironment) {
  return env.AI_ASSISTANT_ENABLED==='true'&&env.TIMETABLE_IMAGE_PROCESSOR_URL===processor&&!!env.JWT_SECRET&&env.JWT_SECRET.length>=32;
}
/** Recovery only, using the original quota reservation and overall deadline. */
export async function gatewayAcademicCompletion(env:AIEnvironment,input:AIInput,messages:AIMessage[],maxTokens:number,timeoutMs:number,fetcher:typeof fetch=fetch) {
  if(input.mode!=='timetable'||!academicGatewayConfigured(env))throw new AIProviderError(503,'AI_NOT_CONFIGURED','The document reader is temporarily unavailable. Your file is kept.');
  const deadline=Math.min(input.deadline??Infinity,Date.now()+timeoutMs);
  if(deadline<=Date.now())throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your full file is kept.');
  const latest=messages.filter(message=>message.role==='user').at(-1);
  const source=messages.filter(message=>message.role==='system'||message===latest).map(message=>({role:message.role,
    content:Array.isArray(message.content)?message.content.map(part=>part?.type==='image_url'?{type:'image_url',image_url:{url:part.image_url?.url}}:part):message.content}));
  const body=JSON.stringify({messages:source,maxTokens:Math.min(maxTokens,4096),timeoutMs:Math.min(60000,Math.max(1,Math.floor(deadline-Date.now())))});
  if(new TextEncoder().encode(body).byteLength>4_200_000)throw new AIProviderError(503,'AI_PROVIDER_UNAVAILABLE','The complete image could not be read. Your original file is kept.');
  const authorization=await imageProcessingToken(env.JWT_SECRET!,body,academicInferenceAudience);
  let response:Response;
  try {response=await fetcher(relay,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+authorization},body,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});}
  catch(error){
    console.warn(JSON.stringify({event:'ai.academic.gateway_transport_failed',timedOut:error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)}));
    input.onProviderFailure?.({provider:'gateway',status:0,hint:'transport'});
    throw new AIProviderError(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)?504:503,error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)?'AI_TIMEOUT':'AI_PROVIDER_UNAVAILABLE','The reader could not finish. Your full file is kept; no import credit was used.');
  }
  if(!response.ok){
    await response.body?.cancel().catch(()=>undefined);
    input.onProviderFailure?.({provider:'gateway',status:response.status,hint:[402,429].includes(response.status)?'service_limit':'unclassified'});
    throw new AIProviderError(response.status===504?504:503,[402,429].includes(response.status)?'AI_PROVIDER_LIMIT':response.status===504?'AI_TIMEOUT':[401,403].includes(response.status)?'AI_PROVIDER_AUTH':'AI_PROVIDER_UNAVAILABLE','The reader could not finish. Your full file is kept; no import credit was used.');
  }
  const payload=await response.json().catch(()=>({})) as {choices?:{finish_reason?:string;message?:{content?:unknown}}[]};
  const choice=payload.choices?.[0],text=choice?.message?.content;
  if(choice?.finish_reason==='length'){
    if(typeof text==='string'&&text.length<=50000)input.onScheduleRead?.(null,text);
    throw new AIProviderError(502,'AI_INCOMPLETE','The schedule response was cut short. Your full file is kept; no import credit was used.');
  }
  if(choice?.finish_reason!=='stop'||typeof text!=='string'||!text.trim()||text.length>50000)throw new AIProviderError(502,'AI_INVALID_OUTPUT','The complete document could not be read. Your full file is kept.');
  return{text:text.trim(),calls:[],provider:'gateway' as const};
}
