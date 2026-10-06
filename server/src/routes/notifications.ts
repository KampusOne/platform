import {notificationRuntime,defaultNotificationRuntime,type NotificationRuntime} from '../services/notification-runtime';
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
import { unblockedAuthor } from '../lib/profile-safety';
import type { Bindings, Variables } from '../types';
import { queueDuePurchaseReviews } from '../services/purchase-reviews';
import {
  defaultNotificationPreferences,
  notificationPreferences,
  notificationChannels,
  notificationCategories,
} from '../services/notification-preferences';

export const notificationRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
notificationRoutes.use('/*',requireAuth);
notificationRoutes.use('/*',async(c,next)=>{
 if(c.env.UNIFIED_SCHEMA_READY!=='true')throw new AppError(503,'PROVIDER_UNAVAILABLE','Notifications are unavailable until the account service is ready.');
 await next();
});
notificationRoutes.get('/runtime',async c=>c.json({policy:await notificationRuntime(c.env,currentUser(c).universityId)}));
notificationRoutes.get('/admin/runtime',async c=>{const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'notifications.manage');const policy=firstRow(await database(c.env).execute<NotificationRuntime>(sql`select push_enabled,alarms_enabled,newsletter_enabled,announcements_enabled,campus_updates_enabled,email_enabled from app_private.notification_runtime_controls where scope_key=${scope??'global'}`))??defaultNotificationRuntime;return c.json({policy,effective:await notificationRuntime(c.env,scope)});});
notificationRoutes.put('/admin/runtime',async c=>{const user=currentUser(c),scope=await resolveAdminScope(c.env,user,c.req.query('universityId'),'notifications.manage'),data=await input(c,z.object({policy:z.object({push_enabled:z.boolean(),alarms_enabled:z.boolean(),newsletter_enabled:z.boolean(),announcements_enabled:z.boolean(),campus_updates_enabled:z.boolean(),email_enabled:z.boolean()}).strict(),note:z.string().trim().min(3).max(1000)}).strict()),p=data.policy;await database(c.env).execute(sql`insert into app_private.notification_runtime_controls(scope_key,institution_id,push_enabled,alarms_enabled,newsletter_enabled,announcements_enabled,campus_updates_enabled,email_enabled,updated_by) values(${scope??'global'},${scope}::uuid,${p.push_enabled},${p.alarms_enabled},${p.newsletter_enabled},${p.announcements_enabled},${p.campus_updates_enabled},${p.email_enabled},${user.id}::uuid) on conflict(scope_key) do update set push_enabled=excluded.push_enabled,alarms_enabled=excluded.alarms_enabled,newsletter_enabled=excluded.newsletter_enabled,announcements_enabled=excluded.announcements_enabled,campus_updates_enabled=excluded.campus_updates_enabled,email_enabled=excluded.email_enabled,updated_by=excluded.updated_by,updated_at=now()`);await recordAudit(c.env,{actorUserId:user.id,universityId:scope,action:'notifications.runtime.changed',targetType:'notification_control',targetId:scope??'global',metadata:data,requestId:c.get('requestId')});return c.json({policy:p,effective:await notificationRuntime(c.env,scope)});});
notificationRoutes.get('/preferences',async c=>{
 const profile=firstRow(await database(c.env).execute<{preferences:unknown;channels:unknown}>(sql`select settings->'notificationPreferences' as preferences,settings->'notificationChannels' as channels from public.profiles where user_id=${currentUser(c).id}::uuid and deleted_at is null`));
 return c.json({preferences:notificationPreferences(profile?.preferences),channels:notificationChannels(profile?.channels,profile?.preferences)});
});
notificationRoutes.put('/preferences',async c=>{
 const legacy=Object.fromEntries(Object.keys(defaultNotificationPreferences).map(key=>[key,z.boolean().optional()]));
 const channelShape=Object.fromEntries(notificationCategories.map(key=>[key,z.object({in_app_enabled:z.boolean(),push_enabled:z.boolean()}).strict().optional()]));
 const data=await input(c,z.union([z.object({channels:z.object(channelShape).strict()}).strict(),z.object(legacy).strict()]));
 let channels,preferences;
 if('channels' in data){
  channels=notificationChannels(data.channels);
  preferences=notificationPreferences(Object.fromEntries(Object.entries(channels).map(([key,value])=>[key,value.in_app_enabled])));
  preferences.pushMessages=channels.messages.push_enabled;
  preferences.pushMentions=channels.mentions.push_enabled;
  preferences.pushAnnouncements=channels.announcements.push_enabled;
  preferences.pushNewsletter=channels.newsletter.push_enabled;
  preferences.pushCampusUpdates=channels.campusUpdates.push_enabled;
 } else {
  preferences=notificationPreferences(data);
  channels=notificationChannels(null,preferences);
 }
 await database(c.env).execute(sql`update public.profiles set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('notificationPreferences',${JSON.stringify(preferences)}::jsonb,'notificationChannels',${JSON.stringify(channels)}::jsonb),updated_at=now() where user_id=${currentUser(c).id}::uuid and deleted_at is null`);
 return c.json({preferences,channels});
});
notificationRoutes.get('/inbox',async c=>{
 const user=currentUser(c),db=database(c.env),limit=30;
 await queueDuePurchaseReviews(c.env,user.id);
 let before:{time:string;id:string}|null=null;
 const cursor=c.req.query('before');
 if(cursor){
  const parts=cursor.split('|');
  const parsed=z.object({time:z.string().datetime({offset:true}),id:z.string().uuid()}).safeParse({time:parts[0],id:parts[1]});
  if(!parsed.success)throw new AppError(400,'BAD_REQUEST','This notification page is invalid.');
  before=parsed.data;
 }
 const actorVisible=unblockedAuthor(user.id,sql`n.actor_user_id`);
 const visible=sql`n.user_id=${user.id}::uuid and (n.institution_id is null or n.institution_id=${user.universityId}::uuid) and ${actorVisible} and coalesce(n.dedupe_key,'') not like 'message:%' and coalesce(n.path,'') not like '/conversation%' and(coalesce(n.dedupe_key,'') not like 'post-mention:%' or exists(select 1 from public.profiles prefs where prefs.user_id=${user.id}::uuid and coalesce(prefs.settings->'notificationChannels'->'mentions'->>'in_app_enabled',prefs.settings->'notificationPreferences'->>'mentions','true')='true'))`;
 const [result,count]=await Promise.all([
  db.execute<{id:string;title:string;body:string;path:string|null;read_at:string|null;created_at:string;actor_user_id:string|null;actor_name:string|null;actor_profile_image_url:string|null}>(sql`select n.id,n.title,n.body,n.path,n.read_at,n.created_at::text,n.actor_user_id,coalesce(actor.display_name,actor.username) as actor_name,actor.profile_image_url as actor_profile_image_url from public.in_app_notifications n left join public.profiles actor on actor.user_id=n.actor_user_id and actor.deleted_at is null where ${visible} and (${before?.time??null}::timestamptz is null or (n.created_at,n.id)<(${before?.time??null}::timestamptz,${before?.id??null}::uuid)) order by n.created_at desc,n.id desc limit ${limit+1}`),
  db.execute<{unread_count:number}>(sql`select count(*)::int as unread_count from public.in_app_notifications n where ${visible} and n.read_at is null`),
 ]);
 const notifications=result.rows.slice(0,limit),last=notifications.at(-1);
 return c.json({notifications,unreadCount:firstRow(count)?.unread_count??0,nextCursor:result.rows.length>limit&&last?new Date(last.created_at).toISOString()+'|'+last.id:null});
});
notificationRoutes.patch('/inbox/:id/read',async c=>{
 const result=await database(c.env).execute<{id:string;read_at:string}>(sql`update public.in_app_notifications set read_at=coalesce(read_at,now()) where id=${id(c.req.param('id'))}::uuid and user_id=${currentUser(c).id}::uuid returning id,read_at::text`);
 const notification=firstRow(result);
 if(!notification)throw new AppError(404,'NOT_FOUND','Notification not found.');
 return c.json({notification});
});
notificationRoutes.post('/read-all',async c=>{
 await database(c.env).execute(sql`update public.in_app_notifications set read_at=coalesce(read_at,now()) where user_id=${currentUser(c).id}::uuid and read_at is null`);
 return c.json({saved:true});
});
notificationRoutes.post('/read-social',async c=>{
 const u=currentUser(c);
 await database(c.env).execute(sql`update public.in_app_notifications set read_at=now() where user_id=${u.id}::uuid and (institution_id is null or institution_id=${u.universityId}::uuid) and read_at is null and (dedupe_key like 'post-%' or dedupe_key like 'community-post:%' or dedupe_key like 'follow:%' or dedupe_key like 'feed-%')`);
 return c.json({saved:true});
});

