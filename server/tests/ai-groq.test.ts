import {describe,expect,it,vi} from 'vitest';
import {generateAI,type AIEnvironment} from '../src/lib/ai-provider';
import {groqAcademicCompletion} from '../src/lib/ai-groq';
const source={documentType:'class_timetable',entries:[{title:'MAT101',courseCode:'MAT101',dayOfWeek:1,startsAt:'08:00',endsAt:'09:00'}],events:[],warnings:[],coverage:{complete:true,daysRead:[1],rowCount:1,uncertain:[]}};
const result=(finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content:JSON.stringify(source)}}]});
const env=():AIEnvironment=>({AI_ASSISTANT_ENABLED:'true',AI:{run:vi.fn().mockRejectedValue(new Error('4006: you have used up your daily free allocation of 10,000 neurons'))},HF_TOKEN:'PRIVATE_HF',HF_CHAT_MODEL:'test/chat',HF_VISION_MODEL:'test/vision',GROQ_API_KEY:'PRIVATE_GROQ',GEMINI_API_KEY:'PRIVATE_GEMINI'});
const input=()=>({mode:'timetable' as const,prompt:'Read my full timetable',media:{mimeType:'image/png',data:btoa('PRIVATE_PIXELS')},deadline:Date.now()+150000});
describe('academic recovery with the existing Groq credential',()=>{
  it('waits for a provider retry window within this same request and deadline',async()=>{
    vi.useFakeTimers();
    try{
      const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'10'}})).mockResolvedValueOnce(result());
      const pending=groqAcademicCompletion(env(),input(),[{role:'user',content:'Read'}],2048,150000,fetcher);
      await vi.advanceTimersByTimeAsync(10250);expect((await pending).provider).toBe('groq');expect(fetcher).toHaveBeenCalledTimes(2);
    }finally{vi.useRealTimers();}
  });
  it('reads the private source after native and HF limits without another reservation or the rejected Gemini call',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).includes('huggingface')?new Response('PRIVATE_BODY',{status:402}):result());
    const generated=await generateAI(env(),input(),fetcher);expect(generated.provider).toBe('groq');expect(JSON.parse(generated.text)).toEqual(source);
    expect(fetcher).toHaveBeenCalledTimes(2);const [url,init]=fetcher.mock.calls[1]!,body=JSON.parse(String(init!.body));
    expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions');expect(String(url)).not.toContain('PRIVATE_GROQ');
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer PRIVATE_GROQ');expect(JSON.stringify(body)).not.toContain('PRIVATE_GROQ');
    expect(body.messages.at(-1).content).toContainEqual({type:'image_url',image_url:{url:'data:image/png;base64,'+btoa('PRIVATE_PIXELS')}});
    expect(body.reasoning_effort).toBe('none');expect(body.response_format).toEqual({type:'json_object'});
  });
  it('rejects a truncated completion and never treats it as the full week',async()=>{
    await expect(groqAcademicCompletion(env(),input(),[],2048,150000,vi.fn().mockResolvedValue(result('length')))).rejects.toMatchObject({reason:'AI_INCOMPLETE'});
  });
  it('caps output reservation to leave room for the source under the 8k service limit',async()=>{
    const fetcher=vi.fn().mockResolvedValue(result());
    await groqAcademicCompletion(env(),input(),[{role:'user',content:'Return JSON'}],8192,150000,fetcher);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).max_completion_tokens).toBe(4096);
  });
  it.each([401,403,429,500])('preserves an HTTP %i failure without leaking provider text or retrying it',async status=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('PRIVATE_SOURCE_AND_KEY',{status}));
    const error=await groqAcademicCompletion(env(),input(),[],2048,150000,fetcher).catch(e=>e);
    expect(error.status).toBe(503);expect(error.message).not.toContain('PRIVATE_SOURCE_AND_KEY');expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains Gemini as one bounded alternative when Groq cannot serve the academic request',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).includes('huggingface')?new Response('',{status:402}):String(url).includes('groq.com')?new Response('',{status:429}):Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(source)}]}}]}));
    expect((await generateAI(env(),input(),fetcher)).provider).toBe('gemini');expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('preserves Pro context through a text fallback without bypassing an expired academic deadline',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).includes('huggingface')?new Response('',{status:402}):Response.json({choices:[{finish_reason:'stop',message:{content:'The same result follows from the previous explanation.'}}]}));
    const generated=await generateAI(env(),{mode:'study',tier:'pro',prompt:'Why?',history:[{prompt:'PRIVATE_HISTORY',text:'PRIVATE_ANSWER'}]},fetcher);
    expect(generated.provider).toBe('groq');
    const body=JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body));
    expect(body.model).toBe('openai/gpt-oss-20b');expect(JSON.stringify(body.messages)).toContain('PRIVATE_HISTORY');expect(JSON.stringify(body.messages)).toContain('PRIVATE_ANSWER');
    expect(body.response_format).toBeUndefined();expect(body.max_completion_tokens).toBe(4096);fetcher.mockClear();
    await expect(groqAcademicCompletion(env(),{...input(),deadline:Date.now()-1},[],2048,150000,fetcher)).rejects.toMatchObject({reason:'AI_TIMEOUT'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
