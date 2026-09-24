import test from 'node:test';
import assert from 'node:assert/strict';
import { aiDay, aiLimit, generateAI, parseTimetableJSON, providerConfiguration, selectAIProvider } from '../server/src/lib/ai-provider.ts';
const env = { AI_ASSISTANT_ENABLED:'true', GEMINI_API_KEY:'test-gemini-key', GEMINI_MODEL:'models/test-gemini-model', HF_TOKEN:'test-hf-key', HF_CHAT_MODEL:'test/chat', HF_VISION_MODEL:'test/vision' };
const gemini = (parts=[{text:'Answer'}],finishReason='STOP') => Response.json({candidates:[{content:{parts},finishReason}]});
const hf = () => Response.json({choices:[{message:{content:'{"entries":[],"warnings":[]}'},finish_reason:'stop'}]});
for (const mode of ['study','summary','quiz','notes']) test(`${mode} uses Gemini with backend credentials`,async()=>{
  let called=0;
  const r=await generateAI(env,{mode,prompt:'Learn physics'},async(url,init)=>{
    called++; assert.match(url,/models\/test-gemini-model:generateContent$/); assert.doesNotMatch(url,/key=/);
    assert.equal(init.headers['x-goog-api-key'],'test-gemini-key'); const b=JSON.parse(init.body); assert.equal(b.contents.at(-1).parts[0].text,'Learn physics'); return gemini();
  }); assert.equal(called,1); assert.equal(r.text,'Answer'); assert.equal(r.provider,'gemini');
});
test('timetable text uses HF and no Gemini fallback',async()=>{
  const r=await generateAI(env,{mode:'timetable',prompt:'Monday 8 to 9'},async(url,init)=>{
    assert.equal(url,'https://router.huggingface.co/v1/chat/completions'); assert.equal(JSON.parse(init.body).model,'test/chat'); return hf();
  }); assert.equal(r.provider,'huggingface');
});
test('timetable images use the configured vision model with inline private bytes',async()=>{
  await generateAI(env,{mode:'timetable',prompt:'',media:{mimeType:'image/png',data:'aGVsbG8='}},async(url,init)=>{
    const b=JSON.parse(init.body); assert.equal(b.model,'test/vision'); assert.equal(b.messages[1].content[1].image_url.url,'data:image/png;base64,aGVsbG8='); return hf();
  });
});
test('PDF timetable input is explicitly routed to Gemini before any call',async()=>{
  let calls=0;
  await generateAI(env,{mode:'timetable',prompt:'',media:{mimeType:'application/pdf',data:'cGRm'}},async(url,init)=>{
    calls++;assert.match(url,/generativelanguage/);const b=JSON.parse(init.body);assert.equal(b.contents[0].parts[1].inlineData.mimeType,'application/pdf'); assert.equal(b.generationConfig.responseMimeType,'application/json'); return gemini([{text:'{"entries":[]}'}]);
  });assert.equal(calls,1);assert.equal(selectAIProvider('timetable','application/pdf'),'gemini');
});
test('missing/disabled configuration fails before provider IO',async()=>{
  let calls=0; const network=async()=>{calls++;return gemini();};
  await assert.rejects(generateAI({...env,AI_ASSISTANT_ENABLED:'false'},{mode:'study',prompt:'x'},network),{reason:'AI_DISABLED'});
  await assert.rejects(generateAI({...env,HF_VISION_MODEL:''},{mode:'timetable',prompt:'x',media:{mimeType:'image/png',data:'eA=='}},network),{reason:'AI_NOT_CONFIGURED'});
  assert.equal(calls,0);assert.deepEqual(providerConfiguration({},'study').missing,['GEMINI_API_KEY','GEMINI_MODEL']);
});
for (const [status,reason] of [[401,'AI_PROVIDER_AUTH'],[403,'AI_PROVIDER_AUTH'],[402,'AI_PROVIDER_LIMIT'],[429,'AI_PROVIDER_LIMIT'],[404,'AI_PROVIDER_MODEL'],[500,'AI_PROVIDER_UNAVAILABLE']]) test(`HTTP ${status} is sanitized and never retries/falls back`,async()=>{
  let calls=0;
  await assert.rejects(generateAI(env,{mode:'timetable',prompt:'x'},async()=>{calls++;return new Response('upstream-private-source-secret',{status});}),e=>e.reason===reason&&!e.message.includes('upstream-private'));
  assert.equal(calls,1);
});
test('thought parts are excluded and bounded multi-turn history is passed',async()=>{
  const history=Array.from({length:9},(_,i)=>({prompt:`Q${i}`,text:`A${i}`}));
  const r=await generateAI(env,{mode:'study',prompt:'Next',history},async(url,init)=>{const b=JSON.parse(init.body);assert.equal(b.contents.length,13);assert.equal(b.contents[0].parts[0].text,'Q3');return gemini([{text:'internal',thought:true},{text:'Visible'}]);});assert.equal(r.text,'Visible');
});
test('blocked, empty, malformed and incomplete responses are not success',async()=>{
  await assert.rejects(generateAI(env,{mode:'study',prompt:'x'},async()=>gemini([])),{reason:'AI_EMPTY_OUTPUT'});
  await assert.rejects(generateAI(env,{mode:'study',prompt:'x'},async()=>gemini([{text:'Partial'}],'MAX_TOKENS')),{reason:'AI_INCOMPLETE'});
  await assert.rejects(generateAI(env,{mode:'study',prompt:'x'},async()=>gemini([],'SAFETY')),{reason:'AI_BLOCKED'});
  await assert.rejects(generateAI(env,{mode:'study',prompt:'x'},async()=>new Response('not json')),{reason:'AI_INVALID_OUTPUT'});
});
test('provider timeout has a distinct safe failure',async()=>{
  await assert.rejects(generateAI(env,{mode:'study',prompt:'x'},async()=>{throw new DOMException('secret','TimeoutError');}),{reason:'AI_TIMEOUT'});
});
test('JSON timetable validation accepts fences, preserves warnings and rejects unsafe shapes',()=>{
  assert.deepEqual(parseTimetableJSON('```json\n{"entries":[],"warnings":["ambiguous",2]}\n```'),{entries:[],warnings:['ambiguous']});
  assert.throws(()=>parseTimetableJSON('{oops'),{reason:'AI_INVALID_OUTPUT'});assert.throws(()=>parseTimetableJSON('{"classes":[]}'),{reason:'AI_INVALID_OUTPUT'});
  assert.throws(()=>parseTimetableJSON(JSON.stringify({entries:Array(41).fill({})})),{reason:'AI_TOO_MANY_CLASSES'});
});
test('limits preserve zero, bound large values and fail closed for invalid values',()=>{
  assert.equal(aiLimit(undefined,5,100),5);assert.equal(aiLimit('0',5,100),0);assert.equal(aiLimit('wat',5,100),0);assert.equal(aiLimit('-1',5,100),0);assert.equal(aiLimit('1.5',5,100),0);assert.equal(aiLimit('1000',5,100),100);
});
test('allowance resets at midnight WAT, including UTC date boundary',()=>{
  assert.deepEqual(aiDay(Date.parse('2026-09-24T22:59:59Z')),{startsAt:'2026-09-23T23:00:00.000Z',resetsAt:'2026-09-24T23:00:00.000Z'});
  assert.deepEqual(aiDay(Date.parse('2026-09-24T23:00:00Z')),{startsAt:'2026-09-24T23:00:00.000Z',resetsAt:'2026-09-25T23:00:00.000Z'});
});
