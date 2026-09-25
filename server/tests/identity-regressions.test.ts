import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Hono } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter } from "./helpers/database";
import { authRoutes } from "../src/routes/auth";
import { socialAuthRoutes } from "../src/routes/social-auth";
import { createSession, rotateSession } from "../src/services/sessions";
import { resolveSupabaseIdentity } from "../src/services/supabase-identity";
import { requireAuth } from "../src/middleware/auth";
import { AppError } from "../src/lib/errors";
import type { Bindings, Variables } from "../src/types";
let db: PGlite;
const sendMail = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
vi.mock("../src/lib/email", () => ({
  requireEmailProvider: () => {},
  sendMail,
}));
const env = {
  ENVIRONMENT: "production",
  UNIFIED_SCHEMA_READY: "true",
  PHASE_2_SCHEMA_READY: "true",
  ALLOWED_ORIGINS: "https://preview.vercel.app,https://app.kampusone.app",
  COOKIE_DOMAIN: ".kampusone.app",
  JWT_SECRET: "test-only-signing-secret-not-for-production-1234",
  OTP_PEPPER: "test-only-otp-pepper-not-for-production-1234",
  SUPABASE_URL: "https://identity.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "test-only-public-key",
} as Bindings;
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.route("/v1/auth", authRoutes);
app.route("/v1/auth/social", socialAuthRoutes);
app.get("/private", requireAuth, (c) => c.json({ id: c.get("user")?.id }));
app.onError((e, c) =>
  e instanceof AppError
    ? c.json({ error: { code: e.code, message: e.message } }, e.status)
    : c.json({ error: { message: e.message } }, 500),
);
const person = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "returning@example.invalid",
  roles: ["STUDENT"],
  operatorRoles: [],
  universityId: null,
};
function request(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return app.request(
    "https://worker.example.invalid" + path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    },
    env,
  );
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "insert into public.users(id,email,password_hash,email_verified_at,updated_at) values($1,$2,'test-only',now(),now())",
    [person.id, person.email],
  );
}, 60000);
afterEach(() => {
  vi.unstubAllGlobals();
  sendMail.mockReset();
});
afterAll(async () => {
  await db?.close();
});
describe("requirements 87–92: persistent sessions and security", () => {
  it("restores a preview cookie when production COOKIE_DOMAIN is configured", async () => {
    const first = await createSession(env, person);
    const r = await request(
      "/v1/auth/refresh",
      {},
      {
        Origin: "https://preview.vercel.app",
        Cookie: `k1_refresh=${first.refreshToken}`,
      },
    );
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=2592000");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const next = await r.json();
    expect(next.user.id).toBe(person.id);
    expect(next.refreshToken).not.toBe(first.refreshToken);
  });
  it("keeps configured cookie domain for an owned domain", async () => {
    const first = await createSession(env, person);
    const r = await request(
      "/v1/auth/refresh",
      {},
      {
        Origin: "https://app.kampusone.app",
        Cookie: `k1_refresh=${first.refreshToken}`,
      },
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("Domain=.kampusone.app");
  });
  it("rejects foreign/missing cookie origins before rotating", async () => {
    const first = await createSession(env, person);
    for (const origin of ["https://attacker.invalid", null]) {
      const r = await request(
        "/v1/auth/refresh",
        {},
        {
          ...(origin ? { Origin: origin } : {}),
          Cookie: `k1_refresh=${first.refreshToken}`,
        },
      );
      expect(r.status).toBe(403);
    }
    expect((await rotateSession(env, first.refreshToken)).user.id).toBe(
      person.id,
    );
  });
  it("supports native secure-storage refresh without browser cookies", async () => {
    const first = await createSession(env, person);
    expect(
      (await request("/v1/auth/refresh", { refreshToken: first.refreshToken }))
        .status,
    ).toBe(200);
  });
  it("revokes access and refresh tokens on logout", async () => {
    const first = await createSession(env, person);
    expect(
      (await request("/v1/auth/logout", { refreshToken: first.refreshToken }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request(
          "https://worker.example.invalid/private",
          { headers: { Authorization: `Bearer ${first.accessToken}` } },
          env,
        )
      ).status,
    ).toBe(401);
    await expect(rotateSession(env, first.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("still detects replay of consumed refresh token", async () => {
    const first = await createSession(env, person);
    const next = await rotateSession(env, first.refreshToken);
    await expect(rotateSession(env, first.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
    await expect(rotateSession(env, next.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("reports email delivery failure instead of claiming a code was sent", async () => {
    sendMail.mockRejectedValueOnce(
      new AppError(
        503,
        "PROVIDER_UNAVAILABLE",
        "Email temporarily unavailable.",
      ),
    );
    const r = await request("/v1/auth/email-code/request", {
      email: person.email,
    });
    expect(await r.json()).toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
    expect(r.status).toBe(503);
    expect(sendMail).toHaveBeenCalledOnce();
  });
});
function provider(
  id: string,
  email: string,
  metadata: Record<string, unknown> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          id,
          email,
          email_confirmed_at: new Date().toISOString(),
          user_metadata: metadata,
        }),
      ),
  );
}
describe("requirements 90–92 / 171: Supabase identity bridge", () => {
  it("returns actual provider flags instead of claiming both providers work", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            external: { google: true, apple: false, email: true },
          }),
        ),
    );
    const r = await app.request(
      "https://worker.example.invalid/v1/auth/social/config",
      {},
      env,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      url: env.SUPABASE_URL,
      providers: ["google"],
    });
  });
  it("creates one identity, derives full name, and ignores metadata roles", async () => {
    const id = "90000000-0000-4000-8000-000000000002";
    provider(id, "new@example.invalid", {
      full_name: "Ada Test",
      roles: ["PLATFORM_ADMIN"],
    });
    const first = await resolveSupabaseIdentity(env, "test-token");
    provider(id, "new@example.invalid");
    const second = await resolveSupabaseIdentity(env, "test-token");
    expect(first.id).toBe(second.id);
    expect(first.operatorRoles).toEqual([]);
    expect(first.roles).not.toContain("PLATFORM_ADMIN");
    expect(
      (
        await db.query(
          "select first_name,last_name,university_id from public.profiles where user_id=$1",
          [first.id],
        )
      ).rows,
    ).toEqual([{ first_name: "Ada", last_name: "Test", university_id: null }]);
  });
  it("invalidates an unverified registration password when owner claims verified OAuth", async () => {
    const id = "90000000-0000-4000-8000-000000000003";
    await db.query(
      "insert into public.users(id,email,password_hash,updated_at) values($1,'unverified@example.invalid','untrusted-old-password',now())",
      [id],
    );
    provider(
      "90000000-0000-4000-8000-000000000013",
      "unverified@example.invalid",
    );
    expect((await resolveSupabaseIdentity(env, "test-token")).id).toBe(id);
    expect(
      (
        await db.query("select password_hash from public.users where id=$1", [
          id,
        ])
      ).rows[0],
    ).toEqual({ password_hash: "!provider-auth-only" });
  });
  it("does not silently link a provisioned staff identity by email", async () => {
    await db.query(
      "insert into app_private.staff_access(user_id,status,all_universities,updated_by) values($1,'ACTIVE',true,$1)",
      [person.id],
    );
    provider("90000000-0000-4000-8000-000000000004", person.email);
    await expect(
      resolveSupabaseIdentity(env, "test-token"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires provider-confirmed email", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            id: "90000000-0000-4000-8000-000000000005",
            email: person.email,
            email_confirmed_at: null,
          }),
        ),
    );
    await expect(
      resolveSupabaseIdentity(env, "test-token"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
