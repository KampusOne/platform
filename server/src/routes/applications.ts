import {acquisitionSchema} from '../lib/acquisition';
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, agentApplicationSchema } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { input } from "../lib/input";
import { ageOn } from "../lib/platform-policy";
import { requireAgentIdentity } from "../lib/kyc";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import { recordAudit } from "../lib/audit";
import {
  agentIntakeReady,
  identityEncryptionConfigured,
  encryptAgentNin,
  decryptAgentNin,
  type IdentityEnvelope,
  agentOperationsSchema,
  agentOperationsDraftSchema,
} from "../lib/agent-intake";
import { identityFingerprint } from "../lib/identity-fingerprint";
import { sha256 } from "../lib/security";
import type { Bindings, Variables } from "../types";
export const applicationRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
applicationRoutes.use("/*", requireAuth);
applicationRoutes.use("/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});
const schema = agentApplicationSchema.extend({
  acquisition:acquisitionSchema.optional(),
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
  whatsappPhone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional(),
  campus: z.string().trim().min(2).max(180).optional(),
  serviceLocation: z.string().trim().min(2).max(300).optional(),
  campusPermission: z.enum(["GRANTED", "NOT_REQUIRED", "REVIEW"]).optional(),
  tutorSubjects: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  tutorLevels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  experience: z.string().trim().max(2000).optional(),
  riderDocumentIds: z.array(z.string().uuid()).max(6).optional(),
  termsAccepted: z.literal(true).optional(),
  nin: z
    .string()
    .regex(/^\d{11}$/)
    .optional(),
  clientRequestId: z.string().uuid().optional(),
  businessDocumentIds: z
    .array(z.string().uuid())
    .max(4)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
  businessCategories: z
    .array(
      z.enum([
        "Restaurant",
        "Supermarket",
        "Groceries",
        "Fashion",
        "Beauty",
        "Electronics",
        "Printing",
        "Other",
      ]),
    )
    .max(8)
    .optional(),
  publishContacts: z.boolean().default(false),
  portraitSource: z.enum(["CAMERA", "UPLOAD"]).optional(),
  operations: agentOperationsSchema.optional(),
  uploadNames: z.record(z.string().uuid(), z.string().max(255)).optional(),
});
const draftId = z.union([z.literal(""), z.string().uuid()]);
const draftValuesSchema = z
  .object({
    acquisition:acquisitionSchema.optional(),
    heardSource:z.string().max(20).optional(),
    heardOther:z.string().max(240).optional(),
    birthDate: z.string().max(10),
    isStudent: z.boolean(),
    matricNumber: z.string().max(80),
    department: z.string().max(120),
    businessName: z.string().max(120),
    businessAddress: z.string().max(500),
    identityDocumentId: draftId,
    portraitDocumentId: draftId,
    studentDocumentId: draftId,
    guardianName: z.string().max(120),
    guardianPhone: z.string().max(20),
    guardianEmail: z.string().max(254),
    guardianRelationship: z.string().max(80),
    universityId: draftId,
    agentType: z.enum(["VENDOR", "TUTOR", "RIDER"]),
    displayName: z.string().max(120),
    phoneE164: z.string().max(20),
    statement: z.string().max(2000),
    legalName: z.string().max(120),
    address: z.string().max(500),
    emergencyContactName: z.string().max(120),
    emergencyContactPhone: z.string().max(20),
    whatsappPhone: z.string().max(20),
    campus: z.string().max(180),
    serviceLocation: z.string().max(300),
    campusPermission: z.enum(["GRANTED", "NOT_REQUIRED", "REVIEW"]),
    tutorSubjects: z.array(z.string().max(120)).max(40),
    tutorLevels: z.array(z.string().max(40)).max(20),
    experience: z.string().max(2000),
    riderDocumentIds: z.array(z.string().uuid()).max(6),
    clientRequestId: draftId,
    businessDocumentIds: z.array(z.string().uuid()).max(4),
    businessCategories: z
      .array(
        z.enum([
          "Restaurant",
          "Supermarket",
          "Groceries",
          "Fashion",
          "Beauty",
          "Electronics",
          "Printing",
          "Other",
        ]),
      )
      .max(8),
    publishContacts: z.boolean(),
    portraitSource: z.enum(["CAMERA", "UPLOAD"]),
    operations: agentOperationsDraftSchema,
    uploadNames: z.record(z.string().uuid(), z.string().max(255)),
  })
  .partial();
function restoredDraft(values: Record<string, unknown>) {
  const restored: Record<string, unknown> = {};
  // Old drafts may predate these field types. Keep valid fields individually.
  for (const [field, validator] of Object.entries(draftValuesSchema.shape)) {
    const parsed = validator.safeParse(values[field]);
    if (parsed.success && parsed.data !== undefined)
      restored[field] = parsed.data;
  }
  return restored;
}
applicationRoutes.get("/requirements", async (c) => {
  const schemaReady = await agentIntakeReady(c.env);
  return c.json({
    schemaVersion: 2,
    privateIdentityReady: schemaReady && identityEncryptionConfigured(c.env),
    schemaReady,
  });
});
applicationRoutes.get("/draft", async (c) => {
  const privateReady = await agentIntakeReady(c.env),
    draft = firstRow(
      await database(c.env).execute<{
        step: number;
        values: Record<string, unknown>;
        updated_at: string;
        identity_envelope?: IdentityEnvelope | null;
        nin_last4?: string | null;
      }>(
        sql`select step,values_json as values,updated_at${privateReady ? sql`,identity_envelope,nin_last4` : sql``} from public.agent_application_drafts where user_id=${currentUser(c).id}::uuid`,
      ),
    );
  if (draft) draft.values = restoredDraft(draft.values);
  if (draft?.identity_envelope) {
    try {
      draft.values.nin = await decryptAgentNin(
        c.env,
        draft.identity_envelope,
        currentUser(c).id,
      );
    } catch {
      draft.values.nin = "";
      draft.values.ninNeedsEntry = true;
    }
    delete draft.identity_envelope;
    delete draft.nin_last4;
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ draft: draft ?? null });
});
applicationRoutes.put("/draft", async (c) => {
  const d = await input(
    c,
    z.object({
      step: z.number().int().min(0).max(5),
      values: z.record(z.string(), z.unknown()),
    }),
  );
  // A draft is private unverified input, never a source of roles or approval.
  const draftParsed = draftValuesSchema.safeParse(d.values);
  if (!draftParsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the field types and evidence limits before saving this draft.",
    );
  const values = draftParsed.data;
  if (JSON.stringify(values).length > 60000)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "This application draft is too large.",
    );
  const privateReady = await agentIntakeReady(c.env),
    hasNin = d.values.nin !== undefined;
  let envelope: IdentityEnvelope | null = null,
    last4: string | null = null;
  if (hasNin && d.values.nin !== "") {
    if (!privateReady)
      throw new AppError(
        503,
        "PROVIDER_UNAVAILABLE",
        "Private identity submission is being connected.",
      );
    const parsed = z
      .object({
        nin: z.string().regex(/^\d{11}$/),
        clientRequestId: z.string().uuid(),
        universityId: z.string().uuid(),
      })
      .safeParse(d.values);
    if (!parsed.success)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Enter an eleven-digit NIN and choose your campus before saving this step.",
      );
    const user = currentUser(c);
    if (user.universityId && user.universityId !== parsed.data.universityId)
      throw new AppError(
        403,
        "FORBIDDEN",
        "Save this application through your university.",
      );
    envelope = await encryptAgentNin(
      c.env,
      parsed.data.nin,
      user.id,
      parsed.data.universityId,
      parsed.data.clientRequestId,
    );
    last4 = parsed.data.nin.slice(-4);
  }
  const result = await database(c.env).execute(
    sql`insert into public.agent_application_drafts(user_id,step,values_json${privateReady ? sql`,identity_envelope,nin_last4` : sql``}) values(${currentUser(c).id}::uuid,${d.step},${JSON.stringify(values)}::jsonb${privateReady ? sql`,${envelope ? JSON.stringify(envelope) : null}::jsonb,${last4}` : sql``}) on conflict(user_id) do update set step=excluded.step,values_json=excluded.values_json,updated_at=now()${privateReady ? sql`,identity_envelope=case when ${hasNin} then excluded.identity_envelope else agent_application_drafts.identity_envelope end,nin_last4=case when ${hasNin} then excluded.nin_last4 else agent_application_drafts.nin_last4 end` : sql``} returning step,updated_at`,
  );
  return c.json({ draft: firstRow(result) });
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
  const privateReady = await agentIntakeReady(c.env);
  let envelope: IdentityEnvelope | null = null,
    ninFingerprint: string | null = null,
    formHash: string | null = null;
  if (privateReady) {
    if (!d.nin || !d.clientRequestId)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Complete the updated identity step with your eleven-digit NIN.",
      );
    if (!identityEncryptionConfigured(c.env))
      throw new AppError(
        503,
        "PROVIDER_UNAVAILABLE",
        "Private identity submission is being connected. Save your draft and return shortly.",
      );
    ninFingerprint = await identityFingerprint(c.env, d.nin);
    formHash = await sha256(
      JSON.stringify({
        ...d,
        nin: undefined,
        clientRequestId: undefined,
        owner: u.id,
        ninFingerprint,
      }),
    );
    const previous = firstRow(
      await database(c.env).execute<{
        application_id: string;
        form_hash: string;
        status: string;
      }>(
        sql`select s.application_id,s.form_hash,a.status from app_private.agent_identity_submissions s join public.agent_applications a on a.id=s.application_id where s.user_id=${u.id}::uuid and s.institution_id=${d.universityId}::uuid and s.client_request_id=${d.clientRequestId}::uuid`,
      ),
    );
    if (previous) {
      if (previous.form_hash !== formHash)
        throw new AppError(
          409,
          "CONFLICT",
          "This submission identifier was used for different application details.",
        );
      return c.json({
        id: previous.application_id,
        status: previous.status,
        reused: true,
      });
    }
    if (
      d.agentType === "VENDOR" &&
      (!d.businessDocumentIds?.length || !d.businessCategories?.length)
    )
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Add a business category and school or business evidence. CAC registration is optional.",
      );
    if (d.publishContacts && !/^\+234[789][0-9]{9}$/.test(d.phoneE164))
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Use a Nigerian mobile number to publish a business contact.",
      );
    if (
      d.publishContacts &&
      d.whatsappPhone &&
      !/^\+234[789][0-9]{9}$/.test(d.whatsappPhone)
    )
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Use a Nigerian mobile number for your public WhatsApp contact.",
      );
  }
  if (
    !firstRow(
      await database(c.env).execute(
        sql`select id from public.universities where id=${d.universityId}::uuid and deleted_at is null`,
      ),
    )
  )
    throw new AppError(400, "BAD_REQUEST", "Choose an available university.");
  if (
    d.agentType === "VENDOR" &&
    (!d.businessName || !d.businessAddress || !d.campusPermission)
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Add your business name, location and campus permission status.",
    );
  if (
    d.agentType === "TUTOR" &&
    (!d.tutorSubjects?.length || !d.tutorLevels?.length || !d.experience)
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Add your subjects, levels and teaching background.",
    );
  if (d.agentType === "RIDER" && !d.riderDocumentIds?.length)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Upload your bike and operating evidence.",
    );
  const roleDetails = JSON.stringify({
    whatsappPhone: d.whatsappPhone,
    campus: d.campus,
    serviceLocation: d.serviceLocation,
    campusPermission: d.campusPermission,
    tutorSubjects: d.tutorSubjects,
    tutorLevels: d.tutorLevels,
    experience: d.experience,
    riderDocumentIds: d.riderDocumentIds,
    operations: d.operations,
    uploadNames: d.uploadNames,
    ...(privateReady
      ? {
          intakeVersion: 2,
          clientRequestId: d.clientRequestId,
          businessDocumentIds: d.businessDocumentIds ?? [],
          businessCategories: d.businessCategories ?? [],
          publishContacts: d.publishContacts,
          portraitSource: d.portraitSource ?? "UPLOAD",
        }
      : {}),
  });
  if(privateReady && d.portraitSource!=="CAMERA")throw new AppError(400,"BAD_REQUEST","Take a fresh passport photo with the camera before submitting this application.");
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
  const coreIds = [
    d.identityDocumentId,
    d.portraitDocumentId,
    ...(d.studentDocumentId ? [d.studentDocumentId] : []),
    ...(d.riderDocumentIds ?? []),
  ];
  if (new Set(coreIds).size !== coreIds.length)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose separate identity and portrait documents.",
    );
  const ids = [...new Set([...coreIds, ...(d.businessDocumentIds ?? [])])];
  if (
    d.businessDocumentIds?.some((id) =>
      [d.identityDocumentId, d.portraitDocumentId].includes(id),
    )
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Use school or business evidence for the business document.",
    );
  const docs = await database(c.env).execute<{
    id: string;
    content_type: string;
  }>(
    sql`select id,content_type from public.media_objects where id=any(${sql.param(ids)}::uuid[]) and owner_user_id=${u.id}::uuid and(institution_id is null or institution_id=${d.universityId}::uuid) and kind='kyc' and deleted_at is null`,
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
  if (privateReady)
    envelope = await encryptAgentNin(
      c.env,
      d.nin!,
      u.id,
      d.universityId,
      d.clientRequestId!,
    );
  const identitySaved = privateReady
    ? sql`,identity_saved as(insert into app_private.agent_identity_submissions(application_id,institution_id,user_id,client_request_id,form_hash,nin_fingerprint,identity_envelope,nin_last4)select application.id,${d.universityId}::uuid,${u.id}::uuid,${d.clientRequestId}::uuid,${formHash},${ninFingerprint},${JSON.stringify(envelope)}::jsonb,${d.nin!.slice(-4)} from application join details on details.application_id=application.id returning application_id)`
    : sql``;
  const result = await database(c.env).execute(sql`with application as (
 insert into public.agent_applications(university_id,user_id,agent_type,display_name,phone_e164,statement,legal_name,address_text,emergency_contact_name,emergency_contact_phone,terms_version,terms_accepted_at,kyc_status)
 values(${d.universityId}::uuid,${u.id}::uuid,${d.agentType},${d.agentType === "VENDOR" ? d.businessName! : d.displayName},${d.phoneE164},${d.statement},${d.legalName},${d.address},${d.emergencyContactName},${d.emergencyContactPhone},${d.termsVersion},now(),'PENDING')
 on conflict(university_id,user_id,agent_type) do update set display_name=excluded.display_name,phone_e164=excluded.phone_e164,statement=excluded.statement,legal_name=excluded.legal_name,address_text=excluded.address_text,emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,terms_version=excluded.terms_version,terms_accepted_at=now(),kyc_status='PENDING',bank_status='NOT_STARTED',status='SUBMITTED',review_note=null,submitted_at=now(),updated_at=now()
 where agent_applications.status in('DRAFT','NEEDS_CORRECTION','REJECTED') returning id,status), details as (
 insert into public.agent_application_details(application_id,birth_date,is_student,matric_number,department,business_name,business_address,identity_document_id,portrait_document_id,student_document_id,guardian_name,guardian_phone,guardian_email,guardian_relationship,terms_version,role_details)
 select id,${d.birthDate}::date,${d.isStudent},${d.matricNumber ?? null},${d.department ?? null},${d.businessName ?? null},${d.businessAddress ?? null},${d.identityDocumentId}::uuid,${d.portraitDocumentId}::uuid,${d.studentDocumentId ?? null}::uuid,${d.guardianName ?? null},${d.guardianPhone ?? null},${d.guardianEmail ?? null},${d.guardianRelationship ?? null},${d.termsVersion},${roleDetails}::jsonb from application
 on conflict(application_id) do update set birth_date=excluded.birth_date,is_student=excluded.is_student,matric_number=excluded.matric_number,department=excluded.department,business_name=excluded.business_name,business_address=excluded.business_address,identity_document_id=excluded.identity_document_id,portrait_document_id=excluded.portrait_document_id,student_document_id=excluded.student_document_id,guardian_name=excluded.guardian_name,guardian_phone=excluded.guardian_phone,guardian_email=excluded.guardian_email,guardian_relationship=excluded.guardian_relationship,guardian_consent_at=null,guardian_reviewed_by=null,guardian_evidence=null,terms_version=excluded.terms_version,role_details=excluded.role_details returning application_id)${identitySaved}, receipt as (
 insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key) select ${u.id}::uuid,'EMAIL','We received your KampusOne application','Your '||${d.agentType.toLowerCase()}::text||' application is under review. Open your agent workspace to check its status. We will email you when a reviewer makes a decision.', 'agent-submitted:'||application.id::text||':'||${d.clientRequestId ?? c.get("requestId")} from application join details on details.application_id=application.id${privateReady ? sql` join identity_saved on identity_saved.application_id=application.id` : sql``} on conflict(dedupe_key) do nothing returning id), acquisition as(insert into app_private.user_acquisition(user_id,institution_id,context,source,other_text)
 select ${u.id}::uuid,${d.universityId}::uuid,${d.agentType},${d.acquisition?.source??null},${d.acquisition?.source==='OTHER'?d.acquisition.other:''} from application
 where ${Boolean(d.acquisition)} on conflict(user_id,context) do nothing), draft_removed as (delete from public.agent_application_drafts where user_id=${u.id}::uuid and exists(select 1 from application)) select application.id,application.status from application join details on details.application_id=application.id`);
  const row = firstRow(result);
  if (!row) {
    if (privateReady) {
      const previous = firstRow(
        await database(c.env).execute<{
          application_id: string;
          form_hash: string;
          status: string;
        }>(
          sql`select s.application_id,s.form_hash,a.status from app_private.agent_identity_submissions s join public.agent_applications a on a.id=s.application_id where s.user_id=${u.id}::uuid and s.institution_id=${d.universityId}::uuid and s.client_request_id=${d.clientRequestId}::uuid`,
        ),
      );
      if (previous?.form_hash === formHash)
        return c.json({
          id: previous.application_id,
          status: previous.status,
          reused: true,
        });
    }
    throw new AppError(
      409,
      "CONFLICT",
      "This application is already under review or approved.",
    );
  }
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
      sql`select application_id,university_id from public.agent_profiles where user_id=${u.id}::uuid and status='ACTIVE' and agent_type='VENDOR' order by verified_at limit 1`,
    ),
  );
  if (!profile)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Your application must be approved first.",
    );
  await requireAgentIdentity(c.env, profile.application_id);
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
