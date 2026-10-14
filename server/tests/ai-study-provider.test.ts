import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { createSession } from "../src/services/sessions";
import { sha256 } from "../src/lib/security";
import { app } from "../src/app";
import type { AuthenticatedUser, Bindings } from "../src/types";
import { pdfFixture, scannedPdfFixture } from "./helpers/pdf";
import {readFileSync} from 'node:fs';
import { nativeKiraVoiceBody } from "../../mobile/src/lib/kira-voice-upload";

let db: PGlite;
vi.mock("../src/lib/database", () => ({ database: () => testDatabaseAdapter(db), sqlClient: () => testSqlClient(db), firstRow: (r: { rows: unknown[] }) => r.rows[0] }));
const owner = "30000000-0000-4000-8000-000000000001";
const other = "30000000-0000-4000-8000-000000000002";
const ownerEmail = "hf-owner@example.invalid";
const env: Bindings = {
  ENVIRONMENT: "local", ALLOWED_ORIGINS: "https://app.example.invalid", MINIMUM_APP_VERSION: "0.1.0", MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true", SOCIAL_FEED_ENABLED: "true", MARKETPLACE_ENABLED: "false", PHASE_2_SCHEMA_READY: "true", PHASE_3_SCHEMA_READY: "false",
  UNIFIED_SCHEMA_READY: "true", PAYMENTS_ENABLED: "false", AI_ASSISTANT_ENABLED: "true", JWT_SECRET: "test-only-signing-key-not-for-deployment-12345678",
  HF_TOKEN: "hf_SYNTHETIC", HF_CHAT_MODEL: "test/model:nscale", HF_REASONING_MODEL: "test/reasoning:nscale", HF_VISION_MODEL: "test/vision", HF_TRANSCRIPTION_MODEL: "test/whisper",
};
const tokens = new Map<string, string>();
const provider = vi.fn<typeof fetch>();
const draft = (mode = "study") => ({ mode, provider: "huggingface", prompt: "Explain Ohm's law", idempotencyKey: crypto.randomUUID(), consent: true });
async function request(path: string, method = "GET", body?: unknown, actor = owner) {
  return app.request("https://api.example.invalid/v1" + path, { method, headers: { Authorization: `Bearer ${tokens.get(actor)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect({ status: response.status, ...(response.status === status ? {} : { data }) }).toEqual({ status });
  return data;
}
async function count() {
  return (await db.query<{ count: number }>("select count(*)::int as count from app_private.ai_requests")).rows[0]?.count;
}
beforeAll(async () => {
  db = await createTestDatabase();
  for (const [i, id] of [owner, other].entries()) {
    const identity: AuthenticatedUser = { id, email: id === owner ? ownerEmail : "hf-other@example.invalid", roles: ["STUDENT"], operatorRoles: [], universityId: null };
    await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())", [id, identity.email]);
    await db.query("insert into public.profiles(id,user_id,username,display_name,updated_at) values(gen_random_uuid(),$1,$2,'Provider test',now())", [id, "hf-study-" + i]);
    tokens.set(id, (await createSession(env, identity)).accessToken);
  }
}, 60000);
beforeEach(async () => {
  delete env.AI; delete env.AI_TEXT_PROVIDER;
  await db.exec("delete from app_private.ai_requests;delete from app_private.academic_import_usage;delete from app_private.request_rate_limits");
  delete env.PRIVATE_BUCKET;
  env.AI_UNLIMITED_EMAIL_HASHES = await sha256(ownerEmail);
  env.AI_DAILY_USER_LIMIT = "5"; env.AI_DAILY_GLOBAL_LIMIT = "100"; env.AI_ASSISTANT_ENABLED = "true";
  env.HF_TOKEN = "hf_SYNTHETIC";env.AI_CHAT_WINDOW_LIMIT="15";env.AI_STUDY_TRIAL_LIMIT="5";
  provider.mockReset();
  provider.mockImplementation(async url => String(url).includes("/hf-inference/models/")
    ? Response.json({ text: "Explain Newton's second law." })
    : String(url).includes("huggingface.co")
      ? Response.json({ choices: [{ finish_reason: "stop", message: { content: "Voltage equals current multiplied by resistance." } }] })
      : Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A Gemini test answer." }] } }] }));
  vi.stubGlobal("fetch", provider);
});
afterAll(async () => { vi.unstubAllGlobals(); await db?.close(); });

describe("student AI persistence and quota boundaries",()=>{
  it('uses Workers AI through the authenticated route and replays without another inference',async()=>{
    const run=vi.fn().mockResolvedValue({response:'Voltage equals current multiplied by resistance.'});
    env.AI={run};env.AI_TEXT_PROVIDER='workers-ai';
    const body=draft();const first=await json(await request('/ai','POST',body));
    expect(first.text).toBe('Voltage equals current multiplied by resistance.');
    expect(first.provider).toBeUndefined();
    expect(await json(await request('/ai','POST',body))).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);expect(provider).not.toHaveBeenCalled();
    const next=await json(await request('/ai','POST',{...draft(),prompt:'What does resistance mean?',replyTo:body.idempotencyKey}));
    expect(next.threadId).toBe(first.threadId);expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1].messages.some((turn:{role:string;content:unknown})=>turn.role==='assistant'&&turn.content===first.text)).toBe(true);
  });
  it.each(['text/plain','application/pdf'])("extracts an attached %s, saves its type and replays one inference",async mime=>{
    const mediaId=crypto.randomUUID(),bytes=mime==='application/pdf'?pdfFixture(['Physics 101: Ohm law states V = I times R.']):new TextEncoder().encode('Physics 101: Ohm law states V = I times R.');
    const filename=mime==='application/pdf'?'Physics.pdf':'Physics.txt';
    await db.query("insert into public.media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,'resource',$3,$4,$5,$6)",[mediaId,owner,'private-'+mediaId,mime,bytes.byteLength,filename]);
    env.PRIVATE_BUCKET={get:async key=>key==='private-'+mediaId?{size:bytes.byteLength,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null} as unknown as R2Bucket;
    const body={...draft('summary'),prompt:'',mediaId};
    const result=await json(await request('/ai','POST',body));
    expect(result.text).toContain('Voltage');
    const payload=JSON.parse(String(provider.mock.calls[0]?.[1]?.body));
    expect(String(payload.messages.at(-1).content)).toContain('Ohm law states V = I times R.');
    expect((await json(await request(`/ai/history/${body.idempotencyKey}`))).fileType).toBe(mime);
    expect(await json(await request('/ai','POST',body))).toEqual(result);
    expect((await json(await request(`/ai/requests/${body.idempotencyKey}`))).status).toBe('completed');
    await json(await request(`/ai/requests/${body.idempotencyKey}`,'GET',undefined,other),404);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('reads an owned raster PDF through the authenticated route and replays without another scan or inference',async()=>{
    const fixture=JSON.parse(readFileSync(new URL('../../scripts/fixtures/handwritten-timetable.json',import.meta.url),'utf8'));
    const bytes=scannedPdfFixture(Uint8Array.from(Buffer.from(fixture.jpegBase64,'base64')),fixture.width,fixture.height);
    const mediaId=crypto.randomUUID(),run=vi.fn().mockResolvedValueOnce({response:'Handwritten class: MAT 101, 8:00 - 9:00, LT 1'}).mockResolvedValueOnce({response:'Voltage equals current multiplied by resistance.'});
    env.AI={run};
    await db.query("insert into public.media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,'resource',$3,'application/pdf',$4,'handwritten.pdf')",[mediaId,owner,'private-'+mediaId,bytes.byteLength]);
    env.PRIVATE_BUCKET={get:async key=>key==='private-'+mediaId?{size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer}:null} as unknown as R2Bucket;
    const body={...draft('summary'),prompt:'Summarise the attached class',mediaId},result=await json(await request('/ai','POST',body));
    const payload=run.mock.calls[1]![1];
    expect(String(payload.messages.at(-1).content)).toContain('Handwritten class: MAT 101');
    expect(await json(await request('/ai','POST',body))).toEqual(result);
    expect(run).toHaveBeenCalledTimes(2);expect(provider).not.toHaveBeenCalled();
    await json(await request(`/ai/history/${body.idempotencyKey}`,'GET',undefined,other),404);
  });
  it('reads processing reservations without starting another metered call',async()=>{
    const key=crypto.randomUUID();await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) values($1,$2,repeat('a',64),'summary','PROCESSING','{}'::jsonb)",[owner,key]);
    expect(await json(await request(`/ai/requests/${key}`))).toEqual({requestId:key,status:'processing',stage:'analysing'});
    expect(provider).not.toHaveBeenCalled();
    await db.query("update app_private.ai_requests set created_at=now()-interval '6 minutes' where idempotency_key=$1",[key]);
    const stale=await json(await request(`/ai/requests/${key}`),409);expect(stale.error.details).toMatchObject({reason:'AI_STALE_REQUEST',retryWithNewKey:true});
  });
  it("stores and replays Kira voice transcription against the real AI request schema",async()=>{
    const requestKey=crypto.randomUUID();
    const voiceBody=await nativeKiraVoiceBody({exists:true,size:5,arrayBuffer:async()=>new Uint8Array([0,1,2,3,4]).buffer});
    const makeRequest=()=>app.request(`https://api.example.invalid/v1/ai/transcribe?idempotencyKey=${requestKey}&consent=true`,{
      method:"POST",
      headers:{Authorization:`Bearer ${tokens.get(owner)}`,"Content-Type":"audio/mp4"},
      body:voiceBody,
    },env);
    expect(await json(await makeRequest())).toEqual({text:"Explain Newton's second law."});
    expect(await json(await makeRequest())).toEqual({text:"Explain Newton's second law."});
    const rows=await db.query<{mode:string;status:string;transcription_text:string}>(`select mode,status,result->>'transcriptionText' as transcription_text from app_private.ai_requests where user_id=$1 and idempotency_key=$2`,[owner,requestKey]);
    expect(rows.rows[0]).toMatchObject({mode:"transcription",status:"COMPLETED",transcription_text:"Explain Newton's second law."});
    expect(provider.mock.calls.filter(([url])=>String(url).includes("/hf-inference/models/"))).toHaveLength(1);
  });
  it("records voice provider failures as structured AI errors instead of internal 500s",async()=>{
    provider.mockResolvedValueOnce(new Response("PRIVATE_PROVIDER_BODY",{status:429}));
    const requestKey=crypto.randomUUID();
    const response=await app.request(`https://api.example.invalid/v1/ai/transcribe?idempotencyKey=${requestKey}&consent=true`,{
      method:"POST",
      headers:{Authorization:`Bearer ${tokens.get(owner)}`,"Content-Type":"audio/mp4"},
      body:new Uint8Array([0,1,2,3,4]),
    },env);
    expect(response.status).toBe(503);
    const data=await response.json() as {error:{details?:{reason?:string}}};
    expect(data.error.details?.reason).toBe("AI_PROVIDER_LIMIT");
    expect(JSON.stringify(data)).not.toContain("PRIVATE_PROVIDER_BODY");
    const rows=await db.query<{status:string;reason:string}>(`select status,result->>'reason' as reason from app_private.ai_requests where user_id=$1 and idempotency_key=$2`,[owner,requestKey]);
    expect(rows.rows[0]).toMatchObject({status:"FAILED",reason:"AI_PROVIDER_LIMIT"});
  });
  it.each(["study","summary","explanation","notes","quiz"])("saves %s without exposing provider identity",async mode=>{const body=draft(mode);const result=await json(await request("/ai","POST",body));expect(result).toMatchObject({tier:"pro",requestId:body.idempotencyKey,text:expect.any(String)});expect(result.provider).toBeUndefined();expect(provider).toHaveBeenCalledTimes(1);expect(provider.mock.calls[0]?.[0]).toBe("https://router.huggingface.co/v1/chat/completions");const payload=JSON.parse(String(provider.mock.calls[0]?.[1]?.body));expect(payload.model).toBe("test/reasoning:nscale");const saved=await json(await request(`/ai/history/${body.idempotencyKey}`));expect(saved.provider).toBeUndefined();expect(saved.text).toBe(result.text);expect((await json(await request("/ai/history?q=Ohm"))).sessions).toHaveLength(1);});
  it("injects the signed-in student's stored profile into Kira context without private identity fields",async()=>{await json(await request("/ai","POST",{...draft(),prompt:"What's my name?"}));const payload=JSON.parse(String(provider.mock.calls[0]?.[1]?.body));const system=String(payload.messages?.[0]?.content??"");expect(system).toContain("You are Kira");expect(system).toContain('\"name\":\"Provider test\"');expect(system).toContain('\"username\":\"hf-study-0\"');expect(system).toContain("Gideon");expect(system).toContain("Orobosa");expect(system).toContain("Joshua");expect(system).toContain("student AI companion");expect(system).not.toContain(ownerEmail);expect(system).not.toContain(owner);});
  it("routes omitted provider to HF and replays without another call",async()=>{const {provider:_provider,...body}=draft();const first=await json(await request("/ai","POST",body));expect(await json(await request("/ai","POST",body))).toEqual(first);expect(provider).toHaveBeenCalledTimes(1);await json(await request("/ai","POST",{...body,prompt:"Changed"}),409);});
  it("rejects provider/tier/exemption/identity forgery",async()=>{for(const extra of [{provider:"gemini"},{provider:"unknown"},{tier:"fast"},{unlimited:true},{userId:owner},{consent:false}])await json(await request("/ai","POST",{...draft(),...extra},other),400);await json(await request("/ai","POST",{...draft(),tier:"pro"},other),403);expect(provider).not.toHaveBeenCalled();expect(await count()).toBe(0);});
  it("keeps ordered follow-up context and another account's history private",async()=>{const first=await json(await request("/ai","POST",draft()));await json(await request("/ai","POST",{...draft(),prompt:"Example?",replyTo:first.requestId}));const body=JSON.parse(String(provider.mock.calls[1]?.[1]?.body));expect(body.messages.map((m:{role:string})=>m.role)).toEqual(["system","user","assistant","user"]);expect(body.messages[2].content).toBe(first.text);await json(await request(`/ai/history/${first.requestId}`,"GET",undefined,other),404);await json(await request(`/ai/thread/${first.requestId}`,"GET",undefined,other),404);await json(await request("/ai","POST",{...draft(),replyTo:first.requestId},other),404);expect(provider).toHaveBeenCalledTimes(2);});
  it("never forwards an old provider's private conversation",async()=>{const key=crypto.randomUUID();await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) values($1,$2,repeat('a',64),'study','COMPLETED',$3::jsonb)",[owner,key,JSON.stringify({provider:"gemini",text:"Old private answer",prompt:"Old question"})]);await json(await request("/ai","POST",{...draft(),replyTo:key}),400);expect(provider).not.toHaveBeenCalled();});
  it("shares five study trials across Summary/Explanation/Notes and retains use after deletion",async()=>{for(let i=0;i<5;i++){const body=draft(["summary","explanation","notes"][i%3]);await json(await request("/ai","POST",body,other));await json(await request(`/ai/history/${body.idempotencyKey}`,"DELETE",undefined,other));}expect((await json(await request("/ai/status","GET",undefined,other))).study.remaining).toBe(0);await json(await request("/ai","POST",draft("notes"),other),429);expect(provider).toHaveBeenCalledTimes(5);expect(await count()).toBe(5);});
  it("new conversations and new sessions cannot reset the short Ask window",async()=>{await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) select $1,gen_random_uuid(),repeat('a',64),'study','COMPLETED','{\"deleted\":true}'::jsonb from generate_series(1,15)",[other]);const limited=await request("/ai","POST",draft(),other);expect(limited.status).toBe(429);expect(limited.headers.get("Retry-After")).toBeTruthy();const data=await limited.json();expect(data.error.details.resetsAt).toBeTruthy();tokens.set(other,(await createSession(env,{id:other,email:"hf-other@example.invalid",roles:["STUDENT"],operatorRoles:[],universityId:null})).accessToken);await json(await request("/ai","POST",draft(),other),429);await db.query("update app_private.ai_requests set created_at=now()-interval '16 minutes' where user_id=$1",[other]);await json(await request("/ai","POST",draft(),other));expect(provider).toHaveBeenCalledTimes(1);});
  it("refunds a failed study generation but still records the paid attempt",async()=>{provider.mockResolvedValueOnce(new Response("PRIVATE_SOURCE",{status:402}));const result=await json(await request("/ai","POST",draft("summary"),other),503);expect(JSON.stringify(result)).not.toContain("PRIVATE_SOURCE");expect((await json(await request("/ai/status","GET",undefined,other))).study.remaining).toBe(5);expect(await count()).toBe(1);});
  it("does not leak provider configuration, secrets, normal-chat counters or billing credentials",async()=>{const result=await json(await request("/ai/status"));expect(result.capabilities).toEqual({text:true,images:true,documents:true});expect(result.subscription.checkoutEnabled).toBe(false);for(const value of ["hf_SYNTHETIC","test/model","huggingface","chat_used","GEMINI","HF_TOKEN"])expect(JSON.stringify(result)).not.toContain(value);});
  it("keeps shared capacity and kill switch enforced on exempt accounts",async()=>{env.AI_DAILY_GLOBAL_LIMIT="0";await json(await request("/ai","POST",draft()),429);env.AI_DAILY_GLOBAL_LIMIT="100";env.AI_ASSISTANT_ENABLED="false";await json(await request("/ai","POST",draft()),503);expect(provider).not.toHaveBeenCalled();});
  it("does not retry authentication failures or switch providers",async()=>{for(const status of [401,403]){provider.mockResolvedValueOnce(new Response("PRIVATE_INPUT",{status}));const result=await json(await request("/ai","POST",draft()),503);expect(JSON.stringify(result)).not.toContain("PRIVATE_INPUT");}expect(provider).toHaveBeenCalledTimes(2);expect(provider.mock.calls.every(([url])=>String(url).startsWith("https://router.huggingface.co/"))).toBe(true);});
  it("falls back from the reasoning model to the cheaper HF chat model on model/capacity failures",async()=>{for(const status of [402,404,422,429,500]){const before=provider.mock.calls.length;provider.mockResolvedValueOnce(new Response("PRIVATE_INPUT",{status}));const result=await json(await request("/ai","POST",draft()));expect(result.text).toContain("Voltage");const calls=provider.mock.calls.slice(before);expect(calls).toHaveLength(2);expect(calls.every(([url])=>String(url).startsWith("https://router.huggingface.co/"))).toBe(true);const first=JSON.parse(String(calls[0]?.[1]?.body)),fallback=JSON.parse(String(calls[1]?.[1]?.body));expect(first.model).toBe("test/reasoning:nscale");expect(fallback.model).toBe("test/model:nscale");expect(JSON.stringify(result)).not.toContain("PRIVATE_INPUT");}});
});

