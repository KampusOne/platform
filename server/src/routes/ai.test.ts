import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Bindings, Variables } from "../types";
import { AppError } from "../lib/errors";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), fetch: vi.fn() }));
vi.mock("../lib/student-ai-policy",()=>({studentExperienceReady:async()=>true,isStudyGeneration:(mode:string)=>["summary","notes","quiz"].includes(mode),studentAIPolicy:async()=>({user:5,global:100,unlimited:false,pro:false,chat:15,study:5}),studentAIUsage:async()=>({total:0,study_used:0,chat_used:15,chat_resets_at:new Date(Date.now()+900000).toISOString()})}));
vi.mock("../lib/database", () => {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values });
  return { database: () => ({ execute: mocks.execute }), firstRow: (r: { rows: unknown[] }) => r.rows[0], sqlClient: () => Object.assign(tag, { transaction: mocks.transaction }) };
});
vi.mock("../lib/security", () => ({ sha256: async () => "request-hash" }));
vi.mock("../middleware/auth", () => ({
  requireAuth: async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
    if (!c.req.header("Authorization")) throw new AppError(401, "UNAUTHENTICATED", "Sign in.");
    c.set("user", { id: "11111111-1111-4111-8111-111111111111", email: "test@example.invalid", roles: [], operatorRoles: [], universityId: null });
    await next();
  }, currentUser: (c: Context<{ Variables: Variables }>) => c.get("user"),
}));
import { aiRoutes } from "./ai";
const owner = "11111111-1111-4111-8111-111111111111", key = "22222222-2222-4222-8222-222222222222", mediaId = "33333333-3333-4333-8333-333333333333";
const env = {UNIFIED_SCHEMA_READY:"true",AI_ASSISTANT_ENABLED:"true",HF_TOKEN:"synthetic",HF_CHAT_MODEL:"test/chat",HF_VISION_MODEL:"test/vision"} as Bindings;
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
app.onError((e,c)=>e instanceof AppError?c.json({error:{code:e.code,message:e.message,details:e.details}},e.status):c.json({error:String(e)},500));app.route("/ai",aiRoutes);
const body={mode:"study",prompt:"Explain energy",idempotencyKey:key,consent:true};
const post=(extra={},bindings=env)=>app.request("/ai",{method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify({...body,...extra})},bindings);
const get=(path:string,method="GET")=>app.request(path,{method,headers:{Authorization:"Bearer test"}},env);
const query=(s:SQL)=>new PgDialect().sqlToQuery(s);
const queries=()=>mocks.execute.mock.calls.map(call=>query(call[0]));
function cached(status:string,result:unknown,request_hash="request-hash"){return {rows:[{idempotency_key:key,request_hash,status,result,created_at:new Date().toISOString()}]};}
beforeEach(()=>{vi.clearAllMocks();mocks.execute.mockImplementation(async(s:SQL)=>query(s).sql.includes("consume_request_rate_limit")?{rows:[{allowed:true}]}:{rows:[]});mocks.transaction.mockResolvedValue([[],[],[{idempotency_key:key}]]);mocks.fetch.mockResolvedValue(Response.json({choices:[{finish_reason:"stop",message:{content:"Energy explanation"}}]}));vi.stubGlobal("fetch",mocks.fetch);});
afterEach(()=>vi.unstubAllGlobals());
describe("AI router security and idempotency",()=>{
  it("requires authentication on all private reads",async()=>{for(const path of ["/ai/status","/ai/history",`/ai/history/${key}`,`/ai/thread/${key}`])expect((await app.request(path,{},env)).status).toBe(401);expect(mocks.execute).not.toHaveBeenCalled();});
  it.each([{AI_ASSISTANT_ENABLED:"false"},{HF_TOKEN:""},{HF_CHAT_MODEL:""}])("rejects disabled/missing configuration before quota reservation",async fields=>{expect((await post({},{...env,...fields})).status).toBe(503);expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();});
  it("locks separately before the fresh-snapshot quota claim",async()=>{const response=await post();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({text:"Energy explanation",tier:"standard"});const [statements,options]=mocks.transaction.mock.calls[0]!;expect(options.isolationLevel).toBe("ReadCommitted");expect(statements[0].text).toContain("pg_advisory_xact_lock");expect(statements[2].text).toContain("on conflict do nothing");expect(statements[2].text).toContain("('summary','notes','quiz')");expect(statements[2].values).toContain(owner);expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(response.headers.get("cache-control")).toContain("no-store");});
  it("replays completed requests without paid I/O",async()=>{mocks.execute.mockResolvedValueOnce(cached("COMPLETED",{text:"Saved"}));const r=await post();expect((await r.json() as {text:string}).text).toBe("Saved");expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();});
  it("rejects mutated keys, deleted results and processing replays",async()=>{for(const [row,status] of [[cached("COMPLETED",{text:"Private"},"other-hash"),409],[cached("COMPLETED",{deleted:true}),410],[cached("PROCESSING",null),409]] as const){mocks.execute.mockResolvedValueOnce(row);const r=await post();expect(r.status).toBe(status);expect(JSON.stringify(await r.json())).not.toContain("Private");}expect(mocks.fetch).not.toHaveBeenCalled();});
  it("returns a persistent-limit reset without provider I/O",async()=>{mocks.transaction.mockResolvedValueOnce([[],[],[]]);const r=await post();expect(r.status).toBe(429);expect(r.headers.get("Retry-After")).toBeTruthy();expect((await r.json() as {error:{details:{reason:string}}}).error.details.reason).toBe("AI_CHAT_LIMIT");expect(mocks.fetch).not.toHaveBeenCalled();});
  it("rejects an unowned private attachment before reservation",async()=>{expect((await post({mediaId})).status).toBe(404);const media=queries().find(q=>q.sql.includes("public.media_objects"))!;expect(media.sql).toContain("owner_user_id=");expect(media.params).toContain(owner);expect(mocks.transaction).not.toHaveBeenCalled();});
  it("records terminal provider failure without saving a successful answer",async()=>{mocks.fetch.mockResolvedValueOnce(new Response("confidential upstream detail",{status:403}));const r=await post();expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain("confidential");expect(queries().some(q=>q.sql.includes("status='FAILED'"))).toBe(true);expect(mocks.fetch).toHaveBeenCalledTimes(1);});
  it("scopes history searches and deletes to the verified account",async()=>{await get("/ai/history?q=physics");expect(queries()[0]?.params).toContain(owner);expect(queries()[0]?.params).toContain("physics");vi.clearAllMocks();await get(`/ai/history/${key}`,"DELETE");expect(queries()[0]?.params).toContain(owner);expect(queries()[0]?.sql).toContain('"deleted":true');expect(queries()[0]?.sql).not.toContain("delete from");});
  it("rejects fabricated action payloads before any write",async()=>{const r=await app.request("/ai/actions/confirm",{method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify({requestId:key,actionId:mediaId,userId:owner,entry:{title:"Forged"}})},env);expect(r.status).toBe(400);expect(mocks.transaction).not.toHaveBeenCalled();});
});
