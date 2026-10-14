import {describe,expect,it,vi} from 'vitest';
import {generateAI,type AIEnvironment} from '../src/lib/ai-provider';
import {geminiAcademicCompletion} from '../src/lib/ai-gemini';

const source={documentType:'class_timetable',entries:[{title:'MAT101',courseCode:'MAT101',dayOfWeek:1,startsAt:'08:00',endsAt:'09:00'}],events:[],warnings:[],coverage:{complete:true,daysRead:[1],rowCount:1,uncertain:[]}};
const result=(finishReason='STOP')=>Response.json({candidates:[{finishReason,content:{parts:[{thought:true,text:'internal summary'},{text:JSON.stringify(source)}]}}]});
const env=():AIEnvironment=>({AI_ASSISTANT_ENABLED:'true',AI:{run:vi.fn().mockRejectedValue(new Error('4006: you have used up your daily free allocation of 10,000 neurons'))},HF_TOKEN:'PRIVATE_HF_KEY',HF_CHAT_MODEL:'test/chat',HF_VISION_MODEL:'test/vision',GEMINI_API_KEY:'PRIVATE_GEMINI_KEY'});
const input={mode:'timetable' as const,prompt:'Read the whole timetable',media:{mimeType:'image/png',data:btoa('PRIVATE_PIXELS')},deadline:Date.now()+150000};
describe('academic recovery through existing Gemini configuration',()=>{
  it('recovers a full private academic response when native allowance and HF capacity are exhausted',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).includes('huggingface')?new Response('PRIVATE_PROVIDER_BODY',{status:402}):result());
    const generated=await generateAI(env(),input,fetcher);
    expect(generated.provider).toBe('gemini');expect(JSON.parse(generated.text)).toEqual(source);
    expect(generated.text).not.toContain('internal summary');expect(fetcher).toHaveBeenCalledTimes(2);
    const [url,request]=fetcher.mock.calls[1]!,body=JSON.parse(String(request!.body));
    expect(String(url)).not.toContain('PRIVATE_GEMINI_KEY');expect(new Headers(request!.headers).get('x-goog-api-key')).toBe('PRIVATE_GEMINI_KEY');
    expect(body.contents[0].parts).toContainEqual({inlineData:input.media});expect(JSON.stringify(body)).not.toContain('PRIVATE_GEMINI_KEY');
    expect(body.generationConfig.responseMimeType).toBe('application/json');expect(body.generationConfig.thinkingConfig).toEqual({thinkingLevel:'low'});
    expect(request!.signal).toBeInstanceOf(AbortSignal);expect(request!.redirect).toBe('manual');
  });
  it.each([['MAX_TOKENS','AI_INCOMPLETE'],['SAFETY','AI_INVALID_OUTPUT']])('rejects a %s completion instead of saving a partial schedule',async(finish,reason)=>{
    await expect(geminiAcademicCompletion(env(),input,[{role:'user',content:'Read'}],2048,150000,vi.fn().mockResolvedValue(result(finish)))).rejects.toMatchObject({reason});
  });
  it('replaces an unavailable configured model once within the same deadline',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('PRIVATE_BODY',{status:404})).mockResolvedValueOnce(result());
    expect((await geminiAcademicCompletion({...env(),GEMINI_MODEL:'gemini-old-flash'},input,[{role:'user',content:'Read'}],2048,150000,fetcher)).provider).toBe('gemini');
    expect(fetcher).toHaveBeenCalledTimes(2);expect(String(fetcher.mock.calls[1][0])).toContain('gemini-3.5-flash-lite:generateContent');
  });
  it.each([401,403,429,500])('does not retry or reveal an HTTP %i provider response',async status=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('PRIVATE_SOURCE_AND_KEY',{status}));
    const error=await geminiAcademicCompletion(env(),input,[{role:'user',content:'Read'}],2048,150000,fetcher).catch(e=>e);
    expect(error.status).toBe(503);expect(error.message).not.toContain('PRIVATE_SOURCE_AND_KEY');expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses the available Flash model when a configured model requires billing',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:{message:'Billing is required for this model'}},{status:429})).mockResolvedValueOnce(result());
    await geminiAcademicCompletion({...env(),GEMINI_MODEL:'gemini-3.8-flash'},input,[{role:'user',content:'Read'}],2048,150000,fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(String(fetcher.mock.calls[1][0])).toContain('gemini-3.5-flash-lite:generateContent');
  });
  it('keeps focused day reads on the provider that successfully read the layout',async()=>{
    const configuration=env(),fetcher=vi.fn().mockResolvedValue(result());
    expect((await generateAI(configuration,{...input,provider:'gemini',scheduleLayout:true},fetcher)).provider).toBe('gemini');
    expect(configuration.AI!.run).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not forward existing chat conversations to the academic fallback',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('No HF capacity',{status:402}));
    await expect(generateAI(env(),{mode:'study',prompt:'Hi',history:[{prompt:'PRIVATE_HISTORY',text:'PRIVATE_ANSWER'}]},fetcher)).rejects.toMatchObject({reason:'AI_PROVIDER_QUOTA'});
    expect(fetcher.mock.calls.every(([url])=>String(url).includes('huggingface'))).toBe(true);
  });
  it('keeps the kill switch and expired deadline ahead of every alternative call',async()=>{
    const fetcher=vi.fn();await expect(generateAI({...env(),AI_ASSISTANT_ENABLED:'false'},input,fetcher)).rejects.toMatchObject({reason:'AI_DISABLED'});
    await expect(geminiAcademicCompletion(env(),{...input,deadline:Date.now()-1},[],2048,150000,fetcher)).rejects.toMatchObject({reason:'AI_TIMEOUT'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
