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
  it.each([['3036','AI_PROVIDER_QUOTA'],['3040','AI_PROVIDER_BUSY'],['3007','AI_TIMEOUT']])('classifies %s without exposing provider data', async(code,reason)=>{
    const run=vi.fn().mockRejectedValue(new Error(`${code}: PRIVATE_PROVIDER_BODY`));
    await expect(generateAI(env(run),input)).rejects.toMatchObject({reason});
    await expect(generateAI(env(run),input)).rejects.not.toThrow('PRIVATE_PROVIDER_BODY');
  });
  it('rejects empty and token-exhausted native output',async()=>{
    await expect(generateAI(env(native({response:''})),input)).rejects.toMatchObject({reason:'AI_EMPTY_OUTPUT'});
    await expect(generateAI(env(native({response:'Partial',usage:{completion_tokens:3072}})),input)).rejects.toMatchObject({reason:'AI_INCOMPLETE'});
  });
  it('reads private timetable pixels as text before reasoning, retaining the Pro model', async () => {
    const run=native(), toMarkdown=vi.fn().mockResolvedValue([{format:'markdown',data:'Monday, MAT 101, 08:00–09:00, LT 1'}]);
    const result=await generateAI({...env(run),AI:{run,toMarkdown}}, {...input,tier:'pro',media:{mimeType:'image/png',data:btoa('PRIVATE_PIXELS')}});
    expect(result.provider).toBe('workers-ai');
    const files=toMarkdown.mock.calls[0][0]; expect(files[0].blob).toBeInstanceOf(Blob);
    expect(await files[0].blob.text()).toBe('PRIVATE_PIXELS');
    expect(run.mock.calls[0][0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(run.mock.calls[0][1].messages.at(-1).content).toContain('MAT 101');
    expect(run.mock.calls[0][1].image).toBeUndefined();
  });
  it('recovers visually when conversion cannot read a photo', async () => {
    const run=native(),toMarkdown=vi.fn().mockResolvedValue([{format:'error',data:'Unreadable'}]);
    await generateAI({...env(run),AI:{run,toMarkdown}},{...input,media:{mimeType:'image/png',data:btoa('PIXELS')}});
    expect(run.mock.calls[0][0]).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(run.mock.calls[0][1].image).toBe('data:image/png;base64,'+btoa('PIXELS'));
  });

});
