import {AIProviderError} from './ai-error.ts';
import type {AIEnvironment,AIInput,AIMessage} from './ai-provider';

/** Use the existing server-only Gemini credential for academic recovery. No
 * browser key, new quota reservation, conversation forwarding or tool calls. */
export async function geminiAcademicCompletion(env:AIEnvironment,input:AIInput,messages:AIMessage[],maxTokens:number,
  timeoutMs:number,fetcher:typeof fetch=fetch) {
  if(input.mode!=='timetable'||!env.GEMINI_API_KEY)throw new AIProviderError(503,'AI_NOT_CONFIGURED','The document reader is temporarily unavailable. Your file is kept.');
  const configured=(env.GEMINI_MODEL?.trim()||'gemini-3.8-flash').replace(/^models\//,'');
  if(!/^gemini-[a-z0-9.-]{1,80}$/.test(configured))throw new AIProviderError(503,'AI_NOT_CONFIGURED','The document reader is temporarily unavailable. Your file is kept.');
  const deadline=Math.min(input.deadline??Infinity,Date.now()+timeoutMs);
  const text=(value:unknown)=>typeof value==='string'?value:Array.isArray(value)?value.filter(p=>p?.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n'):'';
  const system=messages.filter(m=>m.role==='system').map(m=>text(m.content)).join('\n');
  const parts:Record<string,unknown>[]=[{text:text(messages.filter(m=>m.role==='user').at(-1)?.content)||input.prompt}];
  if(input.media)parts.push({inlineData:{mimeType:input.media.mimeType,data:input.media.data}});
  const models=configured==='gemini-3.8-flash'?[configured]:[configured,'gemini-3.8-flash'];
  for(const [index,model] of models.entries()) {
    const remaining=deadline-Date.now();
    if(remaining<=0)throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your file and draft are kept.');
    let response:Response;
    try {
      response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(remaining),
        headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
        body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts}],
          generationConfig:{temperature:0,maxOutputTokens:Math.max(maxTokens,4096),responseMimeType:'application/json',
            ...(/^gemini-3\./.test(model)?{thinkingConfig:{thinkingLevel:'low'}}:/^gemini-2\.5-flash/.test(model)?{thinkingConfig:{thinkingBudget:0}}:{})}}),
      });
    }catch(error){
      if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new AIProviderError(504,'AI_TIMEOUT','Reading took too long. Your file and draft are kept.');
      throw new AIProviderError(503,'AI_PROVIDER_UNAVAILABLE','The document reader could not connect. Your file is kept; try again.');
    }
    if(!response.ok) {
      const failure=await response.json().catch(()=>({})) as {error?:{message?:string}};
      const message=typeof failure.error?.message==='string'?failure.error.message:'';
      const hint=/key.*(?:invalid|not valid|expired|leaked)/i.test(message)?'key_invalid'
        :/key.*restrict|permission|forbidden/i.test(message)?'key_restricted':/billing/i.test(message)?'billing_required'
        :/quota|rate limit|resource exhausted/i.test(message)?'service_limit':'unclassified';
      input.onProviderFailure?.({provider:'gemini',status:response.status,hint});
      if(response.status===404&&index===0&&models.length>1)continue;
      console.warn(JSON.stringify({event:'ai.provider.failed',provider:'gemini',httpStatus:response.status}));
      throw new AIProviderError(503,response.status===429?'AI_PROVIDER_LIMIT':[401,403].includes(response.status)?'AI_PROVIDER_AUTH':'AI_PROVIDER_UNAVAILABLE',
        'The document reader is temporarily unavailable. Your full file is kept; no import credit was used.');
    }
    let payload:{candidates?:{finishReason?:string;content?:{parts?:{text?:string;thought?:boolean}[]}}[]};
    try{payload=await response.json();}catch{throw new AIProviderError(502,'AI_INVALID_OUTPUT','The document reader returned an unreadable result. Your file is kept.');}
    const candidate=payload.candidates?.[0];
    if(candidate?.finishReason==='MAX_TOKENS')throw new AIProviderError(502,'AI_INCOMPLETE','The schedule response was cut short. Your full file is kept; no import credit was used.');
    if(candidate?.finishReason!=='STOP')throw new AIProviderError(502,'AI_INVALID_OUTPUT','The complete document could not be read. Your file is kept; no import credit was used.');
    const output=candidate.content?.parts?.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('').trim()??'';
    if(!output||output.length>50000)throw new AIProviderError(502,'AI_EMPTY_OUTPUT','The document reader returned no usable result. Your file is kept.');
    return {text:output,calls:[],provider:'gemini' as const};
  }
  throw new AIProviderError(503,'AI_PROVIDER_UNAVAILABLE','The document reader is temporarily unavailable. Your file is kept.');
}