notificationRoutes.get('/devices',async c=>{
 const result=await database(c.env).execute(sql`select id,platform,label,build_version,active,created_at,updated_at from app_private.push_devices where user_id=${currentUser(c).id}::uuid order by updated_at desc limit 30`);
 return c.json({devices:result.rows});
});
notificationRoutes.get('/delivery-status',async c=>{
 const user=currentUser(c),db=database(c.env);
 const [devices,outbox,delivery]=await Promise.all([
  db.execute(sql`select count(*)::int as registered,count(*) filter(where d.active and exists(select 1 from public.refresh_tokens r where r.family_id=d.session_family_id and r.user_id=d.user_id and r.revoked_at is null and r.expires_at>now()))::int as active from app_private.push_devices d where d.user_id=${user.id}::uuid`),
  db.execute(sql`select state,last_error_code,count(*)::int as count from app_private.notification_outbox where user_id=${user.id}::uuid and channel='PUSH' and created_at>now()-interval '7 days' group by state,last_error_code`),
  db.execute(sql`select status,error_code,created_at,checked_at,observed_at from app_private.community_push_deliveries where user_id=${user.id}::uuid order by created_at desc limit 20`),
 ]);
 return c.json({devices:firstRow(devices),queue:outbox.rows,deliveries:delivery.rows,policy:await notificationRuntime(c.env,user.universityId),receiptMeaning:'Provider acceptance is separate from delivery to this device.'});
});
notificationRoutes.post('/deliveries/:id/observed',async c=>{
 const result=await database(c.env).execute(sql`update app_private.community_push_deliveries set observed_at=coalesce(observed_at,now()) where id=${id(c.req.param('id'))}::uuid and user_id=${currentUser(c).id}::uuid returning id,observed_at`);
 if(!firstRow(result))throw new AppError(404,'NOT_FOUND','Notification delivery not found.');
 return c.json({observation:firstRow(result)});
});
notificationRoutes.get('/admin/delivery-status',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'notifications.test');
 const [queue,deliveries]=await Promise.all([
  database(c.env).execute(sql`select o.state,o.last_error_code,count(*)::int as count from app_private.notification_outbox o join public.profiles p on p.user_id=o.user_id where o.channel='PUSH' and o.created_at>now()-interval '7 days' and(${scope}::uuid is null or p.university_id=${scope}::uuid) group by o.state,o.last_error_code`),
  database(c.env).execute(sql`select status,error_code,count(*)::int as count,count(*) filter(where observed_at is not null)::int observed from app_private.community_push_deliveries where created_at>now()-interval '7 days' and(${scope}::uuid is null or institution_id=${scope}::uuid) group by status,error_code`),
 ]);
 return c.json({queue:queue.rows,deliveries:deliveries.rows});
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


notificationRoutes.post('/alarms/import-timetable',async c=>{
 const u=currentUser(c),data=await input(c,z.object({entryIds:z.array(z.string().uuid()).min(1).max(100).transform(values=>[...new Set(values)]),reminderMinutes:z.number().int().min(0).max(120)}).strict());
 const client=sqlClient(c.env);
 const results=await client.transaction([
  client`select pg_advisory_xact_lock(hashtextextended(${u.id+'-class-alarms'},0))`,
  client`update public.timetable_entries set reminder_enabled=false,updated_at=now() where user_id=${u.id}::uuid and status<>'ARCHIVED' and reminder_enabled`,
  client`update public.timetable_entries set reminder_minutes=15,reminder_enabled=true,updated_at=now() where user_id=${u.id}::uuid and status<>'ARCHIVED' and id=any(${data.entryIds}::uuid[]) returning id`
 ]);
 return c.json({imported:(results[2]??[]).length});
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
