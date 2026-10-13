import { describe, expect, it, vi } from 'vitest';
import { aiMessages, assertAIConfiguration, completeAI, generateAI, providerConfiguration, type AIEnvironment, type AIInput } from '../src/lib/ai-provider';
const input: AIInput = {mode: 'study', prompt: 'Explain Ohm’s law'};
const native = (result: unknown = {response: 'Voltage equals current multiplied by resistance.'}) => vi.fn().mockResolvedValue(result);
const env = (run = native()): AIEnvironment => ({AI_ASSISTANT_ENABLED: 'true', AI_TEXT_PROVIDER: 'workers-ai', AI: {run}});
describe('Workers AI recovery', () => {
  it('activates the native binding without consuming new environment variable slots',async()=>{
    const run=native(),fetcher=vi.fn();
    expect((await generateAI({AI_ASSISTANT_ENABLED:'true',AI:{run},HF_TOKEN:'synthetic',HF_CHAT_MODEL:'test/chat'},input,fetcher)).provider).toBe('workers-ai');
    expect(fetcher).not.toHaveBeenCalled();expect(run).toHaveBeenCalledTimes(1);
  });
  it('serves both tiers without a Hugging Face token and preserves their model difference', async () => {
    const run = native(), fetcher = vi.fn();
    expect((await generateAI(env(run), input, fetcher)).provider).toBe('workers-ai');
    await generateAI(env(run), {...input, tier: 'pro'}, fetcher);
    expect(run.mock.calls.map(call => call[0])).toEqual(['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
    expect(fetcher).not.toHaveBeenCalled();
    expect(run.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it('recovers from exhausted HF credit under the same request without retrying it', async () => {
    const run = native(), fetcher = vi.fn().mockResolvedValue(new Response('PRIVATE_PROVIDER_BODY', {status: 402}));
    const result = await generateAI({...env(run), AI_TEXT_PROVIDER: 'huggingface', HF_TOKEN: 'synthetic', HF_CHAT_MODEL: 'test/chat'}, input, fetcher);
    expect(result).toMatchObject({provider: 'workers-ai', text: expect.any(String)});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(run).toHaveBeenCalledTimes(1);
  });
  it('honours the kill switch before any inference', async () => {
    const run = native();await expect(generateAI({...env(run),AI_ASSISTANT_ENABLED:'false'},input)).rejects.toMatchObject({reason:'AI_DISABLED'});expect(run).not.toHaveBeenCalled();
    expect(()=>assertAIConfiguration({...env(),AI:undefined},'study')).toThrow();
  });
  it('routes images to the working native vision adapter without HF credits', () => {
    expect(providerConfiguration({...env(), HF_TOKEN:'synthetic', HF_VISION_MODEL:'test/vision'},'study','image/png').provider).toBe('workers-ai');
  });
  it('normalizes native tool calls and transports tool results without executing them', async () => {
    const run = native({tool_calls:[{name:'get_my_timetable',arguments:{}}]});
    const tools = [{type:'function' as const,function:{name:'get_my_timetable',description:'Read my schedule',parameters:{type:'object'}}}];
    const first = await completeAI(env(run),input,aiMessages(input),tools);
    expect(first.calls).toEqual([{id:'call_cf_0',type:'function',function:{name:'get_my_timetable',arguments:'{}'}}]);
    run.mockResolvedValueOnce({response:'Your next class is at 10:00.'});
    await completeAI(env(run),input,[...aiMessages(input),{role:'assistant',content:null,tool_calls:first.calls},{role:'tool',tool_call_id:first.calls[0].id,content:'{"time":"10:00"}'}]);
    expect(run.mock.calls[1][1].messages.at(-2).content).toContain('get_my_timetable');
    expect(run.mock.calls[1][1].messages.at(-1)).toEqual({role:'tool',content:'{"time":"10:00"}'});
  });
  it.each([['3036','AI_PROVIDER_QUOTA'],['3040','AI_PROVIDER_BUSY'],['3007','AI_TIMEOUT'],['5016','AI_MODEL_ACCESS'],['5018','AI_MODEL_ACCESS']])('classifies %s without exposing provider data', async(code,reason)=>{
    const run=vi.fn().mockRejectedValue(new Error(`${code}: PRIVATE_PROVIDER_BODY`));
    await expect(generateAI(env(run),input)).rejects.toMatchObject({reason});
    await expect(generateAI(env(run),input)).rejects.not.toThrow('PRIVATE_PROVIDER_BODY');
  });
  it('rejects empty and token-exhausted native output',async()=>{
    await expect(generateAI(env(native({response:''})),input)).rejects.toMatchObject({reason:'AI_EMPTY_OUTPUT'});
    await expect(generateAI(env(native({response:'Partial',usage:{completion_tokens:3072}})),input)).rejects.toMatchObject({reason:'AI_INCOMPLETE'});
  });
  it('reads the original private photo in one inference without waiting for OCR', async () => {
    const run=native(), toMarkdown=vi.fn().mockResolvedValue([{format:'markdown',data:'WRONG OCR TEXT'}]);
    const result=await generateAI({...env(run),AI:{run,toMarkdown}}, {...input,tier:'pro',media:{mimeType:'image/png',data:btoa('PRIVATE_PIXELS')}});
    expect(result.provider).toBe('workers-ai');
    expect(toMarkdown).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(run.mock.calls[0][1].messages.at(-1).content).toEqual(expect.arrayContaining([
      expect.objectContaining({type:'image_url',image_url:{url:'data:image/png;base64,'+btoa('PRIVATE_PIXELS')}}),
    ]));
    expect(run.mock.calls[0][1].image).toBeUndefined();
  });
  it('recovers visually when conversion cannot read a photo', async () => {
    const run=native(),toMarkdown=vi.fn().mockResolvedValue([{format:'error',data:'Unreadable'}]);
    await generateAI({...env(run),AI:{run,toMarkdown}},{...input,media:{mimeType:'image/png',data:btoa('PIXELS')}});
    expect(run.mock.calls[0][0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(run.mock.calls[0][1].messages.at(-1).content).toEqual(expect.arrayContaining([expect.objectContaining({type:'image_url',image_url:{url:'data:image/png;base64,'+btoa('PIXELS')}})]));
    expect(run.mock.calls[0][1].image).toBeUndefined();
  });

});

describe('schedule inference deadline regression', () => {
  const schedule = {documentType:'class_timetable',entries:[{title:'Mathematics',courseCode:'MTH 201',dayOfWeek:1,startsAt:'08:00',endsAt:'10:00',venue:'LT 1',lecturer:''}],events:[],warnings:[]};
  it('finishes a real-length schedule attempt after the old 45-second cut-off',async()=>{
    vi.useFakeTimers();
    try {
      const run=vi.fn(()=>new Promise(resolve=>setTimeout(()=>resolve({choices:[{finish_reason:'stop',message:{content:JSON.stringify(schedule)}}]}),60000)));
      const toMarkdown=vi.fn(()=>new Promise(()=>{}));
      const pending=generateAI({...env(run),AI:{run,toMarkdown}},{mode:'timetable',documentKind:'class',prompt:'',media:{mimeType:'image/jpeg',data:btoa('PRIVATE_PIXELS')}});
      await vi.advanceTimersByTimeAsync(60001);
      expect(JSON.parse((await pending).text).entries[0].courseCode).toBe('MTH 201');
      expect(toMarkdown).not.toHaveBeenCalled();
      expect(run.mock.calls[0][1]).toMatchObject({chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_object'}});
    } finally { vi.useRealTimers(); }
  });
  it('reserves time for the configured fallback instead of consuming its whole deadline',async()=>{
    vi.useFakeTimers();
    try {
      const run=vi.fn(()=>new Promise(()=>{}));
      const fetcher=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(schedule)}}]}));
      const pending=generateAI({...env(run),HF_TOKEN:'synthetic',HF_CHAT_MODEL:'test/chat',HF_VISION_MODEL:'test/vision'},{mode:'timetable',prompt:'',media:{mimeType:'image/png',data:btoa('PIXELS')}},fetcher);
      await vi.advanceTimersByTimeAsync(75001);
      expect((await pending).provider).toBe('huggingface');
      expect(run).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('gives dated exams their own schema without conflicting weekly instructions',async()=>{
    const run=native({response:'{"documentType":"exam_timetable","entries":[],"warnings":[]}'});
    await generateAI(env(run),{mode:'timetable',documentKind:'exam',prompt:'Read exams'});
    const instruction=run.mock.calls[0][1].messages[0].content;
    expect(instruction).toContain('exam_timetable');expect(instruction).not.toContain('dayOfWeek');
  });
});
