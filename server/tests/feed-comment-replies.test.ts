import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Hono, type Context, type Next } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors";
import { feedSocialRoutes } from "../src/routes/feed-social";

const mocked = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/lib/database", () => ({ database: () => ({ execute: mocked.execute }), firstRow: (result: { rows: unknown[] }) => result.rows[0] }));
// Only identity verification is replaced. These tests execute the actual Hono handlers,
// request schemas, SQL, migrations and foreign keys against isolated PostgreSQL.
vi.mock("../src/middleware/auth", () => ({
  currentUser: (c: Context) => ({ id: c.req.header("x-test-user"), universityId: c.req.header("x-test-campus") }),
  requireAuth: async (c: Context, next: Next) => c.req.header("x-test-user") ? next() : c.json({ error: "Unauthorized" }, 401),
}));

const campusA = randomUUID(), campusB = randomUUID(), userA = randomUUID(), userB = randomUUID();
const postA = randomUUID(), postB = randomUUID(), otherPostA = randomUUID(), sourceA = randomUUID();
const env = { UNIFIED_SCHEMA_READY: "true" };
const dialect = new PgDialect();
const app = new Hono().route("/feed", feedSocialRoutes);
app.onError((error, c) => c.json({ error: error.message }, error instanceof AppError ? error.status : 500));
let pg: PGlite;
let quotaCalls = 0;

