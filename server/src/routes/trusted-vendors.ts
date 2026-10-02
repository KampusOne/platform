import {Hono} from 'hono';
import {z} from '@kampusone/contracts';
import {sql} from 'drizzle-orm';
import {database,firstRow} from '../lib/database';
import {currentUser,requireAuth} from '../middleware/auth';
import {resolveAdminScope} from '../lib/admin-access';
import {recordAudit} from '../lib/audit';
import {id,input} from '../lib/input';
import {AppError} from '../lib/errors';
import type {Bindings,Variables} from '../types';
export const trustedVendorRoutes=new Hono<{Bindings:Bindings,Variables:Variables}>();
trustedVendorRoutes.use('*',requireAuth);
trustedVendorRoutes.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
const token=z.string().regex(/^[a-f0-9]{64}$/);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
trustedVendorRoutes.post('/invite',async c=>{const d=await input(c,z.object({token}).strict()),actor=currentUser(c);const invite=firstRow(await database(c.env).execute(sql`select i.id,i.institution_id,school.name university_name,i.expires_at,i.application_id from app_private.trusted_vendor_invites i join public.universities school on school.id=i.institution_id join public.users account on account.id=${actor.id}::uuid and lower(account.email)=lower(i.email) and account.email_verified_at is not null where i.token_hash=${await hash(d.token)} and i.revoked_at is null and(i.expires_at>now()or i.claimed_user_id=${actor.id}::uuid)`));if(!invite)throw new AppError(403,'FORBIDDEN','This invitation is unavailable for your account. Sign in with the invited email.');return c.json({invite});});
const submission=z.object({token,requestId:z.string().uuid(),businessName:z.string().trim().min(2).max(160),legalName:z.string().trim().min(2).max(160),birthDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),description:z.string().trim().min(20).max(2000),address:z.string().trim().min(10).max(500),category:z.enum(['Restaurant','Supermarket','Groceries','Fashion','Beauty','Electronics','Printing','Other']),campus:z.string().trim().min(2).max(100),phone:z.string().regex(/^\+234[789]\d{9}$/),whatsapp:z.string().regex(/^\+234[789]\d{9}$/).optional(),profileMediaId:z.string().uuid().optional(),businessDocumentIds:z.array(z.string().uuid()).min(1).max(4).refine(v=>new Set(v).size===v.length),adultAuthorized:z.literal(true),terms:z.literal(true)}).strict();
trustedVendorRoutes.post('/submit',async c=>{
 const u=currentUser(c),d=await input(c,submission),db=database(c.env);
 const allowed=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('TRUSTED_VENDOR_SUBMIT',${u.id},10,3600,3600) allowed`));
 if(!allowed?.allowed)throw new AppError(429,'RATE_LIMITED','Please wait before submitting again.');
 try{
  const {token:code,requestId,...values}=d,codeHash=await hash(code);
  const documents=await db.execute<{id:string}>(sql`select distinct m.id from public.media_objects m join app_private.trusted_vendor_invites i on i.token_hash=${codeHash} where m.id=any(${sql.param(d.businessDocumentIds)}::uuid[]) and m.owner_user_id=${u.id}::uuid and m.kind='kyc' and m.deleted_at is null and(m.institution_id is null or m.institution_id=i.institution_id)`);
  if(documents.rows.length!==d.businessDocumentIds.length)throw new AppError(400,'BAD_REQUEST','Upload at least one valid school or business document before submitting.');
  const row=firstRow(await db.execute<{id:string}>(sql`select app_private.submit_trusted_vendor(${u.id}::uuid,${codeHash},${requestId}::uuid,${JSON.stringify(values)}::jsonb) id`));
  if(!row?.id)throw new AppError(409,'CONFLICT','The invitation or application changed. Refresh and try again.');
  await db.execute(sql`update public.agent_applications set evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('businessDocumentIds',${JSON.stringify(d.businessDocumentIds)}::jsonb),updated_at=now() where id=${row.id}::uuid and user_id=${u.id}::uuid`);
  return c.json({id:row.id,status:'SUBMITTED'},201);
 }catch(e){
  if(e instanceof AppError)throw e;
  if(e instanceof Error&&/TRUSTED_|agent_applications_university_id_user_id_agent_type_key/.test(e.message))throw new AppError(409,'CONFLICT','The invitation, age, uploaded documents, profile photo or application changed. Check your details or contact the inviting team.');
  throw e;
 }
});
trustedVendorRoutes.get('/admin',async c=>{const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'agents.review');const rows=await database(c.env).execute(sql`select a.id,a.university_id,a.user_id,a.display_name,a.legal_name,a.phone_e164,a.status,a.updated_at::text revision,coalesce(a.evidence->'businessDocumentIds','[]'::jsonb) business_document_ids,t.birth_date,t.description,t.address,t.category,t.campus,t.whatsapp_phone,t.review_note,t.approved_at,u.email,i.reason invitation_reason from app_private.trusted_vendor_intakes t join public.agent_applications a on a.id=t.application_id join app_private.trusted_vendor_invites i on i.id=t.invite_id join public.users u on u.id=a.user_id where(${scope}::uuid is null or a.university_id=${scope}::uuid)order by a.submitted_at desc limit 100`);return c.json({applications:rows.rows});});
trustedVendorRoutes.post('/admin/invites',async c=>{const u=currentUser(c),d=await input(c,z.object({universityId:z.string().uuid(),email:z.email(),reason:z.string().trim().min(10).max(2000)}).strict());await resolveAdminScope(c.env,u,d.universityId,'agents.review');const bytes=crypto.getRandomValues(new Uint8Array(32)),value=Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');const row=firstRow(await database(c.env).execute<{id:string}>(sql`insert into app_private.trusted_vendor_invites(institution_id,email,token_hash,created_by,reason,expires_at)values(${d.universityId}::uuid,${d.email.toLowerCase()},${await hash(value)},${u.id}::uuid,${d.reason},now()+interval '7 days')returning id`));await recordAudit(c.env,{actorUserId:u.id,universityId:d.universityId,action:'trusted_vendor.invited',targetType:'trusted_vendor_invite',targetId:row!.id,requestId:c.get('requestId'),metadata:{reason:d.reason}});return c.json({id:row!.id,url:'https://agents.kampusone.app/exclusive?invite='+value,expiresInDays:7},201);});
trustedVendorRoutes.post('/admin/:id/review',async c=>{
 const u=currentUser(c),applicationId=id(c.req.param('id')),d=await input(c,z.object({revision:z.string().min(1),decision:z.enum(['APPROVED','REJECTED']),note:z.string().trim().min(20).max(2000),verifiedBusinessAndContact:z.literal(true),verifiedDocuments:z.literal(true)}).strict()),db=database(c.env);
 const a=firstRow(await db.execute<{university_id:string,user_id:string,evidence:{businessDocumentIds?:unknown}|null}>(sql`select university_id,user_id,evidence from public.agent_applications where id=${applicationId}::uuid`));
 if(!a)throw new AppError(404,'NOT_FOUND','Application not found.');
 await resolveAdminScope(c.env,u,a.university_id,'agents.review');
 const rawIds=a.evidence?.businessDocumentIds;
 if(!Array.isArray(rawIds)||rawIds.length<1||rawIds.length>4||new Set(rawIds).size!==rawIds.length||rawIds.some(value=>typeof value!=='string'||!/^[0-9a-f-]{36}$/i.test(value)))throw new AppError(409,'CONFLICT','This invited vendor has no valid uploaded business evidence. Ask them to submit the Exclusive form again.');
 const documentIds=rawIds as string[];
 const documents=await db.execute<{id:string}>(sql`select id from public.media_objects where id=any(${sql.param(documentIds)}::uuid[]) and owner_user_id=${a.user_id}::uuid and(institution_id is null or institution_id=${a.university_id}::uuid) and kind='kyc' and deleted_at is null`);
 if(documents.rows.length!==documentIds.length)throw new AppError(409,'CONFLICT','One or more uploaded business documents are unavailable. Ask the applicant to upload the evidence again.');
 const result=firstRow(await db.execute<{result:string}>(sql`select app_private.review_trusted_vendor(${u.id}::uuid,${applicationId}::uuid,${d.revision},${d.decision},${d.note},${c.get('requestId')}) result`));
 if(!['REVIEWED','EXISTING'].includes(result?.result??''))throw new AppError(409,'CONFLICT','The application or invitation changed. Refresh before reviewing.');
 await recordAudit(c.env,{actorUserId:u.id,universityId:a.university_id,action:'trusted_vendor.documents_verified',targetType:'agent_application',targetId:applicationId,requestId:c.get('requestId'),metadata:{decision:d.decision,documentCount:documentIds.length}});
 return c.json({status:d.decision});
});
