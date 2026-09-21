import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), ready: vi.fn(), repliesReady: vi.fn(),
  user: { id: "11111111-1111-4111-8111-111111111111", universityId: "22222222-2222-4222-8222-222222222222" as string | null },
}));
vi.mock("../lib/database", () => ({ database: () => ({ execute: mocks.execute }), firstRow: (result: { rows: unknown[] }) => result.rows[0] }));
vi.mock("../lib/security", () => ({ sha256: async () => "hashed-session-user" }));
vi.mock("../lib/feed-social", async (importOriginal) => ({ ...await importOriginal<typeof import("../lib/feed-social")>(), socialSchemaReady: mocks.ready, commentRepliesSchemaReady: mocks.repliesReady }));
vi.mock("../middleware/auth", () => {
  const requireAuth: MiddlewareHandler = async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer test-session") return c.json({ error: { code: "UNAUTHORIZED" } }, 401);
    await next();
  };
  return { requireAuth, currentUser: () => mocks.user };
});
import { feedPostRoutes } from "./feed-posts";
import { nextFeedCursor, parseFeedCursor } from "../lib/feed-social";
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().route("/v1/student/feed", feedPostRoutes);
app.onError((error, c) => error instanceof AppError ? c.json({ error: { code: error.code, message: error.message } }, error.status) : c.json({ error: { code: "INTERNAL_ERROR" } }, 500));
const id = "33333333-3333-4333-8333-333333333333";
const commentId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const headers = { Authorization: "Bearer test-session", "Content-Type": "application/json" };
const env = {} as Bindings;
const dialect = new PgDialect();
const query = (index = 0) => dialect.sqlToQuery(mocks.execute.mock.calls[index]![0]);
const request = (suffix = "", method = "GET", body?: unknown) => app.request(`/v1/student/feed${suffix}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);

beforeEach(() => {
  mocks.execute.mockReset(); mocks.ready.mockReset(); mocks.ready.mockResolvedValue(true);
  mocks.repliesReady.mockReset(); mocks.repliesReady.mockResolvedValue(true);
  mocks.user.universityId = "22222222-2222-4222-8222-222222222222";
});

describe("shared feed, comments, reposts and quotes", () => {
  it.each([["GET", ""], ["POST", ""], ["GET", `/${id}/comments`], ["POST", `/${id}/comments`], ["DELETE", `/${id}/comments/${commentId}`], ["PUT", `/${id}/repost`], ["DELETE", `/${id}/repost`]])("requires authentication: %s %s", async (method, suffix) => {
    const response = await app.request(`/v1/student/feed${suffix}`, { method }, env);
    expect(response.status).toBe(401); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([["GET", "/bad-id"], ["DELETE", "/bad-id"], ["DELETE", `/${id}/comments/bad-id`], ["PUT", "/bad-id/repost"]])("rejects malformed IDs: %s %s", async (method, suffix) => {
    expect((await request(suffix, method)).status).toBe(400); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("paginates the shared feed once per post and keeps exact timestamp precision", async () => {
    const rows = Array.from({ length: 41 }, () => ({ id, cursor_at: "2026-09-21T17:00:00.123456Z", activity_at: "2026-09-21T17:00:00.123Z" }));
    mocks.execute.mockResolvedValue({ rows });
    const response = await request(); const data = await response.json() as { posts: unknown[]; nextCursor: string };
    expect(response.status).toBe(200); expect(data.posts).toHaveLength(40);
    expect(data.nextCursor).toBe(`2026-09-21T17:00:00.123456Z|${id}`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(query().sql).toContain("posts.audience->>'visibility' = 'PUBLIC'");
    expect(query().sql).toContain("left join lateral");
    expect(query().sql).toContain("posts.status in ('PUBLISHED', 'CORRECTED')");
  });
  it("keeps campus-only and archived quote originals out of the nested preview", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id, quoted_post: null, can_delete: false }] });
    const response = await request(`/${id}`);
    expect(response.status).toBe(200);
    expect(query().sql).toContain("quoted.status in ('PUBLISHED', 'CORRECTED')");
    expect(query().sql).toContain("quoted.audience->>'visibility' = 'PUBLIC'");
    expect(query().params).toContain(mocks.user.universityId);
  });
  it("never authorizes post deletion from forged input", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id }] });
    expect((await request(`/${id}`, "DELETE", { author_user_id: commentId })).status).toBe(200);
    expect(query().params).toEqual([id, mocks.user.id, mocks.user.universityId]);
    expect(query().sql).toContain("author_user_id = $2::uuid");
    expect(query().sql).toContain("delete from public.feed_reposts");
  });
  it("only the comment author can delete, never the parent post's owner", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: commentId }] }).mockResolvedValueOnce({ rows: [{ retained: false, reply_count: 0 }] });
    const response = await request(`/${id}/comments/${commentId}`, "DELETE", { author_user_id: id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: commentId, deleted: true, retained: false, reply_count: 0 });
    expect(query().params).toEqual([commentId, id, mocks.user.id]);
    expect(query().sql).toContain("author_user_id = $3::uuid");
    expect(query().sql).toContain("coalesce(deleted_at, now())");
    expect(query().sql).not.toContain("posts.author_user_id");
    expect(query(1).sql).toContain("parent_comment_id");
  });
  it("does not claim deletion success for somebody else's comment", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await request(`/${id}/comments/${commentId}`, "DELETE");
    expect(response.status).toBe(404); expect(await response.json()).not.toHaveProperty("deleted");
  });
  it.each(["", "  ", "x".repeat(2001)])("rejects an invalid comment without writing", async (body) => {
    expect((await request(`/${id}/comments`, "POST", { body, requestId })).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("creates retry-safe comments under a locked visible parent", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ allowed: true }] }).mockResolvedValueOnce({ rows: [{ id: commentId, body: "Hello", can_delete: true }] });
    expect((await request(`/${id}/comments`, "POST", { body: " Hello ", requestId, author_user_id: id })).status).toBe(201);
    expect(query(0).sql).toContain("client_request_id");
    expect(query(2).sql).toContain("for update");
    expect(query(2).sql).toContain("on conflict(author_user_id, client_request_id)");
    expect(query(2).sql).toContain("feed_comments.deleted_at is null");
    expect(query(2).sql).toContain("feed_comments.parent_comment_id is not distinct from excluded.parent_comment_id");
    expect(query(2).params).toContain("Hello"); expect(query(2).params).toContain(mocks.user.id);
  });
  it("fails clearly when reply schema is missing without writing", async () => {
    mocks.repliesReady.mockResolvedValue(false);
    const response = await request(`/${id}/comments`, "POST", { body: "Reply", requestId, parentCommentId: commentId });
    expect(response.status).toBe(503);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("reposts idempotently with a unique post/user pair", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ allowed: true }] }).mockResolvedValueOnce({ rows: [{ id }] }).mockResolvedValueOnce({ rows: [{ id, reposted: true, repost_count: 1 }] });
    const response = await request(`/${id}/repost`, "PUT"); expect(response.status).toBe(200);
    expect(query(1).sql).toContain("on conflict(post_id, user_id) do nothing");
    expect(await response.json()).toMatchObject({ reposted: true, post: { repost_count: 1 } });
  });
  it("undo only removes the authenticated user's repost", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    expect((await request(`/${id}/repost`, "DELETE")).status).toBe(200);
    expect(query().params).toEqual([id, mocks.user.id]);
  });
  it("quotes retain a reference and inherit the original's audience", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ allowed: true }] }).mockResolvedValueOnce({ rows: [{ id: commentId }] });
    const response = await request("", "POST", { body: "My thoughts", requestId, quotedPostId: id });
    expect(response.status).toBe(201); const sql = query(2).sql;
    expect(sql).toContain("quoted_post_id"); expect(sql).toContain("else 'CAMPUS' end");
    expect(sql).toContain("exists(select 1 from target)"); expect(sql).toContain("for update");
  });
  it("does not use the same request key for two different posts", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id, body: "Previous body", image_url: null, quoted_post_id: null }] });
    expect((await request("", "POST", { body: "New body", requestId })).status).toBe(409);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("retries a confirmed post before consuming another quota token", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id, body: "Same body", image_url: null, quoted_post_id: null }] });
    expect((await request("", "POST", { body: "Same body", requestId })).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("fails clearly when migration is missing, without converting a quote to a plain post", async () => {
    mocks.ready.mockResolvedValue(false);
    expect((await request("", "POST", { body: "My thoughts", requestId, quotedPostId: id })).status).toBe(503);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not report a successful write after a storage failure", async () => {
    mocks.execute.mockRejectedValue(new Error("storage failure"));
    expect((await request(`/${id}/repost`, "DELETE")).status).toBe(500);
  });
  it("rejects bad cursors and preserves microseconds in valid cursors", () => {
    expect(() => parseFeedCursor("bad-cursor")).toThrow();
    expect(() => parseFeedCursor(`2026-09-21T12:00:00Z|${id}|extra`)).toThrow();
    const value = `2026-09-21T12:00:00.654321Z|${id}`;
    expect(parseFeedCursor(value)?.at).toBe("2026-09-21T12:00:00.654321Z");
    expect(nextFeedCursor({ id, cursor_at: "2026-09-21T12:00:00.654321Z" }, "created_at")).toBe(value);
  });
});
