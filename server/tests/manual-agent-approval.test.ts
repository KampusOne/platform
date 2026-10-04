import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { app } from "../src/app";
import { createSession } from "../src/services/sessions";
import { requireAgentIdentity, requireFullKyc } from "../src/lib/kyc";
import type { Bindings } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({ database: () => testDatabaseAdapter(db), sqlClient: () => testSqlClient(db), firstRow: (value: { rows: unknown[] }) => value.rows[0] }));
const campus = crypto.randomUUID(), foreignCampus = crypto.randomUUID(), admin = crypto.randomUUID(), foreignReviewer = crypto.randomUUID(), applicant = crypto.randomUUID();
const env = { ENVIRONMENT: "local", ALLOWED_ORIGINS: "https://example.invalid", MINIMUM_APP_VERSION: "1", MAINTENANCE_MODE: "false", JWT_SECRET: "test-only-manual-review-secret-123456789012345", PHASE_2_SCHEMA_READY: "true", UNIFIED_SCHEMA_READY: "true" } as Bindings;
const tokens = new Map<string,string>();
async function request(id: string, actor: string, data: unknown) {
  return app.request(`/v1/admin/applications/${id}/approve`, { method: "POST", headers: { Authorization: `Bearer ${tokens.get(actor)}`, "Content-Type": "application/json" }, body: JSON.stringify(data) }, env);
}
async function application(incomplete = false, birthDate = "2000-01-01") {
  const id = crypto.randomUUID(), identity = crypto.randomUUID(), portrait = crypto.randomUUID(), person = crypto.randomUUID();
  await db.query("insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,$1::uuid::text||'@example.invalid','test',now(),now())",[person]);
  await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values($1,$1,substring($1::uuid::text,1,20),'Test',$2,now())",[person,campus]);
  await db.query("insert into app_private.verified_people(user_id,identity_fingerprint,verified_by)values($1,$2,$3)",[person,person.replaceAll('-','').repeat(2),admin]);
  tokens.set(person,(await createSession(env,{id:person,email:person+'@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:campus})).accessToken);
  for (const media of [identity,portrait]) await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name,deleted_at)values($1,$2,$3,'kyc',$1::uuid::text,'image/jpeg',100,'evidence',$4)", [media,person,campus,incomplete ? new Date().toISOString() : null]);
  await db.query("insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,legal_name,address_text,terms_version,terms_accepted_at)values($1,$2,$3,'VENDOR','Test vendor','+2348012345678','Campus services with reviewed business and contact information.','Test vendor','Main campus','test',now())", [id,campus,person]);
  await db.query("insert into public.agent_application_details(application_id,birth_date,is_student,identity_document_id,portrait_document_id,terms_version)values($1,$2,false,$3,$4,'test')", [id,birthDate,identity,portrait]);
  const revision=(await db.query<{revision:string}>('select updated_at::text revision from public.agent_applications where id=$1',[id])).rows[0]!.revision;
  return {id,revision,userId:person};
}
beforeAll(async () => {
  db=await createTestDatabase();
  await db.exec(readFileSync(new URL('../../database/neon/migrations/20261001010000_private_agent_identity_submissions.sql',import.meta.url),'utf8'));
  await db.exec("create or replace function app_private.prevent_append_only_mutation()returns trigger language plpgsql as $$begin raise exception 'APPEND_ONLY';end$$;");
  await db.exec(readFileSync(new URL('../../database/neon/migrations/20261004014000_manual_agent_approval.sql',import.meta.url),'utf8'));
  for(const id of [campus,foreignCampus])await db.query("insert into public.universities(id,name,slug,updated_at)values($1,'Test '||$1::uuid::text,$1::uuid::text,now())",[id]);
  for(const actor of [admin,foreignReviewer,applicant]) {
    await db.query("insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,$1::uuid::text||'@example.invalid','test',now(),now())",[actor]);
    await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values($1,$1,substring($1::uuid::text,1,20),'Test',$2,now())",[actor,campus]);
    tokens.set(actor,(await createSession(env,{id:actor,email:actor+'@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:campus})).accessToken);
  }
  await db.query("insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')",[admin]);
  await db.query("insert into public.operator_roles(user_id,university_id,role)values($1,$2,'VERIFICATION_REVIEWER')",[foreignReviewer,foreignCampus]);
  await db.query("insert into app_private.verified_people(user_id,identity_fingerprint,verified_by)values($1,$2,$3)",[applicant,'a'.repeat(64),admin]);
},60000);
afterAll(async()=>{await db?.close();});
describe('single reviewed application approval',()=>{
  it('approves once with one action and leaves bank verification and withdrawal eligibility unchanged',async()=>{
    const a=await application();const body={revision:a.revision,reviewedEvidence:true};
    const response=await request(a.id,admin,body);expect(await response.json()).toMatchObject({status:'APPROVED',bankVerificationChanged:false});expect(response.status).toBe(200);
    expect((await request(a.id,admin,body)).status).toBe(200);
    expect((await db.query('select * from app_private.agent_manual_approvals where application_id=$1',[a.id])).rows).toHaveLength(1);
    await expect(requireAgentIdentity(env,a.id)).resolves.toMatchObject({manually_reviewed:true});
    await expect(requireFullKyc(env,a.id)).rejects.toMatchObject({code:'KYC_REQUIRED'});
    expect((await db.query<{bank_status:string}>('select bank_status from public.agent_applications where id=$1',[a.id])).rows[0]!.bank_status).toBe('NOT_STARTED');
  });
  it('requires an intentional scoped owner exception for incomplete fields and records exactly what was missing',async()=>{
    const a=await application(true),body={revision:a.revision,reviewedEvidence:true};
    const blocked=await request(a.id,admin,body);expect(blocked.status).toBe(409);expect(await blocked.json()).toMatchObject({error:{details:{reason:'APPLICATION_INCOMPLETE'}}});
    const overridden=await request(a.id,admin,{...body,overrideIncomplete:true,note:'Owner inspected the original documents in person and approved the business.'});expect(overridden.status).toBe(200);
    const audit=(await db.query<{missing_fields:string[];override_incomplete:boolean}>('select * from app_private.agent_manual_approvals where application_id=$1',[a.id])).rows[0]!;expect(audit.override_incomplete).toBe(true);expect(audit.missing_fields).toContain('Identity or student documents');
    await expect(requireAgentIdentity(env,a.id)).resolves.toBeDefined();await expect(requireFullKyc(env,a.id)).rejects.toMatchObject({code:'KYC_REQUIRED'});
  });
  it('retains tenant, self-review, stale-revision and minimum-age barriers',async()=>{
    const a=await application(),body={revision:a.revision,reviewedEvidence:true};
    expect((await request(a.id,foreignReviewer,body)).status).toBe(403);
    expect((await request(a.id,a.userId,body)).status).toBe(403);
    expect((await request(a.id,admin,{...body,revision:'old-revision'})).status).toBe(409);
    const underage=await application(false,'2015-01-01');expect((await request(underage.id,admin,{revision:underage.revision,reviewedEvidence:true,overrideIncomplete:true,note:'This attempt must remain forbidden.'})).status).toBe(409);
    await db.query("insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')",[a.userId]);
    expect((await request(a.id,a.userId,body)).status).toBe(403);
  });
});
