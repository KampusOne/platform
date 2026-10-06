import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {currentUser,requireAuth} from '../middleware/auth';
import {database,firstRow} from '../lib/database';
import {input,id} from '../lib/input';
import {AppError} from '../lib/errors';
import {examEntrySchema} from '../lib/exam-schedule';
import {generateOtp,hashOtp,sha256} from '../lib/security';
import {sendMail,requireEmailProvider} from '../lib/email';
import type {Bindings,Variables} from '../types';
export const examRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
examRoutes.use('*',requireAuth);
examRoutes.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
examRoutes.get('/',async c=>{
 const user=currentUser(c);
 const exams=await database(c.env).execute(sql`select e.id,e.title,e.course_code,e.assessment_kind,e.is_personal,e.reminders_enabled,e.exam_date::text date,to_char(e.starts_at,'HH24:MI') starts_at,to_char(e.ends_at,'HH24:MI') ends_at,e.venue,
  exists(select 1 from app_private.exam_day_acknowledgements a where a.user_id=e.user_id and a.exam_date=e.exam_date) alarms_disabled
  from public.student_exams e where e.user_id=${user.id}::uuid and e.institution_id=${user.universityId}::uuid order by e.exam_date,e.starts_at,e.id limit 100`);
 const period=firstRow(await database(c.env).execute<{active:boolean;starts_on:string|null;ends_on:string|null}>(sql`select min(exam_date)::text starts_on,max(exam_date)::text ends_on,
  coalesce((now() at time zone 'Africa/Lagos')::date between min(exam_date) and max(exam_date),false) active from public.student_exams where user_id=${user.id}::uuid and institution_id=${user.universityId}::uuid`));
 return c.json({exams:exams.rows,period,timeZone:'Africa/Lagos'});
});
examRoutes.post('/import',async c=>{
 const user=currentUser(c),data=await input(c,z.object({requestId:z.string().uuid(),entries:z.array(examEntrySchema).min(1).max(80).refine(rows=>new Set(rows.map(r=>[r.date,r.startsAt,r.courseCode,r.title].join('|'))).size===rows.length,'Remove duplicate papers before saving.')}).strict());
 if(!user.universityId)throw new AppError(409,'CONFLICT','Choose your university before saving exams.');
 const hash=await sha256(JSON.stringify(data.entries));
 try{
  const result=firstRow(await database(c.env).execute(sql`select * from app_private.import_exam_schedule(${user.id}::uuid,${user.universityId}::uuid,${data.requestId}::uuid,${hash},${JSON.stringify(data.entries)}::jsonb)`));
  return c.json(result,201);
 }catch(error){if(/EXAM_REQUEST_CONFLICT|EXAM_TENANT_CHANGED/.test(String(error)))throw new AppError(409,'CONFLICT','Your schedule or university changed. Reload before saving.');throw error;}
});
examRoutes.post('/personal',async c=>{
 const user=currentUser(c),data=await input(c,z.object({requestId:z.string().uuid(),kind:z.enum(['TEST','EXAM']),entry:examEntrySchema}).strict());
 if(!user.universityId)throw new AppError(409,'CONFLICT','Choose your university first.');
 const start=Date.parse(data.entry.date+'T'+data.entry.startsAt+':00+01:00');
 if(start<=Date.now()||start>Date.now()+366*86400000)throw new AppError(400,'BAD_REQUEST','Choose a test or exam in the next year.');
 try{
  const result=firstRow(await database(c.env).execute(sql`select * from app_private.add_personal_assessment(${user.id}::uuid,${user.universityId}::uuid,${data.requestId}::uuid,${await sha256(JSON.stringify({kind:data.kind,entry:data.entry}))},${data.kind},${JSON.stringify(data.entry)}::jsonb)`));
  return c.json(result,201);
 }catch(error){if(/PERSONAL_ASSESSMENTS_FULL/.test(String(error)))throw new AppError(409,'CONFLICT','You can save up to 20 personal tests and exams.');if(/EXAM_REQUEST_CONFLICT|EXAM_TENANT_CHANGED/.test(String(error)))throw new AppError(409,'CONFLICT','Reload before saving this assessment.');throw error;}
});
examRoutes.post('/import-alarms',async c=>{
 const data=await input(c,z.object({entryIds:z.array(z.string().uuid()).min(1).max(100)}).strict());
 const result=firstRow(await database(c.env).execute<{imported:number}>(sql`select app_private.import_exam_alarms(${currentUser(c).id}::uuid,${sql.param(data.entryIds)}::uuid[]) imported`));
 return c.json(result);
});
examRoutes.get('/alarms/:id',async c=>{
 const row=firstRow(await database(c.env).execute(sql`select e.id,e.title,e.course_code,e.assessment_kind,e.is_personal,e.reminders_enabled,e.exam_date::text date,e.venue,
  (e.exam_date+e.starts_at) at time zone 'Africa/Lagos' starts_at,l.lead_minutes,
  exists(select 1 from app_private.exam_day_acknowledgements ack where ack.user_id=e.user_id and ack.exam_date=e.exam_date) disabled
  from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id
  where l.alarm_id=${id(c.req.param('id'))}::uuid and e.user_id=${currentUser(c).id}::uuid`));
 if(!row)throw new AppError(404,'NOT_FOUND','This is not one of your exam alarms.');return c.json({exam:row});
});
examRoutes.post('/disable/request',async c=>{
 requireEmailProvider(c.env);const user=currentUser(c),data=await input(c,z.object({alarmId:z.string().uuid()}).strict());
 const db=database(c.env);
 const allowed=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('EXAM_DISABLE_CODE',${user.id},5,3600,3600) allowed`));
 if(!allowed?.allowed)throw new AppError(429,'RATE_LIMITED','Please wait before requesting another code. Your remaining alarms are still enabled.');
 const exam=firstRow(await db.execute<{date:string}>(sql`select e.exam_date::text date from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where l.alarm_id=${data.alarmId}::uuid and e.user_id=${user.id}::uuid
  and (e.exam_date+e.starts_at) at time zone 'Africa/Lagos'>now() and ((e.exam_date+e.starts_at) at time zone 'Africa/Lagos')-now()<=interval '3 hours'`));
 if(!exam)throw new AppError(409,'CONFLICT','This exam is outside its alarm period.');
 const challenge=crypto.randomUUID(),code=generateOtp();
 await db.execute(sql`insert into app_private.exam_disable_challenges(id,user_id,exam_date,code_hash,expires_at) values(${challenge}::uuid,${user.id}::uuid,${exam.date}::date,${await hashOtp(c.env,code)},now()+interval '10 minutes')`);
 await sendMail(c.env,{to:user.email,kind:'exam-awareness',code,idempotencyKey:'exam-awareness/'+challenge});
 return c.json({challengeId:challenge,expiresInSeconds:600,message:'Enter the code sent to your email to disable the remaining exam alarms today.'});
});
examRoutes.post('/disable/confirm',async c=>{
 const data=await input(c,z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{6}$/)}).strict());
 const state=firstRow(await database(c.env).execute<{state:string}>(sql`select app_private.confirm_exam_awareness(${currentUser(c).id}::uuid,${data.challengeId}::uuid,${await hashOtp(c.env,data.code)}) state`))?.state;
 if(state!=='CONFIRMED'&&state!=='ALREADY_CONFIRMED')throw new AppError(400,'BAD_REQUEST',state==='INCORRECT'?'That code is incorrect. The remaining exam alarms are still enabled.':'That code expired. Request another code.');
 return c.json({disabled:true});
});
