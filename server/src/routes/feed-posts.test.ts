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
const headers = { Authorization: "Bearer test-session", "Content-Type": "application/json" };
const env = {} as Bindings;
const dialect = new PgDialect();

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.user.universityId = "22222222-2222-4222-8222-222222222222";
});

describe("post detail and author deletion", () => {
  it.each(["GET", "DELETE"])("requires a session for %s", async (method) => {
    const response = await app.request(`/v1/student/feed/${id}`, { method }, env);
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["GET", "DELETE"])("rejects malformed IDs before database access for %s", async (method) => {
    const response = await app.request("/v1/student/feed/not-a-post", { method, headers }, env);
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("requires a completed campus profile", async () => {
    mocks.user.universityId = null;
    const response = await app.request(`/v1/student/feed/${id}`, { headers }, env);
    expect(response.status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("restricts detail to published posts in the authenticated campus", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id, can_delete: true }] });
    const response = await app.request(`/v1/student/feed/${id}`, { headers }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).post.can_delete).toBe(true);
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.params).toEqual([mocks.user.id, mocks.user.id, id, mocks.user.universityId]);
    expect(query.sql).toContain("posts.status in ('PUBLISHED', 'CORRECTED')");
    expect(query.sql).toContain("posts.published_at <= now()");
    expect(query.sql).toContain("posts.university_id = $4::uuid");
  });
  it("does not expose unavailable or cross-campus post details", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await app.request(`/v1/student/feed/${id}`, { headers }, env);
    expect(response.status).toBe(404);
    expect((await response.json()).post).toBeUndefined();
  });
  it("deletes only the authenticated author's post and removes its bookmarks atomically", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id }] });
    const response = await app.request(`/v1/student/feed/${id}`, {
      method: "DELETE", headers,
      body: JSON.stringify({ author_user_id: "44444444-4444-4444-8444-444444444444", university_id: "forged" }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, deleted: true });
    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.params).toEqual([id, mocks.user.id, mocks.user.universityId]);
    expect(query.sql).toContain("author_user_id = $2::uuid");
    expect(query.sql).toContain("university_id = $3::uuid");
    expect(query.sql).toContain("status = 'ARCHIVED'");
    expect(query.sql).toContain("delete from public.feed_bookmarks");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("does not report success when the author or campus does not match", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    const response = await app.request(`/v1/student/feed/${id}`, { method: "DELETE", headers }, env);
    expect(response.status).toBe(404);
    expect((await response.json()).deleted).toBeUndefined();
  });
  it("allows a safe retry without changing an already archived post's timestamp", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id }] });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.request(`/v1/student/feed/${id}`, { method: "DELETE", headers }, env);
      expect(response.status).toBe(200);
    }
    expect(dialect.sqlToQuery(mocks.execute.mock.calls[1]![0]).sql).toContain("case when status = 'ARCHIVED' then updated_at else now() end");
  });
  it("returns an error instead of false success when storage fails", async () => {
    mocks.execute.mockRejectedValue(new Error("database unavailable"));
    const response = await app.request(`/v1/student/feed/${id}`, { method: "DELETE", headers }, env);
    expect(response.status).toBe(500);
    expect((await response.json()).deleted).toBeUndefined();
  });
});
