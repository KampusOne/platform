import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { aiLimit } from "./ai-provider";
import { resolveAIQuota } from "./ai-quota";
import type { AuthenticatedUser, Bindings } from "../types";
export const CHAT_WINDOW_SECONDS = 15 * 60;
export const STUDY_MODES = ["summary", "notes", "quiz"] as const;
export const isStudyGeneration = (mode: string) => (STUDY_MODES as readonly string[]).includes(mode);
export async function studentExperienceReady(env: Bindings) {
  if (env.UNIFIED_SCHEMA_READY !== "true") return false;
  return firstRow(await database(env).execute<{ ready: boolean }>(sql`select to_regclass('public.profile_follows') is not null and to_regclass('app_private.ai_subscriptions') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='timetable_entries' and column_name='occurs_on') as ready`))?.ready === true;
}
export async function studentAIPolicy(env: Bindings, user: AuthenticatedUser) {
  const base = await resolveAIQuota(env, user);
  const pro = await studentExperienceReady(env) ? firstRow(await database(env).execute<{ active: boolean }>(sql`select exists(select 1 from app_private.ai_subscriptions where user_id=${user.id}::uuid and status='ACTIVE' and current_period_end>now()) as active`))?.active === true : false;
  return { ...base, pro, chat: aiLimit(env.AI_CHAT_WINDOW_LIMIT, 15, 60), study: aiLimit(env.AI_STUDY_TRIAL_LIMIT, 5, 50) };
}
export async function studentAIUsage(env: Bindings, userId: string) {
  const row = firstRow(await database(env).execute<{ chat_used: number; study_used: number; day_used: number; total: number; chat_resets_at: string | null; burst_resets_at:string|null; month_used:number; timetable_used:number }>(sql`
    select count(*) filter(where user_id=${userId}::uuid and mode='study' and created_at>now()-interval '15 minutes')::int as chat_used,
      count(*) filter(where user_id=${userId}::uuid and mode in ('summary','notes','quiz') and status in ('COMPLETED','PROCESSING'))::int as study_used,
      count(*) filter(where user_id=${userId}::uuid and created_at>=(date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))::int as day_used,
      count(*) filter(where created_at>=(date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))::int as total,
      count(*) filter(where user_id=${userId}::uuid and mode in ('summary','notes','quiz') and status in ('COMPLETED','PROCESSING') and created_at>=date_trunc('month',now()))::int as month_used,
      count(*) filter(where user_id=${userId}::uuid and mode='timetable' and created_at>=(date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))::int as timetable_used,
      min(created_at+interval '15 minutes') filter(where user_id=${userId}::uuid and created_at>now()-interval '15 minutes') as burst_resets_at,
      min(created_at+interval '15 minutes') filter(where user_id=${userId}::uuid and mode='study' and created_at>now()-interval '15 minutes') as chat_resets_at
    from app_private.ai_requests
    where user_id=${userId}::uuid or created_at>=(date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')
  `));
  return row ?? { chat_used: 0, study_used: 0, day_used: 0, total: 0, chat_resets_at: null,burst_resets_at:null,month_used:0,timetable_used:0 };
}
