import {Hono} from 'hono';
import {z} from '@kampusone/contracts';
import {sql} from 'drizzle-orm';
import {currentUser,requireAuth} from '../middleware/auth';
import {database,firstRow} from '../lib/database';
import {resolveAdminScope} from '../lib/admin-access';
import {input} from '../lib/input';
import {AppError} from '../lib/errors';
import type {Bindings,Variables} from '../types';
import {reportWindow} from '../lib/admin-reporting';
export const usageRoutes=new Hono<{Bindings:Bindings,Variables:Variables}>();
usageRoutes.use('*',requireAuth);
const sample=z.object({id:z.string().uuid(),ownerUserId:z.string().uuid(),platform:z.enum(['android','ios','web']),screen:z.string().regex(/^[a-zA-Z0-9_\-/()\[\]]{1,100}$/),startedAt:z.iso.datetime(),endedAt:z.iso.datetime(),seconds:z.number().positive().max(60)}).strict();
usageRoutes.post('/',async c=>{const d=await input(c,sample),u=currentUser(c);if(d.ownerUserId!==u.id)throw new AppError(403,'FORBIDDEN','This sample belongs to another account.');const start=Date.parse(d.startedAt),end=Date.parse(d.endedAt),now=Date.now();if(end<=start||end-start>61000||end>now+120000||start<now-48*3600000||Math.abs((end-start)/1000-d.seconds)>1)throw new AppError(400,'BAD_REQUEST','This foreground sample is outside its collection window.');const institution=u.universityId??firstRow(await database(c.env).execute<{university_id:string}>(sql`select university_id from public.agent_profiles where user_id=${u.id}::uuid and status='ACTIVE'order by verified_at desc limit 1`))?.university_id;if(!institution)return c.json({recorded:false});const rate=firstRow(await database(c.env).execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('FOREGROUND_USAGE',${u.id},300,3600,3600) allowed`));if(!rate?.allowed)throw new AppError(429,'RATE_LIMITED','Usage reporting will resume shortly.');await database(c.env).execute(sql`insert into app_private.foreground_usage_samples(id,user_id,institution_id,platform,screen,started_at,ended_at,seconds)values(${d.id}::uuid,${u.id}::uuid,${institution}::uuid,${d.platform},${d.screen},${d.startedAt}::timestamptz,${d.endedAt}::timestamptz,${d.seconds})on conflict(id)do nothing`);return c.json({recorded:true},201);});
usageRoutes.get('/admin/today',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'analytics.view'),db=database(c.env);
 const window=reportWindow(c.req.query('date'));
 const scoped=sql`(${scope}::uuid is null or s.institution_id=${scope}::uuid)and s.ended_at>=${window.start}::timestamptz and s.ended_at<${window.end}::timestamptz`;
 const ready=firstRow(await db.execute<{ready:boolean}>(sql`select to_regclass('app_private.foreground_usage_samples')is not null ready`))?.ready;
 if(!ready)return c.json({ready:false,message:'Foreground usage awaits the database update.'});
 const [totals,users,screens]=await Promise.all([
  db.execute(sql`select round(coalesce(sum(s.seconds),0),0)::int foreground_seconds,count(distinct s.user_id)::int users,count(*)::int samples,${window.day}::text as "day" from app_private.foreground_usage_samples s where ${scoped}`),
  db.execute(sql`select s.user_id,p.display_name,p.username,round(sum(s.seconds),0)::int foreground_seconds,array_agg(distinct s.platform)platforms from app_private.foreground_usage_samples s left join public.profiles p on p.user_id=s.user_id where ${scoped} group by s.user_id,p.display_name,p.username order by foreground_seconds desc limit 500`),
  db.execute(sql`select s.screen,round(sum(s.seconds),0)::int foreground_seconds from app_private.foreground_usage_samples s where ${scoped} group by s.screen order by foreground_seconds desc limit 30`)
 ]);
 c.header('Cache-Control','private, no-store');
 return c.json({ready:true,totals:firstRow(totals),users:users.rows,screens:screens.rows,timeZone:'Africa/Lagos',definition:'Measured time while KampusOne is visible in the foreground, sampled in intervals of at most one minute. Background and other apps are excluded. Multiple devices are added together. Offline samples can arrive for 48 hours; this is not Android’s system screen-time report.'});
});
