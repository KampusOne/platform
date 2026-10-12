import {extractExamPeriods} from "../lib/academic-calendar";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { calendarEventSchema } from "../lib/schedule-document";
import { database, firstRow, sqlClient } from "../lib/database";
import { input, id } from "../lib/input";
import { sha256 } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

type CalendarRow = {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
  semester: string;
};

export const calendarRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

calendarRoutes.use("/*", requireAuth);
calendarRoutes.use("/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

calendarRoutes.get("/", async (c) => {
  const result = await database(c.env).execute<CalendarRow>(sql`
    select id,title,starts_on::text,ends_on::text,semester
    from public.student_calendar_events
    where user_id=${currentUser(c).id}::uuid
      and institution_id=${currentUser(c).universityId}::uuid
    order by starts_on,id
    limit 1000
  `);
  return c.json({ events: result.rows, examPeriods: extractExamPeriods(result.rows), manualRecovery: "v1", conditionalEdits: true });
});

calendarRoutes.get("/requests/:requestId", async c => {
  const user=currentUser(c), requestId=id(c.req.param("requestId"));
  const receipt=firstRow(await database(c.env).execute(sql`
    select request_id from public.calendar_imports
    where user_id=${user.id}::uuid and request_id=${requestId}::uuid
  `));
  if(!receipt)return c.json({state:"missing",event:null});
  const event=firstRow(await database(c.env).execute<CalendarRow>(sql`
    select id,title,starts_on::text,ends_on::text,semester from public.student_calendar_events
    where user_id=${user.id}::uuid and institution_id=${user.universityId}::uuid
      and import_id=${requestId}::uuid and row_number=0
  `));
  return c.json({state:event?"saved":"unavailable",event:event??null});
});

calendarRoutes.get("/dates/:id",async c=>{
  const event=firstRow(await database(c.env).execute<CalendarRow>(sql`
    select id,title,starts_on::text,ends_on::text,semester from public.student_calendar_events
    where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid
      and institution_id=${currentUser(c).universityId}::uuid
  `));
  if(!event)throw new AppError(404,"NOT_FOUND","This calendar date is no longer available in your campus.",{kind:"calendar-date-unavailable"});
  return c.json({event});
});

calendarRoutes.get("/exam-periods", async (c) => {
  const result=await database(c.env).execute<CalendarRow>(sql`select title,starts_on::text,ends_on::text,semester from public.student_calendar_events where user_id=${currentUser(c).id}::uuid and institution_id=${currentUser(c).universityId}::uuid order by starts_on limit 1000`);
  return c.json({examPeriods:extractExamPeriods(result.rows),progressionRequiresConfirmation:true});
});
calendarRoutes.post('/import-alarms',async c=>{
 const d=await input(c,z.object({entryIds:z.array(z.string().uuid()).min(1).max(100),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00')}).strict());
 const entryIds=[...new Set(d.entryIds)];
 const eligible=await database(c.env).execute(sql`select id from public.student_calendar_events where user_id=${currentUser(c).id}::uuid and institution_id=${currentUser(c).universityId}::uuid and id=any(${sql.param(entryIds)}::uuid[])`);
 if(eligible.rows.length!==entryIds.length)throw new AppError(404,"NOT_FOUND","Choose calendar dates from your current campus.");
 const result=firstRow(await database(c.env).execute<{imported:number}>(sql`select app_private.import_calendar_alarms(${currentUser(c).id}::uuid,${sql.param(entryIds)}::uuid[],${d.time}::time) imported`));
 return c.json(result);
});
calendarRoutes.post("/", async (c) => {
  const user = currentUser(c);
  if (!user.universityId)
    throw new AppError(409, "CONFLICT", "Choose your university first.");

  const data = await input(
    c,
    z
      .object({
        requestId: z.string().uuid(),
        event: calendarEventSchema,
      })
      .strict(),
  );
  const hash = await sha256(
    JSON.stringify({ kind: "personal-calendar-event", event: data.event }),
  );
  const db = database(c.env);
  const client = sqlClient(c.env);

  const previous = firstRow(
    await db.execute<{ request_hash: string }>(sql`
      select request_hash
      from public.calendar_imports
      where user_id=${user.id}::uuid
        and request_id=${data.requestId}::uuid
    `),
  );
  if (previous?.request_hash && previous.request_hash !== hash)
    throw new AppError(
      409,
      "CONFLICT",
      "This save attempt belongs to a different calendar date.",
    );
  if (previous?.request_hash === hash) {
    const existing = firstRow(
      await db.execute<CalendarRow>(sql`
        select id,title,starts_on::text,ends_on::text,semester
        from public.student_calendar_events
        where user_id=${user.id}::uuid
          and institution_id=${user.universityId}::uuid
          and import_id=${data.requestId}::uuid
          and row_number=0
      `),
    );
    if (existing) return c.json({ event: existing });
    throw new AppError(409,"CONFLICT","This saved date was removed or is no longer available in your campus. Your edits can be kept as a new date.",{kind:"calendar-request-unavailable"});
  }

  const rows = await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${user.id + "-calendar"},0))`,
    client`
      with receipt as (
      insert into public.calendar_imports(user_id,request_id,request_hash)
      select ${user.id}::uuid,${data.requestId}::uuid,${hash}
      where (select count(*) from public.student_calendar_events where user_id=${user.id}::uuid) < 1000
      on conflict do nothing
      returning request_id
      )
      insert into public.student_calendar_events(
        user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number
      )
      select
        ${user.id}::uuid,
        ${user.universityId}::uuid,
        ${data.event.title},
        ${data.event.startsOn}::date,
        ${data.event.endsOn}::date,
        ${data.event.semester},
        ${data.requestId}::uuid,
        0
      from receipt
      on conflict(user_id,import_id,row_number) do nothing
      returning id
    `,
  ]);

  const receipt = firstRow(
    await db.execute<{ request_hash: string }>(sql`
      select request_hash
      from public.calendar_imports
      where user_id=${user.id}::uuid
        and request_id=${data.requestId}::uuid
    `),
  );
  if (receipt?.request_hash !== hash)
    throw new AppError(
      409,
      "CONFLICT",
      "This calendar date could not be saved. Remove an older date if your calendar is full.",
    );

  const saved = firstRow(
    await db.execute<CalendarRow>(sql`
      select id,title,starts_on::text,ends_on::text,semester
      from public.student_calendar_events
      where user_id=${user.id}::uuid
        and institution_id=${user.universityId}::uuid
        and import_id=${data.requestId}::uuid
        and row_number=0
    `),
  );
  if (!saved)
    throw new AppError(
      409,
      "CONFLICT",
      "This saved date is no longer available in your campus. Your edits are kept.",
      {kind:"calendar-request-unavailable"},
    );

  return c.json({ event: saved }, rows[1]?.length ? 201 : 200);
});

calendarRoutes.post("/import", async (c) => {
  const user = currentUser(c);
  if (!user.universityId)
    throw new AppError(409, "CONFLICT", "Choose your university first.");

  const data = await input(
    c,
    z
      .object({
        requestId: z.string().uuid(),
        events: z.array(calendarEventSchema).min(1).max(80),
      })
      .strict(),
  );
  const hash = await sha256(JSON.stringify(data.events));
  const db = database(c.env);
  const client = sqlClient(c.env);
  const existing = firstRow(
    await db.execute<{ request_hash: string }>(sql`
      select request_hash
      from public.calendar_imports
      where user_id=${user.id}::uuid
        and request_id=${data.requestId}::uuid
    `),
  );

  if (existing) {
    if (existing.request_hash !== hash)
      throw new AppError(
        409,
        "CONFLICT",
        "This saved import belongs to a different calendar draft.",
      );
    const retained=await db.execute(sql`select id from public.student_calendar_events where user_id=${user.id}::uuid and institution_id=${user.universityId}::uuid and import_id=${data.requestId}::uuid`);
    if(!retained.rows.length)throw new AppError(409,"CONFLICT","This saved calendar import was removed or is no longer available in your campus.",{kind:"calendar-request-unavailable"});
    return c.json({ saved: true, count: retained.rows.length, replayed: true });
  }

  const rows = await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${user.id + "-calendar"},0))`,
    client`
      with receipt as (
      insert into public.calendar_imports(user_id,request_id,request_hash)
      select ${user.id}::uuid,${data.requestId}::uuid,${hash}
      where (select count(*) from public.student_calendar_events where user_id=${user.id}::uuid)+${data.events.length}<=1000
      on conflict do nothing
      returning request_id
      )
        insert into public.student_calendar_events(
          user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number
        )
        select
          ${user.id}::uuid,
          ${user.universityId}::uuid,
          entry.value->>'title',
          (entry.value->>'startsOn')::date,
          (entry.value->>'endsOn')::date,
          entry.value->>'semester',
          ${data.requestId}::uuid,
          (entry.ordinality-1)::smallint
        from receipt cross join jsonb_array_elements(${JSON.stringify(data.events)}::jsonb) with ordinality as entry(value,ordinality)
        on conflict(user_id,import_id,row_number) do nothing
        returning id
      `,
  ]);

  if (!rows[1]?.length) {
    const saved = firstRow(
      await db.execute<{ request_hash: string }>(sql`
        select request_hash
        from public.calendar_imports
        where user_id=${user.id}::uuid
          and request_id=${data.requestId}::uuid
      `),
    );
    if (saved?.request_hash !== hash)
      throw new AppError(
        409,
        "CONFLICT",
        "This calendar could not be saved. Check the draft or remove older events if your calendar is full.",
      );
  }

  const retained=await db.execute(sql`select id from public.student_calendar_events where user_id=${user.id}::uuid and institution_id=${user.universityId}::uuid and import_id=${data.requestId}::uuid`);
  if(!retained.rows.length)throw new AppError(409,"CONFLICT","This calendar import is no longer available in your campus.",{kind:"calendar-request-unavailable"});
  return c.json({ saved: true, count: retained.rows.length }, rows[1]?.length?201:200);
});

