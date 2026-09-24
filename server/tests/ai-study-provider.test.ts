import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { createSession } from "../src/services/sessions";
import { sha256 } from "../src/lib/security";
import { app } from "../src/app";
import type { AuthenticatedUser, Bindings } from "../src/types";

let db: PGlite;
vi.mock("../src/lib/database", () => ({ database: () => testDatabaseAdapter(db), sqlClient: () => testSqlClient(db), firstRow: (r: { rows: unknown[] }) => r.rows[0] }));
const owner = "30000000-0000-4000-8000-000000000001";
const other = "30000000-0000-4000-8000-000000000002";
const ownerEmail = "hf-owner@example.invalid";
const env: Bindings = {
  ENVIRONMENT: "local", ALLOWED_ORIGINS: "https://app.example.invalid", MINIMUM_APP_VERSION: "0.1.0", MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true", SOCIAL_FEED_ENABLED: "true", MARKETPLACE_ENABLED: "false", PHASE_2_SCHEMA_READY: "true", PHASE_3_SCHEMA_READY: "false",
  UNIFIED_SCHEMA_READY: "true", PAYMENTS_ENABLED: "false", AI_ASSISTANT_ENABLED: "true", JWT_SECRET: "test-only-signing-key-not-for-deployment-12345678",
  HF_TOKEN: "hf_SYNTHETIC", HF_CHAT_MODEL: "test/model:nscale", HF_VISION_MODEL: "test/vision",
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
  await db.exec("delete from app_private.ai_requests;delete from app_private.request_rate_limits");
  env.AI_UNLIMITED_EMAIL_HASHES = await sha256(ownerEmail);
  env.AI_DAILY_USER_LIMIT = "5"; env.AI_DAILY_GLOBAL_LIMIT = "100"; env.AI_ASSISTANT_ENABLED = "true";
  env.HF_TOKEN = "hf_SYNTHETIC";env.AI_CHAT_WINDOW_LIMIT="15";env.AI_STUDY_TRIAL_LIMIT="5";
  provider.mockReset();
  provider.mockImplementation(async url => String(url).includes("huggingface.co")
    ? Response.json({ choices: [{ finish_reason: "stop", message: { content: "Voltage equals current multiplied by resistance." } }] })
    : Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A Gemini test answer." }] } }] }));
  vi.stubGlobal("fetch", provider);
});
afterAll(async () => { vi.unstubAllGlobals(); await db?.close(); });

