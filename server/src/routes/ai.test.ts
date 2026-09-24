import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Bindings, Variables } from "../types";
import { AppError } from "../lib/errors";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), fetch: vi.fn() }));
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
const env = { UNIFIED_SCHEMA_READY: "true", AI_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "test-key", GEMINI_MODEL: "test-model", HF_TOKEN: "test-hf-key", HF_CHAT_MODEL: "test-chat" } as Bindings;
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.onError((e, c) => e instanceof AppError ? c.json({ error: { code: e.code, message: e.message, details: e.details } }, e.status) : c.json({ error: String(e) }, 500));
app.route("/ai", aiRoutes);
const body = { mode: "study", prompt: "Explain energy", idempotencyKey: key, consent: true };
const post = (extra = {}, bindings: Bindings = env) => app.request("/ai", { method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...extra }) }, bindings);
const get = (path: string, method = "GET") => app.request(path, { method, headers: { Authorization: "Bearer test" } }, env);
const query = (index: number) => new PgDialect().sqlToQuery(mocks.execute.mock.calls[index][0] as SQL);
function cached(status: string, result: unknown, request_hash = "request-hash") { return { rows: [{ idempotency_key: key, request_hash, status, result, created_at: new Date().toISOString() }] }; }
beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ rows: [] }); mocks.transaction.mockResolvedValue([[], [{ idempotency_key: key }]]); mocks.fetch.mockImplementation(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Energy explanation" }] } }] })); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());
describe("AI request and private-history boundary", () => {
  it("requires authentication for status and history", async () => {
    for (const path of ["/ai/status", "/ai/history", `/ai/history/${key}`]) expect((await app.request(path, {}, env)).status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not reserve allowance or call a provider when disabled", async () => {
    const r = await post({}, { ...env, AI_ASSISTANT_ENABLED: "false" }); expect(r.status).toBe(503); expect((await r.json()).error.details.reason).toBe("AI_DISABLED"); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("reports missing provider configuration without consuming allowance", async () => {
    const r = await post({}, { ...env, GEMINI_MODEL: undefined }); expect(r.status).toBe(503); expect((await r.json()).error.details.reason).toBe("AI_NOT_CONFIGURED"); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("claims idempotency and both quotas before one provider call", async () => {
    const r = await post(); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ text: "Energy explanation", requestId: key, provider: "gemini" });
    const [statements, options] = mocks.transaction.mock.calls[0]; expect(options.isolationLevel).toBe("ReadCommitted"); expect(statements[0].text).toContain("pg_advisory_xact_lock"); expect(statements[1].text).toContain("on conflict do nothing"); expect(statements[1].text.match(/select count\(\*\)/g)).toHaveLength(2); expect(statements[1].values).toContain(owner); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(query(1).sql).toContain("status='COMPLETED'"); expect(query(1).params).toContain(owner); expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("replays a completed request without another provider call or reservation", async () => {
    mocks.execute.mockResolvedValueOnce(cached("COMPLETED", { text: "Saved answer" })); const r = await post(); expect(r.status).toBe(200); expect((await r.json()).text).toBe("Saved answer"); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects a changed draft under an existing request key", async () => {
    mocks.execute.mockResolvedValueOnce(cached("COMPLETED", { text: "Secret" }, "different-hash")); const r = await post(); expect(r.status).toBe(409); expect(JSON.stringify(await r.json())).not.toContain("Secret"); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("processing retries keep the same key", async () => {
    mocks.execute.mockResolvedValueOnce(cached("PROCESSING", null)); const r = await post(); expect(r.status).toBe(409); expect((await r.json()).error.details.retryWithNewKey).toBe(false); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("a full quota does not reach the provider", async () => {
    mocks.transaction.mockResolvedValueOnce([[], []]); const r = await post(); expect(r.status).toBe(429); expect((await r.json()).error.details.reason).toBe("AI_DAILY_LIMIT"); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("a competing identical claim can return the completed result", async () => {
    mocks.transaction.mockResolvedValueOnce([[], []]); mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(cached("COMPLETED", { text: "Other request finished" })); const r = await post(); expect(r.status).toBe(200); expect((await r.json()).text).toBe("Other request finished"); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("provider failure records a terminal failure, not success or a paid fallback", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("upstream confidential body", { status: 429 })); const r = await post(); expect(r.status).toBe(429); const payload = await r.json(); expect(payload.error.details.reason).toBe("AI_PROVIDER_LIMIT"); expect(JSON.stringify(payload)).not.toContain("confidential"); expect(query(1).sql).toContain("status='FAILED'"); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("unowned/missing private files are rejected before reservation", async () => {
    const r = await post({ mediaId }); expect(r.status).toBe(404); expect(query(1).sql).toContain("owner_user_id="); expect(query(1).params).toContain(owner); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("invalid timetable rows are omitted with warnings and never auto-saved", async () => {
    const valid = { title: "Physics", dayOfWeek: 1, startsAt: "08:00", endsAt: "09:00" };
    mocks.fetch.mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ entries: [valid, { ...valid, dayOfWeek: 9 }, { ...valid, endsAt: "07:00" }], warnings: [] }) } }] }));
    const r = await post({ mode: "timetable" }); expect(r.status).toBe(200); const payload = await r.json(); expect(payload.entries).toHaveLength(1); expect(payload.warnings).toHaveLength(2); expect(payload.entries[0]).toMatchObject({ courseCode: "", venue: "", reminderEnabled: true }); expect(mocks.execute.mock.calls.map((_, i) => query(i).sql).join(" ")).not.toContain("insert into public.timetable");
  });
  it("history searches are owner-scoped and parameterised", async () => {
    const r = await get("/ai/history?q=physics"); expect(r.status).toBe(200); expect(query(0).params).toContain(owner); expect(query(0).params).toContain("physics"); expect(query(0).sql).toContain("mode<>'timetable'"); expect(query(0).sql).toContain("limit 50");
  });
  it("another owner's history ID is not returned", async () => {
    const r = await get(`/ai/history/${key}`); expect(r.status).toBe(404); expect(query(0).params).toContain(owner); expect(query(0).params).toContain(key);
  });
  it("deletion removes private content but keeps the allowance tombstone", async () => {
    const r = await get(`/ai/history/${key}`, "DELETE"); expect(r.status).toBe(200); expect(query(0).sql).toContain('"deleted":true'); expect(query(0).sql).not.toContain("delete from"); expect(query(0).params).toContain(owner); expect(query(0).params).toContain(key);
  });
  it("deleted results cannot be replayed", async () => {
    mocks.execute.mockResolvedValueOnce(cached("COMPLETED", { deleted: true, version: 2 })); expect((await post()).status).toBe(410); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("status never exposes secrets or upstream response data", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ used: 2, total: 4 }] }); const r = await get("/ai/status"); expect(r.status).toBe(200); const payload = await r.json(); expect(payload.allowance.remaining).toBe(3); const rendered = JSON.stringify(payload); expect(rendered).not.toContain("test-key"); expect(rendered).not.toContain("test-hf-key"); expect(payload.providers.study.configured).toBe(true);
  });
});
