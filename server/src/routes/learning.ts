import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, timetableEntrySchema } from "@kampusone/contracts";
import { database, firstRow, sqlClient } from "../lib/database";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";
export const learningRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
learningRoutes.use("/*", requireAuth);
const alarmSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    days: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((d) => [...new Set(d)]),
    enabled: z.boolean(),
    sound: z.enum(["default", "silent"]),
    vibration: z.boolean(),
    snoozeMinutes: z.number().int().min(1).max(30),
    firesAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.days.length > 0 ||
      (!!d.firesAt &&
        Date.parse(d.firesAt) > Date.now() &&
        Date.parse(d.firesAt) < Date.now() + 366 * 86400000),
    { message: "Choose a future time or a repeating day." },
  );
learningRoutes.get("/alarms", async (c) => {
  const result = await database(c.env).execute(
    sql`select id,label,to_char(time,'HH24:MI') time,days,(enabled and (cardinality(days)>0 or fires_at>now())) enabled,sound,vibration,snooze_minutes,timetable_entry_id,fires_at from public.student_alarms where user_id=${currentUser(c).id}::uuid order by time,id limit 150`,
  );
  return c.json({ alarms: result.rows });
});
learningRoutes.post("/alarms", async (c) => {
  const user = currentUser(c);
  const d = await input(c, alarmSchema);
  const client = sqlClient(c.env);
  const results = await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${user.id + "-alarms"},0))`,
    client`insert into public.student_alarms(user_id,institution_id,label,time,days,enabled,sound,vibration,snooze_minutes,fires_at) select ${user.id}::uuid,${user.universityId}::uuid,${d.label},${d.time}::time,${d.days}::smallint[],${d.enabled},${d.sound},${d.vibration},${d.snoozeMinutes},${d.days.length ? null : d.firesAt!}::timestamptz where (select count(*) from public.student_alarms where user_id=${user.id}::uuid)<100 returning id`,
  ]);
  const created = results[1]?.[0];
  if (!created) throw new AppError(409, "CONFLICT", "Your alarm list is full.");
  return c.json(created, 201);
});
learningRoutes.put("/alarms/:id", async (c) => {
  const d = await input(c, alarmSchema);
  const result = await database(c.env).execute(
    sql`update public.student_alarms set label=${d.label},time=${d.time}::time,days=${sql.param(d.days)}::smallint[],fires_at=${d.days.length ? null : d.firesAt!}::timestamptz,enabled=${d.enabled},sound=${d.sound},vibration=${d.vibration},snooze_minutes=${d.snoozeMinutes},updated_at=now() where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid returning id`,
  );
  if (!firstRow(result))
    throw new AppError(404, "NOT_FOUND", "Alarm not found.");
  return c.json(firstRow(result));
});
learningRoutes.delete("/alarms/:id", async (c) => {
  await database(c.env).execute(
    sql`delete from public.student_alarms where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid`,
  );
  return c.json({ status: "deleted" });
});
learningRoutes.get("/courses", async (c) => {
  const u = currentUser(c);
  const [courses, config] = await Promise.all([
    database(c.env).execute(
      sql`select course_code,title,units,grade from public.course_drafts where user_id=${u.id}::uuid order by course_code limit 100`,
    ),
    database(c.env).execute(
      sql`select grading_scale from public.institution_config where institution_id=${u.universityId}::uuid`,
    ),
  ]);
  return c.json({
    courses: courses.rows,
    gradingScale: firstRow(config)?.grading_scale ?? {
      A: 5,
      B: 4,
      C: 3,
      D: 2,
      E: 1,
      F: 0,
    },
  });
});
learningRoutes.put("/courses", async (c) => {
  const u = currentUser(c);
  if (!u.universityId)
    throw new AppError(409, "CONFLICT", "Choose your university first.");
  const d = await input(
    c,
    z.object({
      courses: z
        .array(
          z.object({
            courseCode: z.string().trim().toUpperCase().min(2).max(24),
            title: z.string().trim().min(1).max(160),
            units: z.number().positive().max(30).nullable(),
            grade: z.string().max(3).nullable(),
          }),
        )
        .max(100),
    }),
  );
  if (new Set(d.courses.map((v) => v.courseCode)).size !== d.courses.length)
    throw new AppError(400, "BAD_REQUEST", "Remove duplicate course codes.");
  const config = firstRow(
    await database(c.env).execute<{ grading_scale: Record<string, number> }>(
      sql`select grading_scale from public.institution_config where institution_id=${u.universityId}::uuid`,
    ),
  );
  for (const course of d.courses) {
    if (
      course.grade &&
      !(
        course.grade in
        (config?.grading_scale ?? { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 })
      )
    )
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Choose a grade in your university scale.",
      );
  }
  const client = sqlClient(c.env);
  await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${u.id + "-courses"},0))`,
    client`delete from public.course_drafts where user_id=${u.id}::uuid`,
    ...d.courses.map(
      (v) =>
        client`insert into public.course_drafts(user_id,institution_id,course_code,title,units,grade) values(${u.id}::uuid,${u.universityId}::uuid,${v.courseCode},${v.title},${v.units},${v.grade})`,
    ),
  ]);
  return c.json({ status: "saved" });
});
learningRoutes.put("/timetable/:id", async (c) => {
  const d = await input(c, timetableEntrySchema);
  if (d.endsAt <= d.startsAt)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The class must end after it starts.",
    );
  const result = await database(c.env).execute(
    sql`update public.timetable_entries set title=${d.title},course_code=${d.courseCode?.toUpperCase() ?? null},venue=${d.venue ?? null},lecturer=${d.lecturer ?? null},day_of_week=${d.dayOfWeek},starts_at=${d.startsAt}::time,ends_at=${d.endsAt}::time,reminder_minutes=${d.reminderMinutes},reminder_enabled=${d.reminderEnabled},updated_at=now() where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid and status<>'ARCHIVED' returning id`,
  );
  if (!firstRow(result))
    throw new AppError(404, "NOT_FOUND", "Class not found.");
  return c.json(firstRow(result));
});
learningRoutes.post("/timetable/import", async (c) => {
  const u = currentUser(c);
  if (!u.universityId)
    throw new AppError(409, "CONFLICT", "Choose your university first.");
  const d = await input(
    c,
    z.object({ entries: z.array(timetableEntrySchema).min(1).max(40) }),
  );
  for (const e of d.entries)
    if (e.endsAt <= e.startsAt)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Check each class start and end time.",
      );
  const client = sqlClient(c.env);
  await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${u.id + "-timetable"},0))`,
    ...d.entries.map(
      (e) =>
        client`insert into public.timetable_entries(id,user_id,university_id,title,course_code,venue,lecturer,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled) values(${crypto.randomUUID()}::uuid,${u.id}::uuid,${u.universityId}::uuid,${e.title},${e.courseCode?.toUpperCase() ?? null},${e.venue ?? null},${e.lecturer ?? null},${e.dayOfWeek},${e.startsAt}::time,${e.endsAt}::time,${e.reminderMinutes},${e.reminderEnabled})`,
    ),
  ]);
  return c.json({ imported: d.entries.length }, 201);
});
