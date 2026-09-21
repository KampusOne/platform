import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  user: { id: "11111111-1111-4111-8111-111111111111", universityId: "22222222-2222-4222-8222-222222222222" as string | null },
}));
vi.mock("../lib/database", () => ({ database: () => ({ execute: mocks.execute }), firstRow: (result: { rows: unknown[] }) => result.rows[0] }));
vi.mock("../middleware/auth", () => {
  const requireAuth: MiddlewareHandler = async (context, next) => {
    if (context.req.header("Authorization") !== "Bearer test-session") return context.json({ error: { code: "UNAUTHENTICATED" } }, 401);
    await next();
  };
  return { requireAuth, currentUser: () => mocks.user };
});
import { feedCommentLikeRoutes } from "./feed-comment-likes";
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().route("/v1/student/feed", feedCommentLikeRoutes);
app.onError((error, context) => error instanceof AppError
  ? context.json({ error: { code: error.code } }, error.status)
  : context.json({ error: { code: "INTERNAL_ERROR" } }, 500));
const id = "33333333-3333-4333-8333-333333333333";
const headers = { Authorization: "Bearer test-session", "Content-Type": "application/json" };
const dialect = new PgDialect();
let env: Bindings;
beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValueOnce({ rows: [{ ready: true }] });
  mocks.user.universityId = "22222222-2222-4222-8222-222222222222";
  env = { UNIFIED_SCHEMA_READY: "true" } as Bindings;
});

describe("comment likes", () => {
  it.each(["PUT", "DELETE"])("requires authentication for %s", async (method) => {
    expect((await app.request(`/v1/student/feed/comments/${id}/like`, { method }, env)).status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires authentication for batched counts", async () => {
    expect((await app.request(`/v1/student/feed/comment-likes?ids=${id}`, {}, env)).status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["PUT", "DELETE"])("rejects malformed comment IDs for %s", async (method) => {
    expect((await app.request("/v1/student/feed/comments/bad-id/like", { method, headers }, env)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires a completed campus profile", async () => {
    mocks.user.universityId = null;
    expect((await app.request(`/v1/student/feed/comments/${id}/like`, { method: "PUT", headers }, env)).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([["PUT", true], ["DELETE", false]] as const)("%s uses the session actor and explicit desired state", async (method, liked) => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id, liked, like_count: liked ? 1 : 0 }] });
    const response = await app.request(`/v1/student/feed/comments/${id}/like`, { method, headers, body: JSON.stringify({ user_id: "forged", institution_id: "forged", post_id: "forged" }) }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ id, liked, like_count: liked ? 1 : 0 });
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[1]![0]);
    expect(query.params).toEqual([id, mocks.user.id, mocks.user.universityId, liked]);
    expect(query.sql).toContain("app_private.set_feed_comment_like");
  });
  it("returns 404 for unavailable comments rather than false success", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    expect((await app.request(`/v1/student/feed/comments/${id}/like`, { method: "PUT", headers }, env)).status).toBe(404);
  });
  it("does not report success when a database write fails", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("offline"));
    expect((await app.request(`/v1/student/feed/comments/${id}/like`, { method: "PUT", headers }, env)).status).toBe(500);
  });
  it("returns a recoverable 503 before the additive migration exists", async () => {
    mocks.execute.mockReset().mockResolvedValue({ rows: [{ ready: false }] });
    expect((await app.request(`/v1/student/feed/comments/${id}/like`, { method: "PUT", headers }, env)).status).toBe(503);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("does not query a disabled unified schema", async () => {
    env = { UNIFIED_SCHEMA_READY: "false" } as Bindings;
    expect((await app.request(`/v1/student/feed/comments/${id}/like`, { method: "PUT", headers }, env)).status).toBe(503);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["", "bad-id", Array(51).fill(id).join(",")])("validates bounded batch IDs: %s", async (ids) => {
    expect((await app.request(`/v1/student/feed/comment-likes?ids=${ids}`, { headers }, env)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("deduplicates IDs and enforces comment deletion, post publication and audience", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id, liked: false, like_count: 0 }] });
    const response = await app.request(`/v1/student/feed/comment-likes?ids=${id},${id}`, { headers }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likes: [{ id, liked: false, like_count: 0 }] });
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[1]![0]);
    expect(query.params).toEqual([mocks.user.id, id, mocks.user.universityId]);
    expect(query.sql).toContain("comments.deleted_at is null");
    expect(query.sql).toContain("posts.university_id = comments.institution_id");
    expect(query.sql).toContain("posts.status in ('PUBLISHED', 'CORRECTED')");
    expect(query.sql).toContain("posts.published_at <= now()");
    expect(query.sql).toContain("posts.audience->>'visibility' = 'PUBLIC'");
  });
});
