import {sql} from 'drizzle-orm';
import {database,firstRow} from '../lib/database';
import {sendCampusPush,fetchPushReceipt} from '../lib/push';
import type{Bindings}from'../types';
export async function deliverCommunityPush(env:Bindings){
 if(env.UNIFIED_SCHEMA_READY!=='true')return {sent:0};
 const db=database(env);let sent=0;
 const pending=await db.execute<{id:string;user_id:string;subject:string;body:string;dedupe_key:string}>(sql`with ready as(select id from app_private.notification_outbox where channel='PUSH' and state in('PENDING','PROCESSING') and next_attempt_at<=now() and attempts<8 order by next_attempt_at limit 20 for update skip locked) update app_private.notification_outbox o set state='PROCESSING',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' from ready where ready.id=o.id returning o.id,o.user_id,o.subject,o.body,o.dedupe_key`);
 for(const row of pending.rows){
  const notice=firstRow(await db.execute<{path:string;institution_id:string}>(sql`select path,institution_id from public.in_app_notifications where user_id=${row.user_id}::uuid and dedupe_key=${row.dedupe_key.replace('announcement-push:','announcement:')} limit 1`));
  const devices=await db.execute<{id:string;token:string;university_id:string}>(sql`select d.id,d.token,p.university_id from app_private.push_devices d join public.profiles p on p.user_id=d.user_id join public.users u on u.id=d.user_id where d.user_id=${row.user_id}::uuid and p.university_id=${notice?.institution_id??null}::uuid and d.active and p.deleted_at is null and u.status::text='ACTIVE' and u.deleted_at is null and coalesce(p.settings->>'notifications','true')='true' and exists(select 1 from public.refresh_tokens r where r.user_id=d.user_id and r.family_id=d.session_family_id and r.revoked_at is null and r.expires_at>now()) order by d.updated_at desc limit 5`);
  await Promise.all(devices.rows.map(async device=>{
   const attempt=firstRow(await db.execute<{id:string}>(sql`insert into app_private.community_push_deliveries(outbox_id,device_id,user_id,institution_id,status) values(${row.id}::uuid,${device.id}::uuid,${row.user_id}::uuid,${device.university_id}::uuid,'SENDING') on conflict(outbox_id,device_id) do nothing returning id`));
   if(!attempt)return; // Never blindly replay an external send with an uncertain acknowledgement.
   const result=await sendCampusPush(env,device.token,{title:row.subject,body:row.body,path:notice?.path??'/notifications',id:attempt.id});
   await db.execute(sql`update app_private.community_push_deliveries set status=${result.status},ticket_id=${result.ticketId??null},error_code=${result.errorCode??null} where id=${attempt.id}::uuid`);
   if(result.status==='ACCEPTED')sent++;
   if(result.errorCode==='DeviceNotRegistered')await db.execute(sql`update app_private.push_devices set active=false where id=${device.id}::uuid`);
  }));
  await db.execute(sql`update app_private.notification_outbox set state=case when exists(select 1 from app_private.community_push_deliveries where outbox_id=${row.id}::uuid and status in('ACCEPTED','RECEIPT_OK')) then 'SENT' else 'FAILED' end where id=${row.id}::uuid`);
 }
 await db.execute(sql`update app_private.community_push_deliveries set status='UNKNOWN',error_code='SEND_ACKNOWLEDGEMENT_MISSING' where status='SENDING' and created_at<now()-interval '10 minutes'`);
 return {sent};
}
export async function checkCommunityPushReceipts(env:Bindings){
 if(env.UNIFIED_SCHEMA_READY!=='true')return;
 const db=database(env),pending=await db.execute<{id:string;ticket_id:string;device_id:string}>(sql`select id,ticket_id,device_id from app_private.community_push_deliveries where status='ACCEPTED' and ticket_id is not null and created_at<now()-interval '15 minutes' and created_at>now()-interval '1 day' order by created_at limit 30`);
 for(const row of pending.rows){const receipt=await fetchPushReceipt(env,row.ticket_id);await db.execute(sql`update app_private.community_push_deliveries set status=${receipt.status==='PENDING'?'ACCEPTED':receipt.status},error_code=${receipt.errorCode??null},checked_at=now() where id=${row.id}::uuid`);if(receipt.errorCode==='DeviceNotRegistered')await db.execute(sql`update app_private.push_devices set active=false where id=${row.device_id}::uuid`);}
}
