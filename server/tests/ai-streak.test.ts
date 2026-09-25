import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Hono } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import type { Bindings, Variables } from "../src/types";
import { aiRoutes } from "../src/routes/ai";
import { accountRoutes } from "../src/routes/account";
import { AppError } from "../src/lib/errors";
import { pdfFixture } from "./helpers/pdf";
let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
vi.mock("../src/middleware/auth", () => ({
  requireAuth: async (
    c: {
      req: { header: (name: string) => string };
      set: (name: string, value: unknown) => void;
    },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: c.req.header("X-Test-User"), roles: ["STUDENT"] });
    await next();
  },
  currentUser: (c: { get: (name: string) => unknown }) => c.get("user"),
}));
const user = "11000000-0000-4000-8000-000000000001",
  other = "11000000-0000-4000-8000-000000000002";
const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "",
  MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "false",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "true",
  UNIFIED_SCHEMA_READY: "true",
  HF_TOKEN: "test-only",
  HF_CHAT_MODEL: "test-model",
  HF_VISION_MODEL: "test/vision",
  AI_DAILY_USER_LIMIT: "5",
  AI_DAILY_GLOBAL_LIMIT: "100",
};
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.route("/ai", aiRoutes);
app.route("/account", accountRoutes);
app.onError((e, c) =>
  e instanceof AppError
    ? c.json({ error: { message: e.message, details: e.details } }, e.status)
    : c.json({ error: { message: e.message } }, 500),
);
function request(
  path: string,
  method = "GET",
  body?: unknown,
  actor = user,
  overrides: Partial<Bindings> = {},
) {
  return app.request(
    "https://example.invalid" + path,
    {
      method,
      headers: { "X-Test-User": actor, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...env, ...overrides },
  );
}
function draft(overrides: Record<string, unknown> = {}) {
  return {
    mode: "study",
    prompt: "Explain capacitors",
    consent: true,
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}
async function data(response: Response, status = 200) {
  const result = await response.json();
  expect({
    status: response.status,
    ...(response.status === status ? {} : { result }),
  }).toEqual({ status });
  return result as any;
}
const gemini = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [{ text: "Capacitors store energy in an electric field." }],
        },
      },
    ],
  });
beforeAll(async () => {
  db = await createTestDatabase();
  for (const id of [user, other])
    await db.query(
      "insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",
      [id, id + "@example.invalid"],
    );
}, 60000);
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.exec(
    "truncate app_private.ai_study_sessions,app_private.ai_requests,app_private.ai_daily_usage,public.streak_activity_days,public.user_streaks",
  );
});
afterAll(async () => {
  await db?.close();
});

describe("IDs 121–126: authentic streak data", () => {
  it("refresh never earns activity; concurrent check-ins earn one Lagos day", async () => {
    const initial = await data(await request("/account/streak"));
    expect(initial.streak).toEqual({
      current_days: 0,
      longest_days: 0,
      goal_days: 7,
      last_day: null,
    });
    expect(initial.activityDays).toEqual([]);
    await data(await request("/account/streak"));
    expect(
      (await db.query("select * from public.user_streaks")).rows,
    ).toHaveLength(0);
    await Promise.all([
      request("/account/streak/check-in", "POST"),
      request("/account/streak/check-in", "POST"),
    ]);
    const checked = await data(await request("/account/streak"));
    expect(checked.streak.current_days).toBe(1);
    expect(checked.streak.longest_days).toBe(1);
    expect(checked.activityDays).toEqual([checked.today]);
    expect(checked.timezone).toBe("Africa/Lagos");
    expect(
      (await data(await request("/account/streak", "GET", undefined, other)))
        .activityDays,
    ).toEqual([]);
  });
  it("expires missed days while retaining personal best; saves goal before first check-in", async () => {
    await data(await request("/account/streak", "PATCH", { goalDays: 14 }));
    expect(
      (await data(await request("/account/streak"))).streak.goal_days,
    ).toBe(14);
    await db.query(
      "update public.user_streaks set current_days=9,longest_days=12,last_day=(now() at time zone 'Africa/Lagos')::date-2 where user_id=$1",
      [user],
    );
    const loaded = await data(await request("/account/streak"));
    expect(loaded.streak.current_days).toBe(0);
    expect(loaded.streak.longest_days).toBe(12);
    expect(loaded.activityDays).toEqual([]);
    expect(
      (await data(await request("/account/streak", "POST"))).streak
        .current_days,
    ).toBe(1);
  });
});
// The superseded Gemini route assertions are replaced by ai-study-provider.test.ts,
// ai-study-adapter.test.ts, ai-document.test.ts and schedule-document.test.ts.
