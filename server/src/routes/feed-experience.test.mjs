import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.ts";

// Node-only test harness; keep Node globals outside the production Worker type environment.
const env = {
  ENVIRONMENT: "staging", ALLOWED_ORIGINS: "https://staging.kampusone.app", MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false", ACADEMIC_CORE_ENABLED: "true", SOCIAL_FEED_ENABLED: "true", MARKETPLACE_ENABLED: "false",
  PHASE_2_SCHEMA_READY: "true", PHASE_3_SCHEMA_READY: "true", UNIFIED_SCHEMA_READY: "true",
  TUTORIALS_ENABLED: "true", STORE_ENABLED: "false", STORE_DEMO_ENABLED: "true", LOGISTICS_ENABLED: "false", PAYMENTS_ENABLED: "false", AI_ASSISTANT_ENABLED: "false",
};
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const S1 = "00000000-0000-4000-8000-000000000011", S2 = "00000000-0000-4000-8000-000000000012";
const P1 = "00000000-0000-4000-8000-000000000021", M1 = "00000000-0000-4000-8000-000000000031";
const migration = readFileSync(new URL("../../../database/neon/migrations/20260922140000_feed_conversation_experience.sql", import.meta.url), "utf8");

describe("conversation API boundaries", () => {
  for (const [method, path] of [
    ["PUT", `/v1/student/feed/${P1}/view`], ["POST", `/v1/student/feed/${P1}/comments`],
    ["GET", `/v1/admin/public-badges/${U1}`], ["PUT", `/v1/admin/public-badges/${U1}`],
  ]) {
    it(`${method} ${path} refuses anonymous callers before accessing data`, async () => {
      const response = await app.request(`http://local.test${path}`, { method }, env);
      expect(response.status).toBe(401);
    });
  }
  it("public badge controls require platform-admin privileges and record decisions atomically", () => {
    const source = readFileSync(new URL("./public-badges.ts", import.meta.url), "utf8");
    expect(source).toContain('requireOperator("PLATFORM_ADMIN")');
    expect(source).toContain("insert into app_private.audit_events");
    expect(source).toContain("candidate.previous=${data.expected}");
    expect(source).not.toMatch(/set\s+verification_status|set\s+roles/i);
  });
});
describe("conversation migration on an isolated PostgreSQL-compatible database", () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.users(id uuid primary key);
      create table public.universities(id uuid primary key);
      create table public.profiles(user_id uuid primary key references public.users(id), verification_status text not null);
      create table public.media_objects(id uuid primary key, owner_user_id uuid not null references public.users(id));
      create table public.feed_posts(id uuid primary key, university_id uuid not null references public.universities(id), unique(id,university_id));
      create table public.feed_comments(id uuid primary key default gen_random_uuid(), body text not null check(char_length(btrim(body)) between 1 and 2000));
      insert into public.users values('${U1}'),('${U2}');
      insert into public.universities values('${S1}'),('${S2}');
      insert into public.profiles values('${U1}','VERIFIED'),('${U2}','PENDING');
      insert into public.media_objects values('${M1}','${U1}');
      insert into public.feed_posts values('${P1}','${S1}');
      insert into public.feed_comments(body) values('Existing reply stays intact');
    `);
    await db.exec(migration);
  }, 30000);
  afterAll(async () => { if (db) await db.close(); });
  it("is safe to rerun and preserves existing replies", async () => {
    await db.exec(migration);
    expect((await db.query("select body from public.feed_comments where body='Existing reply stays intact'")).rows).toEqual([{ body: "Existing reply stays intact" }]);
  });
  it("permits text, image-only and combined replies", async () => {
    await db.query("insert into public.feed_comments(body) values($1)", ["New text reply"]);
    await db.query("insert into public.feed_comments(body,media_object_id) values('', $1), ('Caption', $1)", [M1]);
    expect((await db.query("select count(*)::int as total from public.feed_comments where media_object_id=$1", [M1])).rows[0]?.total).toBe(2);
  });
  it("rejects empty replies, over-limit text and nonexistent media", async () => {
    await expect(db.query("insert into public.feed_comments(body) values('   ')")).rejects.toThrow();
    await expect(db.query("insert into public.feed_comments(body) values($1)", ["x".repeat(2001)])).rejects.toThrow();
    await expect(db.query("insert into public.feed_comments(body,media_object_id) values('', $1)", ["00000000-0000-4000-8000-000000000099"])).rejects.toThrow();
  });
  it("deduplicates repeated views and binds the view to the correct post campus", async () => {
    for (let i = 0; i < 2; i++) await db.query("insert into public.feed_post_views(post_id,institution_id,user_id) values($1,$2,$3) on conflict(post_id,user_id) do nothing", [P1,S1,U1]);
    await db.query("insert into public.feed_post_views(post_id,institution_id,user_id) values($1,$2,$3)", [P1,S1,U2]);
    expect((await db.query("select count(*)::int as total from public.feed_post_views")).rows[0]?.total).toBe(2);
    await expect(db.query("insert into public.feed_post_views(post_id,institution_id,user_id) values($1,$2,$3)", [P1,S2,U1])).rejects.toThrow();
    expect((await db.query("select relrowsecurity from pg_class where oid='public.feed_post_views'::regclass")).rows[0]?.relrowsecurity).toBe(true);
  });
  it("assigns and removes a public badge without changing identity verification", async () => {
    await db.query("update public.profiles set public_badge_verified=false where user_id=$1", [U1]);
    await db.query("update public.profiles set public_badge_verified=true where user_id=$1", [U2]);
    const result = await db.query("select verification_status,coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,verification_status='VERIFIED',false) as badge from public.profiles p order by user_id");
    expect(result.rows).toEqual([{ verification_status: "VERIFIED", badge: false }, { verification_status: "PENDING", badge: true }]);
  });
});
