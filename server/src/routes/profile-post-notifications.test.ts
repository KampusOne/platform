import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ready: vi.fn(),
  unblocked: vi.fn(),
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    universityId: "22222222-2222-4222-8222-222222222222",
    sessionFamilyId: "33333333-3333-4333-8333-333333333333",
    roles: ["STUDENT"],
  },
}));

vi.mock("../lib/database", () => ({
  database: () => ({ execute: mocks.execute }),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
vi.mock("../lib/profile-safety", () => ({
  requireProfileSafety: vi.fn(),
  requireUnblocked: mocks.unblocked,
}));
vi.mock("../lib/student-ai-policy", () => ({ studentExperienceReady: async () => true }));
vi.mock("../services/profile-post-notifications", () => ({
  profilePostNotificationsReady: mocks.ready,
}));
vi.mock("../middleware/auth", () => ({
  currentUser: () => mocks.user,
  requireAuth: async (c: Context, next: Next) =>
    c.req.header("Authorization") === "Bearer test-session"
      ? next()
      : c.json({ error: { code: "UNAUTHORIZED" } }, 401),
}));

import { peopleRoutes } from "./people";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
  .route("/v1/people", peopleRoutes);
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
  mocks.ready.mockReset();
  mocks.ready.mockResolvedValue(true);
  mocks.unblocked.mockReset();
  mocks.unblocked.mockResolvedValue(undefined);
});

describe("profile post notification subscriptions", () => {
  it("turns notifications on idempotently", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ user_id: target }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.request(
      `/v1/people/${target}/notifications`,
      { method: "PUT", headers, body: JSON.stringify({ enabled: true }) },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
    expect(query(1).sql).toContain("insert into public.profile_post_notification_subscriptions");
    expect(query(1).sql).toContain("on conflict(subscriber_id,target_user_id)");
    expect(query(1).params).toEqual([mocks.user.id, target, mocks.user.universityId]);
  });

  it("turns notifications off without touching another subscription", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ user_id: target }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.request(
      `/v1/people/${target}/notifications`,
      { method: "PUT", headers, body: JSON.stringify({ enabled: false }) },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(query(1).sql).toContain("delete from public.profile_post_notification_subscriptions");
    expect(query(1).params).toEqual([mocks.user.id, target]);
  });

  it("projects the saved state when a profile is loaded", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [{
        user_id: target,
        display_name: "Student",
        post_notifications_enabled: true,
      }],
    }).mockResolvedValueOnce({ rows: [] });

    const response = await app.request(`/v1/people/${target}`, { headers }, env);
    expect(response.status).toBe(200);
    expect(query(0).sql).toContain("profile_post_notification_subscriptions");
    expect(query(0).sql).toContain("post_notifications_enabled");
    const payload = await response.json() as { profile: { post_notifications_enabled: boolean } };
    expect(payload.profile.post_notifications_enabled).toBe(true);
  });
});
