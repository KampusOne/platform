import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import type { Bindings } from "../types";

export const REPORT_TIME_ZONE = "Africa/Lagos";
export const lagosDay = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export function reportWindow(value: string | undefined, now = new Date()) {
  const day = value ?? lagosDay(now);
  const start = new Date(`${day}T00:00:00+01:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(start.getTime()) || lagosDay(start) !== day || day > lagosDay(now) || day < "2020-01-01") {
    throw new AppError(400, "BAD_REQUEST", "Choose a valid report date from 2020 through today.");
  }
  return { day, start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
type CountRow = { count: number };
const count = (r: { rows: CountRow[] }) => Number(firstRow(r)?.count ?? 0);
export async function adminReportingReady(env: Bindings) {
  return firstRow(await database(env).execute<{ ready: boolean }>(sql`select to_regclass('app_private.daily_app_reports') is not null and to_regclass('app_private.admin_record_events') is not null and to_regclass('app_private.operations_expenses') is not null as ready`))?.ready ?? false;
}

export async function financeReport(env: Bindings, scope: string | null, day?: string) {
  const db = database(env), window = day ? reportWindow(day) : null;
  const recordedDay = sql`coalesce(e.incurred_on,(t.created_at at time zone 'Africa/Lagos')::date)`;
  const scoped = sql`(${scope}::uuid is null or t.university_id=${scope}::uuid) and (${window?.day ?? null}::date is null or ${recordedDay}=${window?.day ?? null}::date)`;
  const rows = await db.execute<{ account_code: string; account_type: string; amount_kobo: string }>(sql`
    select a.account_code,a.account_type,coalesce(sum(case when (a.account_type='EXPENSE'and l.direction='DEBIT')or(a.account_type<>'EXPENSE'and l.direction='CREDIT')then l.amount_kobo else -l.amount_kobo end),0)::text amount_kobo
    from public.ledger_lines l join public.ledger_accounts a on a.id=l.account_id
    join public.ledger_transactions t on t.id=l.transaction_id left join app_private.operations_expenses e on e.journal_id=t.id
    where ${scoped} and(a.account_type in('REVENUE','EXPENSE')or(a.account_code='VENDOR_PENDING'and t.reference_type='STORE_ORDER'and not exists(select 1 from public.ledger_lines moved join public.ledger_accounts destination on destination.id=moved.account_id where moved.transaction_id=t.id and destination.account_code in('VENDOR_AVAILABLE','VENDOR_PAYOUT_RESERVED'))))
    group by a.account_code,a.account_type order by a.account_code
  `);
  const totals = rows.rows.reduce((value, row) => {
    const amount = Number(row.amount_kobo);
    if (row.account_type === "REVENUE") value.platform_revenue_kobo += amount;
    if (row.account_type === "EXPENSE") value.expenses_kobo += amount;
    if (row.account_code === "PLATFORM_COMMISSION") value.commission_kobo += amount;
    if (row.account_code === "VENDOR_PENDING") value.vendor_proceeds_kobo += amount;
    if (row.account_type === "REVENUE" && row.account_code !== "KIRA_SUBSCRIPTION_REVENUE") value.marketplace_revenue_kobo += amount;
    return value;
  }, { platform_revenue_kobo: 0, expenses_kobo: 0, commission_kobo: 0, vendor_proceeds_kobo: 0, marketplace_revenue_kobo: 0 });
  // Vendor liability releases are excluded: they move earnings between wallets,
  // they do not create a second sale or platform revenue.
  const gmv = firstRow(await db.execute<{ gmv_kobo: string; transactions: number }>(sql`
    select coalesce(sum(o.subtotal_kobo+o.delivery_fee_kobo),0)::text gmv_kobo,count(distinct o.id)::int transactions
    from public.orders o join public.ledger_transactions t on t.reference_type='STORE_ORDER'and t.reference_id=o.id::text
    where (${scope}::uuid is null or t.university_id=${scope}::uuid)and(${window?.day ?? null}::date is null or(t.created_at at time zone 'Africa/Lagos')::date=${window?.day ?? null}::date)
    and exists(select 1 from public.ledger_lines l join public.ledger_accounts a on a.id=l.account_id where l.transaction_id=t.id and l.direction='CREDIT'and a.account_code='VENDOR_PENDING')
  `));
  const receiptsReady = firstRow(await db.execute<{ready:boolean}>(sql`select to_regclass('app_private.verified_paystack_receipts')is not null ready`))?.ready;
  const receipts = receiptsReady ? firstRow(await db.execute<{count:number}>(sql`select count(*)::int count from app_private.verified_paystack_receipts where(${scope}::uuid is null or university_id=${scope}::uuid)and(${window?.day ?? null}::date is null or(paid_at at time zone 'Africa/Lagos')::date=${window?.day ?? null}::date)`))?.count : null;
  return { ...totals, gmv_kobo: Number(gmv?.gmv_kobo ?? 0), transactions_processed: receipts ?? Number(gmv?.transactions ?? 0), transactions_definition: receiptsReady ? "Verified provider receipts across purchase categories" : "Journal-backed store transactions; provider receipt reporting awaits its database update", profit_kobo: totals.platform_revenue_kobo - totals.expenses_kobo,
    arr_kobo: null, arr_definition: "Kira is paid one month at a time without automatic renewal. These payments are not contracted recurring revenue, so ARR is not reported.",
    definition: "Posted revenue credits less reversals; expense debits less reversals. Vendor proceeds exclude wallet release transfers. Profit is recorded revenue less recorded expenses, not a bank balance. GMV counts journal-backed store sales including delivery.",
    breakdown: rows.rows.map(r => ({ ...r, amount_kobo: Number(r.amount_kobo) })) };
}

export async function buildDailyReport(env: Bindings, scope: string | null, day: string) {
  const db = database(env), window = reportWindow(day);
  const readiness = firstRow(await db.execute<{ foreground: boolean; messages: boolean; campaigns: boolean }>(sql`select to_regclass('app_private.foreground_usage_samples')is not null foreground,to_regclass('public.direct_messages')is not null messages,to_regclass('app_private.email_recipients')is not null campaigns`));
  const [signups, signins, activity, changes, posts, foreground, messages, campaigns, collection, finance] = await Promise.all([
    db.execute<CountRow>(sql`select count(*)::int count from public.users u left join public.profiles p on p.user_id=u.id where u.created_at>=${window.start}::timestamptz and u.created_at<${window.end}::timestamptz and(${scope}::uuid is null or p.university_id=${scope}::uuid)`),
    db.execute<{ signins: number; resumes: number; started_at: string | null }>(sql`select count(distinct actor_user_id)filter(where action='auth.signin'and occurred_at>=${window.start}::timestamptz and occurred_at<${window.end}::timestamptz)::int signins,count(distinct actor_user_id)filter(where action='auth.resume'and occurred_at>=${window.start}::timestamptz and occurred_at<${window.end}::timestamptz)::int resumes,min(occurred_at)filter(where action='auth.signin')::text started_at from app_private.audit_events where action in('auth.signin','auth.resume')and outcome='succeeded'and(${scope}::uuid is null or university_id=${scope}::uuid)`),
    db.execute<{ event_name: string; count: number; users: number }>(sql`select event_name,count(*)::int count,count(distinct user_id)::int users from public.product_events where created_at>=${window.start}::timestamptz and created_at<${window.end}::timestamptz and(${scope}::uuid is null or institution_id=${scope}::uuid)group by event_name order by count desc`),
    db.execute<{ event_name: string; count: number }>(sql`select event_name,count(*)::int count from app_private.admin_record_events where occurred_at>=${window.start}::timestamptz and occurred_at<${window.end}::timestamptz and(${scope}::uuid is null or institution_id=${scope}::uuid)group by event_name`),
    db.execute<CountRow>(sql`select count(*)::int count from public.feed_posts where created_at>=${window.start}::timestamptz and created_at<${window.end}::timestamptz and(${scope}::uuid is null or university_id=${scope}::uuid)`),
    readiness?.foreground ? db.execute<{ seconds: number; users: number }>(sql`select round(coalesce(sum(seconds),0))::int seconds,count(distinct user_id)::int users from app_private.foreground_usage_samples where ended_at>=${window.start}::timestamptz and ended_at<${window.end}::timestamptz and(${scope}::uuid is null or institution_id=${scope}::uuid)`) : Promise.resolve({ rows: [] }),
    readiness?.messages ? db.execute<CountRow>(sql`select count(*)::int count from public.direct_messages m join public.direct_threads t on t.id=m.thread_id where m.created_at>=${window.start}::timestamptz and m.created_at<${window.end}::timestamptz and(${scope}::uuid is null or t.institution_id=${scope}::uuid)`) : Promise.resolve({ rows: [] }),
    readiness?.campaigns ? db.execute<{ status: string; count: number }>(sql`select status,count(*)::int count from app_private.email_recipients where not is_test and created_at>=${window.start}::timestamptz and created_at<${window.end}::timestamptz and(${scope}::uuid is null or institution_id=${scope}::uuid)group by status`) : Promise.resolve({ rows: [] }),
    db.execute<{ started_at: string }>(sql`select started_at::text from app_private.reporting_collection where key='record_changes'`),
    financeReport(env, scope, day),
  ]);
  const active = count(await db.execute<CountRow>(sql`select count(distinct user_id)::int count from public.product_events where created_at>=${window.start}::timestamptz and created_at<${window.end}::timestamptz and(${scope}::uuid is null or institution_id=${scope}::uuid)`));
  const change = (name: string) => Number(changes.rows.find(r => r.event_name === name)?.count ?? 0);
  return { day, timeZone: REPORT_TIME_ZONE, institutionId: scope, generatedAt: new Date().toISOString(), provisional: day >= lagosDay(new Date(Date.now() - 2 * 86400000)),
    counts: { signups: count(signups), signed_in_users: Number(firstRow(signins)?.signins ?? 0), resumed_users: Number(firstRow(signins)?.resumes ?? 0), active_users: active, recorded_activities: activity.rows.reduce((sum,r) => sum + r.count,0), posts_created: count(posts), posts_published: change("post_published"), products_created: change("product_created"), product_updates: change("product_updated"), sales_recorded: change("sale_paid"), coupons_created: change("coupon_created"), agents_approved: change("agent_approved"), messages_sent: readiness?.messages ? count(messages as { rows: CountRow[] }) : null, foreground_seconds: readiness?.foreground ? Number((firstRow(foreground) as { seconds?: number } | undefined)?.seconds ?? 0) : null },
    activity: activity.rows, changes: changes.rows, campaigns: readiness?.campaigns ? campaigns.rows : null, finance,
    coverage: { signinsStartedAt: firstRow(signins)?.started_at ?? null, recordChangesStartedAt: firstRow(collection)?.started_at ?? null, definition: "Counts use stored events and records. Product edits, first publication, approvals and sale transitions are collected from this release onward; earlier changes are not reconstructed. Offline foreground samples may arrive for 48 hours. Campaign statuses describe recipients created that day, as last observed." } };
}
export type DailyAppReport = Awaited<ReturnType<typeof buildDailyReport>>;
export async function saveDailyReport(env: Bindings, scope: string | null, day: string) {
  const report = await buildDailyReport(env, scope, day);
  await database(env).execute(sql`insert into app_private.daily_app_reports(scope_key,institution_id,day,report,generated_at)values(${scope ?? "all"},${scope}::uuid,${day}::date,${JSON.stringify(report)}::jsonb,${report.generatedAt}::timestamptz)on conflict(scope_key,day)do update set report=excluded.report,generated_at=excluded.generated_at`);
  return report;
}
