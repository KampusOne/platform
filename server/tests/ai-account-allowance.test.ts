import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { createSession } from "../src/services/sessions";
import { sha256 } from "../src/lib/security";
import { aiAllowance, resolveAIQuota } from "../src/lib/ai-quota";
import type { AuthenticatedUser, Bindings } from "../src/types";
import { app } from "../src/app";

let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
const owner = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const ownerEmail = "ai-owner@example.invalid";
const identities = new Map<string, AuthenticatedUser>([
  [owner, { id: owner, email: ownerEmail, roles: ["STUDENT"], operatorRoles: [], universityId: null }],
  [other, { id: other, email: "ai-student@example.invalid", roles: ["STUDENT"], operatorRoles: [], universityId: null }],
]);
const env: Bindings = {
  ENVIRONMENT: "local", ALLOWED_ORIGINS: "https://app.example.invalid", MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false", ACADEMIC_CORE_ENABLED: "true", SOCIAL_FEED_ENABLED: "true",
  MARKETPLACE_ENABLED: "false", PHASE_2_SCHEMA_READY: "true", PHASE_3_SCHEMA_READY: "false",
  UNIFIED_SCHEMA_READY: "true", PAYMENTS_ENABLED: "false", AI_ASSISTANT_ENABLED: "true",
  JWT_SECRET: "test-only-signing-key-not-for-deployment-12345678",
  GEMINI_API_KEY: "test-only-ai-key", GEMINI_MODEL: "test-model",
  HF_TOKEN: "test-only-hf-token", HF_CHAT_MODEL: "test-model", HF_VISION_MODEL: "test-model",
};
const tokens = new Map<string, string>();
const provider = vi.fn<typeof fetch>();
const draft = (mode = "study") => ({ mode, prompt: "Explain Ohm's law", idempotencyKey: crypto.randomUUID(), consent: true });
async function request(path: string, method = "GET", body?: unknown, actor = owner, token?: string) {
  return app.request("https://api.example.invalid/v1" + path, {
    method,
    headers: { Authorization: `Bearer ${token ?? tokens.get(actor)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
}
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect({ status: response.status, ...(response.status === status ? {} : { data }) }).toEqual({ status });
  return data;
}
async function seedAttempts(actor: string, count = 5) {
  await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result) select $1::uuid,gen_random_uuid(),repeat('a',64),'study','FAILED','{}'::jsonb from generate_series(1,$2::int)", [actor, count]);
}
beforeAll(async () => {
  db = await createTestDatabase();
  for (const [i, identity] of [...identities.values()].entries()) {
    await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())", [identity.id, identity.email]);
    await db.query("insert into public.profiles(id,user_id,username,display_name,updated_at) values(gen_random_uuid(),$1,$2,$3,now())", [identity.id, "ai-quota-" + i, "AI quota test " + i]);
    tokens.set(identity.id, (await createSession(env, identity)).accessToken);
  }
}, 60000);
beforeEach(async () => {
  await db.exec("delete from app_private.ai_requests");
  env.AI_UNLIMITED_EMAIL_HASHES = await sha256(ownerEmail);
  env.AI_DAILY_USER_LIMIT = "5";
  env.AI_DAILY_GLOBAL_LIMIT = "100";
  env.AI_ASSISTANT_ENABLED = "true";
  provider.mockReset();
  provider.mockImplementation(async url => String(url).includes("huggingface.co")
    ? Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"entries":[],"warnings":[]}' } }] })
    : Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Voltage equals current times resistance." }] } }] }));
  vi.stubGlobal("fetch", provider);
});
afterAll(async () => { vi.unstubAllGlobals(); await db?.close(); });

describe("account-specific AI daily allowance", () => {
  it("keeps the normal five-attempt limit for another authenticated account", async () => {
    const data = await json(await request("/ai/status", "GET", undefined, other));
    expect(data.allowance).toMatchObject({ unlimited: false, limit: 5, remaining: 5 });
  });
  it("reports no personal cap even when the approved account has used its old allowance", async () => {
    await seedAttempts(owner);
    const data = await json(await request("/ai/status"));
    expect(data.allowance).toMatchObject({ unlimited: true, limit: null, remaining: null, used: 5, globalAvailable: true });
    expect(JSON.stringify(data)).not.toContain(ownerEmail);
    expect(JSON.stringify(data)).not.toContain(env.AI_UNLIMITED_EMAIL_HASHES);
  });
  it.each(["study", "summary", "notes", "quiz", "timetable"])("allows %s beyond five attempts and still records the reservation", async mode => {
    await seedAttempts(owner);
    await json(await request("/ai", "POST", draft(mode)));
    expect(provider).toHaveBeenCalledTimes(1);
    const rows = await db.query<{ count: number }>("select count(*)::int as count from app_private.ai_requests where user_id=$1", [owner]);
    expect(rows.rows[0]?.count).toBe(6);
  });
  it("rejects a client-supplied exemption or another user's email", async () => {
    await seedAttempts(other);
    await json(await request("/ai", "POST", { ...draft(), unlimited: true, email: ownerEmail }, other), 429);
    expect(provider).not.toHaveBeenCalled();
  });
  it("resolves identity from the database, not a stale or forged email claim", async () => {
    const token = (await createSession(env, { ...identities.get(other)!, email: ownerEmail })).accessToken;
    const data = await json(await request("/ai/status", "GET", undefined, other, token));
    expect(data.allowance.unlimited).toBe(false);
  });
  it("keeps the global service budget enforced for an exempt account", async () => {
    await seedAttempts(owner);
    env.AI_DAILY_GLOBAL_LIMIT = "5";
    const data = await json(await request("/ai", "POST", draft()), 429);
    expect(JSON.stringify(data)).toContain("AI_GLOBAL_LIMIT");
    const status = await json(await request("/ai/status"));
    expect(status.allowance).toMatchObject({ unlimited: true, globalAvailable: false });
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not call the provider twice when an exempt account replays a request", async () => {
    await seedAttempts(owner);
    const body = draft();
    const first = await json(await request("/ai", "POST", body));
    const second = await json(await request("/ai", "POST", body));
    expect(second).toEqual(first);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("keeps the AI kill switch in force", async () => {
    env.AI_ASSISTANT_ENABLED = "false";
    await json(await request("/ai", "POST", draft()), 503);
    expect(provider).not.toHaveBeenCalled();
  });
  it("does not bypass an upstream credentials rejection", async () => {
    await seedAttempts(owner);
    provider.mockResolvedValueOnce(new Response("withheld", { status: 403 }));
    const data = await json(await request("/ai", "POST", draft()), 503);
    expect(JSON.stringify(data)).toContain("AI_PROVIDER_AUTH");
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("normalizes an exact trusted email match and fails closed without a valid allowlist", async () => {
    const identity = identities.get(owner)!;
    expect((await resolveAIQuota(env, { ...identity, email: " AI-OWNER@EXAMPLE.INVALID " })).unlimited).toBe(true);
    for (const allowlist of [undefined, "", "*", ownerEmail, "invalid-hash"]) {
      expect((await resolveAIQuota({ ...env, AI_UNLIMITED_EMAIL_HASHES: allowlist }, identity)).unlimited).toBe(false);
    }
    expect((await resolveAIQuota(env, { ...identity, email: "ai-owner+alias@example.invalid", operatorRoles: ["PLATFORM_ADMIN"] })).unlimited).toBe(false);
  });
  it("can revoke the exemption without editing or deleting usage records", async () => {
    await seedAttempts(owner);
    env.AI_UNLIMITED_EMAIL_HASHES = "";
    const status = await json(await request("/ai/status"));
    expect(status.allowance).toMatchObject({ unlimited: false, limit: 5, remaining: 0, used: 5 });
    await json(await request("/ai", "POST", draft()), 429);
    expect(provider).not.toHaveBeenCalled();
  });
  it("keeps zero or invalid global limits closed and never serializes Infinity", () => {
    for (const global of [0]) {
      const status = aiAllowance({ user: 5, global, unlimited: true }, 999999, 0, new Date().toISOString());
      expect(status.globalAvailable).toBe(false);
      expect(JSON.parse(JSON.stringify(status))).toMatchObject({ limit: null, remaining: null, unlimited: true });
    }
  });
});
