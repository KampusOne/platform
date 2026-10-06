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
    order by starts_on,id
    limit 1000
  `);
  return c.json({ events: result.rows, examPeriods: extractExamPeriods(result.rows) });
});

calendarRoutes.get("/exam-periods", async (c) => {
  const result=await database(c.env).execute<CalendarRow>(sql`select title,starts_on::text,ends_on::text,semester from public.student_calendar_events where user_id=${currentUser(c).id}::uuid order by starts_on`);
  return c.json({examPeriods:extractExamPeriods(result.rows),progressionRequiresConfirmation:true});
});
calendarRoutes.post('/import-alarms',async c=>{
 const d=await input(c,z.object({entryIds:z.array(z.string().uuid()).min(1).max(100),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00')}).strict());
 const result=firstRow(await database(c.env).execute<{imported:number}>(sql`select app_private.import_calendar_alarms(${currentUser(c).id}::uuid,${sql.param(d.entryIds)}::uuid[],${d.time}::time) imported`));
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
          and import_id=${data.requestId}::uuid
          and row_number=0
      `),
    );
    if (existing) return c.json({ event: existing });
  }

  const rows = await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${user.id + "-calendar"},0))`,
    client`
      insert into public.calendar_imports(user_id,request_id,request_hash)
      select ${user.id}::uuid,${data.requestId}::uuid,${hash}
      where (select count(*) from public.student_calendar_events where user_id=${user.id}::uuid) < 1000
      on conflict do nothing
      returning request_id
    `,
    client`
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
      where exists(
        select 1
        from public.calendar_imports
        where user_id=${user.id}::uuid
          and request_id=${data.requestId}::uuid
          and request_hash=${hash}
      )
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
        and import_id=${data.requestId}::uuid
        and row_number=0
    `),
  );
  if (!saved)
    throw new AppError(
      409,
      "CONFLICT",
      "This calendar date could not be saved. Try again.",
    );

  return c.json({ event: saved }, rows[2]?.length ? 201 : 200);
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
    return c.json({ saved: true, count: data.events.length });
  }

  const rows = await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${user.id + "-calendar"},0))`,
    client`
      insert into public.calendar_imports(user_id,request_id,request_hash)
      select ${user.id}::uuid,${data.requestId}::uuid,${hash}
      where (select count(*) from public.student_calendar_events where user_id=${user.id}::uuid)+${data.events.length}<=1000
      on conflict do nothing
      returning request_id
    `,
    ...data.events.map(
      (event, index) => client`
        insert into public.student_calendar_events(
          user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number
        )
        select
          ${user.id}::uuid,
          ${user.universityId}::uuid,
          ${event.title},
          ${event.startsOn}::date,
          ${event.endsOn}::date,
          ${event.semester},
          ${data.requestId}::uuid,
          ${index}
        where exists(
          select 1
          from public.calendar_imports
          where user_id=${user.id}::uuid
            and request_id=${data.requestId}::uuid
            and request_hash=${hash}
        )
        on conflict(user_id,import_id,row_number) do nothing
        returning id
      `,
    ),
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

  return c.json({ saved: true, count: data.events.length }, 201);
});

calendarRoutes.post("/bulk-delete", async (c) => {
  const d=await input(c,z.object({ids:z.array(z.string().uuid()).min(1).max(1000)}).strict());
  const result=await database(c.env).execute(sql`delete from public.student_calendar_events where user_id=${currentUser(c).id}::uuid and id=any(${sql.param(d.ids)}::uuid[]) returning id`);
  return c.json({deleted:result.rows.length});
});
calendarRoutes.patch("/:id", async (c) => {
  const data = await input(
    c,
    z.object({ event: calendarEventSchema }).strict(),
  );
  const saved = firstRow(
    await database(c.env).execute<CalendarRow>(sql`
      update public.student_calendar_events
      set title=${data.event.title},
          starts_on=${data.event.startsOn}::date,
          ends_on=${data.event.endsOn}::date,
          semester=${data.event.semester}
      where id=${id(c.req.param("id"))}::uuid
        and user_id=${currentUser(c).id}::uuid
      returning id,title,starts_on::text,ends_on::text,semester
    `),
  );
  if (!saved)
    throw new AppError(404, "NOT_FOUND", "Calendar date not found.");
  return c.json({ event: saved });
});

calendarRoutes.delete("/:id", async (c) => {
  await database(c.env).execute(sql`
    delete from public.student_calendar_events
    where id=${id(c.req.param("id"))}::uuid
      and user_id=${currentUser(c).id}::uuid
  `);
  return c.json({ deleted: true });
});
