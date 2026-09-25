import {sha256} from "../lib/security";
import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow,sqlClient} from '../lib/database';
import {id,input} from '../lib/input';
import {AppError} from '../lib/errors';
import {currentUser} from '../middleware/auth';
import {adminAccess,resolveAdminScope} from '../lib/admin-access';
import type {Bindings,Variables} from '../types';
export const academicAdminRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;},'Use a valid calendar date.');
const safeUrl=z.string().url().max(2000).refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;},'Use an HTTPS primary source URL.');
async function requireGlobal(env:Bindings,user:ReturnType<typeof currentUser>,permission:string){
 const access=await adminAccess(env,user);
 if(!access.grants.some(g=>g.university_id===null&&g.permissions.includes(permission)))throw new AppError(403,'FORBIDDEN','Global academic review permission is required for unassigned source claims.');
}
academicAdminRoutes.get('/claims',async c=>{
 await requireGlobal(c.env,currentUser(c),'academic.view');
 const kind=c.req.query('kind')||null,status=c.req.query('status')||'PENDING',q=c.req.query('q')?.trim().slice(0,160),page=Math.max(1,Math.min(10000,Math.trunc(Number(c.req.query('page'))||1))),pageSize=25;
 const filter=sql`(${kind}::text is null or c.claim_kind=${kind}) and (${status}='ALL' or c.review_status=${status}) and (${q?'%'+q+'%':null}::text is null or c.payload::text ilike ${q?'%'+q+'%':null})`;
 const db=database(c.env);const [rows,count]=await Promise.all([db.execute(sql`select c.*,d.filename,d.metadata_json from public.academic_source_claims c join public.academic_source_documents d on d.source_key=c.source_key where ${filter} order by c.source_key,c.report_ref limit ${pageSize} offset ${(page-1)*pageSize}`),db.execute<{total:number}>(sql`select count(*)::int total from public.academic_source_claims c where ${filter}`)]);
 return c.json({rows:rows.rows,total:firstRow(count)?.total??0,page,pageSize});
});
academicAdminRoutes.post('/claims/:id/publish-institution',async c=>{
 const actor=currentUser(c),target=id(c.req.param('id'));
 await requireGlobal(c.env,actor,'academic.manage');
 const d=await input(c,z.object({name:z.string().trim().min(3).max(160),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),primarySourceUrl:safeUrl,sourceVerified:z.literal(true),reason:z.string().trim().min(20).max(2000),existingInstitutionId:z.string().uuid().optional()}));
 const claim=firstRow(await database(c.env).execute<{claim_kind:string;review_status:string;institution_id:string|null}>(sql`select claim_kind,review_status,institution_id from public.academic_source_claims where id=${target}::uuid`));
 if(!claim||claim.claim_kind!=='institution')throw new AppError(404,'NOT_FOUND','Choose an institution source claim.');
 if(claim.review_status!=='PENDING')throw new AppError(409,'CONFLICT','This claim has already been reviewed.');
 if(d.existingInstitutionId&&!firstRow(await database(c.env).execute(sql`select id from public.universities where id=${d.existingInstitutionId}::uuid and deleted_at is null`)))throw new AppError(400,'BAD_REQUEST','The selected institution is unavailable.');
 const collision=firstRow(await database(c.env).execute<{id:string}>(sql`select id from public.universities where slug=${d.slug} or lower(name)=lower(${d.name}) limit 1`));
 if(collision&&collision.id!==d.existingInstitutionId)throw new AppError(409,'CONFLICT','A matching institution already exists. Review and link its existing record.');
 const university=d.existingInstitutionId??crypto.randomUUID();
 let published:{outcome:string;institution_id:string}|undefined;
 try{published=firstRow(await database(c.env).execute<{outcome:string;institution_id:string}>(sql`select outcome,published_institution_id institution_id from app_private.publish_academic_institution(${target}::uuid,${actor.id}::uuid,${university}::uuid,${Boolean(d.existingInstitutionId)},${d.name},${d.slug},${d.primarySourceUrl},${d.reason},${c.get('requestId')})`));}
 catch(error){if((error as {code?:string}).code==='23505')throw new AppError(409,'CONFLICT','An institution with this identity was created during review. Reload and link it.');throw error;}
 if(published?.outcome!=='CREATED')throw new AppError(409,'CONFLICT','This claim was already reviewed or matches an existing institution. Reload before continuing.');
 return c.json({institutionId:university,status:'APPROVED'},201);
});
academicAdminRoutes.post('/claims/:id/review',async c=>{
 await requireGlobal(c.env,currentUser(c),'academic.manage');
 const d=await input(c,z.object({decision:z.literal('REJECTED'),reason:z.string().trim().min(20).max(2000)})),target=id(c.req.param('id')),actor=currentUser(c);
 const result=await database(c.env).execute(sql`with changed as(update public.academic_source_claims set review_status='REJECTED',reviewed_by=${actor.id}::uuid,reviewed_at=now(),review_note=${d.reason} where id=${target}::uuid and review_status='PENDING' returning id) insert into app_private.audit_events(actor_user_id,action,target_type,target_id,request_id,outcome,metadata) select ${actor.id}::uuid,'academic.claim.rejected','academic_source_claim',id::text,${c.get('requestId')},'succeeded',${JSON.stringify({reason:d.reason})}::jsonb from changed returning target_id`);
 if(!firstRow(result))throw new AppError(409,'CONFLICT','This source claim is unavailable or has already been reviewed.');
 return c.json({status:'REJECTED'});
});
academicAdminRoutes.get('/guidelines',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'academic.view');
 const result=await database(c.env).execute(sql`select id,institution_id,faculty_id,department_id,title,body,status,source_url,source_key,source_page,source_excerpt,issuing_institution,document_date,effective_from,session_label,programme_name,family_id,version,published_at from public.institution_guidelines where (${scope}::uuid is null or institution_id=${scope}::uuid) order by updated_at desc limit 200`);
 return c.json({rows:result.rows});
});
academicAdminRoutes.post('/guidelines',async c=>{
 const d=await input(c,z.object({universityId:z.string().uuid(),facultyId:z.string().uuid().optional(),departmentId:z.string().uuid().optional(),title:z.string().trim().min(3).max(180),body:z.string().trim().min(20).max(20000),sourceUrl:safeUrl,sourceKey:z.string().max(240).default(""),sourcePage:z.number().int().positive(),sourceExcerpt:z.string().trim().min(10).max(2000),issuingInstitution:z.string().trim().min(2).max(180),documentDate:dateOnly.optional(),effectiveFrom:dateOnly.optional(),sessionLabel:z.string().trim().max(40).optional(),programmeName:z.string().trim().max(180).optional(),sourceVerified:z.literal(true),reason:z.string().trim().min(20).max(2000),replacesId:z.string().uuid().optional()}));
 const actor=currentUser(c);await resolveAdminScope(c.env,actor,d.universityId,'academic.manage');
 if(!d.sourceKey){
  const hash=await sha256(d.sourceUrl);d.sourceKey="web:"+hash;
  if(d.sourcePage!==1)throw new AppError(400,'BAD_REQUEST','Use page 1 for a web source, or select a registered paginated document.');
  await database(c.env).execute(sql`insert into public.academic_source_documents(source_key,filename,sha256,metadata_json) values(${d.sourceKey},${d.sourceUrl},${hash},${JSON.stringify({kind:'web',hashKind:'url',primarySourceUrl:d.sourceUrl,pages:1})}::jsonb) on conflict(source_key) do nothing`);
 }
 const document=firstRow(await database(c.env).execute<{metadata_json:{pages?:number}}>(sql`select metadata_json from public.academic_source_documents where source_key=${d.sourceKey}`));
 if(!document||d.sourcePage>(Number(document.metadata_json.pages)||0))throw new AppError(400,'BAD_REQUEST','Choose a page in a registered source document.');
 if(d.facultyId&&!firstRow(await database(c.env).execute(sql`select id from public.faculties where id=${d.facultyId}::uuid and university_id=${d.universityId}::uuid and deleted_at is null`)))throw new AppError(400,'BAD_REQUEST','The faculty does not belong to this university.');
 if(d.departmentId&&!firstRow(await database(c.env).execute(sql`select d.id from public.departments d join public.faculties f on f.id=d.faculty_id where d.id=${d.departmentId}::uuid and f.university_id=${d.universityId}::uuid and (${d.facultyId??null}::uuid is null or f.id=${d.facultyId??null}::uuid) and d.deleted_at is null`)))throw new AppError(400,'BAD_REQUEST','The department does not belong to this academic scope.');
 const prior=d.replacesId?firstRow(await database(c.env).execute<{family_id:string;version:number;status:string}>(sql`select family_id,version,status from public.institution_guidelines where id=${d.replacesId}::uuid and institution_id=${d.universityId}::uuid`)):null;
 if(d.replacesId&&(!prior||prior.status!=='PUBLISHED'))throw new AppError(409,'CONFLICT','Only the current published guideline can be replaced.');
 const target=crypto.randomUUID(),family=prior?.family_id??crypto.randomUUID(),version=(prior?.version??0)+1,client=sqlClient(c.env),queries=[client`select pg_advisory_xact_lock(hashtextextended(${family},0))`];
 if(d.replacesId)queries.push(client`update public.institution_guidelines set status='ARCHIVED',updated_at=now() where id=${d.replacesId}::uuid and status='PUBLISHED'`);
 queries.push(client`insert into public.institution_guidelines(id,institution_id,faculty_id,department_id,title,body,source_url,status,created_by,published_by,published_at,source_key,source_page,source_excerpt,issuing_institution,document_date,effective_from,session_label,programme_name,family_id,version) values(${target}::uuid,${d.universityId}::uuid,${d.facultyId??null}::uuid,${d.departmentId??null}::uuid,${d.title},${d.body},${d.sourceUrl},'PUBLISHED',${actor.id}::uuid,${actor.id}::uuid,now(),${d.sourceKey},${d.sourcePage},${d.sourceExcerpt},${d.issuingInstitution},${d.documentDate??null}::date,${d.effectiveFrom??null}::date,${d.sessionLabel??null},${d.programmeName??null},${family}::uuid,${version})`);
 queries.push(client`insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) values(${actor.id}::uuid,${d.universityId}::uuid,'academic.guideline.published','guideline',${target},${c.get('requestId')},'succeeded',${JSON.stringify({reason:d.reason,sourceKey:d.sourceKey,sourcePage:d.sourcePage,version,replacesId:d.replacesId??null})}::jsonb)`);
 try{await client.transaction(queries);}catch(error){if((error as {code?:string}).code==='23505')throw new AppError(409,'CONFLICT','This guideline was revised by another reviewer. Reload before editing.');throw error;}
 return c.json({id:target,version,status:'PUBLISHED'},201);
});

