import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from '@kampusone/contracts';
import { currentUser, requireAuth } from '../middleware/auth';
import { database, firstRow, sqlClient } from '../lib/database';
import { input, id } from '../lib/input';
import { AppError } from '../lib/errors';
import { resolveAdminScope } from '../lib/admin-access';
import { recordAudit } from '../lib/audit';
import { expoTokenPattern, sendTestPush, fetchPushReceipt } from '../lib/push';
import type { Bindings, Variables } from '../types';

export const notificationRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
notificationRoutes.use('/*',requireAuth);
notificationRoutes.use('/*',async(c,next)=>{
 if(c.env.UNIFIED_SCHEMA_READY!=='true')throw new AppError(503,'PROVIDER_UNAVAILABLE','Notifications are unavailable until the account service is ready.');
 await next();
});
notificationRoutes.get('/devices',async c=>{
 const result=await database(c.env).execute(sql`select id,platform,label,build_version,active,created_at,updated_at from app_private.push_devices where user_id=${currentUser(c).id}::uuid order by updated_at desc limit 30`);
 return c.json({devices:result.rows});
});
notificationRoutes.post('/devices',async c=>{
 const u=currentUser(c),data=await input(c,z.object({expoPushToken:z.string().regex(expoTokenPattern),platform:z.enum(['ios','android']),label:z.string().trim().min(1).max(100),buildVersion:z.string().trim().min(1).max(60)}).strict());
 const db=database(c.env);
 const result=await db.execute(sql`insert into app_private.push_devices(user_id,token,session_family_id,platform,label,build_version) values(${u.id}::uuid,${data.expoPushToken},${u.sessionFamilyId}::uuid,${data.platform},${data.label},${data.buildVersion}) on conflict(token) do update set user_id=excluded.user_id,session_family_id=excluded.session_family_id,platform=excluded.platform,label=excluded.label,build_version=excluded.build_version,active=true,updated_at=now() returning id,platform,label,build_version,active,updated_at`);
 return c.json({device:firstRow(result)});
});
notificationRoutes.delete('/devices/:id',async c=>{
 await database(c.env).execute(sql`update app_private.push_devices set active=false,updated_at=now() where id=${id(c.req.param('id'))}::uuid and user_id=${currentUser(c).id}::uuid`);
 return c.json({status:'disabled'});
});
notificationRoutes.get('/admin/devices',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'notifications.test');
 const userId=c.req.query('userId')?id(c.req.query('userId')!):null;
 const result=await database(c.env).execute(sql`select d.id,d.user_id,d.platform,d.label,d.build_version,d.active,d.updated_at,p.display_name,p.university_id from app_private.push_devices d join public.profiles p on p.user_id=d.user_id where d.active and exists(select 1 from public.refresh_tokens rt where rt.family_id=d.session_family_id and rt.user_id=d.user_id and rt.revoked_at is null and rt.expires_at>now()) and p.deleted_at is null and (${scope}::uuid is null or p.university_id=${scope}::uuid) and (${userId}::uuid is null or d.user_id=${userId}::uuid) order by d.updated_at desc limit 100`);
 return c.json({devices:result.rows,scope:{universityId:scope}});
});
type Device={id:string;user_id:string;token:string;university_id:string|null};
notificationRoutes.post('/admin/test',async c=>{
 const u=currentUser(c),data=await input(c,z.object({deviceId:z.string().uuid(),requestId:z.string().uuid()}).strict());
 const db=database(c.env);
 const device=firstRow(await db.execute<Device>(sql`select d.id,d.user_id,d.token,p.university_id from app_private.push_devices d join public.profiles p on p.user_id=d.user_id join public.users u on u.id=d.user_id where d.id=${data.deviceId}::uuid and d.active and exists(select 1 from public.refresh_tokens rt where rt.family_id=d.session_family_id and rt.user_id=d.user_id and rt.revoked_at is null and rt.expires_at>now()) and u.deleted_at is null and u.status::text='ACTIVE' and p.deleted_at is null`));
 if(!device)throw new AppError(404,'NOT_FOUND','The selected device is no longer available.');
 const scope=await resolveAdminScope(c.env,u,device.university_id??undefined,'notifications.test');
 if(device.university_id===null&&scope!==null)throw new AppError(403,'FORBIDDEN','This device is outside your university scope.');
 const existing=firstRow(await db.execute<{device_id:string;actor_user_id:string;status:string}>(sql`select device_id,actor_user_id,status from app_private.push_attempts where id=${data.requestId}::uuid`));
 if(existing){
  if(existing.device_id!==device.id||existing.actor_user_id!==u.id)throw new AppError(409,'CONFLICT','Use a new request ID for a different test.');
  return c.json({attemptId:data.requestId,status:existing.status,deviceDelivery:'not_observed'});
 }
 const limit=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('push-test',${u.id},10,3600,3600) as allowed`));
 if(!limit?.allowed)throw new AppError(429,'RATE_LIMITED','Too many test notifications. Try again later.');
 const claimed=firstRow(await db.execute(sql`insert into app_private.push_attempts(id,device_id,actor_user_id,recipient_user_id,institution_id,status) values(${data.requestId}::uuid,${device.id}::uuid,${u.id}::uuid,${device.user_id}::uuid,${device.university_id}::uuid,'SENDING') on conflict do nothing returning id`));
 if(!claimed)return c.json({attemptId:data.requestId,status:'SENDING',deviceDelivery:'not_observed'},202);
 // Record the permitted intent before provider invocation; no token or recipient contact goes into audit metadata.
 await recordAudit(c.env,{actorUserId:u.id,universityId:device.university_id,action:'notification.test_requested',targetType:'push_attempt',targetId:data.requestId,requestId:c.get('requestId')});
 const result=await sendTestPush(c.env,device.token,data.requestId);
 await db.execute(sql`update app_private.push_attempts set status=${result.status},ticket_id=${result.ticketId??null},error_code=${result.errorCode??null} where id=${data.requestId}::uuid`);
 if(result.errorCode==='DeviceNotRegistered')await db.execute(sql`update app_private.push_devices set active=false where id=${device.id}::uuid`);
 return c.json({attemptId:data.requestId,status:result.status,errorCode:result.errorCode,deviceDelivery:'not_observed'},202);
});
notificationRoutes.get('/admin/attempts',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'notifications.test');
 const deviceId=c.req.query('deviceId')?id(c.req.query('deviceId')!):null;
 const result=await database(c.env).execute(sql`select id,device_id,recipient_user_id,institution_id,status,error_code,created_at,checked_at,observed_at from app_private.push_attempts where (${scope}::uuid is null or institution_id=${scope}::uuid) and (${deviceId}::uuid is null or device_id=${deviceId}::uuid) order by created_at desc limit 100`);
 return c.json({attempts:result.rows});
});
notificationRoutes.post('/admin/attempts/:id/receipt',async c=>{
 const db=database(c.env),attemptId=id(c.req.param('id'));
 const attempt=firstRow(await db.execute<{institution_id:string|null;ticket_id:string|null;device_id:string;status:string}>(sql`select institution_id,ticket_id,device_id,status from app_private.push_attempts where id=${attemptId}::uuid`));
 if(!attempt)throw new AppError(404,'NOT_FOUND','Notification test not found.');
 const scope=await resolveAdminScope(c.env,currentUser(c),attempt.institution_id??undefined,'notifications.test');
 if(attempt.institution_id===null&&scope!==null)throw new AppError(403,'FORBIDDEN','This test is outside your university scope.');
 if(!attempt.ticket_id||attempt.status!=='ACCEPTED')return c.json({status:attempt.status,deviceDelivery:'not_observed'});
 const receipt=await fetchPushReceipt(c.env,attempt.ticket_id);
 await db.execute(sql`update app_private.push_attempts set status=${receipt.status==='PENDING'?'ACCEPTED':receipt.status},error_code=${receipt.errorCode??null},checked_at=now() where id=${attemptId}::uuid`);
 if(receipt.errorCode==='DeviceNotRegistered')await db.execute(sql`update app_private.push_devices set active=false where id=${attempt.device_id}::uuid`);
 return c.json({...receipt,deviceDelivery:'not_observed'});
});
// Explicit recipient acknowledgement is separate from both provider acceptance and receipt status.
notificationRoutes.post('/attempts/:id/observed',async c=>{
 const result=await database(c.env).execute(sql`update app_private.push_attempts set observed_at=coalesce(observed_at,now()) where id=${id(c.req.param('id'))}::uuid and recipient_user_id=${currentUser(c).id}::uuid returning id,observed_at`);
 if(!firstRow(result))throw new AppError(404,'NOT_FOUND','Notification test not found.');
 return c.json({observation:firstRow(result)});
});

notificationRoutes.get('/sounds/default',async c=>{
 const sound=firstRow(await database(c.env).execute(sql`select s.id,s.name,s.media_id from public.notification_sounds s join public.media_objects m on m.id=s.media_id and m.deleted_at is null where s.active and s.is_default and (s.institution_id=${currentUser(c).universityId}::uuid or s.institution_id is null) order by s.institution_id nulls last limit 1`));
 return c.json({sound:sound?{...sound,url:`${(c.env.PUBLIC_API_ORIGIN??new URL(c.req.url).origin).replace(/\/$/,'')}/v1/media/${sound.media_id}`,availability:'web',nativeSound:'default'}:null});
});
notificationRoutes.get('/admin/sounds',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'notifications.manage');
 const sounds=await database(c.env).execute(sql`select s.id,s.name,s.media_id,s.institution_id,s.is_default,s.active,m.content_type from public.notification_sounds s join public.media_objects m on m.id=s.media_id and m.deleted_at is null where (${scope}::uuid is null or s.institution_id=${scope}::uuid) order by s.created_at desc limit 100`);
 const origin=(c.env.PUBLIC_API_ORIGIN??new URL(c.req.url).origin).replace(/\/$/,'');
 return c.json({sounds:sounds.rows.map(row=>({...row,url:`${origin}/v1/media/${row.media_id}`,availability:'web',nativeSound:'default'}))});
});
notificationRoutes.post('/admin/sounds',async c=>{
 const u=currentUser(c),d=await input(c,z.object({name:z.string().trim().min(2).max(80),mediaId:z.string().uuid(),universityId:z.string().uuid().optional()}).strict());
 const scope=await resolveAdminScope(c.env,u,d.universityId,'notifications.manage');
 const media=firstRow(await database(c.env).execute(sql`select id from public.media_objects where id=${d.mediaId}::uuid and owner_user_id=${u.id}::uuid and kind='notification-sound' and content_type in ('audio/mpeg','audio/wav') and deleted_at is null`));
 if(!media)throw new AppError(400,'BAD_REQUEST','Upload your own MP3 or WAV sound first.');
 const saved=firstRow(await database(c.env).execute(sql`insert into public.notification_sounds(institution_id,name,media_id,created_by) values(${scope}::uuid,${d.name},${d.mediaId}::uuid,${u.id}::uuid) on conflict(media_id) do update set name=excluded.name where notification_sounds.created_by=excluded.created_by and notification_sounds.institution_id is not distinct from excluded.institution_id returning id`));
 if(!saved)throw new AppError(409,'CONFLICT','This sound belongs to a different catalogue.');
 await recordAudit(c.env,{actorUserId:u.id,universityId:scope,action:'notification.sound.saved',targetType:'notification_sound',targetId:String(saved.id),requestId:c.get('requestId')});
 return c.json(saved,201);
});
notificationRoutes.put('/admin/sounds/:id/default',async c=>{
 const u=currentUser(c),target=id(c.req.param('id'));
 const sound=firstRow(await database(c.env).execute<{institution_id:string|null}>(sql`select institution_id from public.notification_sounds where id=${target}::uuid and active`));
 if(!sound)throw new AppError(404,'NOT_FOUND','Sound not found.');
 const scope=await resolveAdminScope(c.env,u,sound.institution_id??undefined,'notifications.manage');
 if(scope!==null && scope!==sound.institution_id)throw new AppError(403,'FORBIDDEN','This sound is outside your university scope.');
 const client=sqlClient(c.env);
 await client.transaction([
  client`select pg_advisory_xact_lock(hashtextextended(${sound.institution_id??'default-sound'},0))`,
  client`update public.notification_sounds set is_default=false where institution_id is not distinct from ${sound.institution_id}::uuid`,
  client`update public.notification_sounds set is_default=true where id=${target}::uuid and active`,
  client`insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome) values(${u.id}::uuid,${sound.institution_id}::uuid,'notification.sound.default','notification_sound',${target},${c.get('requestId')},'succeeded')`
 ]);
 return c.json({saved:true,availability:'web',nativeSound:'default'});
});
