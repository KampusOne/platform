import {notificationRuntime} from './notification-runtime';
import {sql} from 'drizzle-orm';
import {database,firstRow} from '../lib/database';
import {sendDevicePush,fetchPushReceipt} from '../lib/push';
import {retryablePushError,pushRetryDelaySeconds} from '../lib/push-retry';
import {notificationChannels,type NotificationCategory} from './notification-preferences';
import type{Bindings}from'../types';

type Notice={
 id:string;
 path:string|null;
 institution_id:string|null;
 actor_name:string|null;
 actor_username:string|null;
};

export function preferenceCategoryFor(dedupeKey:string,_notice?:Notice|null):NotificationCategory{
 if(dedupeKey.startsWith('managed-profile-post:'))return 'newsletter';
 if(dedupeKey.startsWith('message:'))return 'messages';
 if(dedupeKey.startsWith('feed-like:'))return 'likes';
 if(dedupeKey.startsWith('feed-comment-like:'))return 'commentLikes';
 if(dedupeKey.startsWith('feed-comment:'))return 'comments';
 if(dedupeKey.startsWith('feed-reply:'))return 'replies';
 if(dedupeKey.startsWith('feed-repost:'))return 'reposts';
 if(dedupeKey.startsWith('feed-quote:'))return 'quotes';
 if(dedupeKey.startsWith('follow:'))return 'follows';
 if(dedupeKey.startsWith('profile-post:'))return 'profilePosts';
 if(dedupeKey.startsWith('post-mention:'))return 'mentions';
 if(dedupeKey.startsWith('announcement-push:'))return 'announcements';
 if(dedupeKey.startsWith('community-urgent:'))return 'announcements';
 if(dedupeKey.startsWith('community-post:'))return 'announcements';
 if(dedupeKey.startsWith('class-reminder:'))return 'classReminders';
 return 'campusUpdates';
}

