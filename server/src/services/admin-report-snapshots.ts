import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import { adminReportingReady, lagosDay, saveDailyReport } from "../lib/admin-reporting";
import type { Bindings } from "../types";

/** Called by the existing cron. Revisit the last two days for delayed samples. */
export async function captureDailyAppReports(env: Bindings) {
  if (!(await adminReportingReady(env))) return;
  const db = database(env), now = new Date();
  const runKey = `${lagosDay(now)}:${Math.floor(now.getUTCHours() / 6)}`;
  const claimed = firstRow(await db.execute(sql`insert into app_private.daily_report_runs(run_key)values(${runKey})on conflict do nothing returning run_key`));
  if (!claimed) return;
  try {
    const universities = await db.execute<{ id: string }>(sql`select id from public.universities where deleted_at is null and (exists(select 1 from public.profiles p where p.university_id=universities.id)or exists(select 1 from app_private.admin_record_events e where e.institution_id=universities.id))`);
    for (const offset of [0, 1, 2]) {
      const day = lagosDay(new Date(now.getTime() - offset * 86400000));
      await saveDailyReport(env, null, day);
      for (const school of universities.rows) await saveDailyReport(env, school.id, day);
    }
  } catch (error) {
    await db.execute(sql`delete from app_private.daily_report_runs where run_key=${runKey}`);
    throw error;
  }
}
