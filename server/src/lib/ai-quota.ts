import { aiLimit } from "./ai-provider";
import { sha256 } from "./security";
import type { AuthenticatedUser, Bindings } from "../types";
import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";

export type AIQuota = { user: number; global: number; unlimited: boolean };

/**
 * The caller must pass currentUser(c), resolved by requireAuth from public.users.
 * Never accept an email, role or unlimited flag from a request or profile metadata.
 * Hashes keep raw account addresses out of deployment configuration; they are not
 * secrets and are not authentication credentials. Only the Worker can grant this.
 */
export async function resolveAIQuota(env: Bindings, user: AuthenticatedUser): Promise<AIQuota> {
  const allowed = new Set((env.AI_UNLIMITED_EMAIL_HASHES ?? "")
    .split(/[\s,]+/)
    .map(value => value.toLowerCase())
    .filter(value => /^[a-f0-9]{64}$/.test(value)));
  const email = user.email.trim().toLowerCase();
  const unlimited = Boolean(user.id && email && allowed.size && allowed.has(await sha256(email)));
  return {
    user: aiLimit(env.AI_DAILY_USER_LIMIT, 5, 100),
    global: aiLimit(env.AI_DAILY_GLOBAL_LIMIT, 100, 100000),
    unlimited,
  };
}

export function aiAllowance(quota: AIQuota, used: number, globalUsed: number, resetsAt: string) {
  return {
    unlimited: quota.unlimited,
    limit: quota.unlimited ? null : quota.user,
    used,
    remaining: quota.unlimited ? null : Math.max(0, quota.user - used),
    resetsAt,
    globalAvailable: globalUsed < quota.global,
    policy: quota.unlimited
      ? "No personal daily AI cap. Shared service and provider limits still apply. Attempts remain recorded; retrying an existing request does not call the provider again."
      : "One reservation per new attempt. Provider failures count; replaying the same request is free. Invalid files, missing configuration and rejected reservations do not count.",
  };
}

export type AcademicImportKind = "calendar" | "timetable" | "image" | "document";
export function academicImportLimits(pro: boolean) {
  return { limit: pro ? 30 : 5, calendarLimit: pro ? 30 : 3 };
}
export async function academicImportUsage(env: Bindings, user: AuthenticatedUser, pro: boolean) {
  const limits = academicImportLimits(pro);
  const row = firstRow(await database(env).execute<{ ready: boolean }>(sql`select to_regclass('app_private.academic_import_usage') is not null as ready`));
  if (!row?.ready) return { ...limits, available: false, used: 0, remaining: limits.limit, calendar: { limit: limits.calendarLimit, used: 0, remaining: limits.calendarLimit }, resetsAt: null };
  const usage = firstRow(await database(env).execute<{ used: number; calendar_used: number; resets_at: string }>(sql`
    select count(*)::int as used,count(*) filter(where kind='calendar')::int as calendar_used,
    ((date_trunc('week',now() at time zone 'Africa/Lagos')+interval '7 days') at time zone 'Africa/Lagos') as resets_at
    from app_private.academic_import_usage where user_id=${user.id}::uuid
    and created_at>=(date_trunc('week',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')
  `));
  const used = Number(usage?.used ?? 0), calendarUsed = Number(usage?.calendar_used ?? 0);
  return { ...limits, available: true, used, remaining: Math.max(0, limits.limit-used), calendar: { limit: limits.calendarLimit, used: calendarUsed, remaining: Math.max(0, limits.calendarLimit-calendarUsed) }, resetsAt: usage?.resets_at ?? null };
}
/** Call only after validation and an AI request idempotency claim, before provider I/O. */
export async function consumeAcademicImportQuota(env: Bindings, user: AuthenticatedUser, kind: AcademicImportKind, requestId: string, pro: boolean) {
  const limits = academicImportLimits(pro);
  const ready = firstRow(await database(env).execute<{ ready: boolean }>(sql`select to_regprocedure('app_private.reserve_academic_import(uuid,uuid,uuid,text,integer,integer)') is not null as ready`));
  if (!ready?.ready) throw new AppError(503,"PROVIDER_UNAVAILABLE","Imports are being updated. You can still add your data manually.",{reason:"IMPORT_QUOTA_NOT_READY"});
  const result = firstRow(await database(env).execute<{ status: string }>(sql`
    select app_private.reserve_academic_import(${user.id}::uuid,${user.universityId}::uuid,${requestId}::uuid,${kind},${limits.limit},${limits.calendarLimit}) as status
  `));
  if (result?.status === "RESERVED" || result?.status === "REPLAY") return;
  const usage = await academicImportUsage(env,user,pro);
  throw new AppError(429,"RATE_LIMITED",result?.status === "CALENDAR_LIMIT"
    ? `You've used your ${limits.calendarLimit} calendar imports this week. Manual entries are still available.`
    : `You've used your ${limits.limit} imports this week. Manual entries and grades are still available.`,
    {reason:result?.status === "CALENDAR_LIMIT"?"IMPORT_CALENDAR_LIMIT":"IMPORT_WEEK_LIMIT",resetsAt:usage.resetsAt,imports:usage,upgrade:!pro});
}