calendarRoutes.post("/bulk-delete", async (c) => {
  const d=await input(c,z.object({ids:z.array(z.string().uuid()).min(1).max(1000)}).strict());
  const result=await database(c.env).execute(sql`delete from public.student_calendar_events where user_id=${currentUser(c).id}::uuid and institution_id=${currentUser(c).universityId}::uuid and id=any(${sql.param(d.ids)}::uuid[]) returning id`);
  return c.json({deleted:result.rows.length});
});
calendarRoutes.patch("/:id", async (c) => {
  const data = await input(
    c,
    z.object({ event: calendarEventSchema, expectedEvent: calendarEventSchema.optional() }).strict(),
  );
  const expected=data.expectedEvent;
  const match=expected?sql`and title=${expected.title} and starts_on=${expected.startsOn}::date and ends_on=${expected.endsOn}::date and semester=${expected.semester}`:sql``;
  const saved = firstRow(
    await database(c.env).execute<CalendarRow>(sql`
      update public.student_calendar_events
      set title=${data.event.title},
          starts_on=${data.event.startsOn}::date,
          ends_on=${data.event.endsOn}::date,
          semester=${data.event.semester}
      where id=${id(c.req.param("id"))}::uuid
        and user_id=${currentUser(c).id}::uuid
        and institution_id=${currentUser(c).universityId}::uuid
        ${match}
      returning id,title,starts_on::text,ends_on::text,semester
    `),
  );
  if (!saved) {
    const current=firstRow(await database(c.env).execute<CalendarRow>(sql`select id,title,starts_on::text,ends_on::text,semester from public.student_calendar_events where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid and institution_id=${currentUser(c).universityId}::uuid`));
    if(current&&expected)throw new AppError(409,"CONFLICT","This date changed online. Your edits are kept; review the current date before saving.",{kind:"calendar-date-changed",event:current});
    throw new AppError(404, "NOT_FOUND", "Calendar date not found.");
  }
  return c.json({ event: saved });
});

calendarRoutes.delete("/:id", async (c) => {
  await database(c.env).execute(sql`
    delete from public.student_calendar_events
    where id=${id(c.req.param("id"))}::uuid
      and user_id=${currentUser(c).id}::uuid
      and institution_id=${currentUser(c).universityId}::uuid
  `);
  return c.json({ deleted: true });
});
