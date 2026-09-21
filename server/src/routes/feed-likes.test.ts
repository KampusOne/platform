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
import { feedLikeRoutes } from "./feed-likes";
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().route("/v1/student/feed", feedLikeRoutes);
app.onError((error, context) => error instanceof AppError
  ? context.json({ error: { code: error.code } }, error.status)
  : context.json({ error: { code: "INTERNAL_ERROR" } }, 500));
const id = "33333333-3333-4333-8333-333333333333";
const headers = { Authorization: "Bearer test-session", "Content-Type": "application/json" };
const env = {} as Bindings;
const dialect = new PgDialect();
beforeEach(() => { mocks.execute.mockReset(); mocks.user.universityId = "22222222-2222-4222-8222-222222222222"; });

describe("post likes", () => {
  it.each(["PUT", "DELETE"])("requires authentication for %s", async (method) => {
    const response = await app.request(`/v1/student/feed/${id}/like`, { method }, env);
    expect(response.status).toBe(401); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires authentication for batched counts", async () => {
    expect((await app.request(`/v1/student/feed/likes?ids=${id}`, {}, env)).status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["PUT", "DELETE"])("rejects malformed post IDs for %s", async (method) => {
    expect((await app.request("/v1/student/feed/bad-id/like", { method, headers }, env)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects incomplete campus profiles", async () => {
    mocks.user.universityId = null;
    expect((await app.request(`/v1/student/feed/${id}/like`, { method: "PUT", headers }, env)).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([["PUT", true], ["DELETE", false]] as const)("%s uses only the authenticated actor and an explicit desired state", async (method, liked) => {
    mocks.execute.mockResolvedValue({ rows: [{ id, liked, like_count: liked ? 1 : 0 }] });
    const response = await app.request(`/v1/student/feed/${id}/like`, { method, headers, body: JSON.stringify({ user_id: "forged", institution_id: "forged" }) }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ id, liked, like_count: liked ? 1 : 0 });
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.params).toEqual([id, mocks.user.id, mocks.user.universityId, liked]);
    expect(query.sql).toContain("app_private.set_feed_post_like");
  });
  it("returns 404 for unavailable posts, not a false success", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    expect((await app.request(`/v1/student/feed/${id}/like`, { method: "PUT", headers }, env)).status).toBe(404);
  });
  it("does not report success when the database fails", async () => {
    mocks.execute.mockRejectedValue(new Error("offline"));
    expect((await app.request(`/v1/student/feed/${id}/like`, { method: "PUT", headers }, env)).status).toBe(500);
  });
  it.each(["", "bad-id", Array(51).fill(id).join(",")])("validates bounded batch IDs before querying: %s", async (ids) => {
    expect((await app.request(`/v1/student/feed/likes?ids=${ids}`, { headers }, env)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("deduplicates a batch and checks publication, time and campus", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id, liked: false, like_count: 0 }] });
    const response = await app.request(`/v1/student/feed/likes?ids=${id},${id}`, { headers }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likes: [{ id, liked: false, like_count: 0 }] });
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.params).toEqual([mocks.user.id, id, mocks.user.universityId]);
    expect(query.sql).toContain("posts.status in ('PUBLISHED', 'CORRECTED')");
    expect(query.sql).toContain("posts.published_at <= now()");
    expect(query.sql).toContain("posts.university_id = $3::uuid");
    expect(query.sql).toContain("posts.audience->>'visibility' = 'PUBLIC'");
  });
});
