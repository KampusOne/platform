import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, timetableEntrySchema } from "@kampusone/contracts";
import { database, firstRow, sqlClient } from "../lib/database";
import { input, id } from "../lib/input";
import { sha256 } from "../lib/security";
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
    sound: z.union([z.enum(["default", "silent"]), z.string().regex(/^media:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)]),
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
type AlarmSoundMedia = { id: string; original_name: string };
function alarmSoundMediaId(sound: string) {
  return sound.startsWith("media:") ? sound.slice(6) : null;
}
async function assertOwnedAlarmSound(env: Bindings, userId: string, sound: string) {
  const mediaId = alarmSoundMediaId(sound);
  if (!mediaId) return;
  const owned = firstRow(
    await database(env).execute<{ id: string }>(
      sql`select id from public.media_objects where id=${mediaId}::uuid and owner_user_id=${userId}::uuid and kind='notification-sound' and deleted_at is null limit 1`,
    ),
  );
  if (!owned) throw new AppError(400, "BAD_REQUEST", "Choose one of your uploaded alarm sounds.");
}
function alarmSoundUrl(c: { env: Bindings; req: { url: string } }, id: string) {
  const origin = (c.env.PUBLIC_API_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, "");
  return `${origin}/v1/media/${id}`;
}
learningRoutes.get("/alarm-sounds", async (c) => {
  const result = await database(c.env).execute<AlarmSoundMedia>(
    sql`select id,original_name from public.media_objects where owner_user_id=${currentUser(c).id}::uuid and kind='notification-sound' and deleted_at is null order by created_at desc limit 30`,
  );
  return c.json({
    sounds: result.rows.map((sound) => ({
      id: sound.id,
      name: sound.original_name,
      url: alarmSoundUrl(c, sound.id),
    })),
  });
});
learningRoutes.get("/alarms", async (c) => {
  const user = currentUser(c);
  const [result, sounds] = await Promise.all([
    database(c.env).execute<{ id:string;label:string;time:string;days:number[];enabled:boolean;sound:string;vibration:boolean;snooze_minutes:number;timetable_entry_id:string|null;fires_at:string|null;course_code:string|null;course_title:string|null;class_starts_at:string|null;class_ends_at:string|null;venue:string|null;lecturer:string|null;reminder_minutes:number|null }>(
      sql`select alarm.id,alarm.label,to_char(alarm.time,'HH24:MI') time,alarm.days,(alarm.enabled and (cardinality(alarm.days)>0 or alarm.fires_at>now())) enabled,alarm.sound,alarm.vibration,alarm.snooze_minutes,alarm.timetable_entry_id,alarm.fires_at,timetable.course_code,timetable.title course_title,to_char(timetable.starts_at,'HH24:MI') class_starts_at,to_char(timetable.ends_at,'HH24:MI') class_ends_at,timetable.venue,timetable.lecturer,timetable.reminder_minutes from public.student_alarms alarm left join public.timetable_entries timetable on timetable.id=alarm.timetable_entry_id and timetable.user_id=alarm.user_id and timetable.status::text<>'ARCHIVED' where alarm.user_id=${user.id}::uuid order by alarm.time,alarm.id limit 150`,
    ),
    database(c.env).execute<AlarmSoundMedia>(
      sql`select id,original_name from public.media_objects where owner_user_id=${user.id}::uuid and kind='notification-sound' and deleted_at is null limit 30`,
    ),
  ]);
  const names = new Map(sounds.rows.map((sound) => [sound.id, sound.original_name]));
  return c.json({
    alarms: result.rows.map((alarm) => {
      const mediaId = alarmSoundMediaId(alarm.sound);
      return {
        ...alarm,
        sound_name: mediaId ? names.get(mediaId) ?? null : alarm.sound === "silent" ? "Silent" : "Device default alarm",
        sound_url: mediaId && names.has(mediaId) ? alarmSoundUrl(c, mediaId) : null,
      };
    }),
  });
});
learningRoutes.post("/alarms", async (c) => {
  const user = currentUser(c);
  const d = await input(c, alarmSchema);
  await assertOwnedAlarmSound(c.env, user.id, d.sound);
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
  const user = currentUser(c);
  const d = await input(c, alarmSchema);
  await assertOwnedAlarmSound(c.env, user.id, d.sound);
  const result = await database(c.env).execute(
    sql`update public.student_alarms set label=${d.label},time=${d.time}::time,days=${sql.param(d.days)}::smallint[],fires_at=${d.days.length ? null : d.firesAt!}::timestamptz,enabled=${d.enabled},sound=${d.sound},vibration=${d.vibration},snooze_minutes=${d.snoozeMinutes},updated_at=now() where id=${id(c.req.param("id"))}::uuid and user_id=${user.id}::uuid returning id`,
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
  const courses = await database(c.env).execute(
    sql`select course_code,title,units,grade from public.course_drafts where user_id=${u.id}::uuid order by course_code limit 100`,
  );

  let gradingScale: Record<string, number> | null = null;
  let gradingScaleStatus = "UNVERIFIED";
  if (u.universityId) {
    const config = firstRow(
      await database(c.env).execute<{
        grading_scale: Record<string, number>;
        grading_source_status: string;
      }>(
        sql`select
          config.grading_scale,
          coalesce(to_jsonb(config)->>'grading_source_status','UNVERIFIED') as grading_source_status
        from public.institution_config config
        where config.institution_id=${u.universityId}::uuid`,
      ),
    );
    if (config?.grading_source_status === "VERIFIED") {
      gradingScale = config.grading_scale;
      gradingScaleStatus = "VERIFIED";
    }
  }

  return c.json({
    courses: courses.rows,
    gradingScale,
    gradingScaleStatus,
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
    await database(c.env).execute<{
      grading_scale: Record<string, number>;
      grading_source_status: string;
    }>(
      sql`select
        config.grading_scale,
        coalesce(to_jsonb(config)->>'grading_source_status','UNVERIFIED') as grading_source_status
      from public.institution_config config
      where config.institution_id=${u.universityId}::uuid`,
    ),
  );
  for (const course of d.courses) {
    if (
      course.grade && config?.grading_source_status==='VERIFIED' && !(course.grade in config.grading_scale)
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
    z.object({ requestId:z.string().uuid().optional(), entries: z.array(timetableEntrySchema).min(1).max(40) }),
  );
  for (const e of d.entries)
    if (e.endsAt <= e.startsAt)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Check each class start and end time.",
      );
  const requestId=d.requestId??crypto.randomUUID();
  const hash=await sha256(JSON.stringify([u.universityId,d.entries]));
  const result=firstRow(await database(c.env).execute<{outcome:string;imported:number}>(sql`select * from app_private.import_timetable_entries(${u.id}::uuid,${u.universityId}::uuid,${requestId}::uuid,${hash},${JSON.stringify(d.entries)}::jsonb)`));
  if(result?.outcome==='CONFLICT')throw new AppError(409,'CONFLICT','This import request was used for different class details. Start a new save.');
  if(result?.outcome==='FORBIDDEN')throw new AppError(403,'FORBIDDEN','Your university changed. Reload before importing.');
  if(!result)throw new AppError(503,'PROVIDER_UNAVAILABLE','The timetable could not be saved. Retry with the same request.');
  return c.json({imported:result.imported,requestId},result.outcome==='EXISTING'?200:201);
});
