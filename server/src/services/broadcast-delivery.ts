import { sql, type SQL } from 'drizzle-orm';
import { database, firstRow } from '../lib/database';
import { AppError } from '../lib/errors';
import { resolveAdminScope } from '../lib/admin-access';
import type { Bindings } from '../types';

export type EmailBindings = Bindings & { RESEND_WEBHOOK_SECRET?: string };
export type EmailSegment = { role: 'ALL'|'STUDENT'|'AGENT'|'VENDOR'|'TUTOR'|'RIDER'|'BUYER'|'STAFF'; userIds: string[]; facultyId?: string; departmentId?: string; agentStatus?: 'ACTIVE'|'PAUSED'|'SUSPENDED' };
export type Campaign = { id:string; institution_id:string|null; created_by:string; persona_id:string; kind:'OPERATIONAL'|'MARKETING'; subject:string; body:string; segment:EmailSegment; revision:number; status:string; scheduled_at:string|null; display_name:string; reviewed_snapshot_id:string|null };
export type AudienceMember = { user_id:string;email:string;display_name:string;institution_id:string|null;eligible:boolean;suppressed:boolean;consented:boolean };
export type EmailContent = { from:string; reply_to?:string; subject:string; body:string; senderName:string; kind:'OPERATIONAL'|'MARKETING'; postalAddress:string; apiOrigin:string };
export type EmailPayload = { from:string;to:string[];subject:string;html:string;text:string;reply_to?:string;headers?:Record<string,string> };

export const escapeEmailHtml = (text:string) => text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function emailProviderStatus(env:EmailBindings) {
 return { sendingConfigured:Boolean(env.RESEND_API_KEY&&env.RESEND_FROM_EMAIL),webhookConfigured:Boolean(env.RESEND_WEBHOOK_SECRET),unsubscribeConfigured:Boolean(env.PUBLIC_API_ORIGIN) };
}
export function requireBroadcastProvider(env:EmailBindings) {
 if(!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL||!env.RESEND_WEBHOOK_SECRET||!env.PUBLIC_API_ORIGIN)
  throw new AppError(503,'PROVIDER_UNAVAILABLE','Campaign email requires the configured sender, signed delivery webhook and public API origin.');
}
export function freezeEmailContent(env:EmailBindings,campaign:Campaign,postalAddress:string|null):EmailContent {
 const configured=env.RESEND_FROM_EMAIL?.trim()??'';
 const address=(configured.match(/<([^<>]+)>$/)?.[1]??configured).trim();
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)||/[\r\n]/.test(campaign.display_name))throw new AppError(503,'PROVIDER_UNAVAILABLE','The campaign sender address is not configured correctly.');
 let origin:URL;
 try{origin=new URL(env.PUBLIC_API_ORIGIN??'');}catch{throw new AppError(503,'PROVIDER_UNAVAILABLE','The public API origin is required for email preferences.');}
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||(origin.protocol!=='https:'&&env.ENVIRONMENT!=='local'))throw new AppError(503,'PROVIDER_UNAVAILABLE','The public API origin must be an HTTPS origin.');
 if(campaign.kind==='MARKETING'&&!postalAddress?.trim())throw new AppError(409,'CONFLICT','Add the real organisation mailing address in delivery settings before preparing promotional email.');
 return {from:`${campaign.display_name} <${address}>`,...(env.RESEND_REPLY_TO?{reply_to:env.RESEND_REPLY_TO}:{}),subject:campaign.subject,body:campaign.body,senderName:campaign.display_name,kind:campaign.kind,postalAddress:postalAddress??'',apiOrigin:origin.origin};
}
export function composeBroadcastPayload(content:EmailContent,email:string,token:string,isTest=false):EmailPayload {
 const unsubscribe=`${content.apiOrigin}/v1/email/unsubscribe/${token}`;
 const subject=`${isTest?'[Test] ':''}${content.subject}`;
 const disclosure='An official KampusOne team message. This sender identity is managed by KampusOne.';
 const footer=content.kind==='MARKETING'?`<p>${escapeEmailHtml(content.postalAddress)}</p><p><a href="${escapeEmailHtml(unsubscribe)}" style="color:#713C29">Unsubscribe from promotional email</a></p>`:'';
 const body=content.body.split(/\n{2,}/).map(p=>`<p style="margin:0 0 18px;white-space:pre-wrap">${escapeEmailHtml(p)}</p>`).join('');
 const html=`<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(subject)}</title></head><body style="margin:0;background:#FBF7F2;color:#29231F"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-top:5px solid #C35D38"><tr><td style="padding:28px;font:16px/1.6 Arial,sans-serif"><p style="color:#713C29;font-weight:bold">KampusOne${isTest?' · Test message':''}</p><h1 style="font-size:26px;line-height:1.25">${escapeEmailHtml(content.subject)}</h1>${body}<hr style="border:0;border-top:1px solid #E9DED5"><p style="font-size:13px">${disclosure}</p>${footer}</td></tr></table></td></tr></table></body></html>`;
 return {from:content.from,to:[email],subject,html,text:`${subject}\n\n${content.body}\n\n${disclosure}${content.kind==='MARKETING'?`\n${content.postalAddress}\nUnsubscribe: ${unsubscribe}`:''}`,...(content.reply_to?{reply_to:content.reply_to}:{}),...(content.kind==='MARKETING'?{headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}:{})};
}

