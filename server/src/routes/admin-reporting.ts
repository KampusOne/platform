import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { adminAccess, resolveAdminScope } from "../lib/admin-access";
import { AppError } from "../lib/errors";
import { input } from "../lib/input";
import { currentUser } from "../middleware/auth";
import { adminReportingReady, financeReport, lagosDay, reportWindow, saveDailyReport, type DailyAppReport } from "../lib/admin-reporting";
import type { Bindings, Variables } from "../types";

export const adminReportingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const pending = { ready: false as const, message: "Daily reports and the expense ledger await the database update." };
type ReportingContext = Context<{ Bindings: Bindings; Variables: Variables }>;
async function permittedFinance(c: ReportingContext, scope: string | null) {
  const access = await adminAccess(c.env, currentUser(c));
  return access.grants.some(g => g.permissions.includes("finance.view") && (g.university_id === null || g.university_id === scope));
}

adminReportingRoutes.get("/reports/daily", async c => {
  const scope = await resolveAdminScope(c.env, currentUser(c), c.req.query("universityId"), "analytics.view");
  const { day } = reportWindow(c.req.query("date"));
  if (!(await adminReportingReady(c.env))) return c.json(pending);
  const latest = firstRow(await database(c.env).execute<{ report: DailyAppReport }>(sql`select report from app_private.daily_app_reports where scope_key=${scope ?? "all"} and day=${day}::date`));
  // Today remains live. Recent history is refreshed by cron for late samples.
  const report = day === lagosDay() || c.req.query("refresh") === "true" || !latest ? await saveDailyReport(c.env, scope, day) : latest.report;
  const available = await database(c.env).execute<{ day: string }>(sql`select day::text from app_private.daily_app_reports where scope_key=${scope ?? "all"} order by day desc limit 366`);
  return c.json({ ready: true, report: { ...report, finance: await permittedFinance(c, scope) ? report.finance : null }, availableDays: available.rows.map(r => r.day) });
});

adminReportingRoutes.get("/reports/workspace", async c => {
  const scope = await resolveAdminScope(c.env, currentUser(c), c.req.query("universityId"), "analytics.view");
  const parsed = z.enum(["users", "agents", "content", "marketplace", "messages", "campaigns"]).safeParse(c.req.query("module"));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a reporting workspace.");
  const module = parsed.data, db = database(c.env);
  const sources = {
    users: sql`select u.status::text category,u.created_at occurred_at,p.university_id institution_id from public.users u left join public.profiles p on p.user_id=u.id where u.deleted_at is null`,
    agents: sql`select status::text category,submitted_at occurred_at,university_id institution_id from public.agent_applications`,
    content: sql`select category,created_at occurred_at,university_id institution_id from public.feed_posts`,
    marketplace: sql`select status category,created_at occurred_at,university_id institution_id from public.vendor_products`,
    messages: sql`select case when media.content_type like 'audio/%'then 'Voice notes'when media.content_type like 'image/%'then 'Photos'when media.content_type like 'video/%'then 'Videos'when m.media_id is not null then 'Documents'else 'Text' end category,m.created_at occurred_at,t.institution_id from public.direct_messages m join public.direct_threads t on t.id=m.thread_id left join public.media_objects media on media.id=m.media_id`,
    campaigns: sql`select status category,created_at occurred_at,institution_id from app_private.email_recipients where not is_test and status<>'PREVIEW'`,
  };
  const required = module === "messages" ? "public.direct_messages" : module === "campaigns" ? "app_private.email_recipients" : null;
  if (required && !firstRow(await db.execute<{ ready: boolean }>(sql`select to_regclass(${required})is not null ready`))?.ready) return c.json({ ready: false, message: "This workspace awaits its database update." });
  const start = reportWindow(lagosDay(new Date(Date.now() - 29 * 86400000))).start;
  const [categories, daily] = await Promise.all([
    db.execute<{ label: string; value: number }>(sql`with records as(${sources[module]}) select category label,count(*)::int value from records where(${scope}::uuid is null or institution_id=${scope}::uuid)and occurred_at>=${start}::timestamptz group by category order by value desc`),
    db.execute<{ day: string; active_users: number; events: number }>(sql`with records as(${sources[module]}),days as(select generate_series(${start}::timestamptz,now(),interval '1 day')stamp)select (days.stamp at time zone 'Africa/Lagos')::date::text as "day",count(records.occurred_at)::int active_users,count(records.occurred_at)::int events from days left join records on(records.occurred_at at time zone 'Africa/Lagos')::date=(days.stamp at time zone 'Africa/Lagos')::date and(${scope}::uuid is null or records.institution_id=${scope}::uuid)group by days.stamp order by days.stamp`),
  ]);
  return c.json({ ready: true, module, categories: categories.rows, daily: daily.rows, generatedAt: new Date().toISOString(), definition: module === "campaigns" ? "Current delivery states for campaign recipients queued in the last 30 days; provider acceptance and confirmed delivery are separate." : "Stored records created during the last 30 days in this university scope. Message contents are excluded." });
});