academicAdminRoutes.get('/catalogue',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'academic.view');
 const db=database(c.env),[faculties,departments,programmes]=await Promise.all([
  db.execute(sql`select id,university_id,name,slug from public.faculties where deleted_at is null and (${scope}::uuid is null or university_id=${scope}::uuid) order by name`),
  db.execute(sql`select d.id,d.faculty_id,d.name,d.slug from public.departments d join public.faculties f on f.id=d.faculty_id where d.deleted_at is null and f.deleted_at is null and (${scope}::uuid is null or f.university_id=${scope}::uuid) order by d.name`),
  db.execute(sql`select c.id,c.department_id,c.name,c.code,c.award,c.normal_duration_years,c.primary_source_url from public.courses c join public.departments d on d.id=c.department_id join public.faculties f on f.id=d.faculty_id where c.deleted_at is null and d.deleted_at is null and (${scope}::uuid is null or f.university_id=${scope}::uuid) order by c.name`)
 ]);return c.json({faculties:faculties.rows,departments:departments.rows,programmes:programmes.rows});
});
academicAdminRoutes.post('/catalogue',async c=>{
 const d=await input(c,z.object({id:z.string().uuid(),universityId:z.string().uuid(),kind:z.enum(['faculty','department','programme']),parentId:z.string().uuid().optional(),name:z.string().trim().min(2).max(160),code:z.string().trim().max(24).default(''),award:z.string().trim().max(30).default(''),durationYears:z.number().min(1).max(10).nullable().default(null),sourceUrl:safeUrl,sourceVerified:z.literal(true),reason:z.string().trim().min(10).max(1000)}).strict());
 const u=currentUser(c),db=database(c.env);await resolveAdminScope(c.env,u,d.universityId,'academic.manage');
 let result;
 const slug=d.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 if(d.kind==='faculty')result=await db.execute(sql`insert into public.faculties(id,university_id,name,slug,updated_at)values(${d.id}::uuid,${d.universityId}::uuid,${d.name},${slug},now()) on conflict(id) do update set name=excluded.name,updated_at=now() where faculties.university_id=excluded.university_id returning id`);
 else if(d.kind==='department'){
  if(!d.parentId||!firstRow(await db.execute(sql`select id from public.faculties where id=${d.parentId}::uuid and university_id=${d.universityId}::uuid and deleted_at is null`)))throw new AppError(400,'BAD_REQUEST','Choose a faculty in this university.');
  result=await db.execute(sql`insert into public.departments(id,faculty_id,name,slug,updated_at)values(${d.id}::uuid,${d.parentId}::uuid,${d.name},${slug},now()) on conflict(id) do update set name=excluded.name,updated_at=now() where departments.faculty_id=excluded.faculty_id returning id`);
 }else{
  if(!d.parentId||!firstRow(await db.execute(sql`select d.id from public.departments d join public.faculties f on f.id=d.faculty_id where d.id=${d.parentId}::uuid and f.university_id=${d.universityId}::uuid and d.deleted_at is null`)))throw new AppError(400,'BAD_REQUEST','Choose a department in this university.');
  result=await db.execute(sql`insert into public.courses(id,department_id,name,code,award,normal_duration_years,primary_source_url,source_verified_at,updated_at)values(${d.id}::uuid,${d.parentId}::uuid,${d.name},${d.code},${d.award},${d.durationYears},${d.sourceUrl},now(),now()) on conflict(id) do update set name=excluded.name,code=excluded.code,award=excluded.award,normal_duration_years=excluded.normal_duration_years,primary_source_url=excluded.primary_source_url,source_verified_at=now(),updated_at=now() where courses.department_id=excluded.department_id returning id`);
 }
 if(!firstRow(result))throw new AppError(403,'FORBIDDEN','This record belongs to a different academic scope.');
 await db.execute(sql`insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) values(${u.id}::uuid,${d.universityId}::uuid,'academic.catalogue.saved',${d.kind},${d.id},${c.get('requestId')},'succeeded',${JSON.stringify({reason:d.reason,primarySourceUrl:d.sourceUrl,name:d.name})}::jsonb)`);
 return c.json({id:d.id,saved:true});
});