/** Tenant membership includes assigned staff who do not hold a student profile at that campus. */
export function emailUniversityMembership(universityId:string|null):SQL {
 if(!universityId)return sql`true`;
 return sql`(exists(select 1 from public.profiles p where p.user_id=u.id and p.deleted_at is null and p.university_id=${universityId}::uuid)
 or exists(select 1 from public.agent_profiles a where a.user_id=u.id and a.university_id=${universityId}::uuid)
 or exists(select 1 from app_private.staff_access st where st.user_id=u.id and st.status='ACTIVE' and(st.all_universities or ${universityId}::uuid=any(st.university_ids)))
 or(not exists(select 1 from app_private.staff_access st where st.user_id=u.id) and exists(select 1 from public.operator_roles o where o.user_id=u.id and(o.expires_at is null or o.expires_at>now()) and(o.university_id=${universityId}::uuid or o.role='PLATFORM_ADMIN'))))`;
}

export async function audienceForCampaign(env:Bindings,c:Campaign):Promise<AudienceMember[]> {
 const scope=c.institution_id;const s=c.segment;let role:SQL=sql`true`;
 const agentScope=scope?sql`and a.university_id=${scope}::uuid`:sql``;
 if(s.role==='STUDENT')role=sql`'STUDENT'=any(u.roles::text[])`;
 if(['AGENT','VENDOR','TUTOR','RIDER'].includes(s.role))role=sql`exists(select 1 from public.agent_profiles a where a.user_id=u.id ${agentScope} ${s.role==='AGENT'?sql``:sql`and a.agent_type=${s.role}`} and a.status=${s.agentStatus??'ACTIVE'})`;
 if(s.role==='BUYER')role=sql`exists(select 1 from public.orders o where o.buyer_user_id=u.id ${scope?sql`and o.university_id=${scope}::uuid`:sql``})`;
 if(s.role==='STAFF')role=sql`(exists(select 1 from app_private.staff_access st where st.user_id=u.id and st.status='ACTIVE' and ${scope?sql`(st.all_universities or ${scope}::uuid=any(st.university_ids))`:sql`true`}) or(not exists(select 1 from app_private.staff_access st where st.user_id=u.id) and exists(select 1 from public.operator_roles o where o.user_id=u.id and(o.expires_at is null or o.expires_at>now()) and ${scope?sql`(o.university_id=${scope}::uuid or o.role='PLATFORM_ADMIN')`:sql`true`})))`;
 const rows=await database(env).execute<AudienceMember>(sql`select u.id as user_id,lower(u.email) as email,coalesce(p.display_name,'KampusOne member') as display_name,${scope}::uuid as institution_id,
 (x.email is null and(${c.kind}='OPERATIONAL' or coalesce(ep.marketing_opt_in,false))) as eligible,x.email is not null as suppressed,coalesce(ep.marketing_opt_in,false) as consented
 from public.users u left join public.profiles p on p.user_id=u.id and p.deleted_at is null
 left join app_private.email_preferences ep on ep.user_id=u.id left join app_private.email_suppressions x on x.email=lower(u.email)
 where u.deleted_at is null and u.status::text='ACTIVE' and u.email_verified_at is not null
 and ${emailUniversityMembership(scope)}
 and ${role} ${s.userIds.length?sql`and u.id=any(${sql.param(s.userIds)}::uuid[])`:sql``}
 ${s.facultyId?sql`and p.faculty_id=${s.facultyId}::uuid`:sql``} ${s.departmentId?sql`and p.department_id=${s.departmentId}::uuid`:sql``}
 order by u.id limit 10001`);
 if(rows.rows.length>10000)throw new AppError(409,'CONFLICT','This segment exceeds 10,000 accounts. Narrow the university or role selection.');
 return rows.rows;
}