adminReportingRoutes.get("/finance/reporting", async c => {
  const scope = await resolveAdminScope(c.env, currentUser(c), c.req.query("universityId"), "finance.view");
  if (!(await adminReportingReady(c.env))) return c.json(pending);
  const [summary, expenses] = await Promise.all([
    financeReport(c.env, scope),
    database(c.env).execute(sql`select id,institution_id,category,description,amount_kobo::text,incurred_on::text,recorded_at::text from app_private.operations_expenses where(${scope}::uuid is null or institution_id=${scope}::uuid)order by incurred_on desc,recorded_at desc limit 200`),
  ]);
  return c.json({ ready: true, summary, expenses: expenses.rows, generatedAt: new Date().toISOString() });
});
adminReportingRoutes.post("/finance/reporting/expenses", async c => {
  const d = await input(c, z.object({ requestId: z.string().uuid(), universityId: z.string().uuid(), category: z.enum(["Hosting", "Marketing", "Transport", "Equipment", "Staff", "Other"]), description: z.string().trim().min(3).max(1000), amountKobo: z.number().int().min(1).max(200000000000), incurredOn: z.string() }).strict());
  const actor = currentUser(c), scope = await resolveAdminScope(c.env, actor, d.universityId, "finance.review");
  reportWindow(d.incurredOn);
  if (!(await adminReportingReady(c.env))) throw new AppError(503, "PROVIDER_UNAVAILABLE", pending.message);
  try {
    const row = firstRow(await database(c.env).execute(sql`select id,journal_id,amount_kobo::text from app_private.record_operations_expense(${actor.id}::uuid,${d.requestId}::uuid,${scope}::uuid,${d.category},${d.description},${d.amountKobo}::bigint,${d.incurredOn}::date)`));
    return c.json(row, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes("EXPENSE_REQUEST_CONFLICT")) throw new AppError(409, "CONFLICT", "This expense request already recorded different details. Refresh and use a new entry.");
    throw e;
  }
});

async function achievedMilestones(c: ReportingContext, scope: string | null) {
  const users = Number(firstRow(await database(c.env).execute<{ total: number }>(sql`select count(*)::int total from public.users u left join public.profiles p on p.user_id=u.id where u.deleted_at is null and(${scope}::uuid is null or p.university_id=${scope}::uuid)`))?.total ?? 0);
  const milestones = [50, 100, 500, 1000].filter(n => users >= n).map(n => ({ key: `signups_${n}`, label: `${n.toLocaleString()} accounts joined KampusOne`, value: n, kind: "signups" }));
  if (await permittedFinance(c, scope)) {
    const revenue = (await financeReport(c.env, scope)).platform_revenue_kobo;
    for (const n of [10000000, 50000000, 100000000]) if (revenue >= n) milestones.push({ key: `revenue_${n}`, label: `₦${(n / 100).toLocaleString()} in recorded platform revenue`, value: n, kind: "revenue" });
  }
  return milestones;
}
adminReportingRoutes.get("/reports/milestones", async c => {
  const actor = currentUser(c), scope = await resolveAdminScope(c.env, actor, c.req.query("universityId"), "analytics.view");
  if (!(await adminReportingReady(c.env))) return c.json({ ready: false, milestones: [] });
  const [achieved, acknowledged] = await Promise.all([achievedMilestones(c, scope), database(c.env).execute<{ milestone_key: string }>(sql`select milestone_key from app_private.admin_milestone_acknowledgements where user_id=${actor.id}::uuid and scope_key=${scope ?? "all"}`)]);
  return c.json({ ready: true, milestones: achieved.filter(m => !acknowledged.rows.some(a => a.milestone_key === m.key)) });
});
adminReportingRoutes.post("/reports/milestones/acknowledge", async c => {
  const d = await input(c, z.object({ key: z.string().regex(/^(signups|revenue)_\d+$/) }).strict());
  const actor = currentUser(c), scope = await resolveAdminScope(c.env, actor, c.req.query("universityId"), "analytics.view");
  if (!(await achievedMilestones(c, scope)).some(m => m.key === d.key)) throw new AppError(409, "CONFLICT", "This milestone has not been achieved in this scope.");
  await database(c.env).execute(sql`insert into app_private.admin_milestone_acknowledgements(user_id,scope_key,milestone_key)values(${actor.id}::uuid,${scope ?? "all"},${d.key})on conflict do nothing`);
  return c.json({ acknowledged: true });
});
