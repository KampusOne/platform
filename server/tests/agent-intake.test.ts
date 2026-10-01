import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import { app } from "../src/app";
import { createSession } from "../src/services/sessions";
import { encryptAgentNin, decryptAgentNin } from "../src/lib/agent-intake";
import type { Bindings } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
const school = crypto.randomUUID(),
  otherSchool = crypto.randomUUID(),
  owner = crypto.randomUUID(),
  reviewer = crypto.randomUUID(),
  foreign = crypto.randomUUID(),
  other = crypto.randomUUID();
const identity = crypto.randomUUID(),
  portrait = crypto.randomUUID(),
  evidence = crypto.randomUUID(),
  foreignEvidence = crypto.randomUUID();
const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "https://app.example.invalid",
  MINIMUM_APP_VERSION: "1",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "false",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
  UNIFIED_SCHEMA_READY: "true",
  PHASE_2_SCHEMA_READY: "true",
  JWT_SECRET: "test-only-agent-session-secret-123456789012345",
  KYC_FINGERPRINT_SECRET: "test-only-nin-fingerprint-secret-123456789012",
  KYC_ENCRYPTION_KEY: "12".repeat(32),
};
const tokens = new Map<string, string>();
const form = {
  universityId: school,
  agentType: "VENDOR",
  displayName: "Applicant",
  businessName: "Campus meals",
  businessAddress: "Main campus kitchen",
  phoneE164: "+2348012345678",
  whatsappPhone: "+2348012345678",
  statement: "Fresh campus meals prepared every weekday.",
  legalName: "Test Applicant",
  address: "Main campus road residence",
  emergencyContactName: "Test Contact",
  emergencyContactPhone: "+2348012345679",
  acceptedAgentTerms: true,
  termsVersion: "2026-09-21",
  birthDate: "2000-01-01",
  isStudent: false,
  identityDocumentId: identity,
  portraitDocumentId: portrait,
  businessDocumentIds: [evidence],
  businessCategories: ["Restaurant"],
  campusPermission: "REVIEW",
  nin: "10000000001",
  clientRequestId: crypto.randomUUID(),
  publishContacts: false,
  portraitSource: "CAMERA",
};
async function request(
  path: string,
  actor = owner,
  method = "GET",
  body?: unknown,
) {
  return app.request(
    "https://api.example.invalid/v1" + path,
    {
      method,
      headers: {
        Authorization: "Bearer " + tokens.get(actor),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}
async function result(response: Response, status = 200) {
  const data = await response.json();
  expect({
    status: response.status,
    ...(response.status === status ? {} : { data }),
  }).toEqual({ status });
  return data;
}
beforeAll(async () => {
  db = await createTestDatabase();
  for (const migration of [
    "20260930210000_public_business_profiles.sql",
    "20261001010000_private_agent_identity_submissions.sql",
  ])
    await db.exec(
      readFileSync(
        new URL("../../database/neon/migrations/" + migration, import.meta.url),
        "utf8",
      ),
    );
  for (const [i, id] of [school, otherSchool].entries())
    await db.query(
      "insert into public.universities(id,name,slug,updated_at)values($1,$2,$3,now())",
      [id, "Intake campus " + i, "intake-" + i],
    );
  for (const [i, id] of [owner, reviewer, foreign, other].entries()) {
    const campus = id === foreign ? otherSchool : school;
    await db.query(
      "insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,$2,'test-only',now(),now())",
      [id, "intake-" + i + "@example.invalid"],
    );
    await db.query(
      "insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values(gen_random_uuid(),$1,$2,$3,$4,now())",
      [id, "intake" + i, "Intake " + i, campus],
    );
    tokens.set(
      id,
      (
        await createSession(env, {
          id,
          email: "intake-" + i + "@example.invalid",
          roles: ["STUDENT"],
          operatorRoles: [],
          universityId: campus,
        })
      ).accessToken,
    );
  }
  await db.query(
    "insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')",
    [reviewer],
  );
  await db.query(
    "insert into public.operator_roles(user_id,role,university_id)values($1,'VERIFICATION_REVIEWER',$2)",
    [foreign, otherSchool],
  );
  for (const [id, person, campus, type] of [
    [identity, owner, school, "application/pdf"],
    [portrait, owner, school, "image/jpeg"],
    [evidence, owner, school, "application/pdf"],
    [foreignEvidence, other, school, "application/pdf"],
  ])
    await db.query(
      "insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'kyc',$4,$5,100,'test-evidence')",
      [id, person, campus, "kyc/" + id, type],
    );
}, 60000);
afterAll(async () => {
  await db?.close();
});
describe("private encrypted agent intake", () => {
  it("uses randomized authenticated encryption bound to owner, campus and request", async () => {
    const first = await encryptAgentNin(
        env,
        form.nin,
        owner,
        school,
        form.clientRequestId,
      ),
      second = await encryptAgentNin(
        env,
        form.nin,
        owner,
        school,
        form.clientRequestId,
      );
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain(form.nin);
    expect(await decryptAgentNin(env, first, owner)).toBe(form.nin);
    await expect(decryptAgentNin(env, first, other)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      decryptAgentNin(env, { ...first, universityId: otherSchool }, owner),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      decryptAgentNin(env, { ...first, requestId: crypto.randomUUID() }, owner),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      decryptAgentNin(env, { ...first, ciphertext: "a".repeat(36) }, owner),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      encryptAgentNin(
        { ...env, KYC_ENCRYPTION_KEY: undefined },
        form.nin,
        owner,
        school,
        form.clientRequestId,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("stores no raw NIN in draft JSON and restores it only to its owner", async () => {
    expect(
      (await result(await request("/applications/requirements")))
        .privateIdentityReady,
    ).toBe(true);
    await result(
      await request("/applications/draft", owner, "PUT", {
        step: 3,
        values: { ...form, status: "APPROVED", permissions: ["staff.manage"] },
      }),
    );
    const saved = (
      await db.query<{
        values_json: Record<string, unknown>;
        identity_envelope: unknown;
      }>(
        "select values_json,identity_envelope from public.agent_application_drafts where user_id=$1",
        [owner],
      )
    ).rows[0]!;
    expect(saved.values_json.nin).toBeUndefined();
    expect(saved.values_json.status).toBeUndefined();
    expect(saved.values_json.permissions).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain(form.nin);
    const restored = await request("/applications/draft");
    expect(restored.headers.get("cache-control")).toBe("private, no-store");
    const own = await result(restored);
    expect(own.draft.values.nin).toBe(form.nin);
    expect(own.draft.identity_envelope).toBeUndefined();
    expect(
      (await result(await request("/applications/draft", other))).draft,
    ).toBeNull();
    await result(
      await request("/applications/draft", owner, "PUT", {
        step: 3,
        values: { ...form, universityId: otherSchool },
      }),
      403,
    );
    await result(
      await request("/applications/draft", owner, "PUT", {
        step: 3,
        values: { businessCategories: "Restaurant" },
      }),
      400,
    );
  });
  it("rejects missing NIN, missing business proof and documents owned by another applicant", async () => {
    await result(
      await request("/applications", owner, "POST", {
        ...form,
        nin: undefined,
      }),
      400,
    );
    await result(
      await request("/applications", owner, "POST", {
        ...form,
        businessDocumentIds: [],
      }),
      400,
    );
    await result(
      await request("/applications", owner, "POST", {
        ...form,
        businessDocumentIds: [foreignEvidence],
      }),
      400,
    );
    const key = env.KYC_ENCRYPTION_KEY;
    env.KYC_ENCRYPTION_KEY = undefined;
    await result(await request("/applications", owner, "POST", form), 503);
    env.KYC_ENCRYPTION_KEY = key;
  });
  let applicationId: string;
  it("accepts school/business proof without CAC and deduplicates a retried submission and receipt", async () => {
    const responses = await Promise.all([
      request("/applications", owner, "POST", form),
      request("/applications", owner, "POST", form),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const data = await Promise.all(responses.map((r) => r.json()));
    applicationId = data[0].id;
    expect(data[1].id).toBe(applicationId);
    expect(
      (await result(await request("/applications", owner, "POST", form)))
        .reused,
    ).toBe(true);
    await result(
      await request("/applications", owner, "POST", {
        ...form,
        statement: "Changed application must use a fresh request.",
      }),
      409,
    );
    expect(
      (
        await db.query(
          "select * from app_private.agent_identity_submissions where application_id=$1",
          [applicationId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from app_private.notification_outbox where dedupe_key like 'agent-submitted:'||$1||':%'",
          [applicationId],
        )
      ).rows,
    ).toHaveLength(1);
    const publicData = await db.query(
      "select a.*,d.* from public.agent_applications a join public.agent_application_details d on d.application_id=a.id where a.id=$1",
      [applicationId],
    );
    expect(JSON.stringify(publicData.rows)).not.toContain(form.nin);
    expect(
      (
        await db.query("select * from public.agent_profiles where user_id=$1", [
          owner,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select * from public.agent_application_drafts where user_id=$1",
          [owner],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("masks submitted identity and enforces permission, campus and audited reason for reveal", async () => {
    await result(
      await request(`/manage/applications/${applicationId}/documents`, owner),
      403,
    );
    await result(
      await request(
        `/manage/applications/${applicationId}/nin`,
        foreign,
        "POST",
        { reason: "Independent identity review" },
      ),
      403,
    );
    const docs = await result(
      await request(
        `/manage/applications/${applicationId}/documents`,
        reviewer,
      ),
    );
    expect(docs.details.identity_submission).toMatchObject({
      last4: "0001",
      verified: false,
    });
    expect(JSON.stringify(docs)).not.toContain(form.nin);
    await result(
      await request(
        `/manage/applications/${applicationId}/nin`,
        reviewer,
        "POST",
        { reason: "short" },
      ),
      400,
    );
    const reveal = await request(
      `/manage/applications/${applicationId}/nin`,
      reviewer,
      "POST",
      { reason: "Independent identity review for " + form.nin },
    );
    expect(reveal.headers.get("cache-control")).toBe("private, no-store");
    expect(await result(reveal)).toEqual({ nin: form.nin, verified: false });
    const audit = await db.query(
      "select metadata from app_private.audit_events where action='identity.submission.viewed' and target_id=$1",
      [applicationId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain(form.nin);
  });
  it("requires the current NIN match before role approval and never treats a photo as verified identity", async () => {
    await result(
      await request(
        `/manage/applications/${applicationId}/identity`,
        reviewer,
        "POST",
        {
          nin: "10000000002",
          evidence: "Independent provider confirmation reference test.",
        },
      ),
      409,
    );
    await result(
      await request(
        `/admin/applications/${applicationId}/verification`,
        reviewer,
        "POST",
        {
          identityStatus: "MANUALLY_VERIFIED",
          phoneVerified: true,
          bankStatus: "NOT_STARTED",
          note: "Document and telephone review complete.",
        },
      ),
    );
    await result(
      await request(
        `/admin/applications/${applicationId}/review`,
        reviewer,
        "POST",
        {
          decision: "APPROVED",
          note: "Must fail without a recorded identity match.",
        },
      ),
      409,
    );
    await expect(
      db.query(
        "update public.agent_applications set status='APPROVED',reviewer_user_id=$2 where id=$1",
        [applicationId, reviewer],
      ),
    ).rejects.toThrow("CURRENT_IDENTITY_REVIEW_REQUIRED");
    await result(
      await request(
        `/manage/applications/${applicationId}/identity`,
        reviewer,
        "POST",
        {
          nin: form.nin,
          evidence: "Independent provider confirmation reference test.",
        },
      ),
    );
    const docs = await result(
      await request(
        `/manage/applications/${applicationId}/documents`,
        reviewer,
      ),
    );
    expect(docs.details.identity_submission.verified).toBe(true);
    await db.query(
      "update public.media_objects set deleted_at=now() where id=$1",
      [evidence],
    );
    await result(
      await request(
        `/admin/applications/${applicationId}/review`,
        reviewer,
        "POST",
        {
          decision: "APPROVED",
          note: "Must fail without the current business evidence.",
        },
      ),
      409,
    );
    await db.query(
      "update public.media_objects set deleted_at=null where id=$1",
      [evidence],
    );
    await expect(
      db.query(
        "update public.agent_applications set status='APPROVED',reviewer_user_id=$2 where id=$1",
        [applicationId, owner],
      ),
    ).rejects.toThrow("CURRENT_IDENTITY_REVIEW_REQUIRED");
    await result(
      await request(
        `/admin/applications/${applicationId}/review`,
        reviewer,
        "POST",
        {
          decision: "APPROVED",
          note: "Identity, photograph and business evidence reviewed.",
        },
      ),
    );
    const profile = (
      await db.query<{
        display_name: string;
        biography: string;
        public_details: Record<string, unknown>;
      }>(
        "select display_name,biography,public_details from public.agent_profiles where user_id=$1",
        [owner],
      )
    ).rows[0]!;
    expect(profile).toMatchObject({
      display_name: "Campus meals",
      biography: form.statement,
      public_details: { categories: ["Restaurant"] },
    });
    expect(profile.public_details.phone).toBeUndefined();
    expect(JSON.stringify(profile)).not.toContain(form.nin);
    expect(
      (
        await db.query(
          "select * from app_private.notification_outbox where dedupe_key like 'agent-review:'||$1||':%'",
          [applicationId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("protects encrypted submitted records from mutation and deletion", async () => {
    await expect(
      db.query(
        "update app_private.agent_identity_submissions set nin_last4='9999' where application_id=$1",
        [applicationId],
      ),
    ).rejects.toThrow("IDENTITY_SUBMISSION_IMMUTABLE");
    await expect(
      db.query(
        "delete from app_private.agent_identity_submissions where application_id=$1",
        [applicationId],
      ),
    ).rejects.toThrow("IDENTITY_SUBMISSION_IMMUTABLE");
  });
});