/** Svix specification: sign raw id.timestamp.body; reject old/future attempts. */
export async function verifyResendSignature(raw:string,headers:Headers,secret:string,now=Date.now()) {
 const id=headers.get('svix-id')??'',timestamp=headers.get('svix-timestamp')??'',signatures=headers.get('svix-signature')??'';
 if(!id||id.length>200||!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||signatures.length>2048||!secret.startsWith('whsec_'))return false;
 try{
  const bytes=Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const message=new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
  for(const value of signatures.split(' ')) {
   const [version,signature]=value.split(',');if(version!=='v1'||!signature)continue;
   if(await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),message))return true;
  }
 }catch{return false;}return false;
}

export async function reconcileEmailEvents(env:Bindings,providerId:string) {
 await database(env).execute(sql`update app_private.email_recipients r set status=case
 when exists(select 1 from app_private.email_delivery_events e where e.provider_email_id=r.provider_email_id and e.event_type='email.complained') then 'COMPLAINED'
 when exists(select 1 from app_private.email_delivery_events e where e.provider_email_id=r.provider_email_id and e.event_type='email.bounced') then 'BOUNCED'
 when exists(select 1 from app_private.email_delivery_events e where e.provider_email_id=r.provider_email_id and e.event_type in('email.failed','email.suppressed')) then 'FAILED'
 when exists(select 1 from app_private.email_delivery_events e where e.provider_email_id=r.provider_email_id and e.event_type='email.delivered') then 'DELIVERED' else r.status end,
 delivered_at=coalesce(r.delivered_at,(select min(e.occurred_at) from app_private.email_delivery_events e where e.provider_email_id=r.provider_email_id and e.event_type='email.delivered'))
 where r.provider_email_id=${providerId}`);
}

