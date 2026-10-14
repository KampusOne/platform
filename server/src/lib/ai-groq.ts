import {AIProviderError} from './ai-error.ts';
import type {AIEnvironment,AIInput,AIMessage} from './ai-provider.ts';

/** Academic-only recovery with the already configured Groq key. */
export async function groqAcademicCompletion(env:AIEnvironment,input:AIInput,messages:AIMessage[],maxTokens:number,
  timeoutMs:number,fetcher:typeof fetch=fetch){
  if(input.mode!=='timetable'||!env.GROQ_API_KEY)throw new AIProviderError(503,'AI_NOT_CONFIGURED','The document reader is temporarily unavailable. Your file is kept.');
  const remaining=Math.min(input.deadline??Infinity,Date.now()+timeoutMs)-Date.now();
  if(remaining<=0)throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your file and draft are kept.');
  const latest=messages.filter(m=>m.role==='user').at(-1);
  const source=messages.filter(m=>m.role==='system'||m===latest).map(m=>({...m,
    content:Array.isArray(m.content)?m.content.map(p=>p?.type==='image_url'?{type:'image_url',image_url:{url:p.image_url?.url}}:p):m.content}));
  let response:Response;
  try{response=await fetcher('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(remaining),headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.GROQ_API_KEY},
    body:JSON.stringify({model:'qwen/qwen3.8-27b',messages:source,temperature:0,max_completion_tokens:maxTokens,
      reasoning_effort:'none',reasoning_format:'hidden',response_format:{type:'json_object'},stream:false}),
  });}catch(error){
    if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your file and draft are kept.');
    throw new AIProviderError(503,'AI_PROVIDER_UNAVAILABLE','The document reader could not connect. Your file is kept.');
  }
  if(!response.ok){
    void response.body?.cancel().catch(()=>undefined);
    console.warn(JSON.stringify({event:'ai.provider.failed',provider:'groq',httpStatus:response.status}));
    throw new AIProviderError(503,response.status===429?'AI_PROVIDER_LIMIT':[401,403].includes(response.status)?'AI_PROVIDER_AUTH':'AI_PROVIDER_UNAVAILABLE',
      'The document reader is temporarily unavailable. Your full file is kept; no import credit was used.');
  }
  let payload:{choices?:{finish_reason?:string;message?:{content?:string}}[]};
  try{payload=await response.json();}catch{throw new AIProviderError(502,'AI_INVALID_OUTPUT','The document reader returned an unreadable result. Your file is kept.');}
  const choice=payload.choices?.[0];
  if(choice?.finish_reason==='length')throw new AIProviderError(502,'AI_INCOMPLETE','The schedule response was cut short. Your full file is kept; no import credit was used.');
  const text=choice?.message?.content?.trim();
  if(choice?.finish_reason!=='stop'||!text||text.length>50000)throw new AIProviderError(502,'AI_INVALID_OUTPUT','The complete document could not be read. Your file is kept; no import credit was used.');
  return{text,calls:[],provider:'groq' as const};
}
