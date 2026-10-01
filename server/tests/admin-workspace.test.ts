import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import { app } from "../src/app";
import { createSession } from "../src/services/sessions";
import { verifyPassword } from "../src/lib/security";
import type { Bindings } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
const campus = crypto.randomUUID(),
  otherCampus = crypto.randomUUID(),
  admin = crypto.randomUUID(),
  staff = crypto.randomUUID(),
  ordinary = crypto.randomUUID(),
  foreign = crypto.randomUUID(),
  documentId = crypto.randomUUID(),
  foreignFile = crypto.randomUUID();
const tokens = new Map<string, string>();
const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "https://portal.example.invalid",
  MINIMUM_APP_VERSION: "1",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
  UNIFIED_SCHEMA_READY: "true",
  PHASE_2_SCHEMA_READY: "true",
  JWT_SECRET: "test-only-admin-jwt-secret-123456789012345678",
};
async function request(
  path: string,
  actor = admin,
  method = "GET",
  body?: unknown,
  bindings: Bindings = env,
) {
  return app.request(
    "https://api.example.invalid/v1" + path,
    {
      method,
      headers: {
        Authorization: "Bearer " + tokens.get(actor),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings,
  );
}
async function result(r: Response, status = 200) {
  const data = await r.json();
  expect({
    status: r.status,
    ...(r.status === status ? {} : { data }),
  }).toEqual({ status });
  return data;
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(
    readFileSync(
      new URL(
        "../../database/neon/migrations/20261001020000_admin_workspace_extensions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const [i, id] of [campus, otherCampus].entries())
    await db.query(
      "insert into public.universities(id,name,slug,updated_at)values($1,$2,$3,now())",
      [id, "Workspace campus " + i, "workspace-" + i],
    );
  for (const [i, id] of [admin, staff, ordinary, foreign].entries()) {
    const university = id === foreign ? otherCampus : campus;
    await db.query(
      "insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,$2,'test-only',now(),now())",
      [id, `workspace${i}@example.invalid`],
    );
    await db.query(
      "insert into public.profiles(id,user_id,display_name,username,university_id,updated_at)values(gen_random_uuid(),$1,$2,$3,$4,now())",
      [id, "Workspace " + i, "workspace" + i, university],
    );
    tokens.set(
      id,
      (
        await createSession(env, {
          id,
          email: `workspace${i}@example.invalid`,
          roles: ["STUDENT"],
          operatorRoles: [],
          universityId: university,
        })
      ).accessToken,
    );
  }
  await db.query(
    "insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')",
    [admin],
  );
  await db.query(
    "insert into app_private.staff_access(user_id,permissions,university_ids,all_universities,updated_by)values($1,$2,$3,false,$4)",
    [
      staff,
      [
        "overview.view",
        "users.view",
        "analytics.view",
        "documents.view",
        "documents.manage",
        "notifications.manage",
        "staff.manage",
      ],
      [campus],
      admin,
    ],
  );
  for (const [id, owner, school] of [
    [documentId, staff, campus],
    [foreignFile, foreign, otherCampus],
  ])
    await db.query(
      "insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'operations-document',$4,'application/pdf',100,'operations.pdf')",
      [id, owner, school, `test-private/${id}`],
    );
});
afterAll(async () => {
  await db?.close();
});
describe("admin workspace controls", () => {
  it("reports a pending database update without inventing empty activity or failing a schema query", async () => {
    const pendingEnv = { ...env };
    await db.exec(
      "begin; alter table public.product_events rename to product_events_before_update;",
    );
    try {
      const report = await result(
        await request(
          "/admin/reports/engagement",
          staff,
          "GET",
          undefined,
          pendingEnv,
        ),
      );
      expect(report).toMatchObject({ ready: false });
      expect(report).not.toHaveProperty("totals");
      const workspace = await result(
        await request(
          "/admin/workspaces/analytics",
          staff,
          "GET",
          undefined,
          pendingEnv,
        ),
      );
      expect(workspace).toMatchObject({ ready: false, rows: [] });
      expect(workspace).not.toHaveProperty("total");
      expect(
        await result(
          await request(
            "/student/events",
            ordinary,
            "POST",
            {
              requestId: crypto.randomUUID(),
              event: "screen_view",
              screen: "feed",
              platform: "android",
            },
            pendingEnv,
          ),
          202,
        ),
      ).toEqual({ status: "not_connected" });
      await result(
        await request(
          "/admin/workspaces/analytics/export",
          staff,
          "POST",
          { reason: "Reviewed operational export" },
          pendingEnv,
        ),
        503,
      );
    } finally {
      await db.exec("rollback");
    }
  });
  it("creates an individual staff login exactly once, without leaking the password", async () => {
    const body = {
      requestId: crypto.randomUUID(),
      email: "NewStaff@example.invalid",
      password: "C@mpus-test-only-5419",
      displayName: "New team member",
      permissions: ["overview.view", "support.view"],
      universityIds: [campus],
      allUniversities: false,
      reason: "Provision a campus support account",
    };
    const [one, two] = await Promise.all([
      request("/admin/staff", admin, "POST", body),
      request("/admin/staff", admin, "POST", body),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    const a = await one.json(),
      b = await two.json();
    expect(a.id).toBe(b.id);
    expect(a.email).toBe("newstaff@example.invalid");
    expect(JSON.stringify(a)).not.toContain(body.password);
    const saved = (
      await db.query<{ password_hash: string; roles: string[] }>(
        "select password_hash,roles::text[] roles from public.users where id=$1",
        [a.id],
      )
    ).rows[0]!;
    expect(await verifyPassword(body.password, saved.password_hash)).toBe(true);
    expect(saved.roles).toEqual([]);
    const audit = (
      await db.query<{ metadata: unknown }>(
        "select metadata from app_private.audit_events where action='staff.account.created'and target_id=$1",
        [a.id],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(body.password);
    const login = await result(
      await app.request(
        "https://api.example.invalid/v1/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: a.email,
            password: body.password,
            deviceLabel: "Test staff",
          }),
        },
        env,
      ),
    );
    tokens.set(a.id, login.accessToken);
    expect(
      (await result(await request("/admin/access", a.id))).permissions,
    ).toEqual(["overview.view", "support.view"]);
    await result(
      await request("/admin/staff", admin, "POST", {
        ...body,
        password: body.password + "changed",
      }),
      409,
    );
    await result(
      await request("/admin/staff", staff, "POST", {
        ...body,
        requestId: crypto.randomUUID(),
        email: "escalation@example.invalid",
      }),
      403,
    );
    await result(await request("/admin/staff", staff), 403);
    await result(
      await request("/admin/staff", admin, "POST", {
        ...body,
        requestId: crypto.randomUUID(),
      }),
      409,
    );
    expect(
      await verifyPassword(
        body.password,
        (
          await db.query<{ password_hash: string }>(
            "select password_hash from public.users where id=$1",
            [a.id],
          )
        ).rows[0]!.password_hash,
      ),
    ).toBe(true);
  });
  it("keeps private document registration, listing and signed access inside current staff scope", async () => {
    const body = {
      mediaId: documentId,
      universityId: campus,
      title: "Operations notes",
      collection: "Internal",
      description: "Reviewed team notes",
    };
    const saved = await result(
      await request("/admin/documents", staff, "POST", body),
      201,
    );
    expect(
      (await result(await request("/admin/documents", staff, "POST", body))).id,
    ).toBe(saved.id);
    await result(
      await request("/admin/documents", staff, "POST", {
        ...body,
        mediaId: foreignFile,
        universityId: otherCampus,
      }),
      403,
    );
    const list = await request("/admin/documents", staff);
    expect(list.headers.get("Cache-Control")).toContain("no-store");
    const records = await result(list);
    expect(records.rows).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("test-private/");
    await result(
      await request("/admin/documents?universityId=" + otherCampus, staff),
      403,
    );
    await result(
      await request(`/media/${documentId}/access`, ordinary, "POST", {}),
      403,
    );
    const access = await result(
      await request(`/media/${documentId}/access`, staff, "POST", {}),
    );
    expect(access.expiresIn).toBe(90);
    await db.query(
      "update app_private.staff_access set status='SUSPENDED'where user_id=$1",
      [staff],
    );
    await result(await app.request(access.url, {}, env), 403);
    await db.query(
      "update app_private.staff_access set status='ACTIVE'where user_id=$1",
      [staff],
    );
    await result(
      await request(`/admin/documents/${saved.id}/archive`, staff, "POST", {
        reason: "Retain the source and archive superseded notes",
      }),
    );
    await result(
      await request(`/media/${documentId}/access`, staff, "POST", {}),
      404,
    );
    expect(
      (await result(await request("/admin/documents", staff))).rows,
    ).toHaveLength(0);
  });
  it("reports only recorded platforms, actions and scroll milestones in the authorized campus", async () => {
    const send = (actor: string, platform: string, event: string, extra = {}) =>
      request("/student/events", actor, "POST", {
        requestId: crypto.randomUUID(),
        event,
        platform,
        screen: "feed",
        ...extra,
      });
    await result(await send(ordinary, "android", "screen_view"), 202);
    await result(
      await send(ordinary, "ios", "ui_interaction", {
        action: "like_post",
        component: "post",
      }),
      202,
    );
    await result(
      await send(ordinary, "web", "scroll_depth", { percentScrolled: 50 }),
      202,
    );
    await result(await send(foreign, "android", "screen_view"), 202);
    await result(
      await send(ordinary, "web", "scroll_depth", { percentScrolled: 49 }),
      400,
    );
    await result(
      await send(ordinary, "web", "ui_interaction", {
        action: "typed secret email @example.invalid",
      }),
      400,
    );
    const report = await result(
      await request("/admin/reports/engagement?days=7", staff),
    );
    expect(report.totals.events).toBe(3);
    expect(report.totals.active_users).toBe(1);
    expect(
      report.platforms.map((r: { platform: string }) => r.platform),
    ).toEqual(["android", "ios", "web"]);
    expect(report.interactions).toHaveLength(2);
    expect(
      (
        await result(
          await request("/admin/reports/engagement?platform=ios", staff),
        )
      ).totals.events,
    ).toBe(1);
    await result(
      await request(
        "/admin/reports/engagement?universityId=" + otherCampus,
        staff,
      ),
      403,
    );
    const overview = await result(await request("/admin/dashboard", staff));
    expect(overview.metrics.revenue).toBeNull();
    expect(overview.revenueTrend).toBeNull();
    expect(overview.queues.applications).toEqual([]);
  });
  it("exports complete bounded scope with an audited purpose and no credential fields", async () => {
    const data = await result(
      await request("/admin/workspaces/users/export", staff, "POST", {
        reason: "Export the campus account list for operations",
      }),
    );
    expect(data.rows.some((r: { id: string }) => r.id === foreign)).toBe(false);
    expect(data.columns).not.toContain("password_hash");
    expect(data.rows.some((r: { id: string }) => r.id === ordinary)).toBe(true);
    await result(
      await request(
        "/admin/workspaces/users/export?universityId=" + otherCampus,
        staff,
        "POST",
        { reason: "Try another campus export" },
      ),
      403,
    );
    await result(
      await request("/admin/workspaces/users/export", staff, "POST", {
        reason: "short",
      }),
      400,
    );
    const profile = await result(
      await request(`/admin/users/${ordinary}/export`, staff, "POST", {
        reason: "Review the specific account data for support",
      }),
    );
    expect(profile.rows[0].record).toBe("profile");
    expect(
      profile.rows.every(
        (r: { record: string }) =>
          !["order", "application", "post"].includes(r.record),
      ),
    ).toBe(true);
    expect(JSON.stringify(profile)).not.toContain("password_hash");
    await result(
      await request(`/admin/users/${foreign}/export`, staff, "POST", {
        reason: "Try a foreign user data export",
      }),
      403,
    );
    expect(
      (
        await db.query(
          "select id from app_private.audit_events where action in('workspace.csv.exported','user.csv.exported')",
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("controls publisher policy by immutable account ID and prevents scoped staff from global changes", async () => {
    const body = {
      universityId: campus,
      allUniversities: false,
      active: true,
      dailyLimit: 4,
      reason: "Reviewed student campus update publisher",
    };
    await result(
      await request(
        `/admin/managed-publishers/${ordinary}`,
        staff,
        "PUT",
        body,
      ),
    );
    await result(
      await request(`/admin/managed-publishers/${ordinary}`, staff, "PUT", {
        ...body,
        allUniversities: true,
      }),
      403,
    );
    await result(
      await request(`/admin/managed-publishers/${foreign}`, staff, "PUT", {
        ...body,
        universityId: otherCampus,
      }),
      403,
    );
    await result(
      await request(`/admin/managed-publishers/${ordinary}`, admin, "PUT", {
        ...body,
        allUniversities: true,
      }),
    );
    await result(
      await request(`/admin/managed-publishers/${ordinary}`, staff, "PUT", {
        ...body,
        active: false,
      }),
      403,
    );
    expect(
      (await result(await request("/admin/managed-publishers", staff))).rows,
    ).toHaveLength(0);
    const paused = await result(
      await request("/admin/reports/google-analytics", admin),
    );
    expect(paused.state).toBe("paused");
    const scoped = await result(
      await request("/admin/reports/google-analytics", staff),
    );
    expect(scoped.state).toBe("scope_limited");
  });
});
