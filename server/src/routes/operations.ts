import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow,sqlClient} from '../lib/database';
import {id,input} from '../lib/input';
import {AppError} from '../lib/errors';
import {currentUser} from '../middleware/auth';
import {adminAccess,ADMIN_PERMISSIONS,resolveAdminScope} from '../lib/admin-access';
import {recordAudit} from '../lib/audit';
import {adminWorkspaceReady,requireAdminWorkspace,staffRequestDigest}from'../lib/admin-workspace';
import {hashPassword,validatePassword}from'../lib/security';
import type {Bindings,Variables} from '../types';
export const operationsRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
operationsRoutes.get('/access',async c=>{
 const access=await adminAccess(c.env,currentUser(c));
 const universities=await database(c.env).execute(sql`select id,name from public.universities where deleted_at is null and (${access.allUniversities} or id=any(${sql.param(access.universityIds)}::uuid[])) order by name`);
 return c.json({permissions:access.permissions,universityIds:access.universityIds,allUniversities:access.allUniversities,universities:universities.rows});
});
operationsRoutes.get('/staff',async c=>{
 const actor=currentUser(c);if(!actor.operatorRoles.includes('PLATFORM_ADMIN'))throw new AppError(403,'FORBIDDEN','Only a platform administrator can inspect staff access.');
 if(!await adminWorkspaceReady(c.env))return c.json({ready:false,staff:[],permissions:ADMIN_PERMISSIONS,message:'Staff accounts are awaiting the database update.'});
 const rows=await database(c.env).execute(sql`select a.user_id,u.email,p.display_name,a.permissions,a.university_ids,a.all_universities,a.status,a.updated_at from app_private.staff_access a join public.users u on u.id=a.user_id left join public.profiles p on p.user_id=a.user_id order by a.updated_at desc limit 200`);
 return c.json({staff:rows.rows,permissions:ADMIN_PERMISSIONS});
});
operationsRoutes.post('/staff',async c=>{
 const actor=currentUser(c);
 if(!actor.operatorRoles.includes('PLATFORM_ADMIN'))throw new AppError(403,'FORBIDDEN','Only a platform administrator can create a staff account.');
 await requireAdminWorkspace(c.env);
 const d=await input(c,z.object({requestId:z.string().uuid(),email:z.string().trim().email().max(254).toLowerCase(),password:z.string().min(12).max(128),displayName:z.string().trim().min(2).max(120),permissions:z.array(z.enum(ADMIN_PERMISSIONS)).min(1).max(50),universityIds:z.array(z.string().uuid()).max(500),allUniversities:z.boolean(),reason:z.string().trim().min(10).max(1000)}).strict());
 validatePassword(d.password);
 if(!d.allUniversities&&!d.universityIds.length)throw new AppError(400,'BAD_REQUEST','Select at least one university.');
 const normalized={...d,permissions:[...new Set(d.permissions)].sort(),universityIds:[...new Set(d.universityIds)].sort()};
 const digest=await staffRequestDigest(c.env,normalized);
 const previous=firstRow(await database(c.env).execute<{user_id:string;request_digest:string}>(sql`select user_id,request_digest from app_private.staff_account_provisions where actor_user_id=${actor.id}::uuid and request_id=${d.requestId}::uuid`));
 if(previous){if(previous.request_digest!==digest)throw new AppError(409,'CONFLICT','This request identifier was used for different staff details.');return c.json({id:previous.user_id,email:d.email,reused:true});}
 const rate=firstRow(await database(c.env).execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('STAFF_CREATE',${actor.id},20,3600,3600)allowed`));if(!rate?.allowed)throw new AppError(429,'RATE_LIMITED','Staff creation limit reached. Try again later.');
 const passwordHash=await hashPassword(d.password);
 try{
  const created=firstRow(await database(c.env).execute<{user_id:string;reused:boolean}>(sql`select * from app_private.provision_staff_account(${actor.id}::uuid,${d.requestId}::uuid,${digest},${d.email},${passwordHash},${d.displayName},${sql.param(normalized.permissions)}::text[],${sql.param(normalized.universityIds)}::uuid[],${d.allUniversities},${d.reason.replaceAll(d.password,'[credential redacted]')})`));
  if(!created)throw new Error('Staff provision returned no identity');
  return c.json({id:created.user_id,email:d.email,reused:created.reused},created.reused?200:201);
 }catch(error){
  const message=error instanceof Error?error.message:String(error);
  if(/STAFF_EMAIL_EXISTS|users_email_key/.test(message))throw new AppError(409,'CONFLICT','This email already has an account. Manage its existing access; its password has not been changed.');
  if(message.includes('STAFF_PROVISION_REQUEST_CHANGED'))throw new AppError(409,'CONFLICT','This request identifier was used for different staff details.');
  if(message.includes('STAFF_UNIVERSITY_UNAVAILABLE'))throw new AppError(400,'BAD_REQUEST','A selected university is unavailable.');
  if(message.includes('STAFF_PROVISION_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','Only a platform administrator can create a staff account.');
  throw error;
 }
});
operationsRoutes.put('/staff/:id',async c=>{
 const actor=currentUser(c),target=id(c.req.param('id'));
 if(!actor.operatorRoles.includes('PLATFORM_ADMIN'))throw new AppError(403,'FORBIDDEN','Only a platform administrator can provision staff access.');
 if(actor.id===target)throw new AppError(409,'CONFLICT','Another platform administrator must review changes to your access.');
 if(!firstRow(await database(c.env).execute<{ready:boolean}>(sql`select to_regclass('app_private.staff_access')is not null ready`))?.ready)throw new AppError(503,'PROVIDER_UNAVAILABLE','Staff access is awaiting the database update.');
 const d=await input(c,z.object({permissions:z.array(z.enum(ADMIN_PERMISSIONS)).max(50),universityIds:z.array(z.string().uuid()).max(500),allUniversities:z.boolean(),status:z.enum(['ACTIVE','SUSPENDED']),reason:z.string().trim().min(10).max(1000)}));
 if(!d.allUniversities&&!d.universityIds.length)throw new AppError(400,'BAD_REQUEST','Select at least one university.');
 const eligible=firstRow(await database(c.env).execute(sql`select id from public.users where id=${target}::uuid and email_verified_at is not null and deleted_at is null and not exists(select 1 from public.operator_roles where user_id=${target}::uuid and role='PLATFORM_ADMIN')`));
 if(!eligible)throw new AppError(409,'CONFLICT','Choose a verified existing account without platform administrator privileges.');
 const schools=await database(c.env).execute(sql`select id from public.universities where id=any(${sql.param(d.universityIds)}::uuid[]) and deleted_at is null`);
 if(schools.rows.length!==new Set(d.universityIds).size)throw new AppError(400,'BAD_REQUEST','A selected university is unavailable.');
 await database(c.env).execute(sql`insert into app_private.staff_access(user_id,permissions,university_ids,all_universities,status,updated_by) values(${target}::uuid,${sql.param(d.permissions)}::text[],${sql.param([...new Set(d.universityIds)])}::uuid[],${d.allUniversities},${d.status},${actor.id}::uuid) on conflict(user_id) do update set permissions=excluded.permissions,university_ids=excluded.university_ids,all_universities=excluded.all_universities,status=excluded.status,updated_by=excluded.updated_by,updated_at=now()`);
 await recordAudit(c.env,{actorUserId:actor.id,action:'staff.access.updated',targetType:'user',targetId:target,requestId:c.get('requestId'),metadata:d});
 return c.json({status:'saved'});
});
operationsRoutes.post('/users/:id/verification',async c=>{
 const actor=currentUser(c),target=id(c.req.param('id'));
 const d=await input(c,z.object({status:z.enum(['UNVERIFIED','VERIFIED','REJECTED']),expected:z.enum(['UNVERIFIED','PENDING','VERIFIED','REJECTED']),reason:z.string().trim().min(10).max(1000)}).strict());
 if(d.status===d.expected)throw new AppError(400,'BAD_REQUEST','Choose a verification status that changes the current account state.');
 const profile=firstRow(await database(c.env).execute<{university_id:string|null}>(sql`select university_id from public.profiles where user_id=${target}::uuid and deleted_at is null`));
 if(!profile)throw new AppError(404,'NOT_FOUND','Profile not found.');
 const scope=await resolveAdminScope(c.env,actor,profile.university_id??undefined,'users.verify');
 if(scope!==null&&profile.university_id!==scope)throw new AppError(403,'FORBIDDEN','This profile is outside your university scope.');
 const action=d.status==='VERIFIED'?'user.verification.verified':d.status==='REJECTED'?'user.verification.rejected':'user.verification.reset';
 const saved=firstRow(await database(c.env).execute<{status:string}>(sql`
  with updated as(
   update public.profiles set verification_status=${d.status}::"VerificationStatus",updated_at=now()
   where user_id=${target}::uuid and deleted_at is null and verification_status::text=${d.expected}
   returning verification_status::text status,university_id
  ), logged as(
   insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)
   select ${actor.id}::uuid,updated.university_id,${action},'user',${target},${c.get('requestId')},'succeeded',
    jsonb_build_object('previous',${d.expected}::text,'status',updated.status,'reason',${d.reason}::text)
   from updated returning target_id
  )
  select updated.status from updated join logged on logged.target_id=${target}
 `));
 if(!saved)throw new AppError(409,'CONFLICT','The verification status changed in another session. Reload this profile before recording a decision.');
 return c.json({verification:saved});
});
const sources={
 universities:sql`select u.id,u.name,u.state,u.slug,u.id institution_id,u.created_at,coalesce(cfg.status,'CATALOGUED') status,'UNIVERSITY' type from public.universities u left join public.institution_config cfg on cfg.institution_id=u.id where u.deleted_at is null`,
 users:sql`select u.id,p.display_name name,u.email,u.status::text status,p.university_id institution_id,u.created_at,p.profile_image_url,p.cover_image_url,p.verification_status::text verification_status,coalesce(p.public_badge_verified,p.verification_status::text='VERIFIED',false) public_badge_verified,array_to_string(u.roles,',') type from public.users u left join public.profiles p on p.user_id=u.id and p.deleted_at is null where u.deleted_at is null`,
 agents:sql`select a.id,a.display_name name,a.agent_type type,a.status,a.university_id institution_id,a.submitted_at created_at from public.agent_applications a`,
 'academic-submissions':sql`select a.id,a.department_name name,a.faculty_name,a.programme_name,a.status,'SUBMISSION' type,a.institution_id,a.created_at,a.source_note from public.academic_missing_submissions a`,
 content:sql`select f.id,f.title name,f.category type,f.status,f.university_id institution_id,f.created_at,f.author_user_id from public.feed_posts f`,
 analytics:sql`select e.id,e.event_name name,e.screen,e.feature,e.error_code,e.event_name type,'RECORDED' status,e.institution_id,e.created_at from public.product_events e`,
 finance:sql`select o.id,'Store order' name,o.status,o.university_id institution_id,o.created_at,'ORDER' type,o.total_kobo from public.orders o`,
 audit:sql`select a.id::text id,a.action name,a.target_type type,a.outcome status,a.university_id institution_id,a.occurred_at created_at,a.target_id from app_private.audit_events a`,
 ai:sql`select r.idempotency_key id,r.mode name,r.status,p.university_id institution_id,r.created_at,r.mode type from app_private.ai_requests r left join public.profiles p on p.user_id=r.user_id`,
 support:sql`select s.id,s.subject name,s.category type,s.status,s.institution_id,s.created_at from public.support_requests s`,
} as const;
const sourceDependencies:Record<keyof typeof sources,string[]>={
 universities:['public.universities','public.institution_config'],users:['public.users','public.profiles'],agents:['public.agent_applications'],
 'academic-submissions':['public.academic_missing_submissions'],content:['public.feed_posts'],analytics:['public.product_events'],finance:['public.orders'],audit:['app_private.audit_events'],ai:['app_private.ai_requests','public.profiles'],support:['public.support_requests']
};
async function workspaceSourceReady(env:Bindings,module:keyof typeof sources){
 return firstRow(await database(env).execute<{ready:boolean}>(sql`select not exists(select 1 from unnest(${sql.param(sourceDependencies[module])}::text[])name where to_regclass(name)is null)ready`))?.ready===true;
}
operationsRoutes.post('/workspaces/:module/export',async c=>{
 const module=c.req.param('module') as keyof typeof sources,source=sources[module];
 if(!source)throw new AppError(404,'NOT_FOUND','This workspace has not been implemented.');
 const d=await input(c,z.object({reason:z.string().trim().min(10).max(1000)}).strict()),actor=currentUser(c),scope=await resolveAdminScope(c.env,actor,c.req.query('universityId'));
 if(!await workspaceSourceReady(c.env,module))throw new AppError(503,'PROVIDER_UNAVAILABLE','This workspace is awaiting its database update.');
 const q=c.req.query('q')?.trim().slice(0,160),status=c.req.query('status')||null,type=c.req.query('type')||null;
 const search=q?`%${q.replace(/[\\%_]/g,'\\$&')}%`:null,searchColumn=module==='users'?sql`concat_ws(' ',name,email)`:sql`name`;
 const rows=await database(c.env).execute<Record<string,unknown>>(sql`with workspace as(${source})select * from workspace where(${scope}::uuid is null or institution_id=${scope}::uuid)and(${search}::text is null or ${searchColumn} ilike ${search})and(${status}::text is null or status=${status})and(${type}::text is null or type=${type})order by created_at desc,id limit 10001`);
 if(rows.rows.length>10000)throw new AppError(409,'CONFLICT','This export exceeds 10,000 records. Choose a university or narrow the search before exporting.');
 await recordAudit(c.env,{actorUserId:actor.id,universityId:scope,action:'workspace.csv.exported',targetType:'workspace',targetId:module,requestId:c.get('requestId'),metadata:{reason:d.reason,rows:rows.rows.length,filters:{q,status,type}}});
 const columns=rows.rows.length?Object.keys(rows.rows[0]!):['id','name','institution_id','status','created_at'];
 return c.json({filename:`kampusone-${module}-${new Date().toISOString().slice(0,10)}.csv`,columns,rows:rows.rows,generatedAt:new Date().toISOString()});
});
operationsRoutes.get('/workspaces/:module',async c=>{
 const module=c.req.param('module') as keyof typeof sources,source=sources[module];
 if(!source)throw new AppError(404,'NOT_FOUND','This workspace has not been implemented.');
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'));
 const q=c.req.query('q')?.trim().slice(0,160),status=c.req.query('status')||null,type=c.req.query('type')||null;
 const page=Math.max(1,Math.min(10000,Number(c.req.query('page'))||1)),pageSize=Math.max(1,Math.min(100,Number(c.req.query('pageSize'))||25));
 if(!await workspaceSourceReady(c.env,module))return c.json({ready:false,message:'This workspace is awaiting its database update.',rows:[],page:Math.trunc(page),pageSize:Math.trunc(pageSize)});
 const sort=['name','created_at','status','type'].includes(c.req.query('sort')??'')?c.req.query('sort')!:'created_at';
 const direction=c.req.query('direction')==='asc'?'asc':'desc';
 const searchColumn=module==='users'?sql`concat_ws(' ',name,email)`:sql`name`;
 const search=q?`%${q.replace(/[\\%_]/g,'\\$&')}%`:null;
 const filter=sql`(${scope}::uuid is null or institution_id=${scope}::uuid) and (${search}::text is null or ${searchColumn} ilike ${search}) and (${status}::text is null or status=${status}) and (${type}::text is null or type=${type})`;
 const db=database(c.env);
 const [rows,count]=await Promise.all([db.execute(sql`with workspace as (${source}) select * from workspace where ${filter} order by ${sql.identifier(sort)} ${sql.raw(direction)},id limit ${Math.trunc(pageSize)} offset ${Math.trunc((page-1)*pageSize)}`),db.execute<{total:number}>(sql`with workspace as (${source}) select count(*)::int total from workspace where ${filter}`)]);
 return c.json({rows:rows.rows,total:firstRow(count)?.total??0,page:Math.trunc(page),pageSize:Math.trunc(pageSize),generatedAt:new Date().toISOString()});
});
operationsRoutes.post('/academic-submissions/:id/review',async c=>{
 const d=await input(c,z.object({decision:z.enum(['APPROVED','REJECTED','NEEDS_CORRECTION']),departmentId:z.string().uuid().optional(),reason:z.string().trim().min(10).max(2000)}));
 const actor=currentUser(c),target=id(c.req.param('id'));
 const row=firstRow(await database(c.env).execute<{institution_id:string;user_id:string}>(sql`select institution_id,user_id from public.academic_missing_submissions where id=${target}::uuid`));
 if(!row)throw new AppError(404,'NOT_FOUND','Submission not found.');
 await resolveAdminScope(c.env,actor,row.institution_id,'academic.manage');
 if(d.decision==='APPROVED'&&(!d.departmentId||!firstRow(await database(c.env).execute(sql`select d.id from public.departments d join public.faculties f on f.id=d.faculty_id where d.id=${d.departmentId??null}::uuid and f.university_id=${row.institution_id}::uuid and d.deleted_at is null and f.deleted_at is null`))))throw new AppError(400,'BAD_REQUEST','Choose a reviewed department belonging to this university.');
 const client=sqlClient(c.env),queries=[client`update public.academic_missing_submissions set status=${d.decision},linked_department_id=${d.departmentId??null}::uuid,review_note=${d.reason},reviewed_by=${actor.id}::uuid,reviewed_at=now(),updated_at=now() where id=${target}::uuid`];
 if(d.decision==='APPROVED')queries.push(client`update public.profiles set department_id=${d.departmentId}::uuid,faculty_id=(select faculty_id from public.departments where id=${d.departmentId}::uuid),provisional_academic_submission_id=null,updated_at=now() where user_id=${row.user_id}::uuid and university_id=${row.institution_id}::uuid and provisional_academic_submission_id=${target}::uuid`);
 await client.transaction(queries);
 await recordAudit(c.env,{actorUserId:actor.id,universityId:row.institution_id,action:'academic.submission.reviewed',targetType:'academic_submission',targetId:target,requestId:c.get('requestId'),metadata:d});
 return c.json({status:d.decision});
});
operationsRoutes.post('/users/:id/publishing-capabilities',async c=>{
 const target=id(c.req.param('id')),actor=currentUser(c);
 const d=await input(c,z.object({capability:z.enum(['POLL','QA','ANONYMOUS_QA']),enabled:z.boolean(),reason:z.string().trim().min(10).max(1000)}));
 const profile=firstRow(await database(c.env).execute<{university_id:string|null}>(sql`select university_id from public.profiles where user_id=${target}::uuid and deleted_at is null`));
 if(!profile?.university_id)throw new AppError(409,'CONFLICT','The publisher needs a complete university profile.');
 await resolveAdminScope(c.env,actor,profile.university_id,'content.capabilities');
 await database(c.env).execute(sql`insert into app_private.publishing_capabilities(user_id,institution_id,capability,granted_by,reason,revoked_at) values(${target}::uuid,${profile.university_id}::uuid,${d.capability},${actor.id}::uuid,${d.reason},case when ${d.enabled} then null else now() end) on conflict(user_id,institution_id,capability) do update set granted_by=excluded.granted_by,reason=excluded.reason,granted_at=now(),revoked_at=excluded.revoked_at`);
 await recordAudit(c.env,{actorUserId:actor.id,universityId:profile.university_id,action:d.enabled?'publisher.capability.granted':'publisher.capability.revoked',targetType:'user',targetId:target,requestId:c.get('requestId'),metadata:d});
 return c.json({status:d.enabled?'enabled':'revoked'});
});

operationsRoutes.get('/reports/engagement',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'analytics.view');
 const days=Number(c.req.query('days')??30);if(![7,30,90].includes(days))throw new AppError(400,'BAD_REQUEST','Choose 7, 30 or 90 days.');
 const db=database(c.env),since=new Date(Date.now()-days*86400000).toISOString(),extended=await adminWorkspaceReady(c.env);
 const platform=z.enum(['android','ios','web','unknown']).optional().safeParse(c.req.query('platform')||undefined);if(!platform.success)throw new AppError(400,'BAD_REQUEST','Choose Android, iPhone, web or unclassified activity.');
 if(!await workspaceSourceReady(c.env,'analytics'))return c.json({ready:false,message:'Activity collection is awaiting its database update. No activity totals are available yet.'});
 const platformValue=extended?sql`coalesce(e.platform,'unknown')`:sql`'unknown'::text`;
 const scoped=sql`(${scope}::uuid is null or e.institution_id=${scope}::uuid)and(${platform.data??null}::text is null or ${platformValue}=${platform.data??null})`;
 const [totals,daily,screens,universities,retention,platforms,interactions]=await Promise.all([
  db.execute(sql`select count(*) filter(where e.created_at>=${since}::timestamptz)::int events,count(distinct e.user_id) filter(where e.created_at>=${since}::timestamptz)::int active_users,min(e.created_at) collection_started_at from public.product_events e where ${scoped}`),
  db.execute(sql`select (e.created_at at time zone 'Africa/Lagos')::date::text as "day",count(*)::int events,count(distinct e.user_id)::int active_users from public.product_events e where ${scoped} and e.created_at>=${since}::timestamptz group by 1 order by 1`),
  db.execute(sql`select coalesce(e.screen,'Unspecified') screen,count(*)::int views,count(distinct e.user_id)::int active_users from public.product_events e where ${scoped} and e.created_at>=${since}::timestamptz and e.event_name='screen_view' group by 1 order by views desc limit 100`),
  db.execute(sql`select u.id,u.name,count(distinct e.user_id)::int active_users,count(e.id)::int events from public.universities u left join public.product_events e on e.institution_id=u.id and e.created_at>=${since}::timestamptz and(${platform.data??null}::text is null or ${platformValue}=${platform.data??null})where u.deleted_at is null and (${scope}::uuid is null or u.id=${scope}::uuid) group by u.id,u.name order by active_users desc,u.name limit 500`),
  db.execute(sql`with first_seen as(select e.user_id,min(e.created_at) first_at from public.product_events e where ${scoped} group by e.user_id), eligible as(select * from first_seen where first_at>=${since}::timestamptz and first_at<now()-interval '8 days') select count(*)::int eligible_users,count(*) filter(where exists(select 1 from public.product_events e where ${scoped} and e.user_id=eligible.user_id and e.created_at>=eligible.first_at+interval '1 day' and e.created_at<eligible.first_at+interval '8 days'))::int returned_users from eligible`),
  db.execute(sql`select ${platformValue} platform,count(*)::int events,count(distinct e.user_id)::int active_users from public.product_events e where ${scoped}and e.created_at>=${since}::timestamptz group by 1 order by 1`),
  extended?db.execute(sql`select coalesce(e.screen,'Unspecified')screen,e.event_name event,e.action,e.component,e.percent_scrolled,count(*)::int events,count(distinct e.user_id)::int active_users from public.product_events e where ${scoped}and e.created_at>=${since}::timestamptz and e.event_name in('ui_interaction','content_action','scroll_depth')group by 1,2,3,4,5 order by events desc limit 200`):Promise.resolve({rows:[]})
 ]);
 c.header('Cache-Control','private, no-store');
 return c.json({days,since,generatedAt:new Date().toISOString(),totals:firstRow(totals),daily:daily.rows,screens:screens.rows,universities:universities.rows,retention:firstRow(retention),platforms:platforms.rows,interactions:interactions.rows,platformReady:extended,definition:'Recorded activity only. Platforms are reported by the app; older events stay unclassified. An account can appear on multiple platforms. Return rate is activity 1–7 days after first recorded activity, among users with eight days of observation.'});
});
operationsRoutes.get('/reports/ai',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'ai.view');
 const rows=await database(c.env).execute(sql`select r.mode,r.status,count(*)::int requests,max(r.created_at) latest_at from app_private.ai_requests r join public.profiles p on p.user_id=r.user_id where r.created_at>=now()-interval '30 days' and (${scope}::uuid is null or p.university_id=${scope}::uuid) group by r.mode,r.status order by r.mode,r.status`);
 c.header('Cache-Control','private, no-store');
 return c.json({usage:rows.rows,configuration:{enabled:c.env.AI_ASSISTANT_ENABLED==='true',textConfigured:Boolean(c.env.HF_TOKEN&&c.env.HF_CHAT_MODEL),visionConfigured:Boolean(c.env.HF_TOKEN&&c.env.HF_VISION_MODEL)},measuredProviderLatency:null,measuredCost:null});
});
