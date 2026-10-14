import {afterEach,describe,expect,it,vi} from 'vitest';
import {importJWK} from 'jose';
import {privateAcademicInference,academicGatewayModel} from '../../portal/lib/private-academic-inference';
import {imageProcessingPublicKey,imageProcessingToken,academicInferenceAudience} from '../src/lib/image-processing-auth';
import {generateAI,type AIEnvironment} from '../src/lib/ai-provider';
import {gatewayAcademicCompletion} from '../src/lib/ai-gateway';

const secret='academic-private-test-secret-'.repeat(3),url='https://agents.kampusone.app/internal-processing/academic-inference';
const getKey=async()=>importJWK(await imageProcessingPublicKey(secret),'EdDSA');
const messages=[{role:'system',content:'Read visible source only.'},{role:'user',content:[{type:'text',text:'Read my timetable'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]}];
const body=()=>JSON.stringify({messages,maxTokens:2048,timeoutMs:60000});
const signed=async(text=body(),audience:typeof academicInferenceAudience|'kampusone:private:timetable-image'=academicInferenceAudience)=>new Request(url,{method:'POST',headers:{Authorization:'Bearer '+await imageProcessingToken(secret,text,audience),'x-vercel-oidc-token':'PRIVATE_OIDC'},body:text});
const result=(finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content:'{"visible":true}'}}],private:'UPSTREAM_INTERNAL'});
const fetcher=()=>vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({balance:5})).mockResolvedValueOnce(result());
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe('bounded private academic fallback',()=>{
  it('rejects unsigned, expired, wrong-audience and altered-body requests before metered I/O',async()=>{
    const calls=fetcher(),original=await signed();
    expect((await privateAcademicInference(new Request(url,{method:'POST',body:body()}),getKey,calls)).status).toBe(401);
    expect((await privateAcademicInference(await signed(body(),'kampusone:private:timetable-image'),getKey,calls)).status).toBe(401);
    expect((await privateAcademicInference(new Request(url,{method:'POST',headers:original.headers,body:body()+' '}),getKey,calls)).status).toBe(401);
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()-120000);const expired=await signed();vi.useRealTimers();
    expect((await privateAcademicInference(expired,getKey,calls)).status).toBe(401);expect(calls).not.toHaveBeenCalled();
  });
  it('uses only an allowlisted model with rotated server OIDC, excluding upstream details',async()=>{
    const calls=fetcher(),response=await privateAcademicInference(await signed(),getKey,calls);
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toMatch(/PRIVATE_OIDC|UPSTREAM_INTERNAL|balance/);
    const [target,init]=calls.mock.calls[1]!,sent=JSON.parse(String(init!.body));
    expect(target).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');expect(sent.model).toBe(academicGatewayModel);
    expect(sent.messages).toEqual(messages);expect(sent.max_tokens).toBe(2048);expect(sent.reasoning).toEqual({effort:'none'});
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer PRIVATE_OIDC');expect(sent.tools).toBeUndefined();
  });
  it.each(['remote-image','model','tools','token-budget','oversize'])('rejects a %s payload without using credits',async problem=>{
    const value=JSON.parse(body());
    if(problem==='remote-image')value.messages[1].content[1].image_url.url='https://private.invalid/image';
    if(problem==='model')value.model='other/model';if(problem==='tools')value.tools=[];if(problem==='token-budget')value.maxTokens=4097;
    const text=problem==='oversize'?'x'.repeat(4_200_001):JSON.stringify(value),calls=fetcher();
    expect((await privateAcademicInference(await signed(text),getKey,calls)).status).toBe(problem==='oversize'?413:400);expect(calls).not.toHaveBeenCalled();
  });
  it('stops at the existing credit floor without billing changes or inference',async()=>{
    const calls=vi.fn<typeof fetch>().mockResolvedValue(Response.json({balance:.01}));
    expect((await privateAcademicInference(await signed(),getKey,calls)).status).toBe(429);expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0]![0]).toBe('https://ai-gateway.vercel.sh/v1/credits');
  });
  it('requires configured server identity and the fallback switch',async()=>{
    const calls=vi.fn<typeof fetch>(),input={mode:'timetable' as const,prompt:'Read',deadline:Date.now()+150000};
    await expect(gatewayAcademicCompletion({},input,[],4096,60000,calls)).rejects.toMatchObject({reason:'AI_NOT_CONFIGURED'});expect(calls).not.toHaveBeenCalled();
  });
  it('recovers after primary limits using one signed request and the same deadline',async()=>{
    const env:AIEnvironment={AI_ASSISTANT_ENABLED:'true',AI_GATEWAY_FALLBACK_ENABLED:'true',JWT_SECRET:secret,TIMETABLE_IMAGE_PROCESSOR_URL:'https://agents.kampusone.app/internal-processing/timetable-image',
      AI:{run:vi.fn().mockRejectedValue(new Error('4006 daily allocation'))},HF_TOKEN:'PRIVATE_HF',HF_CHAT_MODEL:'test/chat',HF_VISION_MODEL:'test/vision',GROQ_API_KEY:'PRIVATE_GROQ',GEMINI_API_KEY:'PRIVATE_GEMINI'};
    const calls=vi.fn<typeof fetch>().mockImplementation(async(target,init)=>{
      if(String(target)===url){const request=new Request(String(target),init);request.headers.set('x-vercel-oidc-token','PRIVATE_OIDC');return privateAcademicInference(request,getKey,fetcher());}
      return new Response(null,{status:429});
    });
    const deadline=Date.now()+150000,generated=await generateAI(env,{mode:'timetable',prompt:'Read',history:[{prompt:'PRIVATE_HISTORY',text:'PRIVATE_ANSWER'}],media:{mimeType:'image/png',data:'YQ=='},deadline},calls);
    expect(generated.provider).toBe('gateway');expect(JSON.parse(generated.text)).toEqual({visible:true});
    const gateways=calls.mock.calls.filter(([target])=>String(target)===url);expect(gateways).toHaveLength(1);
    const sent=JSON.parse(String(gateways[0]![1]!.body));expect(sent.maxTokens).toBe(4096);expect(sent.timeoutMs).toBeLessThanOrEqual(deadline-Date.now()+1000);
    expect(JSON.stringify(sent)).not.toMatch(/PRIVATE_HISTORY|PRIVATE_ANSWER|PRIVATE_GROQ|PRIVATE_GEMINI/);expect(sent.messages).toHaveLength(2);
  });
  it('cannot accept truncated output or start an expired fallback',async()=>{
    const env={AI_GATEWAY_FALLBACK_ENABLED:'true',JWT_SECRET:secret,TIMETABLE_IMAGE_PROCESSOR_URL:'https://agents.kampusone.app/internal-processing/timetable-image'},calls=vi.fn<typeof fetch>().mockResolvedValue(result('length'));
    await expect(gatewayAcademicCompletion(env,{mode:'timetable',prompt:'Read'},[],2048,60000,calls)).rejects.toMatchObject({reason:'AI_INCOMPLETE'});
    calls.mockClear();await expect(gatewayAcademicCompletion(env,{mode:'timetable',prompt:'Read',deadline:Date.now()-1},[],2048,60000,calls)).rejects.toMatchObject({reason:'AI_TIMEOUT'});expect(calls).not.toHaveBeenCalled();
  });
});
