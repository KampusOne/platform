import {AIProviderError} from './ai-error.ts';
import type {AIEnvironment,AIInput,AIMessage,AITool} from './ai-provider.ts';

/** Existing server credential, shared deadline and no extra quota reservation. */
export async function groqCompletion(env:AIEnvironment,input:AIInput,messages:AIMessage[],maxTokens:number,
  timeoutMs:number,fetcher:typeof fetch=fetch,tools?:AITool[]){
  if(!env.GROQ_API_KEY)throw new AIProviderError(503,'AI_NOT_CONFIGURED','The AI reader is temporarily unavailable. Your draft is kept.');
  const deadline=Math.min(input.deadline??Infinity,Date.now()+timeoutMs);
  if(deadline<=Date.now())throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your file and draft are kept.');
  const source=messages.map(m=>({...m,
    content:Array.isArray(m.content)?m.content.map(p=>p?.type==='image_url'?{type:'image_url',image_url:{url:p.image_url?.url}}:p):m.content}));
  const vision=source.some(m=>Array.isArray(m.content)&&m.content.some(p=>p?.type==='image_url'));
  let response:Response;
  for(let attempt=0;;attempt++){
  try{response=await fetcher('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.GROQ_API_KEY},
    // Leave room for source tokens below the configured 8k/minute free limit.
    // A truncated response still fails validation and uses the same row recovery.
    body:JSON.stringify({model:vision?'qwen/qwen3.8-27b':'openai/gpt-oss-20b',messages:source,temperature:0,max_completion_tokens:Math.min(maxTokens,4096),
      ...(vision?{reasoning_effort:'none',reasoning_format:'hidden'}:{reasoning_effort:'low'}),
      ...(input.mode==='timetable'?{response_format:{type:'json_object'}}:{}),
      ...(tools?.length&&!vision?{tools,tool_choice:'auto'}:{}),stream:false}),
  });}catch(error){
    if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your file and draft are kept.');
    throw new AIProviderError(503,'AI_PROVIDER_UNAVAILABLE','The document reader could not connect. Your file is kept.');
  }
  if(response.status!==429||attempt>=3)break;
  const raw=response.headers.get('Retry-After'),reset=response.headers.get('x-ratelimit-reset-tokens')??'';
  const delay=raw&&Number.isFinite(Number(raw))?Number(raw)*1000:raw&&Number.isFinite(Date.parse(raw))?Date.parse(raw)-Date.now():
    /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.test(reset)?Number(/([\d.]+)m/.exec(reset)?.[1]??0)*60000+Number(/([\d.]+)s/.exec(reset)?.[1]??0)*1000:0;
  if(delay<=0||delay+5000>=deadline-Date.now())break;
  await response.body?.cancel().catch(()=>undefined);
  await input.onProgress?.('analysing');
  await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.ceil(delay)+250)));
  }
  if(!response.ok){
    const failure=await response.json().catch(()=>({})) as {error?:{message?:string;param?:string}};
    const message=typeof failure.error?.message==='string'?failure.error.message:'';
    const hint=/system.{0,60}(?:image|vision)|(?:image|vision).{0,60}system/i.test(message)?'image_system_message'
      :/reasoning/i.test(message)?'reasoning_parameter':/image|base64|decode|resolution|pixel/i.test(message)?'image_input'
      :/model.*(?:not found|decommissioned|not supported|not available)/i.test(message)?'model_unavailable'
      :/key|auth|permission/i.test(message)?'authentication':/quota|rate limit|tokens per/i.test(message)?'service_limit':'unclassified';
    const parameter=['messages','response_format','reasoning_effort','reasoning_format','max_completion_tokens','model','temperature','image_url'].includes(failure.error?.param??'')?failure.error!.param:undefined;
    const dimension=/tokens per day|\bTPD\b/i.test(message)?'tokens_per_day':/tokens per minute|\bTPM\b/i.test(message)?'tokens_per_minute':/requests per day|\bRPD\b/i.test(message)?'requests_per_day':'unknown';
    const quantities=Object.fromEntries(['Limit','Used','Requested'].map(label=>[label.toLowerCase(),Number(new RegExp(label+'[ :]+([0-9]+)','i').exec(message)?.[1])]).filter(([,value])=>Number.isFinite(value)));
    const imageCount=source.reduce((n,m)=>n+(Array.isArray(m.content)?m.content.filter(p=>p?.type==='image_url').length:0),0);
    const textBytes=new TextEncoder().encode(JSON.stringify(source.map(m=>({role:m.role,content:Array.isArray(m.content)?m.content.filter(p=>p?.type==='text').map(p=>p.text):m.content})))).length;
    const capacity={dimension,quantities,imageCount,textBytes,outputBudget:Math.min(maxTokens,4096)};
    input.onProviderFailure?.({provider:'groq',status:response.status,hint,...capacity,...(parameter?{parameter}:{})});
    console.warn(JSON.stringify({event:'ai.provider.failed',provider:'groq',httpStatus:response.status}));
    throw new AIProviderError(503,response.status===429?'AI_PROVIDER_LIMIT':[401,403].includes(response.status)?'AI_PROVIDER_AUTH':'AI_PROVIDER_UNAVAILABLE',
      'The document reader is temporarily unavailable. Your full file is kept; no import credit was used.');
  }
  let payload:{choices?:{finish_reason?:string;message?:{content?:unknown;tool_calls?:unknown}}[]};
  try{payload=await response.json();}catch{throw new AIProviderError(502,'AI_INVALID_OUTPUT','The document reader returned an unreadable result. Your file is kept.');}
  return payload;
}

/** Academic transcriptions have no previous conversation or action tools. */
export async function groqAcademicCompletion(env:AIEnvironment,input:AIInput,messages:AIMessage[],maxTokens:number,
  timeoutMs:number,fetcher:typeof fetch=fetch){
  if(input.mode!=='timetable')throw new AIProviderError(503,'AI_NOT_CONFIGURED','The document reader is temporarily unavailable. Your file is kept.');
  const latest=messages.filter(m=>m.role==='user').at(-1);
  const source=messages.filter(m=>m.role==='system'||m===latest);
  const payload=await groqCompletion(env,input,source,maxTokens,timeoutMs,fetcher);
  const choice=payload.choices?.[0];
  if(choice?.finish_reason==='length')throw new AIProviderError(502,'AI_INCOMPLETE','The schedule response was cut short. Your full file is kept; no import credit was used.');
  const text=typeof choice?.message?.content==='string'?choice.message.content.trim():'';
  if(choice?.finish_reason!=='stop'||!text||text.length>50000)throw new AIProviderError(502,'AI_INVALID_OUTPUT','The complete document could not be read. Your file is kept; no import credit was used.');
  return{text,calls:[],provider:'groq' as const};
}
