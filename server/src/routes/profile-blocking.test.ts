import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  safety: vi.fn(),
  unblocked: vi.fn(),
  relationship: vi.fn(),
  visible: vi.fn(),
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    universityId: "22222222-2222-4222-8222-222222222222",
    sessionFamilyId: "33333333-3333-4333-8333-333333333333",
    roles: ["STUDENT"],
  },
}));

vi.mock("../lib/database", () => ({
  database: () => ({ execute: mocks.execute }),
  sqlClient: vi.fn(),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
vi.mock("../lib/profile-safety", () => ({
  requireProfileSafety: mocks.safety,
  requireUnblocked: mocks.unblocked,
  blockRelationship: mocks.relationship,
  unblockedAuthor: mocks.visible,
}));
vi.mock("../lib/student-ai-policy", () => ({ studentExperienceReady: async () => true }));
vi.mock("../middleware/auth", () => ({
  currentUser: () => mocks.user,
  requireAuth: async (c: Context, next: Next) =>
    c.req.header("Authorization") === "Bearer test-session"
      ? next()
      : c.json({ error: { code: "UNAUTHORIZED" } }, 401),
}));

import { peopleRoutes } from "./people";
import { accountRoutes } from "./account";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
  .route("/v1/people", peopleRoutes)
  .route("/v1/account", accountRoutes);
app.onError((error, c) =>
  error instanceof AppError
    ? c.json({ error: { code: error.code, message: error.message } }, error.status)
    : c.json({ error: { code: "INTERNAL_ERROR", message: error.message } }, 500),
);

const target = "44444444-4444-4444-8444-444444444444";
const env = {} as Bindings;
const headers = { Authorization: "Bearer test-session", "Content-Type": "application/json" };
const dialect = new PgDialect();
const query = (index = 0) => dialect.sqlToQuery(mocks.execute.mock.calls[index]![0]);

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.safety.mockReset();
  mocks.safety.mockResolvedValue(undefined);
  mocks.unblocked.mockReset();
  mocks.unblocked.mockResolvedValue(undefined);
  mocks.relationship.mockReset();
  mocks.relationship.mockResolvedValue("NONE");
  mocks.visible.mockReset();
});

describe("profile blocking routes", () => {
  it("tells the blocked user that the profile owner blocked them", async () => {
    mocks.relationship.mockResolvedValueOnce("BLOCKED_BY_TARGET");
    const response = await app.request(`/v1/people/${target}`, { method: "GET", headers }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "BLOCKED_BY_USER", message: "You have been blocked by this person." },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not expose a profile the viewer has blocked", async () => {
    mocks.relationship.mockResolvedValueOnce("BLOCKED_BY_VIEWER");
    const response = await app.request(`/v1/people/${target}`, { method: "GET", headers }, env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "This student profile is not available." },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("creates a block idempotently and removes both follow directions", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ user_id: target, block_protected: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.request(
      `/v1/people/${target}/block`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ reason: "Spam or misleading content", details: "Repeated spam" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blocked: true });
    expect(query(1).sql).toContain("insert into public.user_blocks");
    expect(query(1).sql).toContain("on conflict(blocker_id,blocked_id)");
    expect(query(2).sql).toContain("delete from public.profile_follows");
    expect(query(2).params).toEqual([mocks.user.id, target, target, mocks.user.id]);
  });

  it("rejects protected profiles without creating a block", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ user_id: target, block_protected: true }] });
    const response = await app.request(
      `/v1/people/${target}/block`,
      { method: "PUT", headers, body: "{}" },
      env,
    );
    expect(response.status).toBe(403);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("unblocks only the authenticated user's relationship", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    const response = await app.request(
      `/v1/people/${target}/block`,
      { method: "DELETE", headers },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blocked: false });
    expect(query().sql).toContain("delete from public.user_blocks");
    expect(query().params).toEqual([mocks.user.id, target]);
  });

  it("lists the authenticated user's blocked accounts for Settings", async () => {
    const profile = {
      user_id: target,
      display_name: "Blocked Student",
      username: "blocked_student",
      profile_image_url: null,
      reason: "Other",
      details: null,
      created_at: "2026-09-27T14:00:00.000Z",
    };
    mocks.execute.mockResolvedValueOnce({ rows: [profile] });
    const response = await app.request("/v1/account/blocked", { method: "GET", headers }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profiles: [profile] });
    expect(query().sql).toContain("from public.user_blocks");
    expect(query().sql).toContain("where blocks.blocker_id=$1::uuid");
    expect(query().params).toEqual([mocks.user.id]);
  });
});
