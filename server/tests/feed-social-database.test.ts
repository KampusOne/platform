import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { createSession } from "../src/services/sessions";
import type { Bindings } from "../src/types";
import { app } from "../src/app";

let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
const author = "20000000-0000-4000-8000-000000000001";
const reader = "20000000-0000-4000-8000-000000000002";
const school = "20000000-0000-4000-8000-000000000010";
const otherSchool = "20000000-0000-4000-8000-000000000011";
const source = "20000000-0000-4000-8000-000000000020";
const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "https://app.example.invalid",
  MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PHASE_2_SCHEMA_READY: "true",
  PHASE_3_SCHEMA_READY: "false",
  UNIFIED_SCHEMA_READY: "true",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
  TUTORIALS_ENABLED: "true",
  JWT_SECRET: "test-only-signing-key-not-for-deployment-12345678",
};
const tokens = new Map<string, string>();
async function call(path: string, method = "GET", body?: unknown, actor = reader, expected = 200) {
  const response = await app.request("https://api.example.invalid/v1/student/feed" + path, {
    method,
    headers: { Authorization: `Bearer ${tokens.get(actor)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const data = await response.json();
  expect({ status: response.status, ...(response.status === expected ? {} : { data }) }).toEqual({ status: expected });
  return data;
}
async function seedPost(audience: Record<string, unknown> = { studentPost: true }, status = "PUBLISHED") {
  const id = crypto.randomUUID();
  await db.query(`insert into public.feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at)
    values($1,$2,$3,$4,'UPDATE','A test post','A test post','A test post',$5::jsonb,$6,now()-interval '1 minute')`,
    [id, school, source, author, JSON.stringify(audience), status]);
  return id;
}
async function stateOf(id: string) {
  return (await db.query<{ status: string }>("select status from public.feed_posts where id=$1", [id])).rows[0]?.status;
}
beforeAll(async () => {
  db = await createTestDatabase();
  for (const [index, id] of [school, otherSchool].entries())
    await db.query("insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())", [id, "Social school " + index, "social-school-" + index]);
  for (const [index, id] of [author, reader].entries()) {
    await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())", [id, `social${index}@example.invalid`]);
    await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())", [id, "social" + index, "Social user " + index, index ? otherSchool : school]);
    tokens.set(id, (await createSession(env, {
      id, email: `social${index}@example.invalid`, roles: ["STUDENT"], operatorRoles: [], universityId: index ? otherSchool : school,
    })).accessToken);
  }
  await db.query("insert into public.content_sources(id,university_id,name,owner_user_id) values($1,$2,'Social test source',$3)", [source, school, author]);
}, 60000);
afterAll(async () => { await db?.close(); });

describe("social feed against PostgreSQL schema and real authenticated routes", () => {
  it("applies the interaction migration repeatedly without losing data", async () => {
    const id = await seedPost();
    await db.exec(readFileSync(new URL("../../database/neon/migrations/20260921170000_feed_social_interactions.sql", import.meta.url), "utf8"));
    expect(await stateOf(id)).toBe("PUBLISHED");
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>("select relname,relrowsecurity from pg_class where relname in ('feed_post_comments','feed_post_reposts') order by relname");
    expect(tables.rows).toEqual([
      { relname: "feed_post_comments", relrowsecurity: true },
      { relname: "feed_post_reposts", relrowsecurity: true },
    ]);
  });
  it("includes public student posts across campuses but excludes campus editorial and private posts", async () => {
    const publicId = await seedPost();
    const editorial = await seedPost({});
    const privateId = await seedPost({ studentPost: true, visibility: "PRIVATE" });
    const data = await call("");
    const ids = data.posts.map((post: { id: string }) => post.id);
    expect(ids).toContain(publicId);
    expect(ids).not.toContain(editorial);
    expect(ids).not.toContain(privateId);
    expect((await call(`/${publicId}`)).post).toMatchObject({ id: publicId, can_delete: false, source_name: "Social user 0" });
    await call(`/${editorial}`, "GET", undefined, reader, 404);
    await call(`/${privateId}`, "GET", undefined, author, 404);
    expect((await call(`/${editorial}`, "GET", undefined, author)).post.id).toBe(editorial);
  });
  it("accepts legacy student post creation and displays it to another campus", async () => {
    const data = await call("", "POST", { body: "Hello from our campus", requestId: crypto.randomUUID() }, author, 201);
    expect((await call(`/${data.id}`)).post).toMatchObject({ body: "Hello from our campus", can_delete: false });
  });
  it("returns valid pagination cursors without duplicate posts", async () => {
    const first = await call("?limit=1");
    expect(first.posts).toHaveLength(1);
    expect(typeof first.nextCursor).toBe("string");
    const next = await call(`?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);
    expect(next.posts).toHaveLength(1);
    expect(next.posts[0].id).not.toBe(first.posts[0].id);
  });
  it("lets a different-campus reader comment, but only that comment's author delete it", async () => {
    const id = await seedPost();
    const input = { body: "A cross-campus reply", requestId: crypto.randomUUID() };
    const created = await call(`/${id}/comments`, "POST", input, reader, 201);
    const commentId = created.comment.id;
    expect(created.stats.comment_count).toBe(1);
    const duplicate = await call(`/${id}/comments`, "POST", input, reader, 201);
    expect(duplicate.comment.id).toBe(commentId);
    expect(duplicate.stats.comment_count).toBe(1);
    expect((await call(`/${id}/comments`)).comments[0]).toMatchObject({ id: commentId, can_delete: true, body: input.body });
    expect((await call(`/${id}/comments`, "GET", undefined, author)).comments[0].can_delete).toBe(false);
    await call(`/${id}/comments/${commentId}`, "DELETE", undefined, author, 404);
    expect((await call(`/${id}/comments/${commentId}`, "DELETE")).stats.comment_count).toBe(0);
    await call(`/${id}/comments/${commentId}`, "DELETE");
    expect((await call(`/${id}/comments`)).comments).toEqual([]);
    await call(`/${id}/comments`, "POST", input, reader, 409);
    const tombstone = (await db.query<{ body: string | null; removed: boolean }>("select body, deleted_at is not null as removed from public.feed_post_comments where id=$1", [commentId])).rows[0];
    expect(tombstone).toEqual({ body: null, removed: true });
  });
  it("rejects reuse of a comment request for a different post or edited body", async () => {
    const first = await seedPost(), second = await seedPost();
    const input = { body: "Original request", requestId: crypto.randomUUID() };
    await call(`/${first}/comments`, "POST", input, reader, 201);
    await call(`/${second}/comments`, "POST", input, reader, 409);
    await call(`/${first}/comments`, "POST", { ...input, body: "Changed request" }, reader, 409);
  });
  it("keeps one repost per reader and undo never changes the original", async () => {
    const id = await seedPost();
    expect((await call(`/${id}/repost`, "PUT")).stats).toMatchObject({ repost_count: 1, reposted: true });
    expect((await call(`/${id}/repost`, "PUT")).stats.repost_count).toBe(1);
    await call(`/${id}/repost`, "PUT", undefined, author);
    expect((await call(`/${id}`)).post).toMatchObject({ repost_count: 2, reposted: true });
    expect((await call(`/${id}/repost`, "DELETE")).stats).toMatchObject({ repost_count: 1, reposted: false });
    expect((await call(`/${id}/repost`, "DELETE")).stats.repost_count).toBe(1);
    expect(await stateOf(id)).toBe("PUBLISHED");
  });
  it("allows public cross-campus bookmarks and only the original author can delete a post", async () => {
    const id = await seedPost();
    await call(`/${id}/bookmark`, "PUT");
    expect((await call(`/${id}`)).post.bookmarked).toBe(true);
    await call(`/${id}`, "DELETE", { author_user_id: author }, reader, 404);
    expect(await stateOf(id)).toBe("PUBLISHED");
    await call(`/${id}`, "DELETE", undefined, author);
    expect(await stateOf(id)).toBe("ARCHIVED");
    await call(`/${id}`, "GET", undefined, reader, 404);
    expect((await db.query("select 1 from public.feed_bookmarks where post_id=$1", [id])).rows).toEqual([]);
  });
  it("makes short quotes independently owned and retry-safe", async () => {
    const id = await seedPost();
    const input = { body: "🔥", requestId: crypto.randomUUID() };
    const result = await call(`/${id}/quote`, "POST", input, reader, 201);
    const retry = await call(`/${id}/quote`, "POST", input, reader, 201);
    expect(retry.id).toBe(result.id);
    expect(retry.stats.quote_count).toBe(1);
    const post = (await call(`/${result.id}`)).post;
    expect(post).toMatchObject({ body: "🔥", can_delete: true, is_quote: true, quoted_post: { id, body: "A test post" } });
    await call(`/${result.id}`, "DELETE", undefined, author, 404);
    await call(`/${result.id}`, "DELETE");
    expect(await stateOf(id)).toBe("PUBLISHED");
    await call(`/${id}/quote`, "POST", input, reader, 409);
  });
  it("hides an archived original from quote embeds and disallows new comments/reposts", async () => {
    const id = await seedPost();
    const result = await call(`/${id}/quote`, "POST", { body: "My own commentary remains", requestId: crypto.randomUUID() }, reader, 201);
    await call(`/${id}/repost`, "PUT");
    await call(`/${id}`, "DELETE", undefined, author);
    expect((await call(`/${result.id}`)).post).toMatchObject({ is_quote: true, body: "My own commentary remains", quoted_post: null });
    await call(`/${id}/comments`, "GET", undefined, reader, 404);
    await call(`/${id}/comments`, "POST", { body: "Too late", requestId: crypto.randomUUID() }, reader, 409);
    await call(`/${id}/repost`, "PUT", undefined, reader, 404);
    await call(`/${id}/quote`, "POST", { body: "Too late", requestId: crypto.randomUUID() }, reader, 409);
    await call(`/${id}/repost`, "DELETE");
    expect((await call("")).posts.map((post: { id: string }) => post.id)).not.toContain(id);
  });
  it("allows transferred students to delete their own public post", async () => {
    const id = await seedPost();
    await db.query("update public.profiles set university_id=$1 where user_id=$2", [otherSchool, author]);
    try { await call(`/${id}`, "DELETE", undefined, author); }
    finally { await db.query("update public.profiles set university_id=$1 where user_id=$2", [school, author]); }
    expect(await stateOf(id)).toBe("ARCHIVED");
  });
});
