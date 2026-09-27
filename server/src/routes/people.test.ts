import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const viewerId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ready: vi.fn(),
  user: { id: "11111111-1111-4111-8111-111111111111", universityId: "44444444-4444-4444-8444-444444444444" as string | null },
}));

vi.mock("../lib/database", () => ({
  database: () => ({ execute: mocks.execute }),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
vi.mock("../lib/student-ai-policy", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/student-ai-policy")>(),
  studentExperienceReady: mocks.ready,
}));
vi.mock("../lib/security", () => ({ sha256: async () => "hashed-user" }));
vi.mock("../middleware/auth", () => {
  const requireAuth: MiddlewareHandler = async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer test-session")
      return c.json({ error: { code: "UNAUTHORIZED" } }, 401);
    await next();
  };
  return { requireAuth, currentUser: () => mocks.user };
});

import { peopleRoutes } from "./people";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().route("/v1/people", peopleRoutes);
app.onError((error, c) =>
  error instanceof AppError
    ? c.json({ error: { code: error.code, message: error.message } }, error.status)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);

const env = {} as Bindings;
const headers = { Authorization: "Bearer test-session" };
const dialect = new PgDialect();
const query = (index: number) => dialect.sqlToQuery(mocks.execute.mock.calls[index]![0]);

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.ready.mockReset();
  mocks.ready.mockResolvedValue(true);
});

describe("profile followers and following", () => {
  it("requires authentication", async () => {
    const response = await app.request(`/v1/people/${targetId}/followers`, {}, env);
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns followers in relationship order and exposes a next cursor", async () => {
    const people = Array.from({ length: 41 }, (_, index) => ({
      user_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
      display_name: `Follower ${index + 1}`,
      username: `follower${index + 1}`,
      profile_image_url: null,
      current_level: 200,
      university_name: "University of Benin",
      department_name: "Computer Engineering",
      verified: false,
      cursor_at: `2026-09-27 11:${String(59 - index).padStart(2, "0")}:00+00`,
    }));
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ user_id: targetId }] })
      .mockResolvedValueOnce({ rows: people });

    const response = await app.request(`/v1/people/${targetId}/followers`, { headers }, env);
    const body = await response.json() as { people: Array<Record<string, unknown>>; nextCursor: string | null };

    expect(response.status).toBe(200);
    expect(body.people).toHaveLength(40);
    expect(body.people[0]).not.toHaveProperty("cursor_at");
    expect(body.nextCursor).toBe(`${people[39]!.cursor_at}|${people[39]!.user_id}`);
    expect(query(1).sql).toContain("p.user_id=f.follower_id");
    expect(query(1).sql).toContain("f.followed_id=$1::uuid");
    expect(query(1).sql).toContain("order by f.created_at desc,f.follower_id desc limit 41");
  });

  it("returns accounts the target follows", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ user_id: targetId }] })
      .mockResolvedValueOnce({ rows: [{
        user_id: connectionId,
        display_name: "Joshua",
        username: "joshua",
        profile_image_url: null,
        current_level: 200,
        university_name: "University of Benin",
        department_name: "Computer Engineering",
        verified: true,
        cursor_at: "2026-09-27 11:30:00+00",
      }] });

    const response = await app.request(`/v1/people/${targetId}/following`, { headers }, env);
    const body = await response.json() as { people: Array<{ user_id: string }>; nextCursor: string | null };

    expect(response.status).toBe(200);
    expect(body.people).toEqual([expect.objectContaining({ user_id: connectionId })]);
    expect(body.nextCursor).toBeNull();
    expect(query(1).sql).toContain("p.user_id=f.followed_id");
    expect(query(1).sql).toContain("where f.follower_id=$1::uuid");
    expect(query(1).sql).toContain("order by f.created_at desc,f.followed_id desc limit 41");
  });

  it("uses the relationship timestamp and person id for stable pagination", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ user_id: targetId }] })
      .mockResolvedValueOnce({ rows: [] });

    const cursor = `2026-09-27 11:30:00+00|${connectionId}`;
    const response = await app.request(
      `/v1/people/${targetId}/followers?cursor=${encodeURIComponent(cursor)}`,
      { headers },
      env,
    );

    expect(response.status).toBe(200);
    expect(query(1).sql).toContain("(f.created_at,f.follower_id)<($2::timestamptz,$3::uuid)");
    expect(query(1).params).toEqual([targetId, "2026-09-27 11:30:00+00", connectionId]);
  });

  it("rejects malformed cursors before querying a list page", async () => {
    const response = await app.request(
      `/v1/people/${targetId}/followers?cursor=not-a-cursor`,
      { headers },
      env,
    );
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns 404 when the target profile is unavailable", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    const response = await app.request(`/v1/people/${targetId}/followers`, { headers }, env);
    expect(response.status).toBe(404);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
