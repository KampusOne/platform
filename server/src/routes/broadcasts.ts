import { Hono, type Context } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from '@kampusone/contracts';
import { database, firstRow } from '../lib/database';
import { resolveAdminScope } from '../lib/admin-access';
import { currentUser, requireAuth } from '../middleware/auth';
import { id, input } from '../lib/input';
import { AppError } from '../lib/errors';
import { audienceForCampaign, composeBroadcastPayload, emailProviderStatus, emailUniversityMembership, escapeEmailHtml, freezeEmailContent, reconcileEmailEvents, requireBroadcastProvider, verifyResendSignature, type Campaign, type EmailContent, type EmailBindings } from '../services/broadcast-delivery';
import type { Variables } from '../types';

type EmailEnvironment={Bindings:EmailBindings;Variables:Variables};
type Ctx=Context<EmailEnvironment>;
export const broadcastRoutes=new Hono<EmailEnvironment>();
export const emailPreferencesRoutes=new Hono<EmailEnvironment>();
const segmentSchema=z.object({role:z.enum(['ALL','STUDENT','AGENT','VENDOR','TUTOR','RIDER','BUYER','STAFF']).default('ALL'),userIds:z.array(z.string().uuid()).max(500).default([]),facultyId:z.string().uuid().optional(),departmentId:z.string().uuid().optional(),agentStatus:z.enum(['ACTIVE','PAUSED','SUSPENDED']).optional()});
const draftSchema=z.object({personaId:z.string().uuid(),kind:z.enum(['OPERATIONAL','MARKETING']),subject:z.string().trim().min(3).max(160).refine(s=>!/[\r\n]/.test(s)),body:z.string().trim().min(5).max(20000),segment:segmentSchema});
async function scope(c:Ctx,permission:string){return resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),permission);}
async function campaign(c:Ctx,permission:string):Promise<Campaign>{
 const selected=await scope(c,permission);const campaignId=id(c.req.param('id')!);
 const row=firstRow(await database(c.env).execute<Campaign>(sql`select c.*,p.display_name from app_private.email_campaigns c join app_private.email_personas p on p.id=c.persona_id where c.id=${campaignId}::uuid and ${selected?sql`c.institution_id=${selected}::uuid`:sql`true`}`));
 if(!row)throw new AppError(404,'NOT_FOUND','Campaign not found in this university scope.');return row;
}
function requireEditable(row:Campaign){if(!['DRAFT','REVIEWED'].includes(row.status))throw new AppError(409,'CONFLICT','Queued or completed campaigns cannot be edited. Create a new draft.');}
async function controls(c:Ctx){return firstRow(await database(c.env).execute<{enabled:boolean;max_per_day:number;max_per_minute:number;postal_address:string|null}>(sql`select enabled,max_per_day,max_per_minute,postal_address from app_private.email_delivery_controls where singleton`))!;}
async function globalManager(c:Ctx){const resolved=await resolveAdminScope(c.env,currentUser(c),undefined,'broadcasts.manage');if(resolved!==null)throw new AppError(403,'FORBIDDEN','Global email settings require platform-wide campaign management access.');}