describe("student AI persistence and quota boundaries",()=>{
  it.each(["study","summary","notes","quiz"])("saves %s without exposing provider identity",async mode=>{const body=draft(mode);const result=await json(await request("/ai","POST",body));expect(result).toMatchObject({tier:"standard",requestId:body.idempotencyKey,text:expect.any(String)});expect(result.provider).toBeUndefined();expect(provider).toHaveBeenCalledTimes(1);expect(provider.mock.calls[0]?.[0]).toBe("https://router.huggingface.co/v1/chat/completions");const saved=await json(await request(`/ai/history/${body.idempotencyKey}`));expect(saved.provider).toBeUndefined();expect(saved.text).toBe(result.text);expect((await json(await request("/ai/history?q=Ohm"))).sessions).toHaveLength(1);});
  it("routes omitted provider to HF and replays without another call",async()=>{const {provider:_provider,...body}=draft();const first=await json(await request("/ai","POST",body));expect(await json(await request("/ai","POST",body))).toEqual(first);expect(provider).toHaveBeenCalledTimes(1);await json(await request("/ai","POST",{...body,prompt:"Changed"}),409);});
  it("rejects provider/tier/exemption/identity forgery",async()=>{for(const extra of [{provider:"gemini"},{provider:"unknown"},{tier:"fast"},{unlimited:true},{userId:owner},{consent:false}])await json(await request("/ai","POST",{...draft(),...extra},other),400);await json(await request("/ai","POST",{...draft(),tier:"pro"},other),403);expect(provider).not.toHaveBeenCalled();expect(await count()).toBe(0);});
  it("keeps ordered follow-up context and another account's history private",async()=>{const first=await json(await request("/ai","POST",draft()));await json(await request("/ai","POST",{...draft(),prompt:"Example?",replyTo:first.requestId}));const body=JSON.parse(String(provider.mock.calls[1]?.[1]?.body));expect(body.messages.map((m:{role:string})=>m.role)).toEqual(["system","user","assistant","user"]);expect(body.messages[2].content).toBe(first.text);await json(await request(`/ai/history/${first.requestId}`,"GET",undefined,other),404);await json(await request(`/ai/thread/${first.requestId}`,"GET",undefined,other),404);await json(await request("/ai","POST",{...draft(),replyTo:first.requestId},other),404);expect(provider).toHaveBeenCalledTimes(2);});
  it("never forwards an old provider's private conversation",async()=>{const key=crypto.randomUUID();await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) values($1,$2,repeat('a',64),'study','COMPLETED',$3::jsonb)",[owner,key,JSON.stringify({provider:"gemini",text:"Old private answer",prompt:"Old question"})]);await json(await request("/ai","POST",{...draft(),replyTo:key}),400);expect(provider).not.toHaveBeenCalled();});
  it("shares five study trials across Summary/Notes and retains use after deletion",async()=>{for(let i=0;i<5;i++){const body=draft(i%2?"notes":"summary");await json(await request("/ai","POST",body,other));await json(await request(`/ai/history/${body.idempotencyKey}`,"DELETE",undefined,other));}expect((await json(await request("/ai/status","GET",undefined,other))).study.remaining).toBe(0);await json(await request("/ai","POST",draft("notes"),other),429);expect(provider).toHaveBeenCalledTimes(5);expect(await count()).toBe(5);});
  it("new conversations and new sessions cannot reset the short Ask window",async()=>{await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) select $1,gen_random_uuid(),repeat('a',64),'study','COMPLETED','{\"deleted\":true}'::jsonb from generate_series(1,15)",[other]);const limited=await request("/ai","POST",draft(),other);expect(limited.status).toBe(429);expect(limited.headers.get("Retry-After")).toBeTruthy();const data=await limited.json();expect(data.error.details.resetsAt).toBeTruthy();tokens.set(other,(await createSession(env,{id:other,email:"hf-other@example.invalid",roles:["STUDENT"],operatorRoles:[],universityId:null})).accessToken);await json(await request("/ai","POST",draft(),other),429);await db.query("update app_private.ai_requests set created_at=now()-interval '16 minutes' where user_id=$1",[other]);await json(await request("/ai","POST",draft(),other));expect(provider).toHaveBeenCalledTimes(1);});
  it("refunds a failed study generation but still records the paid attempt",async()=>{provider.mockResolvedValueOnce(new Response("PRIVATE_SOURCE",{status:402}));const result=await json(await request("/ai","POST",draft("summary"),other),503);expect(JSON.stringify(result)).not.toContain("PRIVATE_SOURCE");expect((await json(await request("/ai/status","GET",undefined,other))).study.remaining).toBe(5);expect(await count()).toBe(1);});
  it("does not leak provider configuration, secrets, normal-chat counters or billing credentials",async()=>{const result=await json(await request("/ai/status"));expect(result.capabilities).toEqual({text:true,images:true,documents:true});expect(result.subscription.checkoutEnabled).toBe(false);for(const value of ["hf_SYNTHETIC","test/model","huggingface","chat_used","GEMINI","HF_TOKEN"])expect(JSON.stringify(result)).not.toContain(value);});
  it("keeps shared capacity and kill switch enforced on exempt accounts",async()=>{env.AI_DAILY_GLOBAL_LIMIT="0";await json(await request("/ai","POST",draft()),429);env.AI_DAILY_GLOBAL_LIMIT="100";env.AI_ASSISTANT_ENABLED="false";await json(await request("/ai","POST",draft()),503);expect(provider).not.toHaveBeenCalled();});
  it("does not use another provider as a fallback",async()=>{for(const status of [401,402,403,429,500]){provider.mockResolvedValueOnce(new Response("PRIVATE_INPUT",{status}));const result=await json(await request("/ai","POST",draft()),503);expect(JSON.stringify(result)).not.toContain("PRIVATE_INPUT");}expect(provider).toHaveBeenCalledTimes(5);expect(provider.mock.calls.every(([url])=>String(url).startsWith("https://router.huggingface.co/"))).toBe(true);});
});