export async function deliverQueuedBroadcasts(env:EmailBindings) {
 if(env.UNIFIED_SCHEMA_READY!=='true'||!env.RESEND_API_KEY||!env.RESEND_WEBHOOK_SECRET)return {accepted:0,skipped:0};
 const db=database(env);const claimed=await db.execute<{id:string;user_id:string;requested_by:string;institution_id:string|null;campaign_id:string;email:string;kind:string;payload:EmailPayload;attempts:number;is_test:boolean}>(sql`select * from app_private.claim_broadcast_deliveries()`);
 let accepted=0,skipped=0;
 for(const row of claimed.rows){
  let senderAllowed=false;
  const sender=firstRow(await db.execute<{id:string;email:string}>(sql`select id,email from public.users where id=${row.requested_by}::uuid and status::text='ACTIVE' and deleted_at is null`));
  if(sender)try{
   const allowedScope=await resolveAdminScope(env,{...sender,roles:[],operatorRoles:[],universityId:null},row.institution_id??undefined,'broadcasts.send');
   senderAllowed=row.institution_id!==null||allowedScope===null;
  }catch(error){if(!(error instanceof AppError)||error.status!==403)throw error;/* Revoked staff authority stops future email. */}
  // Recheck mutable eligibility at the final boundary, not only at audience review.
  const eligible=firstRow(await db.execute<{allowed:boolean;enabled:boolean}>(sql`select controls.enabled,(u.deleted_at is null and u.status::text='ACTIVE' and u.email_verified_at is not null and lower(u.email)=${row.email}
   and ${emailUniversityMembership(row.institution_id)}
   and not exists(select 1 from app_private.email_suppressions s where s.email=${row.email})
   and(${row.kind}='OPERATIONAL' or exists(select 1 from app_private.email_preferences p where p.user_id=u.id and p.marketing_opt_in))
   and c.status<>'CANCELLED') as allowed
   from public.users u cross join app_private.email_campaigns c cross join app_private.email_delivery_controls controls where u.id=${row.user_id}::uuid and c.id=${row.campaign_id}::uuid`));
  if(eligible&&!eligible.enabled){await db.execute(sql`update app_private.email_recipients set status='PENDING',lease_until=null,next_attempt_at=now()+interval '1 minute' where id=${row.id}::uuid and status='PROCESSING'`);continue;}
  if(!eligible?.allowed||!senderAllowed){await db.execute(sql`update app_private.email_recipients set status='SKIPPED',last_error_code=${senderAllowed?'PREFERENCE_OR_ACCOUNT_CHANGED':'SENDER_ACCESS_REVOKED'},lease_until=null where id=${row.id}::uuid and status='PROCESSING'`);skipped++;continue;}
  try{
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`kampusone-broadcast/${row.id}`},body:JSON.stringify(row.payload),signal:AbortSignal.timeout(8000)});
   const payload=await response.json().catch(()=>null) as {id?:string;name?:string}|null;
   if(!response.ok){
    const retry=response.status===429||response.status>=500||(response.status===409&&payload?.name==='concurrent_idempotent_requests');
    const state=retry&&row.attempts<6?'PENDING':response.status===409?'UNKNOWN':'FAILED';
    await db.execute(sql`update app_private.email_recipients set status=${state},last_error_code=${'PROVIDER_HTTP_'+response.status},lease_until=null,next_attempt_at=now()+make_interval(mins=>least(120,power(2,attempts)::int)) where id=${row.id}::uuid and status='PROCESSING'`);continue;
   }
   if(!payload?.id)throw new Error('MISSING_PROVIDER_RECEIPT');
   await db.execute(sql`update app_private.email_recipients set status='ACCEPTED',provider_email_id=${payload.id},accepted_at=now(),lease_until=null,last_error_code=null where id=${row.id}::uuid and status='PROCESSING'`);
   await reconcileEmailEvents(env,payload.id);accepted++;
  }catch{
   // A timeout can hide an accepted send. Preserve the exact payload/key and stop before 24 hours.
   await db.execute(sql`update app_private.email_recipients set status=case when attempts>=6 then 'UNKNOWN' else 'PENDING' end,last_error_code='DELIVERY_UNCONFIRMED',lease_until=null,next_attempt_at=now()+make_interval(mins=>least(120,power(2,attempts)::int)) where id=${row.id}::uuid and status='PROCESSING'`);
  }
 }
 await db.execute(sql`update app_private.email_campaigns c set status=case when exists(select 1 from app_private.email_recipients r where r.campaign_id=c.id and not r.is_test and r.status in('PENDING','PROCESSING')) then 'SENDING' else 'COMPLETED' end,updated_at=now() where c.status in('QUEUED','SENDING') and(c.scheduled_at is null or c.scheduled_at<=now())`);
 return {accepted,skipped};
}
