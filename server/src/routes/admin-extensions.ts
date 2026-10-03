import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { id, input } from "../lib/input";
import { AppError } from "../lib/errors";
import { resolveAdminScope, adminAccess } from "../lib/admin-access";
import {
  adminWorkspaceReady,
  requireAdminWorkspace,
} from "../lib/admin-workspace";
import { currentUser } from "../middleware/auth";
import { recordAudit } from "../lib/audit";
import { googleAnalyticsReport } from "../lib/google-analytics-reporting";
import type { Bindings, Variables } from "../types";
import { adminReportingRoutes } from "./admin-reporting";
export const adminExtensionRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
adminExtensionRoutes.use("/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});
adminExtensionRoutes.route("/", adminReportingRoutes);
adminExtensionRoutes.post("/users/:id/export", async (c) => {
  const actor = currentUser(c),
    target = id(c.req.param("id")),
    d = await input(
      c,
      z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
    ),
    db = database(c.env);
  const profile = firstRow(
    await db.execute<
      Record<string, unknown> & { university_id: string | null }
    >(
      sql`select u.id,u.email,u.status::text status,u.roles,u.created_at,p.display_name,p.username,p.university_id,p.current_level,p.matriculation_number,p.settings->>'birthDate' birth_date,p.verification_status::text verification_status from public.users u left join public.profiles p on p.user_id=u.id where u.id=${target}::uuid`,
    ),
  );
  if (!profile) throw new AppError(404, "NOT_FOUND", "User not found.");
  const scope = await resolveAdminScope(
    c.env,
    actor,
    profile.university_id ?? undefined,
    "users.view",
  );
  if (scope !== null && scope !== profile.university_id)
    throw new AppError(
      403,
      "FORBIDDEN",
      "This account is outside your university scope.",
    );
  const access = await adminAccess(c.env, actor),
    canSee = (permission: string) =>
      access.grants.some(
        (g) =>
          g.permissions.includes(permission) &&
          (g.university_id === null ||
            g.university_id === profile.university_id),
      );
  const [restrictions, posts, applications, orders] = await Promise.all([
    db.execute(
      sql`select id,kind type,reason,starts_at created_at,ends_at,revoked_at from public.account_restrictions where user_id=${target}::uuid order by starts_at desc limit 10001`,
    ),
    canSee("content.view")
      ? db.execute(
          sql`select id,title,status,created_at from public.feed_posts where author_user_id=${target}::uuid and(${scope}::uuid is null or university_id=${scope}::uuid)order by created_at desc limit 10001`,
        )
      : Promise.resolve({ rows: [] }),
    canSee("agents.view")
      ? db.execute(
          sql`select id,agent_type type,status,kyc_status,submitted_at created_at from public.agent_applications where user_id=${target}::uuid and(${scope}::uuid is null or university_id=${scope}::uuid)order by submitted_at desc limit 10001`,
        )
      : Promise.resolve({ rows: [] }),
    canSee("finance.view")
      ? db.execute(
          sql`select id,status,total_kobo,created_at from public.orders where buyer_user_id=${target}::uuid and(${scope}::uuid is null or university_id=${scope}::uuid)order by created_at desc limit 10001`,
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const rows: Record<string, unknown>[] = [
    { record: "profile", ...profile },
    ...restrictions.rows.map((r) => ({ record: "restriction", ...r })),
    ...posts.rows.map((r) => ({ record: "post", ...r })),
    ...applications.rows.map((r) => ({ record: "application", ...r })),
    ...orders.rows.map((r) => ({ record: "order", ...r })),
  ];
  if (rows.length > 10000)
    throw new AppError(
      409,
      "CONFLICT",
      "This account export exceeds 10,000 records. Export its filtered workspaces instead.",
    );
  await recordAudit(c.env, {
    actorUserId: actor.id,
    universityId: profile.university_id,
    action: "user.csv.exported",
    targetType: "user",
    targetId: target,
    requestId: c.get("requestId"),
    metadata: {
      reason: d.reason,
      rows: rows.length,
      included: [
        "profile",
        "restrictions",
        ...(canSee("content.view") ? ["posts"] : []),
        ...(canSee("agents.view") ? ["applications"] : []),
        ...(canSee("finance.view") ? ["orders"] : []),
      ],
    },
  });
  return c.json({
    filename: `kampusone-account-${target}.csv`,
    columns: [...new Set(rows.flatMap((r) => Object.keys(r)))],
    rows,
    generatedAt: new Date().toISOString(),
  });
});
adminExtensionRoutes.get("/reports/google-analytics", async (c) => {
  const actor = currentUser(c),
    scope = await resolveAdminScope(
      c.env,
      actor,
      c.req.query("universityId"),
      "analytics.view",
    );
  if (scope !== null)
    return c.json({
      state: "scope_limited",
      message:
        "This GA4 property covers the whole platform. Use the recorded activity report for the selected university.",
    });
  const days = z.coerce
    .number()
    .refine((n) => [7, 30, 90].includes(n))
    .safeParse(c.req.query("days") ?? 30);
  if (!days.success)
    throw new AppError(400, "BAD_REQUEST", "Choose 7, 30 or 90 days.");
  const rate = firstRow(
    await database(c.env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('GA4_REPORT',${actor.id},60,3600,3600)allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Report refresh limit reached. Return shortly.",
    );
  return c.json(await googleAnalyticsReport(c.env, days.data));
});
adminExtensionRoutes.get("/documents", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "documents.view",
  );
  if (!(await adminWorkspaceReady(c.env)))
    return c.json({ ready: false, rows: [], nextCursor: null });
  const q = c.req.query("q")?.trim().slice(0, 120),
    cursor = c.req.query("before");
  if (cursor && !/^\d{4}-\d{2}-\d{2}T.*\|[a-f0-9-]{36}$/.test(cursor))
    throw new AppError(400, "BAD_REQUEST", "This document page is not valid.");
  const [beforeTime, beforeId] = cursor?.split("|") ?? [];
  if (
    beforeTime &&
    (!Number.isFinite(Date.parse(beforeTime)) ||
      !z.string().uuid().safeParse(beforeId).success)
  )
    throw new AppError(400, "BAD_REQUEST", "This document page is not valid.");
  const search = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const rows = await database(c.env).execute<{
    id: string;
    created_at: string;
  }>(
    sql`select d.id,d.title,d.collection,d.description,d.media_id,d.institution_id,d.created_at::text,m.original_name,m.size_bytes,m.content_type,coalesce(p.display_name,u.email)created_by_name from app_private.operations_documents d join public.media_objects m on m.id=d.media_id and m.deleted_at is null join public.users u on u.id=d.created_by left join public.profiles p on p.user_id=u.id where d.archived_at is null and(${scope}::uuid is null or d.institution_id=${scope}::uuid)and(${search}::text is null or concat_ws(' ',d.title,d.collection)ilike ${search})and(${beforeTime ?? null}::timestamptz is null or(d.created_at,d.id)<(${beforeTime ?? null}::timestamptz,${beforeId ?? null}::uuid))order by d.created_at desc,d.id desc limit 51`,
  );
  const visible = rows.rows.slice(0, 50),
    last = visible.at(-1);
  return c.json({
    ready: true,
    rows: visible,
    nextCursor:
      rows.rows.length > 50 && last
        ? new Date(last.created_at).toISOString() + "|" + last.id
        : null,
  });
});
adminExtensionRoutes.post("/documents", async (c) => {
  await requireAdminWorkspace(c.env);
  const actor = currentUser(c);
  const d = await input(
    c,
    z
      .object({
        mediaId: z.string().uuid(),
        universityId: z.string().uuid().optional(),
        title: z.string().trim().min(2).max(160),
        collection: z.string().trim().min(2).max(60),
        description: z.string().trim().max(2000).default(""),
      })
      .strict(),
  );
  const scope = await resolveAdminScope(
    c.env,
    actor,
    d.universityId,
    "documents.manage",
  );
  const saved = firstRow(
    await database(c.env).execute<{ id: string }>(
      sql`with stored as(insert into app_private.operations_documents(institution_id,media_id,title,collection,description,created_by)select ${scope}::uuid,m.id,${d.title},${d.collection},${d.description},${actor.id}::uuid from public.media_objects m where m.id=${d.mediaId}::uuid and m.owner_user_id=${actor.id}::uuid and m.institution_id is not distinct from ${scope}::uuid and m.kind='operations-document'and m.deleted_at is null on conflict(media_id)do nothing returning id),logged as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome)select ${actor.id}::uuid,${scope}::uuid,'operations.document.created','operations_document',stored.id::text,${c.get("requestId")},'succeeded'from stored returning target_id)select stored.id from stored join logged on logged.target_id=stored.id::text`,
    ),
  );
  if (!saved) {
    const previous = firstRow(
      await database(c.env).execute<{
        id: string;
        title: string;
        collection: string;
        description: string;
      }>(
        sql`select id,title,collection,description from app_private.operations_documents where media_id=${d.mediaId}::uuid and created_by=${actor.id}::uuid and institution_id is not distinct from ${scope}::uuid and archived_at is null`,
      ),
    );
    if (
      previous &&
      previous.title === d.title &&
      previous.collection === d.collection &&
      previous.description === d.description
    )
      return c.json({ id: previous.id, reused: true });
    throw new AppError(
      409,
      "CONFLICT",
      "Choose your own private operations upload in this university scope.",
    );
  }
  return c.json(saved, 201);
});
adminExtensionRoutes.post("/documents/:id/archive", async (c) => {
  await requireAdminWorkspace(c.env);
  const actor = currentUser(c),
    target = id(c.req.param("id")),
    d = await input(
      c,
      z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
    );
  const doc = firstRow(
    await database(c.env).execute<{ institution_id: string | null }>(
      sql`select institution_id from app_private.operations_documents where id=${target}::uuid`,
    ),
  );
  if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found.");
  const scope = await resolveAdminScope(
    c.env,
    actor,
    doc.institution_id ?? undefined,
    "documents.manage",
  );
  if (scope !== null && scope !== doc.institution_id)
    throw new AppError(
      403,
      "FORBIDDEN",
      "This document is outside your university scope.",
    );
  await database(c.env).execute(
    sql`with archived as(update app_private.operations_documents set archived_at=now(),archived_by=${actor.id}::uuid where id=${target}::uuid and archived_at is null returning id),logged as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)select ${actor.id}::uuid,${doc.institution_id}::uuid,'operations.document.archived','operations_document',id::text,${c.get("requestId")},'succeeded',jsonb_build_object('reason',${d.reason}::text)from archived returning id)select count(*)from logged`,
  );
  return c.json({ status: "archived" });
});
adminExtensionRoutes.get("/blocklists", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "users.view",
  );
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .catch(1)
    .parse(c.req.query("page"));
  const db = database(c.env),
    filter = sql`r.revoked_at is null and(r.ends_at is null or r.ends_at>now())and(${scope}::uuid is null or p.university_id=${scope}::uuid)`;
  const [rows, count] = await Promise.all([
    db.execute(
      sql`select r.id,r.user_id,r.kind,r.reason,r.starts_at,r.ends_at,p.display_name,p.username,u.email,p.university_id institution_id from public.account_restrictions r join public.users u on u.id=r.user_id left join public.profiles p on p.user_id=u.id where ${filter}order by r.starts_at desc,r.id desc limit 50 offset ${(page - 1) * 50}`,
    ),
    db.execute<{ total: number }>(
      sql`select count(*)::int total from public.account_restrictions r left join public.profiles p on p.user_id=r.user_id where ${filter}`,
    ),
  ]);
  return c.json({
    rows: rows.rows,
    total: firstRow(count)?.total ?? 0,
    page,
    pageSize: 50,
  });
});
adminExtensionRoutes.get("/managed-publishers", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "notifications.manage",
  );
  if (!(await adminWorkspaceReady(c.env)))
    return c.json({ ready: false, rows: [] });
  const rows = await database(c.env).execute(
    sql`select m.user_id,m.institution_id,m.all_universities,m.active,m.daily_limit,m.reason,m.updated_at,p.display_name,p.username,u.email,(select count(*)::int from app_private.managed_publisher_posts pp where pp.user_id=m.user_id and(pp.created_at at time zone 'Africa/Lagos')::date=(now()at time zone 'Africa/Lagos')::date)alerts_today from app_private.managed_publishers m join public.users u on u.id=m.user_id left join public.profiles p on p.user_id=m.user_id where(${scope}::uuid is null or(m.institution_id=${scope}::uuid and not m.all_universities))order by m.updated_at desc limit 200`,
  );
  return c.json({ ready: true, rows: rows.rows });
});
adminExtensionRoutes.put("/managed-publishers/:id", async (c) => {
  await requireAdminWorkspace(c.env);
  const actor = currentUser(c),
    target = id(c.req.param("id"));
  const d = await input(
    c,
    z
      .object({
        universityId: z.string().uuid(),
        allUniversities: z.boolean(),
        active: z.boolean(),
        dailyLimit: z.number().int().min(1).max(10),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict(),
  );
  await resolveAdminScope(c.env, actor, d.universityId, "notifications.manage");
  const previous = firstRow(
    await database(c.env).execute<{
      all_universities: boolean;
      institution_id: string;
      updated_at: string;
    }>(
      sql`select all_universities,institution_id,updated_at::text from app_private.managed_publishers where user_id=${target}::uuid`,
    ),
  );
  if (d.allUniversities || previous?.all_universities) {
    const allScope = await resolveAdminScope(
      c.env,
      actor,
      undefined,
      "notifications.manage",
    );
    if (allScope !== null || !actor.operatorRoles.includes("PLATFORM_ADMIN"))
      throw new AppError(
        403,
        "FORBIDDEN",
        "Only a platform administrator can manage an all-university publisher.",
      );
  }
  if (previous)
    await resolveAdminScope(
      c.env,
      actor,
      previous.institution_id,
      "notifications.manage",
    );
  const profile = firstRow(
    await database(c.env).execute(
      sql`select p.user_id from public.profiles p join public.users u on u.id=p.user_id where p.user_id=${target}::uuid and p.university_id=${d.universityId}::uuid and p.deleted_at is null and u.deleted_at is null and u.status::text='ACTIVE'`,
    ),
  );
  if (!profile)
    throw new AppError(
      409,
      "CONFLICT",
      "Choose an active publisher in the selected university.",
    );
  const saved = firstRow(
    await database(c.env).execute<{ count: string }>(
      sql`with saved as(insert into app_private.managed_publishers as publisher(user_id,institution_id,all_universities,active,daily_limit,reviewed_by,reason)values(${target}::uuid,${d.universityId}::uuid,${d.allUniversities},${d.active},${d.dailyLimit},${actor.id}::uuid,${d.reason})on conflict(user_id)do update set institution_id=excluded.institution_id,all_universities=excluded.all_universities,active=excluded.active,daily_limit=excluded.daily_limit,reviewed_by=excluded.reviewed_by,reason=excluded.reason,updated_at=now()where publisher.institution_id is not distinct from ${previous?.institution_id ?? null}::uuid and publisher.all_universities is not distinct from ${previous?.all_universities ?? null}::boolean and publisher.updated_at is not distinct from ${previous?.updated_at ?? null}::timestamptz returning user_id),logged as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)select ${actor.id}::uuid,${d.universityId}::uuid,'publisher.notification-policy.updated','user',user_id::text,${c.get("requestId")},'succeeded',${JSON.stringify(d)}::jsonb from saved returning id)select count(*)from logged`,
    ),
  );
  if (!saved || Number(saved.count) !== 1)
    throw new AppError(
      409,
      "CONFLICT",
      "This policy changed in another session. Refresh before saving.",
    );
  return c.json({ status: "saved" });
});
