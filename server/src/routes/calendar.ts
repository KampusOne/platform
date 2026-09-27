import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { academicCalendarReady } from "../services/academic-progression";
import { calendarEventSchema, type CalendarEvent } from "../lib/schedule-document";
import { database, firstRow, sqlClient } from "../lib/database";
import { input, id } from "../lib/input";
import { sha256 } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import { AppError } from "../lib/errors";
import type { AuthenticatedUser, Bindings, Variables } from "../types";
export const calendarRoutes = new Hono<{Bindings: Bindings; Variables: Variables}>();
calendarRoutes.use("/*", requireAuth);
calendarRoutes.use("/*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
const sessionSchema=z.string().regex(/^20\d{2}\/20\d{2}$/).refine(value=>Number(value.slice(5))===Number(value.slice(0,4))+1,"Use an academic session such as 2026/2027");
const programmeSchema=z.enum(['undergraduate','postgraduate','other']);
async function requireCalendarReview(env:Bindings){if(!await academicCalendarReady(env))throw new AppError(503,"PROVIDER_UNAVAILABLE","Calendar sharing is being updated. Your private calendar is available.");}
async function saveCalendar(env:Bindings,u:AuthenticatedUser,requestId:string,events:CalendarEvent[]){
  if(!u.universityId)throw new AppError(409,"CONFLICT","Choose your university first.");
  const hash=await sha256(JSON.stringify(events)),db=database(env),client=sqlClient(env);
  const existing=firstRow(await db.execute<{request_hash:string}>(sql`select request_hash from public.calendar_imports where user_id=${u.id}::uuid and request_id=${requestId}::uuid`));
  if(existing){if(existing.request_hash!==hash)throw new AppError(409,"CONFLICT","This saved import belongs to a different calendar draft.");return;}
  const rows=await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${u.id+"-calendar"},0))`,
    client`insert into public.calendar_imports(user_id,request_id,request_hash) select ${u.id}::uuid,${requestId}::uuid,${hash} where (select count(*) from public.student_calendar_events where user_id=${u.id}::uuid)+${events.length}<=1000 on conflict do nothing returning request_id`,
    ...events.map((event,index)=>client`insert into public.student_calendar_events(user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number) select ${u.id}::uuid,${u.universityId}::uuid,${event.title},${event.startsOn}::date,${event.endsOn}::date,${event.semester},${requestId}::uuid,${index} where exists(select 1 from public.calendar_imports where user_id=${u.id}::uuid and request_id=${requestId}::uuid and request_hash=${hash}) on conflict(user_id,import_id,row_number) do nothing returning id`)
  ]);
  if(!rows[1]?.length){const saved=firstRow(await db.execute<{request_hash:string}>(sql`select request_hash from public.calendar_imports where user_id=${u.id}::uuid and request_id=${requestId}::uuid`));if(saved?.request_hash!==hash)throw new AppError(409,"CONFLICT","This calendar could not be saved. Check the draft or remove older events if your calendar is full.");}
}
calendarRoutes.get("/",async c=>{
  const u=currentUser(c),ready=await academicCalendarReady(c.env),db=database(c.env);
  const events=await db.execute(sql`select id,title,starts_on::text,ends_on::text,semester,import_id,${ready?sql`completed_at`:sql`null::timestamptz as completed_at`} from public.student_calendar_events where user_id=${u.id}::uuid and institution_id=${u.universityId}::uuid order by starts_on,id limit 1000`);
  const transition=ready?firstRow(await db.execute(sql`select session_label,from_level,to_level,exam_ends_on::text,status,completed_at from public.student_level_transitions where user_id=${u.id}::uuid and institution_id=${u.universityId}::uuid`)):null;
  const curriculum=ready?firstRow(await db.execute(sql`select p.current_level,ceil(c.normal_duration_years)::int*100 as maximum_level from public.profiles p left join public.courses c on c.id=p.course_id where p.user_id=${u.id}::uuid`)):null;
  return c.json({events:events.rows,reviewEnabled:ready,transition:transition??null,curriculum:curriculum??null});
});
calendarRoutes.post("/import",async c=>{const d=await input(c,z.object({requestId:z.string().uuid(),events:z.array(calendarEventSchema).min(1).max(80)}).strict());await saveCalendar(c.env,currentUser(c),d.requestId,d.events);return c.json({saved:true,count:d.events.length},201);});
calendarRoutes.put("/events/:id/completed",async c=>{
  await requireCalendarReview(c.env);const d=await input(c,z.object({completed:z.boolean()}).strict());
  const result=await database(c.env).execute(sql`update public.student_calendar_events set completed_at=case when ${d.completed} then now() else null end where id=${id(c.req.param('id'))}::uuid and user_id=${currentUser(c).id}::uuid returning id`);
  if(!result.rows.length)throw new AppError(404,'NOT_FOUND','Calendar event not found.');return c.json({saved:true});
});
calendarRoutes.get('/shared',async c=>{
  await requireCalendarReview(c.env);const session=sessionSchema.safeParse(c.req.query('session')),programme=programmeSchema.safeParse(c.req.query('programmeType'));
  if(!session.success||!programme.success)throw new AppError(400,'BAD_REQUEST','Choose a session and programme type.');
  const u=currentUser(c);
  const rows=await database(c.env).execute(sql`select s.id,s.session_label,s.programme_type,s.source_title,s.events,s.reviewed_at,f.name as faculty,d.name as department from public.shared_academic_calendars s join public.profiles p on p.user_id=${u.id}::uuid and p.university_id=s.institution_id left join public.faculties f on f.id=s.faculty_id left join public.departments d on d.id=s.department_id where s.institution_id=${u.universityId}::uuid and s.session_label=${session.data} and s.programme_type=${programme.data} and s.status='PUBLISHED' and (s.faculty_id is null or s.faculty_id=p.faculty_id) and (s.department_id is null or s.department_id=p.department_id) order by s.reviewed_at desc limit 20`);
  return c.json({calendars:rows.rows});
});
calendarRoutes.post('/shared/propose',async c=>{
  await requireCalendarReview(c.env);
  const d=await input(c,z.object({importId:z.string().uuid(),sessionLabel:sessionSchema,programmeType:programmeSchema,scope:z.enum(['institution','faculty','department']),sourceTitle:z.string().trim().min(1).max(160)}).strict());
  const u=currentUser(c),db=database(c.env);
  const profile=firstRow(await db.execute<{faculty_id:string|null;department_id:string|null}>(sql`select faculty_id,department_id from public.profiles where user_id=${u.id}::uuid and university_id=${u.universityId}::uuid`));
  if(!profile||!u.universityId||(d.scope!=='institution'&&!profile.faculty_id)||(d.scope==='department'&&!profile.department_id))throw new AppError(400,'BAD_REQUEST','Complete your academic profile for this calendar scope.');
  const rows=await db.execute<{title:string;startsOn:string;endsOn:string;semester:string}>(sql`select title,starts_on::text as "startsOn",ends_on::text as "endsOn",semester from public.student_calendar_events where user_id=${u.id}::uuid and institution_id=${u.universityId}::uuid and import_id=${d.importId}::uuid order by row_number limit 80`);
  if(!rows.rows.length)throw new AppError(404,'NOT_FOUND','Choose a saved calendar import first.');
  const events=z.array(calendarEventSchema).min(1).max(80).parse(rows.rows);
  const saved=await db.execute(sql`insert into public.shared_academic_calendars(institution_id,session_label,programme_type,faculty_id,department_id,events,source_title,source_import_id,submitted_by) select ${u.universityId}::uuid,${d.sessionLabel},${d.programmeType},${d.scope==='institution'?null:profile.faculty_id}::uuid,${d.scope==='department'?profile.department_id:null}::uuid,${JSON.stringify(events)}::jsonb,${d.sourceTitle},${d.importId}::uuid,${u.id}::uuid where (select count(*) from public.shared_academic_calendars where submitted_by=${u.id}::uuid and created_at>now()-interval '1 day')<5 on conflict(submitted_by,source_import_id,programme_type) do nothing returning id`);
  if(!saved.rows.length)throw new AppError(409,'CONFLICT',"This calendar was already submitted, or today's review queue allowance is used.");
  return c.json({submitted:true,id:saved.rows[0]?.id},201);
});
calendarRoutes.post('/shared/:id/adopt',async c=>{
  await requireCalendarReview(c.env);const u=currentUser(c),d=await input(c,z.object({requestId:z.string().uuid()}).strict());
  const saved=firstRow(await database(c.env).execute<{events:unknown}>(sql`select s.events from public.shared_academic_calendars s join public.profiles p on p.user_id=${u.id}::uuid and p.university_id=s.institution_id where s.id=${id(c.req.param('id'))}::uuid and s.institution_id=${u.universityId}::uuid and s.status='PUBLISHED' and (s.faculty_id is null or s.faculty_id=p.faculty_id) and (s.department_id is null or s.department_id=p.department_id)`));
  if(!saved)throw new AppError(404,'NOT_FOUND','This calendar is not published for your academic profile.');
  const events=z.array(calendarEventSchema).min(1).max(80).parse(saved.events);await saveCalendar(c.env,u,d.requestId,events);return c.json({saved:true,count:events.length});
});
calendarRoutes.put('/progression',async c=>{
  await requireCalendarReview(c.env);const u=currentUser(c),db=database(c.env);
  const d=await input(c,z.object({eventId:z.string().uuid(),sessionLabel:sessionSchema,toLevel:z.string().regex(/^[1-9]00$/),confirmFullSession:z.literal(true),hasNextLevel:z.literal(true)}).strict());
  const data=firstRow(await db.execute<{current_level:string;course_id:string;maximum_level:number;title:string;ends_on:string;semester:string;import_id:string;latest_exam:string}>(sql`select p.current_level,p.course_id,ceil(course.normal_duration_years)::int*100 as maximum_level,e.title,e.ends_on::text,e.semester,e.import_id,(select max(exam.ends_on)::text from public.student_calendar_events exam where exam.user_id=p.user_id and exam.import_id=e.import_id and exam.title~*'exam') as latest_exam from public.profiles p join public.courses course on course.id=p.course_id join public.student_calendar_events e on e.user_id=p.user_id and e.institution_id=p.university_id where p.user_id=${u.id}::uuid and p.university_id=${u.universityId}::uuid and e.id=${d.eventId}::uuid`));
  if(!data||!data.maximum_level)throw new AppError(409,'CONFLICT','Your programme duration must be verified before automatic level changes can be planned.');
  if(!/^[1-9]00$/.test(data.current_level)||Number(d.toLevel)!==Number(data.current_level)+100||Number(d.toLevel)>data.maximum_level)throw new AppError(400,'BAD_REQUEST','Check your next level. Final-year students are not automatically promoted beyond their programme.');
  if(!/exam/i.test(data.title)||!/second|2nd|final|third|3rd/i.test(data.semester+' '+data.title)||data.ends_on!==data.latest_exam)throw new AppError(400,'BAD_REQUEST','Choose the final examination of the full academic session, not a first-semester exam.');
  const today=new Date(Date.now()+3600000).toISOString().slice(0,10);
  if(data.ends_on<today||Date.parse(data.ends_on)>Date.now()+550*86400000)throw new AppError(400,'BAD_REQUEST','Choose a final exam date from today through the next 18 months.');
  const result=await db.execute(sql`insert into public.student_level_transitions(user_id,institution_id,source_course_id,source_import_id,session_label,from_level,to_level,exam_ends_on) values(${u.id}::uuid,${u.universityId}::uuid,${data.course_id}::uuid,${data.import_id}::uuid,${d.sessionLabel},${data.current_level},${d.toLevel},${data.ends_on}::date) on conflict(user_id) do update set institution_id=excluded.institution_id,source_course_id=excluded.source_course_id,source_import_id=excluded.source_import_id,session_label=excluded.session_label,from_level=excluded.from_level,to_level=excluded.to_level,exam_ends_on=excluded.exam_ends_on,status='PLANNED',confirmed_at=now(),completed_at=null where public.student_level_transitions.status<>'COMPLETED' or public.student_level_transitions.session_label<>excluded.session_label returning user_id`);
  if(!result.rows.length)throw new AppError(409,'CONFLICT','Your level has already changed for this session.');
  return c.json({planned:true,examEndsOn:data.ends_on,toLevel:d.toLevel});
});
calendarRoutes.delete('/progression',async c=>{await requireCalendarReview(c.env);await database(c.env).execute(sql`update public.student_level_transitions set status='CANCELLED' where user_id=${currentUser(c).id}::uuid and status='PLANNED'`);return c.json({cancelled:true});});
calendarRoutes.delete("/:id",async c=>{
  await database(c.env).execute(sql`delete from public.student_calendar_events where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid`);
  return c.json({deleted:true});
});