export async function deliverCommunityPush(env:Bindings){
 if(env.UNIFIED_SCHEMA_READY!=='true')return {sent:0};
 const db=database(env);let sent=0;
 const pending=await db.execute<{id:string;user_id:string;subject:string;body:string;dedupe_key:string;created_at:string}>(sql`with ready as(select id from app_private.notification_outbox where channel='PUSH' and state in('PENDING','PROCESSING') and next_attempt_at<=now() and attempts<8 order by case when dedupe_key like 'community-urgent:%' or dedupe_key like 'announcement-push:%' then 0 when dedupe_key like 'message:%' then 1 else 2 end,next_attempt_at limit 200 for update skip locked) update app_private.notification_outbox o set state='PROCESSING',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' from ready where ready.id=o.id returning o.id,o.user_id,o.subject,o.body,o.dedupe_key,o.created_at::text`);
 for(let offset=0;offset<pending.rows.length;offset+=8)await Promise.all(pending.rows.slice(offset,offset+8).map(async row=>{
  const maxAge=row.dedupe_key.startsWith('class-reminder:')?30*60*1000:row.dedupe_key.startsWith('community-urgent:')||row.dedupe_key.startsWith('announcement-push:')?60*60*1000:24*60*60*1000;
  if(Date.now()-Date.parse(row.created_at)>maxAge){await db.execute(sql`update app_private.notification_outbox set state='FAILED',last_error_code='PUSH_EXPIRED',completed_at=now() where id=${row.id}::uuid`);return;}
  if(row.dedupe_key.startsWith('post-mention:')){
   const postId=row.dedupe_key.split(':')[1];
   const eligible=firstRow(await db.execute(sql`select post.id from public.feed_posts post join public.users author on author.id=post.author_user_id and author.status::text='ACTIVE' and author.deleted_at is null join public.profiles actor on actor.user_id=author.id and actor.deleted_at is null join public.profiles recipient on recipient.user_id=${row.user_id}::uuid and recipient.deleted_at is null where post.id=${postId}::uuid and post.status in('PUBLISHED','CORRECTED') and post.published_at<=now() and(post.audience->>'visibility'='PUBLIC' or recipient.university_id=post.university_id) and exists(select 1 from regexp_matches(post.body,'(^|[^[:alnum:]_@])@([a-zA-Z0-9_]{1,30})','g') as mention(parts) where lower((mention.parts)[2])=lower(recipient.username)) and not exists(select 1 from public.account_restrictions r where r.user_id=author.id and r.revoked_at is null and r.starts_at<=now() and(r.ends_at is null or r.ends_at>now())) and not exists(select 1 from public.user_blocks b where(b.blocker_id=recipient.user_id and b.blocked_id=author.id)or(b.blocker_id=author.id and b.blocked_id=recipient.user_id))`));
   if(!eligible){await db.execute(sql`update app_private.notification_outbox set state='FAILED',last_error_code='POST_OR_AUDIENCE_CHANGED',completed_at=now() where id=${row.id}::uuid`);return;}
  }
  if(row.dedupe_key.startsWith('community-post:')||row.dedupe_key.startsWith('community-urgent:')){
   const postId=row.dedupe_key.split(':')[1];
   const eligible=firstRow(await db.execute(sql`select post.id from public.student_group_posts post join public.student_groups g on g.id=post.group_id and g.institution_id=post.institution_id join public.student_group_members member on member.group_id=g.id and member.user_id=${row.user_id}::uuid and member.notifications_enabled join public.profiles recipient on recipient.user_id=member.user_id and recipient.university_id=g.institution_id and recipient.deleted_at is null join public.users author on author.id=post.author_user_id and author.status::text='ACTIVE' and author.deleted_at is null where post.id=${postId}::uuid and not exists(select 1 from public.user_blocks b where(b.blocker_id=member.user_id and b.blocked_id=post.author_user_id)or(b.blocker_id=post.author_user_id and b.blocked_id=member.user_id))`));
   if(!eligible){await db.execute(sql`update app_private.notification_outbox set state='FAILED',last_error_code='GROUP_MEMBERSHIP_CHANGED',completed_at=now() where id=${row.id}::uuid`);return;}
  }
  if(row.dedupe_key.startsWith('managed-profile-post:')){
   const postId=row.dedupe_key.split(':')[1];
   const eligible=firstRow(await db.execute(sql`select pp.post_id from app_private.managed_publisher_posts pp join app_private.managed_publishers m on m.user_id=pp.user_id and m.active join public.feed_posts p on p.id=pp.post_id and p.author_user_id=m.user_id and p.status in('PUBLISHED','CORRECTED')and p.published_at<=now()and p.published_at>=m.updated_at join public.users author on author.id=m.user_id and author.status::text='ACTIVE'and author.deleted_at is null join public.profiles recipient on recipient.user_id=${row.user_id}::uuid where pp.post_id=${postId}::uuid and not exists(select 1 from public.account_restrictions r where r.user_id in(m.user_id,recipient.user_id)and r.revoked_at is null and r.starts_at<=now()and(r.ends_at is null or r.ends_at>now()))and(p.audience->>'visibility'='PUBLIC' or recipient.university_id=p.university_id)and(m.all_universities or recipient.university_id=m.institution_id or exists(select 1 from public.profile_post_notification_subscriptions s where s.subscriber_id=recipient.user_id and s.target_user_id=m.user_id))and not exists(select 1 from public.user_blocks b where(b.blocker_id=recipient.user_id and b.blocked_id=m.user_id)or(b.blocker_id=m.user_id and b.blocked_id=recipient.user_id))`));
   if(!eligible){await db.execute(sql`update app_private.notification_outbox set state='FAILED',last_error_code='PUBLISHER_OR_AUDIENCE_CHANGED',completed_at=now()where id=${row.id}::uuid`);return;}
  }
  const inboxDedupe=row.dedupe_key.replace('announcement-push:','announcement:');
  const notice=firstRow(await db.execute<Notice>(sql`select n.id,n.path,n.institution_id,coalesce(actor.display_name,actor.username) as actor_name,actor.username as actor_username from public.in_app_notifications n left join public.profiles actor on actor.user_id=n.actor_user_id and actor.deleted_at is null where n.user_id=${row.user_id}::uuid and n.dedupe_key=${inboxDedupe} limit 1`));
  const category=preferenceCategoryFor(row.dedupe_key,notice);
  const runtime=await notificationRuntime(env,notice?.institution_id??null);
  if(!runtime.push_enabled||(category==='newsletter'&&!runtime.newsletter_enabled)||(category==='announcements'&&!runtime.announcements_enabled)||(category==='campusUpdates'&&!runtime.campus_updates_enabled)){await db.execute(sql`update app_private.notification_outbox set state='PENDING',attempts=greatest(attempts-1,0),last_error_code='RUNTIME_PAUSED',next_attempt_at=now()+interval '5 minutes' where id=${row.id}::uuid`);return;}
  const devices=await db.execute<{id:string;token:string;native_token:string|null;platform:string;university_id:string;channels:unknown;preferences:unknown}>(sql`select d.id,d.token,d.native_token,d.platform,p.university_id,p.settings->'notificationChannels' as channels,p.settings->'notificationPreferences' as preferences from app_private.push_devices d join public.profiles p on p.user_id=d.user_id join public.users u on u.id=d.user_id where d.user_id=${row.user_id}::uuid and (${notice?.institution_id??null}::uuid is null or p.university_id=${notice?.institution_id??null}::uuid) and d.active and p.deleted_at is null and u.status::text='ACTIVE' and u.deleted_at is null and coalesce(p.settings->>'notifications','true')='true' and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.revoked_at is null and r.starts_at<=now() and(r.ends_at is null or r.ends_at>now())) and exists(select 1 from public.refresh_tokens r where r.user_id=d.user_id and r.family_id=d.session_family_id and r.revoked_at is null and r.expires_at>now()) order by d.updated_at desc limit 5`);
  const eligibleDevices=devices.rows.filter(device=>notificationChannels(device.channels,device.preferences)[category].push_enabled);
  if(!eligibleDevices.length){
   const expired=Date.now()-Date.parse(row.created_at)>24*60*60*1000;
   await db.execute(sql`update app_private.notification_outbox set state=${expired||devices.rows.length?'FAILED':'PENDING'},attempts=greatest(attempts-1,0),last_error_code=${devices.rows.length?'PREFERENCE_DISABLED':'NO_ELIGIBLE_DEVICE'},next_attempt_at=now()+interval '1 minute',completed_at=case when ${expired||devices.rows.length} then now() else null end where id=${row.id}::uuid`);
   return;
  }
  await Promise.all(eligibleDevices.map(async device=>{
   const attempt=firstRow(await db.execute<{id:string;attempts:number}>(sql`insert into app_private.community_push_deliveries(outbox_id,device_id,user_id,institution_id,status) values(${row.id}::uuid,${device.id}::uuid,${row.user_id}::uuid,${device.university_id}::uuid,'SENDING') on conflict(outbox_id,device_id) do update set status='SENDING',attempts=community_push_deliveries.attempts+1,updated_at=now(),error_code=null where community_push_deliveries.status='FAILED' and community_push_deliveries.error_code in('MessageRateExceeded','PUSH_HTTP_429') and community_push_deliveries.attempts<6 and community_push_deliveries.next_attempt_at<=now() returning id,attempts`));
   if(!attempt)return; // Never blindly replay an external send with an uncertain acknowledgement.
   const result=await sendDevicePush(env,{expoToken:device.token,nativeToken:device.native_token,platform:device.platform},{
    title:row.subject,
    body:row.body,
    path:notice?.path??'/notifications',
    id:attempt.id,
    ...(notice?.id?{notificationId:notice.id}:{}),
    preferenceCategory:category,
   });
   await db.execute(sql`update app_private.community_push_deliveries set status=${result.status},ticket_id=${result.ticketId??null},error_code=${result.errorCode??null},updated_at=now(),next_attempt_at=now()+make_interval(secs=>${pushRetryDelaySeconds(attempt.attempts)}) where id=${attempt.id}::uuid`);
   if(result.status==='ACCEPTED')sent++;
   if(result.errorCode==='DeviceNotRegistered')await db.execute(sql`update app_private.push_devices set active=false where id=${device.id}::uuid`);
  }));
  await db.execute(sql`with result as(select bool_or(status in('ACCEPTED','RECEIPT_OK')) accepted,bool_or(status='FAILED' and error_code in('MessageRateExceeded','PUSH_HTTP_429') and attempts<6) retry,bool_or(status in('UNKNOWN','SENDING')) uncertain,min(next_attempt_at) next_retry from app_private.community_push_deliveries where outbox_id=${row.id}::uuid) update app_private.notification_outbox set state=case when result.retry then 'PENDING' when result.accepted then 'SENT' else 'FAILED' end,last_error_code=case when result.retry then 'RETRYABLE_PROVIDER_REJECTION' when result.accepted then null when result.uncertain then 'DELIVERY_UNCONFIRMED' else 'PUSH_DELIVERY_FAILED' end,next_attempt_at=coalesce(result.next_retry,now()+interval '1 minute'),completed_at=case when result.retry then null else now() end from result where id=${row.id}::uuid`);
 }));
 await db.execute(sql`update app_private.community_push_deliveries set status='UNKNOWN',error_code='SEND_ACKNOWLEDGEMENT_MISSING' where status='SENDING' and updated_at<now()-interval '10 minutes'`);
 return {sent};
}
export async function checkCommunityPushReceipts(env:Bindings){
 if(env.UNIFIED_SCHEMA_READY!=='true')return;
 const db=database(env),pending=await db.execute<{id:string;ticket_id:string;device_id:string}>(sql`select id,ticket_id,device_id from app_private.community_push_deliveries where status='ACCEPTED' and ticket_id is not null and updated_at<now()-interval '15 minutes' and created_at>now()-interval '1 day' order by checked_at nulls first,created_at limit 100`);
 for(const row of pending.rows){const receipt=await fetchPushReceipt(env,row.ticket_id);await db.execute(sql`update app_private.community_push_deliveries set status=${receipt.status==='PENDING'?'ACCEPTED':receipt.status},error_code=${receipt.errorCode??null},checked_at=now(),updated_at=now() where id=${row.id}::uuid`);if(receipt.errorCode==='DeviceNotRegistered')await db.execute(sql`update app_private.push_devices set active=false where id=${row.device_id}::uuid`);if(receipt.status==='FAILED')await db.execute(sql`update app_private.notification_outbox o set state=${retryablePushError(receipt.errorCode)?'PENDING':'FAILED'},last_error_code=${receipt.errorCode??'PUSH_RECEIPT_FAILED'},next_attempt_at=now(),completed_at=null from app_private.community_push_deliveries d where d.id=${row.id}::uuid and o.id=d.outbox_id and not exists(select 1 from app_private.community_push_deliveries other where other.outbox_id=o.id and other.id<>d.id and other.status in('ACCEPTED','RECEIPT_OK'))`);}
}