async function request(path: string, method = "GET", payload?: unknown, user = userA, campus = campusA) {
  return app.request(`/feed/${path}`, { method, headers: { "content-type": "application/json", "x-test-user": user, "x-test-campus": campus }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }, env);
}
async function comment(parentCommentId?: string, user = userA, post = postA) {
  const response = await request(`${post}/comments`, "POST", { body: "A campus conversation", requestId: randomUUID(), ...(parentCommentId ? { parentCommentId } : {}) }, user);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).comment as { id: string; parent_comment_id: string | null };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table public.universities(id uuid primary key);
    create table public.users(id uuid primary key);
    create table public.content_sources(id uuid primary key, name text, verified boolean);
    create table public.profiles(user_id uuid primary key, display_name text, profile_image_url text, username text, verification_status text, deleted_at timestamptz);
    create table public.feed_posts(id uuid primary key, university_id uuid not null, source_id uuid, author_user_id uuid, category text, title text, summary text, body text, image_url text, urgent boolean, sponsored boolean, published_at timestamptz, correction_note text, audience jsonb, status text);
    create table public.feed_bookmarks(post_id uuid, user_id uuid);
  `);
  await pg.exec(readFileSync(new URL("../../database/neon/migrations/20260921180000_feed_social_interactions.sql", import.meta.url), "utf8"));
  // Feed/comment reads now include engagement counts from the existing additive likes migrations.
  await pg.exec(readFileSync(new URL("../../database/neon/migrations/20260921183000_feed_post_likes.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../../database/neon/migrations/20260921184500_feed_comment_likes.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../../database/neon/migrations/20260921200000_feed_comment_replies.sql", import.meta.url), "utf8"));
  // Reapplying the additive migration must not break an already upgraded database.
  await pg.exec(readFileSync(new URL("../../database/neon/migrations/20260921200000_feed_comment_replies.sql", import.meta.url), "utf8"));
  await pg.query("insert into public.universities values ($1),($2)", [campusA, campusB]);
  await pg.query("insert into public.users values ($1),($2)", [userA, userB]);
  await pg.query("insert into public.content_sources values ($1,'Student',true)", [sourceA]);
  await pg.query("insert into public.profiles values ($1,'Author A','https://example.test/a.png','author-a','VERIFIED',null),($2,'Author B','https://example.test/b.png','author-b','UNVERIFIED',null)", [userA, userB]);
  for (const [post, campus, visibility] of [[postA, campusA, "PUBLIC"], [postB, campusB, "CAMPUS"], [otherPostA, campusA, "PUBLIC"]]) {
    await pg.query("insert into public.feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,published_at,audience,status) values($1,$2,$3,$4,'UPDATE','Test','Test','Test',now()-interval '1 hour',jsonb_build_object('visibility',$5::text,'studentPost',true),'PUBLISHED')", [post, campus, sourceA, userA, visibility]);
  }
  mocked.execute.mockImplementation(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.includes("consume_request_rate_limit")) { quotaCalls++; return { rows: [{ allowed: true }] }; }
    return pg.query(compiled.sql, compiled.params);
  });
}, 60_000);

beforeEach(async () => { await pg.exec("truncate public.feed_comments cascade"); quotaCalls = 0; });
afterAll(async () => { await pg?.close(); });

describe("comment reply API and PostgreSQL", () => {
  it("requires authentication", async () => {
    expect((await app.request(`/feed/${postA}/comments`, {}, env)).status).toBe(401);
  });

  it("stores replies and nested replies in the correct thread with profile identity", async () => {
    const root = await comment();
    const reply = await comment(root.id, userB);
    await comment(reply.id);
    const roots = await (await request(`${postA}/comments`)).json();
    expect(roots.comments).toHaveLength(1);
    expect(roots.comments[0]).toMatchObject({ id: root.id, parent_comment_id: null, reply_count: 1 });
    const children = await (await request(`${postA}/comments?parentCommentId=${root.id}`)).json();
    expect(children.comments).toHaveLength(1);
    expect(children.comments[0]).toMatchObject({ id: reply.id, parent_comment_id: root.id, reply_count: 1, author_name: "Author B", author_username: "author-b", author_image_url: "https://example.test/b.png", can_delete: false });
  });

  it("retries the same request without duplicates or consuming another quota", async () => {
    const root = await comment();
    const payload = { body: "Reply", requestId: randomUUID(), parentCommentId: root.id };
    const first = await request(`${postA}/comments`, "POST", payload);
    const id = (await first.json()).comment.id;
    const calls = quotaCalls;
    const retry = await request(`${postA}/comments`, "POST", payload);
    expect(retry.status).toBe(200);
    expect((await retry.json()).comment.id).toBe(id);
    expect(quotaCalls).toBe(calls);
    expect((await pg.query("select id from public.feed_comments where parent_comment_id=$1", [root.id])).rows).toHaveLength(1);
  });

  it("does not reuse an idempotency key for a different parent", async () => {
    const one = await comment(), two = await comment();
    const payload = { body: "Reply", requestId: randomUUID(), parentCommentId: one.id };
    expect((await request(`${postA}/comments`, "POST", payload)).status).toBe(201);
    expect((await request(`${postA}/comments`, "POST", { ...payload, parentCommentId: two.id })).status).toBe(409);
  });

  it("rejects missing or cross-post parents and invalid reply inputs", async () => {
    const root = await comment();
    expect((await request(`${otherPostA}/comments`, "POST", { body: "Reply", requestId: randomUUID(), parentCommentId: root.id })).status).toBe(409);
    expect((await request(`${postA}/comments?parentCommentId=${randomUUID()}`)).status).toBe(404);
    expect((await request(`${postA}/comments?parentCommentId=bad`)).status).toBe(400);
    expect((await request(`${postA}/comments`, "POST", { body: " ", requestId: randomUUID(), parentCommentId: root.id })).status).toBe(400);
  });

  it("enforces the post audience even when a parent ID is known", async () => {
    const response = await request(`${postB}/comments`, "POST", { body: "Private", requestId: randomUUID() }, userB, campusB);
    const root = (await response.json()).comment;
    expect((await request(`${postB}/comments?parentCommentId=${root.id}`)).status).toBe(404);
    expect((await request(`${postB}/comments`, "POST", { body: "Reply", requestId: randomUUID(), parentCommentId: root.id })).status).toBe(409);
  });

  it("does not let the post or parent author delete another user's reply", async () => {
    const root = await comment();
    const reply = await comment(root.id, userB);
    expect((await request(`${postA}/comments/${reply.id}`, "DELETE")).status).toBe(404);
    expect((await request(`${postA}/comments/${reply.id}`, "DELETE", undefined, userB)).status).toBe(200);
  });

  it("redacts a deleted parent while keeping descendants readable and replyable", async () => {
    const root = await comment();
    const reply = await comment(root.id, userB);
    const removed = await request(`${postA}/comments/${root.id}`, "DELETE");
    expect(await removed.json()).toMatchObject({ retained: true, reply_count: 1 });
    const roots = await (await request(`${postA}/comments`)).json();
    expect(roots.comments[0]).toMatchObject({ is_deleted: true, body: "", author_name: "Comment deleted", author_image_url: null, author_username: null, can_delete: false });
    const children = await (await request(`${postA}/comments?parentCommentId=${root.id}`)).json();
    expect(children.parentDeleted).toBe(true);
    expect(children.comments[0].id).toBe(reply.id);
    expect((await request(`${postA}/comments`, "POST", { body: "Reply", requestId: randomUUID(), parentCommentId: root.id })).status).toBe(409);
    await comment(reply.id);
  });

  it("allows confirmation of a saved retry after its parent was deleted", async () => {
    const root = await comment();
    const payload = { body: "Reply", requestId: randomUUID(), parentCommentId: root.id };
    const saved = await request(`${postA}/comments`, "POST", payload, userB);
    const savedId = (await saved.json()).comment.id;
    await request(`${postA}/comments/${root.id}`, "DELETE");
    const retry = await request(`${postA}/comments`, "POST", payload, userB);
    expect(retry.status).toBe(200);
    expect((await retry.json()).comment.id).toBe(savedId);
  });

  it("paginates replies independently, without omitting equal-timestamp rows", async () => {
    const root = await comment();
    await pg.query("insert into public.feed_comments(post_id,institution_id,author_user_id,body,client_request_id,parent_comment_id,created_at) select $1,$2,$3,'Reply',gen_random_uuid(),$4,'2026-09-21T12:00:00.123456Z'::timestamptz from generate_series(1,45)", [postA,campusA,userA,root.id]);
    const first = await (await request(`${postA}/comments?parentCommentId=${root.id}`)).json();
    expect(first.comments).toHaveLength(40);
    const second = await (await request(`${postA}/comments?parentCommentId=${root.id}&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(second.comments).toHaveLength(5);
    expect(new Set([...first.comments,...second.comments].map((row: {id: string}) => row.id)).size).toBe(45);
    expect(second.nextCursor).toBeNull();
  });

  it("enforces same-post parents and no self-replies at the database boundary", async () => {
    const root = await comment();
    await expect(pg.query("insert into public.feed_comments(post_id,institution_id,author_user_id,body,client_request_id,parent_comment_id) values($1,$2,$3,'Invalid',gen_random_uuid(),$4)", [otherPostA,campusA,userA,root.id])).rejects.toMatchObject({ code: "23503" });
    const self = randomUUID();
    await expect(pg.query("insert into public.feed_comments(id,post_id,institution_id,author_user_id,body,client_request_id,parent_comment_id) values($1,$2,$3,$4,'Invalid',gen_random_uuid(),$1)", [self,postA,campusA,userA])).rejects.toMatchObject({ code: "23514" });
  });
});
