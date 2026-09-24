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
  GEMINI_API_KEY: "synthetic-google-secret", GEMINI_MODEL: "gemini-test", HF_TOKEN: "hf_SYNTHETIC", HF_CHAT_MODEL: "test/model:nscale", HF_VISION_MODEL: "test/vision",
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
  await db.exec("delete from app_private.ai_requests");
  env.AI_UNLIMITED_EMAIL_HASHES = await sha256(ownerEmail);
  env.AI_DAILY_USER_LIMIT = "5"; env.AI_DAILY_GLOBAL_LIMIT = "100"; env.AI_ASSISTANT_ENABLED = "true";
  env.GEMINI_API_KEY = "synthetic-google-secret"; env.HF_TOKEN = "hf_SYNTHETIC";
  provider.mockReset();
  provider.mockImplementation(async url => String(url).includes("huggingface.co")
    ? Response.json({ choices: [{ finish_reason: "stop", message: { content: "Voltage equals current multiplied by resistance." } }] })
    : Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A Gemini test answer." }] } }] }));
  vi.stubGlobal("fetch", provider);
});
afterAll(async () => { vi.unstubAllGlobals(); await db?.close(); });

describe("explicit Hugging Face study provider", () => {
  it.each(["study", "summary", "notes", "quiz"])("saves %s through HF even without a Gemini key", async mode => {
    delete env.GEMINI_API_KEY;
    const body = draft(mode);
    const result = await json(await request("/ai", "POST", body));
    expect(result).toMatchObject({ provider: "huggingface", requestId: body.idempotencyKey, text: expect.any(String) });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(String(provider.mock.calls[0]?.[0])).toBe("https://router.huggingface.co/v1/chat/completions");
    const saved = await json(await request(`/ai/history/${body.idempotencyKey}`));
    expect(saved).toMatchObject({ provider: "huggingface", mode, prompt: body.prompt, text: result.text });
    const history = await json(await request("/ai/history?q=Ohm"));
    expect(history.sessions).toHaveLength(1);
    expect(await count()).toBe(1);
  });
  it("leaves provider-omitted legacy requests on Gemini and preserves their replay hash", async () => {
    const { provider: _provider, ...body } = draft();
    const first = await json(await request("/ai", "POST", body));
    expect(first.provider).toBe("gemini");
    const again = await json(await request("/ai", "POST", { ...body, provider: "gemini" }));
    expect(again).toEqual(first);
    expect(provider).toHaveBeenCalledTimes(1);
    const row = (await db.query<{ request_hash: string }>("select request_hash from app_private.ai_requests")).rows[0];
    expect(row?.request_hash).toBe(await sha256(JSON.stringify([body.mode, body.prompt, null, null])));
  });
  it("prevents reusing a request reference with a different provider", async () => {
    const body = draft();
    await json(await request("/ai", "POST", body));
    await json(await request("/ai", "POST", { ...body, provider: "gemini" }), 409);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("replays an HF answer without a second provider call", async () => {
    const body = draft();
    const first = await json(await request("/ai", "POST", body));
    expect(await json(await request("/ai", "POST", body))).toEqual(first);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("sends same-provider follow-up context in order", async () => {
    const parent = await json(await request("/ai", "POST", draft()));
    await json(await request("/ai", "POST", { ...draft(), prompt: "Give an example", replyTo: parent.requestId }));
    const body = JSON.parse(String(provider.mock.calls[1]?.[1]?.body));
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("Explain Ohm's law");
    expect(body.messages[2].content).toBe(parent.text);
    expect(body.messages[3].content).toBe("Give an example");
  });
  it("does not forward a previous Gemini conversation to HF", async () => {
    const parent = await json(await request("/ai", "POST", { ...draft(), provider: "gemini" }));
    const result = await json(await request("/ai", "POST", { ...draft(), replyTo: parent.requestId }), 400);
    expect(JSON.stringify(result)).toContain("AI_PROVIDER_CONTEXT");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(1);
  });
  it("keeps another user's history private", async () => {
    const parent = await json(await request("/ai", "POST", draft()));
    await json(await request(`/ai/history/${parent.requestId}`, "GET", undefined, other), 404);
    await json(await request("/ai", "POST", { ...draft(), replyTo: parent.requestId }, other), 404);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("rejects provider override on timetable and invalid provider/consent before reservations", async () => {
    for (const body of [draft("timetable"), { ...draft(), provider: "unknown" }, { ...draft(), consent: false }]) {
      await json(await request("/ai", "POST", body), 400);
    }
    expect(provider).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });
  it("keeps normal personal and shared quotas enforced for HF", async () => {
    env.AI_DAILY_USER_LIMIT = "0";
    await json(await request("/ai", "POST", draft(), other), 429);
    await json(await request("/ai", "POST", draft()));
    env.AI_DAILY_GLOBAL_LIMIT = "1";
    await json(await request("/ai", "POST", draft()), 429);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("exposes safe capability metadata and enforces missing HF credentials", async () => {
    const status = await json(await request("/ai/status"));
    expect(status.providers.studyHuggingFace).toMatchObject({ provider: "huggingface", configured: true });
    expect(JSON.stringify(status)).not.toContain("hf_SYNTHETIC");
    delete env.HF_TOKEN;
    await json(await request("/ai", "POST", draft()), 503);
    expect(provider).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });
  it("reports Google project denial without leaking its raw response or calling HF", async () => {
    provider.mockResolvedValueOnce(Response.json({ error: { message: "Your project has been denied access. PRIVATE_INPUT synthetic-google-secret" } }, { status: 403 }));
    const body = { ...draft(), provider: "gemini" };
    const result = await json(await request("/ai", "POST", body), 503);
    expect(JSON.stringify(result)).toContain("AI_PROJECT_ACCESS_DENIED");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_INPUT");
    expect(JSON.stringify(result)).not.toContain("synthetic-google-secret");
    await json(await request("/ai", "POST", body), 503);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("does not use Gemini as a paid fallback after HF credit or auth failures", async () => {
    for (const http of [402, 403, 429]) {
      provider.mockResolvedValueOnce(new Response("PRIVATE_INPUT", { status: http }));
      await json(await request("/ai", "POST", draft()), http === 403 ? 503 : 429);
    }
    expect(provider).toHaveBeenCalledTimes(3);
    expect(provider.mock.calls.every(([url]) => String(url).includes("router.huggingface.co"))).toBe(true);
  });
  it("keeps the kill switch in force", async () => {
    env.AI_ASSISTANT_ENABLED = "false";
    await json(await request("/ai", "POST", draft()), 503);
    expect(provider).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });
});