describe('complete academic import routes',()=>{
  const coverage={complete:true,daysRead:[1],rowCount:1,uncertain:[]};
  const classEntry={title:'Mathematics',courseCode:'MAT 101',venue:'LT 1',lecturer:'',dayOfWeek:1,startsAt:'08:00',endsAt:'09:00'};
  const event={title:'Registration',startsOn:'2026-10-19',endsOn:'2026-10-30',semester:'First semester'};
  const exam={title:'Mathematics',courseCode:'MAT 101',date:'2026-11-05',startsAt:'09:00',endsAt:'11:00',venue:'Main hall'};
  it('reads a dense uploaded grid by day inside one import reservation and replays without repeating the reads',async()=>{
    const grid=JSON.parse(readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.json',import.meta.url),'utf8'));
    const bytes=new Uint8Array(readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.jpg',import.meta.url))),mediaId=crypto.randomUUID();
    await db.query("update public.profiles set current_level='200' where user_id=$1",[owner]);
    await db.query("insert into public.media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,'resource',$3,'image/jpeg',$4,'faculty.jpg')",[mediaId,owner,'private-'+mediaId,bytes.length]);
    env.PRIVATE_BUCKET={get:async()=>({size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer})} as unknown as R2Bucket;
    const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const run=vi.fn().mockImplementation(async(_model,payload)=>{
      const content=payload.messages.at(-1).content,text=Array.isArray(content)?content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join('\n'):String(content);
      const day=names.findIndex(name=>text.includes('ONLY the '+name+' row'));
      const value=day<0?{...grid,coverage:{complete:false,daysRead:[],rowCount:0,uncertain:[]},grid:{...grid.grid,rows:[]}}
        :{...grid,coverage:{complete:true,daysRead:[day],rowCount:1,uncertain:[]},grid:{...grid.grid,daysSeen:[day],rows:[grid.grid.rows[day-1]]}};
      return {response:JSON.stringify(value)};
    });env.AI={run};
    const body={mode:'timetable',documentKind:'class',prompt:'',mediaId,idempotencyKey:crypto.randomUUID(),consent:true};
    const result=await json(await request('/ai','POST',body));expect(result.entries).toHaveLength(20);expect(run).toHaveBeenCalledTimes(6);
    expect((await json(await request('/ai/status'))).imports.used).toBe(1);
    expect(await json(await request('/ai','POST',body))).toEqual(result);expect(run).toHaveBeenCalledTimes(6);
    await db.query('update public.profiles set current_level=null where user_id=$1',[owner]);
  });
  it.each(['length','partial','invalid-row'] as const)('refunds a %s timetable attempt, then charges the full retry and its receipt only once',async failure=>{
    const full={documentType:'class_timetable',entries:[classEntry],events:[],warnings:[],coverage};
    const broken=failure==='partial'?{...full,coverage:{...coverage,complete:false},warnings:['Only half the schedule was read.']}
      :failure==='invalid-row'?{...full,entries:[{...classEntry,startsAt:'20:00',endsAt:'09:00'}]}:full;
    const run=vi.fn().mockResolvedValueOnce({choices:[{finish_reason:failure==='length'?'length':'stop',message:{content:JSON.stringify(broken)}}]})
      .mockResolvedValue({choices:[{finish_reason:'stop',message:{content:JSON.stringify(full)}}]});env.AI={run};
    const body={mode:'timetable',documentKind:'class',prompt:'Monday MAT 101 08:00-09:00 LT 1.',idempotencyKey:crypto.randomUUID(),consent:true};
    const failed=await request('/ai','POST',body);expect(failed.status).toBe(failure==='length'?502:422);
    expect((await json(await request('/ai/status'))).imports.used).toBe(0);
    expect((await db.query("select status from app_private.ai_requests where idempotency_key=$1",[body.idempotencyKey])).rows[0]?.status).toBe('FAILED');
    const retry={...body,idempotencyKey:crypto.randomUUID()},result=await json(await request('/ai','POST',retry));
    expect(result.entries).toHaveLength(1);
    expect(await json(await request('/ai','POST',retry))).toEqual(result);
    expect((await json(await request('/ai/requests/'+retry.idempotencyKey))).entries).toHaveLength(1);
    expect((await json(await request('/ai/status'))).imports.used).toBe(1);expect(run).toHaveBeenCalledTimes(2);
    expect((await db.query('select count(*)::int as count from app_private.academic_import_usage')).rows[0]?.count).toBe(1);
  });
  it('uses the stored level and derives the uploaded UNIBEN grid times from its columns',async()=>{
    await db.query("update public.profiles set current_level='200' where user_id=$1",[owner]);
    const grid=JSON.parse(readFileSync(new URL('../../scripts/fixtures/uniben-engineering-2026.json',import.meta.url),'utf8'));
    const run=vi.fn().mockResolvedValue({response:JSON.stringify(grid)});env.AI={run};
    const body={mode:'timetable',documentKind:'class',prompt:'Read my faculty timetable',idempotencyKey:crypto.randomUUID(),consent:true};
    const result=await json(await request('/ai','POST',body));
    expect(result.entries).toHaveLength(20);
    expect(result.entries.filter((entry:{dayOfWeek:number})=>entry.dayOfWeek===3)).toMatchObject([
      {courseCode:'MEE211/GET207',startsAt:'08:00',endsAt:'09:00'},
      {courseCode:'ECP281/GET211',startsAt:'09:00',endsAt:'10:00'},
      {title:'200 LEVEL LABORATORY (ELA201)',startsAt:'10:00',endsAt:'14:00'},
      {courseCode:'GST212',startsAt:'15:00',endsAt:'17:00'},
      {courseCode:'CVE211',startsAt:'17:00',endsAt:'18:00'},
    ]);
    expect(String(run.mock.calls[0]?.[1]?.messages[0].content)).toContain('"level":"200"');
    expect(result.entries.some((entry:{courseCode:string})=>['MTH101','PHY101','GST112'].includes(entry.courseCode))).toBe(false);
    // Explicit carryover/alternative selection replaces the default row scope.
    const mismatched=await request('/ai','POST',{...body,scheduleLevel:'100',idempotencyKey:crypto.randomUUID()});
    expect(mismatched.status).toBe(422);
    await db.query('update public.profiles set current_level=null where user_id=$1',[owner]);
  });
  it.each(['class','calendar','exam'] as const)('extracts and persists %s review data from image, PDF and text attachments',async kind=>{
    for(const mime of ['image/png','application/pdf','text/plain']){
      const expected=kind==='class'?{documentType:'class_timetable',entries:[classEntry],events:[],warnings:[],coverage}:kind==='calendar'?{documentType:'academic_calendar',entries:[],events:[event],warnings:[],coverage:{...coverage,daysRead:[]}}:{documentType:'exam_timetable',entries:[exam],warnings:[],coverage:{...coverage,daysRead:[]}};
      const source=kind==='calendar'?'ACADEMIC CALENDAR: Registration, 19 October 2026 to 30 October 2026.':kind==='exam'?'MAT 101, 5 November 2026, 09:00–11:00 Main hall.':'Monday MAT 101 08:00–09:00 LT 1.';
      const bytes=mime==='application/pdf'?pdfFixture([source]):mime==='text/plain'?new TextEncoder().encode(source):Uint8Array.from(Buffer.from(readFileSync(new URL('../../scripts/fixtures/synthetic-timetable.png',import.meta.url))));
      const mediaId=crypto.randomUUID(),run=vi.fn().mockResolvedValue({choices:[{finish_reason:'stop',message:{content:JSON.stringify(expected)}}]});env.AI={run};
      await db.query("insert into public.media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,'resource',$3,$4,$5,'schedule-source')",[mediaId,owner,'private-'+mediaId,mime,bytes.byteLength]);
      env.PRIVATE_BUCKET={get:async key=>key==='private-'+mediaId?{size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer}:null} as unknown as R2Bucket;
      const body={mode:'timetable',documentKind:kind,prompt:'',notes:'I am in 100 level',mediaId,idempotencyKey:crypto.randomUUID(),consent:true};
      const result=await json(await request('/ai','POST',body));
      expect(result.documentType).toBe(expected.documentType);expect(kind==='calendar'?result.events:result.entries).toHaveLength(1);
      expect(await json(await request('/ai','POST',body))).toEqual(result);expect(run).toHaveBeenCalledTimes(1);
      expect((await json(await request('/ai/requests/'+body.idempotencyKey))).status).toBe('completed');
      await json(await request('/ai/requests/'+body.idempotencyKey,'GET',undefined,other),404);
    }
  });
  it('reads a valid owned PDF above 8 MB without rejecting it as an invalid file',async()=>{
    const original=pdfFixture(['Monday MAT 101 08:00-09:00 LT 1.']),bytes=new Uint8Array(9*1024*1024).fill(32);bytes.set(original);
    const mediaId=crypto.randomUUID(),run=vi.fn().mockResolvedValue({response:JSON.stringify({documentType:'class_timetable',entries:[classEntry],events:[],warnings:[],coverage})});env.AI={run};
    await db.query("insert into public.media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,'resource',$3,'application/pdf',$4,'schedule.pdf')",[mediaId,owner,'private-'+mediaId,bytes.byteLength]);
    env.PRIVATE_BUCKET={get:async()=>({size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer})} as unknown as R2Bucket;
    const result=await json(await request('/ai','POST',{mode:'timetable',documentKind:'class',prompt:'',mediaId,idempotencyKey:crypto.randomUUID(),consent:true}));
    expect(result.entries[0]).toMatchObject({courseCode:'MAT 101',startsAt:'08:00'});expect(run).toHaveBeenCalledTimes(1);
  });
});

it('releases an expired upload-limit draft key while retaining active quota enforcement and single inference replay',async()=>{
  const body={mode:'timetable',documentKind:'class',prompt:'Monday MAT 101 08:00-09:00 LT 1.',idempotencyKey:crypto.randomUUID(),consent:true};
  const hash=await sha256(JSON.stringify([4,'timetable',body.prompt,'',null,null,'standard',null,'class']));
  const failure={version:3,failureStatus:429,message:'Your upload allowance is used.',failureDetails:{reason:'ACADEMIC_IMPORT_LIMIT',resetsAt:new Date(Date.now()+60000).toISOString()}};
  await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) values($1,$2,$3,'timetable','FAILED',$4::jsonb)",[owner,body.idempotencyKey,hash,JSON.stringify(failure)]);
  await json(await request('/ai','POST',body),429);expect(provider).not.toHaveBeenCalled();
  failure.failureDetails.resetsAt=new Date(Date.now()-60000).toISOString();
  await db.query('update app_private.ai_requests set result=$3::jsonb where user_id=$1 and idempotency_key=$2',[owner,body.idempotencyKey,JSON.stringify(failure)]);
  const expired=await json(await request('/ai','POST',body),409);expect(expired.error.details).toMatchObject({reason:'AI_ALLOWANCE_RENEWED',retryWithNewKey:true});expect(provider).not.toHaveBeenCalled();
  provider.mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({documentType:'class_timetable',entries:[{title:'Mathematics',courseCode:'MAT 101',dayOfWeek:1,startsAt:'08:00',endsAt:'09:00',venue:'LT 1',lecturer:''}],events:[],warnings:[],coverage:{complete:true,daysRead:[1],rowCount:1,uncertain:[]}})}}]}));
  const fresh={...body,idempotencyKey:crypto.randomUUID()};const result=await json(await request('/ai','POST',fresh));
  expect(result.entries[0].courseCode).toBe('MAT 101');expect(await json(await request('/ai','POST',fresh))).toEqual(result);expect(provider).toHaveBeenCalledTimes(1);
});
