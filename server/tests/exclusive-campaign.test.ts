import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { app } from "../src/app";
import { createSession } from "../src/services/sessions";
import type { Bindings } from "../src/types";

let db: PGlite;
let auditCount = 0;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
const campus = crypto.randomUUID();
const platformReviewer = crypto.randomUUID();
const campusReviewer = crypto.randomUUID();
const student = crypto.randomUUID();
const tokens = new Map<string, string>();
const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "https://portal.example.invalid",
  MINIMUM_APP_VERSION: "1",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "false",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
  UNIFIED_SCHEMA_READY: "true",
  PHASE_2_SCHEMA_READY: "true",
  JWT_SECRET: "test-only-campaign-session-secret-123456789012345",
};
async function request(path = "/admin/campaign", actor = platformReviewer, method = "GET", body?: unknown) {
  return app.request("https://api.example.invalid/v1/trusted-vendors" + path, {
    method,
    headers: {
      Authorization: "Bearer " + tokens.get(actor),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
}
async function result(response: Response, expectedStatus = 200) {
  const data = await response.json();
  expect({ status: response.status, ...(response.status === expectedStatus ? {} : { data }) }).toEqual({ status: expectedStatus });
  return data;
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into public.universities(id,name,slug,updated_at)values($1,'Campaign fixture campus','campaign-fixture',now())", [campus]);
  for (const [index, userId] of [platformReviewer, campusReviewer, student].entries()) {
    const email = `campaign-fixture-${index}@example.invalid`;
    await db.query("insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,$2,'test-only',now(),now())", [userId, email]);
    await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values(gen_random_uuid(),$1,$2,'Campaign fixture',$3,now())", [userId, `campaignfixture${index}`, campus]);
    tokens.set(userId, (await createSession(env, {
      id: userId, email, roles: ["STUDENT"], operatorRoles: [], universityId: campus,
    })).accessToken);
  }
  await db.query("insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')", [platformReviewer]);
  await db.query("insert into public.operator_roles(user_id,role,university_id)values($1,'VERIFICATION_REVIEWER',$2)", [campusReviewer, campus]);
}, 60000);
beforeEach(async () => {
  await db.query("insert into app_private.agent_campaign_controls(campaign_key,enabled)values('exclusive',true)on conflict(campaign_key)do update set enabled=true,updated_by=null");
  auditCount = Number((await db.query("select count(*)::int count from app_private.audit_events where action='exclusive_campaign.updated'")).rows[0].count);
});
afterAll(async () => { await db?.close(); });

describe("Exclusive campaign management capability", () => {
  it("confirms platform-wide management from trusted grants, including when a campus filter is selected", async () => {
    const response = await request("/admin/campaign?universityId=" + campus);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result(response)).toMatchObject({ enabled: true, canManage: true });
  });

  it("provides a visible read-only status to a campus reviewer", async () => {
    expect(await result(await request("/admin/campaign", campusReviewer))).toMatchObject({ enabled: true, canManage: false });
  });

  it("opens and closes the campaign with an audited server-confirmed result", async () => {
    expect(await result(await request("/admin/campaign", platformReviewer, "PATCH", { enabled: false }))).toMatchObject({ enabled: false, canManage: true });
    expect(await result(await request("/availability"))).toEqual({ enabled: false });
    expect((await request("/invite", student, "POST", { token: "a".repeat(64) })).status).toBe(404);
    expect((await request("/submit", student, "POST", {})).status).toBe(404);
    const audit = (await db.query("select actor_user_id,university_id,metadata from app_private.audit_events where action='exclusive_campaign.updated' order by id offset $1", [auditCount])).rows;
    expect(audit).toEqual([{ actor_user_id: platformReviewer, university_id: null, metadata: { enabled: false } }]);
    expect(await result(await request("/admin/campaign", platformReviewer, "PATCH", { enabled: true }))).toMatchObject({ enabled: true, canManage: true });
    expect(await result(await request("/availability"))).toEqual({ enabled: true });
  });

  it("rejects campus-wide reviewers without changing global state or recording a successful change", async () => {
    expect((await request("/admin/campaign", campusReviewer, "PATCH", { enabled: false })).status).toBe(403);
    expect(await result(await request())).toMatchObject({ enabled: true, canManage: true });
    expect((await db.query("select count(*)::int count from app_private.audit_events where action='exclusive_campaign.updated'")).rows).toEqual([{ count: auditCount }]);
  });

  it("rejects unauthorized users for reads and writes and requires authentication", async () => {
    expect((await request("/admin/campaign", student)).status).toBe(403);
    expect((await request("/admin/campaign", student, "PATCH", { enabled: false })).status).toBe(403);
    expect((await app.request("https://api.example.invalid/v1/trusted-vendors/admin/campaign", {}, env)).status).toBe(401);
  });

  it("rejects untrusted management flags and non-boolean campaign state", async () => {
    for (const body of [{ enabled: "false" }, { enabled: false, canManage: true }]) {
      expect((await request("/admin/campaign", platformReviewer, "PATCH", body)).status).toBe(400);
    }
    expect(await result(await request())).toMatchObject({ enabled: true });
  });

  it("reports missing campaign storage without displaying a fabricated closed state or successful change", async () => {
    await db.query("delete from app_private.agent_campaign_controls where campaign_key='exclusive'");
    expect((await request()).status).toBe(503);
    expect((await request("/admin/campaign", platformReviewer, "PATCH", { enabled: false })).status).toBe(503);
    expect((await db.query("select count(*)::int count from app_private.audit_events where action='exclusive_campaign.updated'")).rows).toEqual([{ count: auditCount }]);
  });
});
