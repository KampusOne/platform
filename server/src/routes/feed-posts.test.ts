import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  user: { id: "11111111-1111-4111-8111-111111111111", universityId: "22222222-2222-4222-8222-222222222222" as string | null },
}));
vi.mock("../lib/database", () => ({
  database: () => ({ execute: mocks.execute }),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
vi.mock("../lib/security", () => ({ sha256: async (value: string) => `hash:${value}` }));
vi.mock("../middleware/auth", () => {
  const requireAuth: MiddlewareHandler = async (context, next) => {
    if (context.req.header("Authorization") !== "Bearer test-session") return context.json({ error: { code: "UNAUTHORIZED" } }, 401);
    await next();
  };
  return { requireAuth, currentUser: () => mocks.user };
});
import { feedPostRoutes } from "./feed-posts";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().route("/v1/student/feed", feedPostRoutes);
app.onError((error, context) => {
  if (error instanceof AppError) return context.json({ error: { code: error.code, message: error.message } }, error.status);
  return context.json({ error: { code: "INTERNAL_ERROR" } }, 500);
});
const id = "33333333-3333-4333-8333-333333333333";
const commentId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const headers = { Authorization: "Bearer test-session", "Content-Type": "application/json" };
const env = {} as Bindings;
const dialect = new PgDialect();
const stats = { comment_count: 1, repost_count: 1, quote_count: 1, reposted: true };
function query(index = 0) { return dialect.sqlToQuery(mocks.execute.mock.calls[index]![0]); }
function rows(...values: unknown[]) { for (const value of values) mocks.execute.mockResolvedValueOnce({ rows: [value] }); }
function request(suffix: string, method = "GET", body?: unknown) {
  return app.request(`/v1/student/feed${suffix}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.user.universityId = "22222222-2222-4222-8222-222222222222";
});

describe("post ownership and shared visibility", () => {
  it.each(["GET", "DELETE"])("requires a session for %s", async (method) => {
    const response = await app.request(`/v1/student/feed/${id}`, { method }, env);
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["GET", "DELETE"])("rejects malformed IDs before storage for %s", async (method) => {
    expect((await request("/not-a-post", method)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires a campus profile before reading", async () => {
    mocks.user.universityId = null;
    expect((await request(`/${id}`)).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("shares public student posts but keeps editorial/private visibility scoped", async () => {
    rows({ id, can_delete: true });
    const response = await request(`/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ post: { can_delete: true } });
    expect(query().params).toContain(mocks.user.id);
    expect(query().params).toContain(mocks.user.universityId);
    expect(query().params).toContain(id);
    expect(query().sql).toContain("posts.status in ('PUBLISHED', 'CORRECTED')");
    expect(query().sql).toContain("posts.published_at <= now()");
    expect(query().sql).toContain("coalesce(posts.audience->>'visibility', 'PUBLIC') = 'PUBLIC'");
    expect(query().sql).toContain("coalesce(posts.audience->>'visibility', 'CAMPUS') in ('PUBLIC', 'CAMPUS')");
    expect(query().sql).toContain("original.status in ('PUBLISHED', 'CORRECTED')");
    expect(query().sql).toContain("original.published_at <= now()");
  });
  it("does not expose unavailable post details", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await request(`/${id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("post");
  });
  it("archives only the authenticated author's requested post and clears bookmarks atomically", async () => {
    rows({ id });
    const response = await request(`/${id}`, "DELETE", { author_user_id: commentId, university_id: "forged" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, deleted: true });
    expect(query().params).toEqual([id, mocks.user.id, mocks.user.universityId]);
    expect(query().sql).toContain("author_user_id = $2::uuid");
    expect(query().sql).toContain("university_id = $3::uuid");
    expect(query().sql).toContain("status = 'ARCHIVED'");
    expect(query().sql).toContain("delete from public.feed_bookmarks");
    expect(query().sql).not.toContain("where quoted_post_id");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("does not report deletion success for another author", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await request(`/${id}`, "DELETE");
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("deleted");
  });
  it("retries an archive without changing its original timestamp", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id }] });
    expect((await request(`/${id}`, "DELETE")).status).toBe(200);
    expect((await request(`/${id}`, "DELETE")).status).toBe(200);
    expect(query(1).sql).toContain("case when status = 'ARCHIVED' then updated_at else now() end");
  });
  it("returns storage failures without false success", async () => {
    mocks.execute.mockRejectedValue(new Error("database unavailable"));
    const response = await request(`/${id}`, "DELETE");
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("deleted");
  });
});

describe("comments, reposts and quotes", () => {
  it.each([
    ["", "GET"], [`/${id}/social`, "GET"], [`/${id}/comments`, "GET"],
    [`/${id}/comments`, "POST"], [`/${id}/comments/${commentId}`, "DELETE"],
    [`/${id}/repost`, "PUT"], [`/${id}/repost`, "DELETE"], [`/${id}/quote`, "POST"], [`/${id}/bookmark`, "PUT"],
  ])("authenticates %s %s", async (suffix, method) => {
    const response = await app.request(`/v1/student/feed${suffix}`, { method }, env);
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["?limit=0", "?limit=101", "?limit=NaN", "?cursor=bad", `?cursor=2026-02-30T12:00:00Z~${id}`])("rejects invalid pagination %s", async (suffix) => {
    expect((await request(suffix)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("mounts the shared feed at the existing URL and returns a stable microsecond cursor", async () => {
    mocks.execute.mockResolvedValue({ rows: [
      { id, cursor_at: "2026-09-21T12:00:00.123456Z" },
      { id: commentId, cursor_at: "2026-09-21T11:00:00.123456Z" },
    ] });
    const response = await request("?limit=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ posts: [{ id }], nextCursor: `2026-09-21T12:00:00.123456Z~${id}` });
    expect(query().sql).toContain("order by activity_at desc, id desc");
  });
  it("only reads live comments on a visible original", async () => {
    rows({ available: true, comments: [], comment_count: 0 });
    const response = await request(`/${id}/comments`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ comments: [], nextCursor: null, comment_count: 0 });
    expect(query().sql).toContain("comments.deleted_at is null");
    expect(query().sql).toContain("comments.author_user_id =");
    expect(query().sql).toContain("join target on target.id = comments.post_id");
  });
  it("does not load comments from a removed original", async () => {
    rows({ available: false, comments: [], comment_count: 0 });
    expect((await request(`/${id}/comments`)).status).toBe(404);
  });
  it.each(["comments", "quote"])("rejects blank and forged-author %s bodies", async (kind) => {
    expect((await request(`/${id}/${kind}`, "POST", { body: "  ", requestId })).status).toBe(400);
    expect((await request(`/${id}/${kind}`, "POST", { body: "Hello", requestId, author_user_id: commentId })).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("creates comments with authenticated ownership and retry-safe deduplication", async () => {
    rows({ allowed: true }, { id: commentId, body: "Hello", can_delete: true }, stats);
    const response = await request(`/${id}/comments`, "POST", { body: " Hello ", requestId });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ comment: { id: commentId }, stats });
    expect(query(1).params).toContain(mocks.user.id);
    expect(query(1).params).toContain("Hello");
    expect(query(1).sql).toContain("for update");
    expect(query(1).sql).toContain("on conflict (author_user_id, client_request_id)");
    expect(query(1).sql).toContain("feed_post_comments.deleted_at is null");
    expect(query(1).sql).toContain("feed_post_comments.body = excluded.body");
    expect(query(1).sql).toContain("feed_post_comments.post_id = excluded.post_id");
  });
  it("erases comment text only for its author and leaves an idempotency tombstone", async () => {
    rows({ id: commentId }, stats);
    const response = await request(`/${id}/comments/${commentId}`, "DELETE", { author_user_id: "forged" });
    expect(response.status).toBe(200);
    expect(query().params).toEqual([commentId, id, mocks.user.id]);
    expect(query().sql).toContain("body = null");
    expect(query().sql).toContain("deleted_at = coalesce(deleted_at, now())");
    expect(query().sql).toContain("author_user_id = $3::uuid");
    expect(query().sql).not.toContain("feed_posts set");
  });
  it("cannot delete someone else's comment, including as the original post owner", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await request(`/${id}/comments/${commentId}`, "DELETE");
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("deleted");
  });
  it("stores a unique repost reference instead of duplicating a post", async () => {
    rows({ allowed: true }, { id }, stats);
    expect((await request(`/${id}/repost`, "PUT")).status).toBe(200);
    expect(query(1).sql).toContain("on conflict (post_id, user_id) do nothing");
    expect(query(1).sql).not.toContain("insert into public.feed_posts");
    expect(query(1).params).toContain(mocks.user.id);
  });
  it("undoes only the caller's repost and never removes the original", async () => {
    rows({}, { ...stats, reposted: false });
    expect((await request(`/${id}/repost`, "DELETE")).status).toBe(200);
    expect(query().params).toEqual([id, mocks.user.id]);
    expect(query().sql).toContain("delete from public.feed_post_reposts");
    expect(query().sql).not.toContain("public.feed_posts");
  });
  it("creates independently owned emoji quotes referencing the original", async () => {
    rows({ allowed: true }, { id: commentId }, stats);
    const response = await request(`/${id}/quote`, "POST", { body: "🔥", requestId });
    expect(response.status).toBe(201);
    expect(query(1).params).toContain("🔥");
    expect(query(1).params).toContain(mocks.user.id);
    expect(query(1).sql).toContain("quoted_post_id");
    expect(query(1).sql).toContain("feed_posts.quoted_post_id = excluded.quoted_post_id");
    expect(query(1).sql).toContain("feed_posts.status in ('PUBLISHED', 'CORRECTED')");
    expect(query(1).sql).not.toContain("update public.feed_posts set body");
  });
  it("returns rate limits without writing a comment", async () => {
    rows({ allowed: false });
    expect((await request(`/${id}/comments`, "POST", { body: "Hello", requestId })).status).toBe(429);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("makes cross-campus public posts bookmarkable but checks availability", async () => {
    rows({ id });
    expect((await request(`/${id}/bookmark`, "PUT")).status).toBe(200);
    expect(query().sql).toContain("coalesce(posts.audience->>'visibility', 'PUBLIC') = 'PUBLIC'");
    expect(query().sql).toContain("posts.status in ('PUBLISHED', 'CORRECTED')");
  });
});
