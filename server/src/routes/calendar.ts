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
export const calendarRoutes = new Hono<{Bindings: Bindings; Variables: Variables}>();
calendarRoutes.use("/*", requireAuth);
calendarRoutes.use("/*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
calendarRoutes.get("/", async c => {
  const result = await database(c.env).execute(sql`select id,title,starts_on::text,ends_on::text,semester from public.student_calendar_events where user_id=${currentUser(c).id}::uuid order by starts_on,id limit 1000`);
  return c.json({events:result.rows});
});
calendarRoutes.post("/import", async c => {
  const u = currentUser(c);
  if (!u.universityId) throw new AppError(409,"CONFLICT","Choose your university first.");
  const d = await input(c,z.object({requestId:z.string().uuid(),events:z.array(calendarEventSchema).min(1).max(80)}).strict());
  const hash = await sha256(JSON.stringify(d.events));
  const db = database(c.env), client=sqlClient(c.env);
  const existing=firstRow(await db.execute<{request_hash:string}>(sql`select request_hash from public.calendar_imports where user_id=${u.id}::uuid and request_id=${d.requestId}::uuid`));
  if(existing) { if(existing.request_hash!==hash) throw new AppError(409,"CONFLICT","This saved import belongs to a different calendar draft."); return c.json({saved:true,count:d.events.length}); }
  const rows=await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${u.id+"-calendar"},0))`,
    client`insert into public.calendar_imports(user_id,request_id,request_hash) select ${u.id}::uuid,${d.requestId}::uuid,${hash} where (select count(*) from public.student_calendar_events where user_id=${u.id}::uuid)+${d.events.length}<=1000 on conflict do nothing returning request_id`,
    ...d.events.map((event,index)=>client`insert into public.student_calendar_events(user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number) select ${u.id}::uuid,${u.universityId}::uuid,${event.title},${event.startsOn}::date,${event.endsOn}::date,${event.semester},${d.requestId}::uuid,${index} where exists(select 1 from public.calendar_imports where user_id=${u.id}::uuid and request_id=${d.requestId}::uuid and request_hash=${hash}) on conflict(user_id,import_id,row_number) do nothing returning id`)
  ]);
  if(!rows[1]?.length) {
    const saved=firstRow(await db.execute<{request_hash:string}>(sql`select request_hash from public.calendar_imports where user_id=${u.id}::uuid and request_id=${d.requestId}::uuid`));
    if(saved?.request_hash!==hash) throw new AppError(409,"CONFLICT","This calendar could not be saved. Check the draft or remove older events if your calendar is full.");
  }
  return c.json({saved:true,count:d.events.length},201);
});
calendarRoutes.delete("/:id",async c=>{
  await database(c.env).execute(sql`delete from public.student_calendar_events where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid`);
  return c.json({deleted:true});
});
