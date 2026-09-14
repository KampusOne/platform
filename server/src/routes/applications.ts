import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, agentApplicationSchema } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { input } from "../lib/input";
import { ageOn } from "../lib/platform-policy";
import { requireFullKyc } from "../lib/kyc";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import { recordAudit } from "../lib/audit";
import type { Bindings, Variables } from "../types";
export const applicationRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
applicationRoutes.use("/*", requireAuth);
const schema = agentApplicationSchema.extend({
  birthDate: z.string(),
  isStudent: z.boolean(),
  matricNumber: z.string().trim().max(80).optional(),
  department: z.string().trim().max(120).optional(),
  businessName: z.string().trim().max(120).optional(),
  businessAddress: z.string().trim().max(500).optional(),
  identityDocumentId: z.string().uuid(),
  portraitDocumentId: z.string().uuid(),
  studentDocumentId: z.string().uuid().optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianPhone: z.string().trim().max(20).optional(),
  guardianEmail: z.string().email().optional(),
  guardianRelationship: z.string().trim().max(80).optional(),
});
applicationRoutes.get("/", async (c) => {
  const result = await database(c.env).execute(
    sql`select a.id,a.agent_type,a.display_name,a.status,a.kyc_status,a.bank_status,a.review_note,a.submitted_at,a.university_id,u.name university_name from public.agent_applications a join public.universities u on u.id=a.university_id where a.user_id=${currentUser(c).id}::uuid order by a.submitted_at desc limit 50`,
  );
  return c.json({ applications: result.rows });
});
applicationRoutes.post("/", async (c) => {
  const u = currentUser(c);
  const d = await input(c, schema);
  const age = ageOn(d.birthDate);
  if (age < 16 || age > 110)
    throw new AppError(
      400,
      "INELIGIBLE",
      "Agents must be at least 16. Check your date of birth.",
    );
  if (u.universityId && u.universityId !== d.universityId)
    throw new AppError(403, "FORBIDDEN", "Apply through your university.");
  if (d.isStudent && (!d.studentDocumentId || !d.matricNumber || !d.department))
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Add your student ID, matric number and department.",
    );
  if (
    age < 18 &&
    (!d.guardianName ||
      !d.guardianEmail ||
      !d.guardianRelationship ||
      !/^\+[1-9]\d{7,14}$/.test(d.guardianPhone ?? ""))
  )
    throw new AppError(
      400,
      "GUARDIAN_REQUIRED",
      "Add your guardian’s name, phone, email and relationship.",
    );
  const ids = [
    d.identityDocumentId,
    d.portraitDocumentId,
    ...(d.studentDocumentId ? [d.studentDocumentId] : []),
  ];
  if (new Set(ids).size !== ids.length)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose separate identity and portrait documents.",
    );
  const docs = await database(c.env).execute<{
    id: string;
    content_type: string;
  }>(
    sql`select id,content_type from public.media_objects where id=any(${sql.param(ids)}::uuid[]) and owner_user_id=${u.id}::uuid and kind='kyc' and deleted_at is null`,
  );
  if (
    docs.rows.length !== ids.length ||
    !docs.rows
      .find((m) => m.id === d.portraitDocumentId)
      ?.content_type.startsWith("image/")
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Upload your documents and a portrait photograph first.",
    );
  const result = await database(c.env).execute(sql`with application as (
 insert into public.agent_applications(university_id,user_id,agent_type,display_name,phone_e164,statement,legal_name,address_text,emergency_contact_name,emergency_contact_phone,terms_version,terms_accepted_at,kyc_status)
 values(${d.universityId}::uuid,${u.id}::uuid,${d.agentType},${d.displayName},${d.phoneE164},${d.statement},${d.legalName},${d.address},${d.emergencyContactName},${d.emergencyContactPhone},${d.termsVersion},now(),'PENDING')
 on conflict(university_id,user_id,agent_type) do update set display_name=excluded.display_name,phone_e164=excluded.phone_e164,statement=excluded.statement,legal_name=excluded.legal_name,address_text=excluded.address_text,emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,terms_version=excluded.terms_version,terms_accepted_at=now(),kyc_status='PENDING',bank_status='NOT_STARTED',status='SUBMITTED',review_note=null,submitted_at=now(),updated_at=now()
 where agent_applications.status in('DRAFT','NEEDS_CORRECTION','REJECTED') returning id,status), details as (
 insert into public.agent_application_details(application_id,birth_date,is_student,matric_number,department,business_name,business_address,identity_document_id,portrait_document_id,student_document_id,guardian_name,guardian_phone,guardian_email,guardian_relationship,terms_version)
 select id,${d.birthDate}::date,${d.isStudent},${d.matricNumber ?? null},${d.department ?? null},${d.businessName ?? null},${d.businessAddress ?? null},${d.identityDocumentId}::uuid,${d.portraitDocumentId}::uuid,${d.studentDocumentId ?? null}::uuid,${d.guardianName ?? null},${d.guardianPhone ?? null},${d.guardianEmail ?? null},${d.guardianRelationship ?? null},${d.termsVersion} from application
 on conflict(application_id) do update set birth_date=excluded.birth_date,is_student=excluded.is_student,matric_number=excluded.matric_number,department=excluded.department,business_name=excluded.business_name,business_address=excluded.business_address,identity_document_id=excluded.identity_document_id,portrait_document_id=excluded.portrait_document_id,student_document_id=excluded.student_document_id,guardian_name=excluded.guardian_name,guardian_phone=excluded.guardian_phone,guardian_email=excluded.guardian_email,guardian_relationship=excluded.guardian_relationship,guardian_consent_at=null,guardian_reviewed_by=null,guardian_evidence=null,terms_version=excluded.terms_version returning application_id) select application.id,application.status from application join details on details.application_id=application.id`);
  const row = firstRow(result);
  if (!row)
    throw new AppError(
      409,
      "CONFLICT",
      "This application is already under review or approved.",
    );
  await recordAudit(c.env, {
    actorUserId: u.id,
    universityId: d.universityId,
    action: "agent.application.submitted",
    targetType: "agent_application",
    targetId: String(row.id),
    requestId: c.get("requestId"),
  });
  return c.json(row, 201);
});
applicationRoutes.get("/trial", async (c) => {
  return c.json({
    trial:
      firstRow(
        await database(c.env).execute(
          sql`select id,claimed_at,expires_at,revoked_at from public.agent_trials where user_id=${currentUser(c).id}::uuid`,
        ),
      ) ?? null,
  });
});
applicationRoutes.post("/trial", async (c) => {
  const u = currentUser(c);
  const profile = firstRow(
    await database(c.env).execute<{
      application_id: string;
      university_id: string;
    }>(
      sql`select application_id,university_id from public.agent_profiles where user_id=${u.id}::uuid and status='ACTIVE' order by verified_at limit 1`,
    ),
  );
  if (!profile)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Your application must be approved first.",
    );
  await requireFullKyc(c.env, profile.application_id);
  const result = await database(c.env).execute(
    sql`insert into public.agent_trials(user_id,institution_id) values(${u.id}::uuid,${profile.university_id}::uuid) on conflict(user_id) do nothing returning id,claimed_at,expires_at`,
  );
  if (!firstRow(result))
    throw new AppError(
      409,
      "CONFLICT",
      "Your free trial has already been claimed.",
    );
  await recordAudit(c.env, {
    actorUserId: u.id,
    action: "agent.trial.claimed",
    targetType: "agent_trial",
    targetId: String(firstRow(result)?.id),
    requestId: c.get("requestId"),
  });
  return c.json({ trial: firstRow(result) }, 201);
});