broadcastRoutes.get('/settings',async c=>{
 await scope(c,'broadcasts.view');const settings=await controls(c);const personas=await database(c.env).execute(sql`select id,display_name,active from app_private.email_personas order by created_at`);
 return c.json({settings,personas:personas.rows,provider:emailProviderStatus(c.env),disclosure:'Official KampusOne team sender identities; internal staff authors remain auditable.'});
});
broadcastRoutes.put('/settings',async c=>{
 await globalManager(c);const d=await input(c,z.object({enabled:z.boolean(),maxPerDay:z.number().int().min(1).max(10000),maxPerMinute:z.number().int().min(1).max(100),postalAddress:z.string().trim().max(500)}));const actor=currentUser(c);
 await database(c.env).execute(sql`with changed as(update app_private.email_delivery_controls set enabled=${d.enabled},max_per_day=${d.maxPerDay},max_per_minute=${d.maxPerMinute},postal_address=${d.postalAddress||null},updated_by=${actor.id}::uuid,updated_at=now() where singleton returning singleton)
 insert into app_private.audit_events(actor_user_id,action,target_type,target_id,outcome,metadata) select ${actor.id}::uuid,'email.controls.updated','email_controls','global','succeeded',${JSON.stringify({enabled:d.enabled,maxPerDay:d.maxPerDay,maxPerMinute:d.maxPerMinute})}::jsonb from changed`);
 return c.json({saved:true});
});
broadcastRoutes.post('/personas',async c=>{
 await globalManager(c);const d=await input(c,z.object({displayName:z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N} .,'’\-]+$/u)}));const actor=currentUser(c);
 const result=firstRow(await database(c.env).execute(sql`with created as(insert into app_private.email_personas(display_name,created_by) values(${d.displayName},${actor.id}::uuid) returning id,display_name),audit as(insert into app_private.audit_events(actor_user_id,action,target_type,target_id,outcome) select ${actor.id}::uuid,'email.persona.created','email_persona',id::text,'succeeded' from created)select * from created`));return c.json(result,201);
});
broadcastRoutes.get('/templates',async c=>{
 await scope(c,'broadcasts.view');return c.json({templates:[
 {id:'operational-update',kind:'OPERATIONAL',name:'Operational update',subject:'An update about your KampusOne account',body:'Describe the account or service change here.\n\nExplain who is affected, the action required, and where to get help.'},
 {id:'campus-announcement',kind:'OPERATIONAL',name:'Campus notice',subject:'Campus service update',body:'Write the verified update for the selected campus.\n\nInclude the effective date and the official source where relevant.'},
 {id:'opt-in-news',kind:'MARKETING',name:'Opt-in community news',subject:'The latest from KampusOne',body:'Share a useful update for subscribers.\n\nAdd the relevant details and a clear next step.'},
 ]});
});
broadcastRoutes.get('/segments',async c=>{
 const selected=await scope(c,'broadcasts.view');if(!selected)return c.json({faculties:[],departments:[]});const db=database(c.env);
 const [faculties,departments]=await Promise.all([db.execute(sql`select id,name from public.faculties where university_id=${selected}::uuid and deleted_at is null order by name`),db.execute(sql`select d.id,d.name,d.faculty_id from public.departments d join public.faculties f on f.id=d.faculty_id where f.university_id=${selected}::uuid and f.deleted_at is null and d.deleted_at is null order by d.name`)]);
 return c.json({faculties:faculties.rows,departments:departments.rows});
});
broadcastRoutes.get('/recipients',async c=>{
 const selected=await scope(c,'broadcasts.view');const search=(c.req.query('q')??'').trim().slice(0,100);if(search.length<2)return c.json({users:[]});
 const rows=await database(c.env).execute(sql`select u.id,u.email,p.display_name from public.users u left join public.profiles p on p.user_id=u.id where u.deleted_at is null and u.status::text='ACTIVE' and u.email_verified_at is not null and ${emailUniversityMembership(selected)} and(u.email ilike ${'%'+search+'%'} or p.display_name ilike ${'%'+search+'%'}) order by p.display_name,u.id limit 20`);
 return c.json({users:rows.rows});
});
broadcastRoutes.get('/',async c=>{
 const selected=await scope(c,'broadcasts.view');const rows=await database(c.env).execute(sql`select id,institution_id,kind,subject,revision,status,scheduled_at,created_at,updated_at from app_private.email_campaigns where ${selected?sql`institution_id=${selected}::uuid`:sql`true`} order by created_at desc limit 100`);return c.json({campaigns:rows.rows});
});
broadcastRoutes.post('/',async c=>{
 const selected=await scope(c,'broadcasts.manage');const actor=currentUser(c);const d=await input(c,draftSchema);
 const result=firstRow(await database(c.env).execute<{id:string}>(sql`with created as(insert into app_private.email_campaigns(institution_id,created_by,updated_by,persona_id,kind,subject,body,segment) select ${selected}::uuid,${actor.id}::uuid,${actor.id}::uuid,p.id,${d.kind},${d.subject},${d.body},${JSON.stringify(d.segment)}::jsonb from app_private.email_personas p where p.id=${d.personaId}::uuid and p.active returning id),audit as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome)select ${actor.id}::uuid,${selected}::uuid,'email.campaign.created','email_campaign',id::text,'succeeded' from created) select * from created`));
 if(!result)throw new AppError(400,'BAD_REQUEST','Choose an active KampusOne sender persona.');return c.json(result,201);
});
broadcastRoutes.get('/:id',async c=>{
 const row=await campaign(c,'broadcasts.view');const db=database(c.env);
 const counts=await db.execute(sql`select is_test,status,count(*)::int as count from app_private.email_recipients where campaign_id=${row.id}::uuid and status<>'PREVIEW' group by is_test,status order by is_test,status`);
 const events=await db.execute(sql`select e.event_type,e.occurred_at,e.received_at from app_private.email_delivery_events e join app_private.email_recipients r on r.provider_email_id=e.provider_email_id where r.campaign_id=${row.id}::uuid order by e.received_at desc limit 50`);
 const snapshot=row.reviewed_snapshot_id?firstRow(await db.execute<{id:string;revision:number;eligible_count:number;excluded_count:number;expires_at:string;content:EmailContent}>(sql`select id,revision,eligible_count,excluded_count,expires_at,content from app_private.email_audience_snapshots where id=${row.reviewed_snapshot_id}::uuid and campaign_id=${row.id}::uuid`)):null;
 const sample=snapshot?await db.execute<{userId:string;name:string;email:string}>(sql`select r.user_id as "userId",coalesce(p.display_name,'KampusOne member') as name,r.email from app_private.email_recipients r left join public.profiles p on p.user_id=r.user_id where r.snapshot_id=${snapshot.id}::uuid order by r.user_id limit 20`):null;
 const review=snapshot?{snapshotId:snapshot.id,revision:snapshot.revision,eligibleCount:snapshot.eligible_count,excludedCount:snapshot.excluded_count,expiresAt:snapshot.expires_at,scope:row.institution_id,subject:snapshot.content.subject,body:snapshot.content.body,sender:snapshot.content.from,sample:sample?.rows??[]}:null;
 return c.json({campaign:row,delivery:counts.rows,events:events.rows,review});
});
broadcastRoutes.put('/:id',async c=>{
 const row=await campaign(c,'broadcasts.manage');requireEditable(row);const d=await input(c,draftSchema.extend({revision:z.number().int().positive()}));const actor=currentUser(c);
 const saved=firstRow(await database(c.env).execute(sql`with changed as(update app_private.email_campaigns set persona_id=${d.personaId}::uuid,kind=${d.kind},subject=${d.subject},body=${d.body},segment=${JSON.stringify(d.segment)}::jsonb,revision=revision+1,status='DRAFT',reviewed_snapshot_id=null,updated_by=${actor.id}::uuid,updated_at=now() where id=${row.id}::uuid and revision=${d.revision} and status in('DRAFT','REVIEWED') and exists(select 1 from app_private.email_personas p where p.id=${d.personaId}::uuid and p.active) returning id,revision),audit as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome)select ${actor.id}::uuid,${row.institution_id}::uuid,'email.campaign.edited','email_campaign',id::text,'succeeded' from changed)select * from changed`));
 if(!saved)throw new AppError(409,'CONFLICT','This draft changed or its sender is inactive. Reload before editing.');return c.json(saved);
});
broadcastRoutes.post('/:id/preview',async c=>{
 const row=await campaign(c,'broadcasts.manage');requireEditable(row);const d=await input(c,z.object({revision:z.number().int().positive()}));if(row.revision!==d.revision)throw new AppError(409,'CONFLICT','Reload the changed draft before reviewing.');
 const setting=await controls(c);const content=freezeEmailContent(c.env,row,setting.postal_address);const audience=await audienceForCampaign(c.env,row);const eligible=audience.filter(r=>r.eligible);const snapshotId=crypto.randomUUID();const actor=currentUser(c);
 // Transmit shared content once; PostgreSQL freezes each recipient payload in this same transaction.
 const templateToken=crypto.randomUUID(),payloadTemplate=JSON.stringify(composeBroadcastPayload(content,'recipient@example.invalid',templateToken));
 const recipients=eligible.map(r=>({user_id:r.user_id,email:r.email,id:crypto.randomUUID(),token:crypto.randomUUID()}));
 const saved=firstRow(await database(c.env).execute<{id:string;expires_at:string}>(sql`with locked as(select id from app_private.email_campaigns where id=${row.id}::uuid and revision=${d.revision} and status in('DRAFT','REVIEWED') for update),snapshot as(insert into app_private.email_audience_snapshots(id,campaign_id,revision,reviewed_by,content,eligible_count,excluded_count)select ${snapshotId}::uuid,id,${d.revision},${actor.id}::uuid,${JSON.stringify(content)}::jsonb,${eligible.length},${audience.length-eligible.length} from locked returning id,expires_at),recipients as(insert into app_private.email_recipients(id,campaign_id,campaign_revision,snapshot_id,requested_by,user_id,institution_id,email,kind,unsubscribe_token,payload)select r.id,${row.id}::uuid,${d.revision},s.id,${actor.id}::uuid,r.user_id,${row.institution_id}::uuid,r.email,${row.kind},r.token,jsonb_set(replace(${payloadTemplate},${templateToken},r.token::text)::jsonb,'{to}',jsonb_build_array(r.email)) from snapshot s cross join jsonb_to_recordset(${JSON.stringify(recipients)}::jsonb) as r(id uuid,user_id uuid,email text,token uuid)),updated as(update app_private.email_campaigns set status='REVIEWED',reviewed_snapshot_id=${snapshotId}::uuid where id in(select id from locked) and exists(select 1 from snapshot)) select * from snapshot`));
 if(!saved)throw new AppError(409,'CONFLICT','The draft changed. Generate a new audience preview.');
 return c.json({snapshotId:saved.id,revision:d.revision,eligibleCount:eligible.length,excludedCount:audience.length-eligible.length,suppressedCount:audience.filter(r=>r.suppressed).length,notOptedInCount:row.kind==='MARKETING'?audience.filter(r=>!r.consented&&!r.suppressed).length:0,expiresAt:saved.expires_at,scope:row.institution_id,subject:content.subject,body:content.body,sender:content.from,sample:eligible.slice(0,20).map(r=>({userId:r.user_id,name:r.display_name,email:r.email})),message:'This review has not queued or sent any email.'});
});
broadcastRoutes.post('/:id/test',async c=>{
 const row=await campaign(c,'broadcasts.send');requireEditable(row);requireBroadcastProvider(c.env);const d=await input(c,z.object({userId:z.string().uuid(),requestId:z.string().uuid(),revision:z.number().int().positive(),confirm:z.literal('SEND_TEST')}));
 if(row.revision!==d.revision)throw new AppError(409,'CONFLICT','The draft changed. Reload before sending a test.');
 const content=freezeEmailContent(c.env,row,(await controls(c)).postal_address);const testCampaign={...row,segment:{role:'ALL' as const,userIds:[d.userId]}};
 const recipient=(await audienceForCampaign(c.env,testCampaign)).find(r=>r.user_id===d.userId&&r.eligible);if(!recipient)throw new AppError(400,'BAD_REQUEST','The selected account is unavailable, outside this scope, suppressed, or not subscribed to promotional email.');
 const token=crypto.randomUUID(),payload=composeBroadcastPayload(content,recipient.email,token,true),actor=currentUser(c);
 const result=firstRow(await database(c.env).execute<{id:string}>(sql`with created as(insert into app_private.email_recipients(campaign_id,campaign_revision,requested_by,user_id,institution_id,email,kind,is_test,request_id,unsubscribe_token,payload,status) select c.id,${d.revision},${actor.id}::uuid,${recipient.user_id}::uuid,${row.institution_id}::uuid,${recipient.email},${row.kind},true,${d.requestId}::uuid,${token}::uuid,${JSON.stringify(payload)}::jsonb,'PENDING' from app_private.email_campaigns c where c.id=${row.id}::uuid and c.revision=${d.revision} and c.status in('DRAFT','REVIEWED') on conflict(campaign_id,request_id) do nothing returning id),audit as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata)select ${actor.id}::uuid,${row.institution_id}::uuid,'email.test.queued','email_campaign',${row.id},'succeeded',${JSON.stringify({recipientId:recipient.user_id,requestId:d.requestId})}::jsonb from created)select id from created union all select id from app_private.email_recipients where campaign_id=${row.id}::uuid and request_id=${d.requestId}::uuid and user_id=${d.userId}::uuid and campaign_revision=${d.revision} limit 1`));
 if(!result)throw new AppError(409,'CONFLICT','The campaign changed before the test was queued.');
 return c.json({queued:true,recipientCount:1,deliveryId:result.id,message:'Only the selected account is queued. Delivery has not yet been confirmed.'});
});
broadcastRoutes.post('/:id/send',async c=>{
 const row=await campaign(c,'broadcasts.send');requireBroadcastProvider(c.env);const d=await input(c,z.object({snapshotId:z.string().uuid(),revision:z.number().int().positive(),recipientCount:z.number().int().min(1).max(10000),confirm:z.literal('SEND_REVIEWED_CAMPAIGN'),scheduledAt:z.string().datetime().optional()}));
 if(d.scheduledAt&&Date.parse(d.scheduledAt)<Date.now()+30000)throw new AppError(400,'BAD_REQUEST','Choose a future schedule time, or send without a schedule.');
 if(row.reviewed_snapshot_id===d.snapshotId&&['QUEUED','SENDING','COMPLETED'].includes(row.status))return c.json({queued:true,alreadyQueued:true});
 const actor=currentUser(c);const result=firstRow(await database(c.env).execute<{id:string}>(sql`with approved as(update app_private.email_campaigns c set status='QUEUED',scheduled_at=${d.scheduledAt??null}::timestamptz,updated_by=${actor.id}::uuid,updated_at=now() from app_private.email_audience_snapshots s where c.id=${row.id}::uuid and c.status='REVIEWED' and c.revision=${d.revision} and c.reviewed_snapshot_id=${d.snapshotId}::uuid and s.id=c.reviewed_snapshot_id and s.revision=c.revision and s.eligible_count=${d.recipientCount} and s.expires_at>now() and exists(select 1 from app_private.email_delivery_controls where singleton and enabled) returning c.id,c.reviewed_snapshot_id),queued as(update app_private.email_recipients r set status='PENDING',requested_by=${actor.id}::uuid from approved a where r.snapshot_id=a.reviewed_snapshot_id and r.status='PREVIEW'),audit as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata)select ${actor.id}::uuid,${row.institution_id}::uuid,'email.campaign.queued','email_campaign',id::text,'succeeded',${JSON.stringify({snapshotId:d.snapshotId,recipientCount:d.recipientCount,scheduledAt:d.scheduledAt??null})}::jsonb from approved)select id from approved`));
 if(!result)throw new AppError(409,'CONFLICT','The preview expired, its content/count changed, or campaign delivery is paused. Review the audience again.');return c.json({queued:true,recipientCount:d.recipientCount,scheduledAt:d.scheduledAt??null,message:'The reviewed audience is queued. Preferences and suppressions are checked again before each send.'});
});
broadcastRoutes.post('/:id/cancel',async c=>{
 const row=await campaign(c,'broadcasts.manage');const actor=currentUser(c);
 await database(c.env).execute(sql`with stopped as(update app_private.email_campaigns set status='CANCELLED',updated_by=${actor.id}::uuid,updated_at=now() where id=${row.id}::uuid and status<>'COMPLETED' returning id),skipped as(update app_private.email_recipients set status='SKIPPED',last_error_code='CAMPAIGN_CANCELLED' where campaign_id in(select id from stopped) and status in('PREVIEW','PENDING')),audit as(insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome)select ${actor.id}::uuid,${row.institution_id}::uuid,'email.campaign.cancelled','email_campaign',id::text,'succeeded' from stopped) select id from stopped`);
 return c.json({cancelled:row.status!=='COMPLETED',message:'Pending email has been stopped. Email already accepted by the provider cannot be recalled.'});
});

emailPreferencesRoutes.get('/preferences',requireAuth,async c=>{
 const row=firstRow(await database(c.env).execute(sql`select marketing_opt_in,consent_version,updated_at from app_private.email_preferences where user_id=${currentUser(c).id}::uuid`));return c.json(row??{marketing_opt_in:false,consent_version:null});
});
emailPreferencesRoutes.put('/preferences',requireAuth,async c=>{
 const user=currentUser(c);const d=await input(c,z.object({marketingOptIn:z.boolean(),consentVersion:z.literal('marketing-email-v1')}));
 await database(c.env).execute(sql`with changed as(insert into app_private.email_preferences(user_id,marketing_opt_in,consent_version)values(${user.id}::uuid,${d.marketingOptIn},${d.consentVersion})on conflict(user_id)do update set marketing_opt_in=excluded.marketing_opt_in,consent_version=excluded.consent_version,updated_at=now()returning user_id)insert into app_private.email_preference_events(user_id,marketing_opt_in,source,consent_version)select user_id,${d.marketingOptIn},'authenticated_account',${d.consentVersion} from changed`);return c.json({saved:true,marketingOptIn:d.marketingOptIn});
});
emailPreferencesRoutes.get('/unsubscribe/:token',async c=>{
 const token=id(c.req.param('token'));const found=firstRow(await database(c.env).execute(sql`select id from app_private.email_recipients where unsubscribe_token=${token}::uuid and kind='MARKETING'`));if(!found)throw new AppError(404,'NOT_FOUND','This email preference link is not available.');
 c.header('Cache-Control','no-store');c.header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
 return c.html(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KampusOne email preferences</title></head><body style="font:17px/1.6 Arial;background:#FBF7F2;color:#29231F;padding:32px"><main style="max-width:520px;margin:auto"><h1>Email preferences</h1><p>Stop promotional email from KampusOne. Account and service messages are separate.</p><form method="post" action="/v1/email/unsubscribe/${escapeEmailHtml(token)}"><button style="padding:14px 20px;background:#713C29;color:white;border:0;font:inherit">Unsubscribe</button></form></main></body></html>`);
});
emailPreferencesRoutes.post('/unsubscribe/:token',async c=>{
 const token=id(c.req.param('token'));
 const changed=firstRow(await database(c.env).execute(sql`with recipient as(select user_id from app_private.email_recipients where unsubscribe_token=${token}::uuid and kind='MARKETING'),updated as(insert into app_private.email_preferences(user_id,marketing_opt_in)select user_id,false from recipient on conflict(user_id)do update set marketing_opt_in=false,updated_at=now()returning user_id),events as(insert into app_private.email_preference_events(user_id,marketing_opt_in,source)select user_id,false,'email_unsubscribe' from updated)select user_id from updated`));
 if(!changed)throw new AppError(404,'NOT_FOUND','This email preference link is not available.');c.header('Cache-Control','no-store');return c.req.header('Accept')?.includes('text/html')?c.text('You are unsubscribed from KampusOne promotional email.',200):c.body(null,200);
});
emailPreferencesRoutes.post('/webhooks/resend',async c=>{
 if(!c.env.RESEND_WEBHOOK_SECRET)throw new AppError(503,'PROVIDER_UNAVAILABLE','Email event verification is not configured.');
 const raw=await c.req.text();if(raw.length>65536||!await verifyResendSignature(raw,c.req.raw.headers,c.env.RESEND_WEBHOOK_SECRET))throw new AppError(400,'BAD_REQUEST','Invalid email event signature.');
 const schema=z.object({type:z.string().max(80),created_at:z.string().datetime(),data:z.object({email_id:z.string().min(1).max(200),to:z.array(z.string().email()).max(50).optional()})});
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new AppError(400,'BAD_REQUEST','Invalid email delivery event.');}
 const event=schema.safeParse(parsed);if(!event.success)throw new AppError(400,'BAD_REQUEST','Invalid email delivery event.');
 const e=event.data,eventId=c.req.header('svix-id')!;const recognised=['email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed'];if(!recognised.includes(e.type))return c.json({received:true,ignored:true});
 const addresses=(e.data.to??[]).map(s=>s.toLowerCase());const suppress=['email.bounced','email.complained','email.suppressed'].includes(e.type);
 await database(c.env).execute(sql`with logged as(insert into app_private.email_delivery_events(event_id,provider_email_id,event_type,occurred_at,recipient_email)values(${eventId},${e.data.email_id},${e.type},${e.created_at}::timestamptz,${addresses[0]??null})on conflict(event_id)do nothing returning event_id),suppressed as(insert into app_private.email_suppressions(email,reason,provider_email_id)select addr,${e.type},${e.data.email_id} from unnest(${sql.param(addresses)}::text[])addr where ${suppress} and exists(select 1 from logged)on conflict(email)do nothing)select event_id from logged`);
 await reconcileEmailEvents(c.env,e.data.email_id);return c.json({received:true});
});
