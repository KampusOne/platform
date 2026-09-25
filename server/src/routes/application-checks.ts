import {Hono} from 'hono';
import {z} from '@kampusone/contracts';
import {requireAgentIdentity} from '../lib/kyc';
import {sql} from 'drizzle-orm';
import {database,firstRow} from '../lib/database';
import {id,input} from '../lib/input';
import {AppError} from '../lib/errors';
import {sha256} from "../lib/security";
import {ageOn} from '../lib/platform-policy';
import {currentUser} from '../middleware/auth';
import {resolveAdminScope} from '../lib/admin-access';
import type {Bindings,Variables} from '../types';
export const applicationCheckRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
export const APPLICATION_CHECK_VERSION='metadata-completeness-v1';
type Flag={code:string;severity:'REVIEW';message:string;fields:string[]};
type Snapshot={id:string;university_id:string;source_revision:string;agent_type:string;legal_name:string;display_name:string;phone_e164:string;terms_accepted_at:string|null;kyc_status:string;details_id:string|null;birth_date:string|null;is_student:boolean|null;matric_number:string|null;department:string|null;business_name:string|null;business_address:string|null;identity_document_id:string|null;portrait_document_id:string|null;student_document_id:string|null;guardian_name:string|null;guardian_phone:string|null;guardian_email:string|null;guardian_relationship:string|null;guardian_consent_at:string|null;role_details:Record<string,unknown>|null;documents:{id:string;kind:string;content_type:string;size_bytes:number;owned:boolean;deleted_at:string|null}[]};
export function assessApplication(snapshot:Snapshot){
 const flags:Flag[]=[];const add=(code:string,message:string,...fields:string[])=>flags.push({code,severity:'REVIEW',message,fields});
 if(!snapshot.details_id)add('MISSING_DETAILS','Role-specific application details have not been supplied.','details');
 if(!snapshot.terms_accepted_at)add('TERMS_MISSING','No accepted agent terms were recorded.','terms_accepted_at');
 if(!/^\+[1-9]\d{7,14}$/.test(snapshot.phone_e164))add('CONTACT_INVALID','The contact number is not in the supported international format.','phone_e164');
 const age=snapshot.birth_date?ageOn(snapshot.birth_date):-1;
 if(age<16||age>110)add('BIRTH_DATE_REVIEW','The birth date is missing or outside the accepted age range.','birth_date');
 if(age>=16&&age<18&&!snapshot.guardian_consent_at)add('GUARDIAN_REVIEW','Independent guardian consent still requires human review.','guardian_consent_at');
 if(snapshot.is_student&&(!snapshot.matric_number||!snapshot.department))add('STUDENT_DETAILS_INCOMPLETE','The student matriculation or department detail is missing.','matric_number','department');
 const documents=snapshot.documents??[];
 const evidence=[['identity_document_id',snapshot.identity_document_id],['portrait_document_id',snapshot.portrait_document_id],...(snapshot.is_student?[['student_document_id',snapshot.student_document_id]]:[])] as [string,string|null][];
 const rider=Array.isArray(snapshot.role_details?.riderDocumentIds)?snapshot.role_details!.riderDocumentIds as string[]:[];
 if(snapshot.agent_type==='RIDER')rider.forEach((value,index)=>evidence.push(['riderDocumentIds.'+index,value]));
 if(new Set(evidence.map(x=>x[1]).filter(Boolean)).size!==evidence.filter(x=>x[1]).length)add('DUPLICATE_EVIDENCE','The same file is used for different evidence requirements.','documents');
 for(const[field,mediaId]of evidence){const media=documents.find(m=>m.id===mediaId);if(!media||media.deleted_at||!media.owned||media.kind!=='kyc'){add('EVIDENCE_UNAVAILABLE','Required private evidence is missing or no longer belongs to this applicant.',field);continue;}
 if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(media.content_type)||media.size_bytes<1||media.size_bytes>10485760)add('EVIDENCE_METADATA_INVALID','Stored evidence metadata falls outside the supported file policy.',field);
 if(field==='portrait_document_id'&&!media.content_type.startsWith('image/'))add('PORTRAIT_FORMAT','The portrait must be a supported image.',field);
 }
 const r=snapshot.role_details??{};
 if(snapshot.agent_type==='VENDOR'){
 if(!snapshot.business_name||!snapshot.business_address)add('VENDOR_DETAILS_INCOMPLETE','Business name or business location is missing.','business_name','business_address');
 if(!['GRANTED','NOT_REQUIRED','REVIEW'].includes(String(r.campusPermission)))add('CAMPUS_PERMISSION_UNSPECIFIED','The applicant has not stated whether campus permission is required.','campusPermission');
 if(r.campusPermission==='REVIEW')add('CAMPUS_PERMISSION_REVIEW','The applicant explicitly requested a review of campus selling permission.','campusPermission');
 }
 if(snapshot.agent_type==='TUTOR'&&(!Array.isArray(r.tutorSubjects)||!r.tutorSubjects.length||!Array.isArray(r.tutorLevels)||!r.tutorLevels.length||typeof r.experience!=='string'||!r.experience.trim()))add('TUTOR_DETAILS_INCOMPLETE','Subjects, levels or teaching background are missing.','tutorSubjects','tutorLevels','experience');
 if(snapshot.agent_type==='RIDER'&&!rider.length)add('RIDER_EVIDENCE_MISSING','Bike or operating evidence has not been provided.','riderDocumentIds');
 return {flags,reviewGroup:flags.length?'NEEDS_REVIEW':'COMPLETE',coverage:{schemaVersion:1,engine:APPLICATION_CHECK_VERSION,performed:['required_fields','ownership_and_file_metadata','duplicate_evidence','role_completeness','age_and_consent_fields'],notPerformed:['document_text_readability','document_authenticity','identity_match','ai_generated_image_detection','fraud_prediction'],humanDecisionRequired:true}};
}
async function snapshot(env:Bindings,applicationId:string){
 const result=firstRow(await database(env).execute<Snapshot>(sql`select a.id,a.university_id,a.updated_at::text source_revision,a.agent_type,a.legal_name,a.display_name,a.phone_e164,a.terms_accepted_at,a.kyc_status,d.application_id details_id,d.birth_date::text,d.is_student,d.matric_number,d.department,d.business_name,d.business_address,d.identity_document_id,d.portrait_document_id,d.student_document_id,d.guardian_name,d.guardian_phone,d.guardian_email,d.guardian_relationship,d.guardian_consent_at,d.role_details,coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'content_type',m.content_type,'size_bytes',m.size_bytes,'owned',m.owner_user_id=a.user_id,'deleted_at',m.deleted_at)) from public.media_objects m where m.id in(d.identity_document_id,d.portrait_document_id,d.student_document_id) or m.id::text in(select jsonb_array_elements_text(case when jsonb_typeof(d.role_details->'riderDocumentIds')='array' then d.role_details->'riderDocumentIds' else '[]'::jsonb end))),'[]'::jsonb) documents from public.agent_applications a left join public.agent_application_details d on d.application_id=a.id where a.id=${applicationId}::uuid`));
 if(result)result.source_revision=await sha256(JSON.stringify(result));
 return result;
}
applicationCheckRoutes.get('/applications/:id/checks',async c=>{
 const target=id(c.req.param('id')),application=await snapshot(c.env,target);
 if(!application)throw new AppError(404,'NOT_FOUND','Application not found.');
 await resolveAdminScope(c.env,currentUser(c),application.university_id,'agents.verify');
 const result=await database(c.env).execute(sql`select id,check_version,result_schema_version,status,review_group,flags,coverage,attempts,error_code,created_at,completed_at,(source_revision=${application.source_revision}) current from app_private.application_checks where application_id=${target}::uuid order by created_at desc limit 10`);
 return c.json({checks:result.rows,humanDecisionRequired:true});
});
applicationCheckRoutes.post('/applications/:id/checks',async c=>{
 const target=id(c.req.param('id')),application=await snapshot(c.env,target),actor=currentUser(c);
 if(!application)throw new AppError(404,'NOT_FOUND','Application not found.');
 await resolveAdminScope(c.env,actor,application.university_id,'agents.verify');
 const db=database(c.env);
 const rate=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('AGENT_CHECK',${actor.id},60,3600,3600) allowed`));if(!rate?.allowed)throw new AppError(429,'RATE_LIMITED','Check limit reached. Try again later.');
 const existing=firstRow(await db.execute<{id:string;status:string}>(sql`select id,status from app_private.application_checks where application_id=${target}::uuid and source_revision=${application.source_revision} and check_version=${APPLICATION_CHECK_VERSION}`));
 if(existing?.status==='COMPLETED')return c.json({id:existing.id,status:'COMPLETED',reused:true});
 const job=firstRow(await db.execute<{id:string}>(sql`insert into app_private.application_checks(application_id,institution_id,source_revision,check_version,status,requested_by,started_at) values(${target}::uuid,${application.university_id}::uuid,${application.source_revision},${APPLICATION_CHECK_VERSION},'RUNNING',${actor.id}::uuid,now()) on conflict(application_id,source_revision,check_version) do update set status='RUNNING',attempts=application_checks.attempts+1,error_code=null,started_at=now() where application_checks.attempts<3 and(application_checks.status='FAILED' or(application_checks.status='RUNNING' and application_checks.started_at<now()-interval '5 minutes')) returning id`));
 if(!job)throw new AppError(409,'CONFLICT','This check is running or its retry limit has been reached.');
 try{
 const result=assessApplication(application);
 const changed=await db.execute(sql`with finished as(update app_private.application_checks set status='COMPLETED',review_group=${result.reviewGroup},flags=${JSON.stringify(result.flags)}::jsonb,coverage=${JSON.stringify(result.coverage)}::jsonb,completed_at=now() where id=${job.id}::uuid returning id) insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) select ${actor.id}::uuid,${application.university_id}::uuid,'agent.check.completed','agent_application',${target},${c.get('requestId')},'succeeded',${JSON.stringify({checkId:job.id,version:APPLICATION_CHECK_VERSION,flags:result.flags.map(f=>f.code)})}::jsonb from finished returning id`);
 if(!firstRow(changed))throw new Error('CHECK_SAVE_FAILED');
 return c.json({id:job.id,status:'COMPLETED',reviewGroup:result.reviewGroup,flags:result.flags,humanDecisionRequired:true},201);
 }catch(error){await db.execute(sql`update app_private.application_checks set status='FAILED',error_code='CHECK_FAILED',completed_at=now() where id=${job.id}::uuid and status='RUNNING'`);throw error;}
});
applicationCheckRoutes.post('/applications/bulk-review/preview',async c=>{
 const d=await input(c,z.object({applicationIds:z.array(z.string().uuid()).min(1).max(25),decision:z.enum(['APPROVED','NEEDS_CORRECTION','REJECTED'])}));
 if(new Set(d.applicationIds).size!==d.applicationIds.length)throw new AppError(400,'BAD_REQUEST','Select each application only once.');
 const actor=currentUser(c),rows=await database(c.env).execute<{id:string;display_name:string;agent_type:string;university_id:string;status:string;revision:string}>(sql`select id,display_name,agent_type,university_id,status,updated_at::text revision from public.agent_applications where id=any(${sql.param(d.applicationIds)}::uuid[]) order by id`);
 if(rows.rows.length!==d.applicationIds.length)throw new AppError(404,'NOT_FOUND','A selected application is unavailable.');
 for(const application of rows.rows){await resolveAdminScope(c.env,actor,application.university_id,'agents.review');if(!['SUBMITTED','IN_REVIEW'].includes(application.status))throw new AppError(409,'CONFLICT','Only submitted or under-review applications can be selected.');if(d.decision==='APPROVED')await requireAgentIdentity(c.env,application.id);}
 const saved=firstRow(await database(c.env).execute<{id:string;expires_at:string}>(sql`insert into app_private.agent_review_previews(actor_user_id,decision,snapshots)values(${actor.id}::uuid,${d.decision},${JSON.stringify(rows.rows)}::jsonb)returning id,expires_at`));
 return c.json({previewId:saved!.id,expiresAt:saved!.expires_at,decision:d.decision,applications:rows.rows.map(({revision,...application})=>application)},201);
});
applicationCheckRoutes.post('/applications/bulk-review/:id/confirm',async c=>{
 const d=await input(c,z.object({confirm:z.literal(true),note:z.string().trim().min(10).max(1000)})),actor=currentUser(c),target=id(c.req.param('id'));
 const preview=firstRow(await database(c.env).execute<{decision:string;snapshots:{id:string;university_id:string}[]}>(sql`select decision,snapshots from app_private.agent_review_previews where id=${target}::uuid and actor_user_id=${actor.id}::uuid`));
 if(!preview)throw new AppError(404,'NOT_FOUND','Review selection not found.');
 for(const application of preview.snapshots)await resolveAdminScope(c.env,actor,application.university_id,'agents.review');
 const result=firstRow(await database(c.env).execute<{outcome:string}>(sql`select app_private.confirm_agent_review_preview(${target}::uuid,${actor.id}::uuid,${d.note},${c.get('requestId')}) outcome`));
 if(!result||!['CONFIRMED','EXISTING'].includes(result.outcome))throw new AppError(409,'CONFLICT','The reviewed selection expired or an application changed. Review a new selection before deciding.');
 return c.json({status:'confirmed',decision:preview.decision,applicationIds:preview.snapshots.map(x=>x.id),reused:result.outcome==='EXISTING'});
});
