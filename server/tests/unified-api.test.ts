import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import { createSession } from "../src/services/sessions";
import { requireFullKyc } from "../src/lib/kyc";
import type { Bindings } from "../src/types";
import { app } from "../src/app";

let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
const user = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const school = "10000000-0000-4000-8000-000000000010";
const otherSchool = "10000000-0000-4000-8000-000000000011";
const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "https://app.example.invalid",
  MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PHASE_2_SCHEMA_READY: "true",
  PHASE_3_SCHEMA_READY: "false",
  UNIFIED_SCHEMA_READY: "true",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
  JWT_SECRET: "test-only-signing-key-not-for-deployment-12345678",
  KYC_FINGERPRINT_SECRET: "test-only-keyed-identity-fingerprint-secret-12345",
  TUTORIALS_ENABLED: "true",
};
const tokens = new Map<string, string>();
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  actor = user,
) {
  return app.request(
    "https://api.example.invalid/v1" + path,
    {
      method,
      headers: {
        Authorization: `Bearer ${tokens.get(actor)}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect({
    status: response.status,
    ...(response.status === status ? {} : { data }),
  }).toEqual({ status });
  return data;
}
beforeAll(async () => {
  db = await createTestDatabase();
  for (const [i, id] of [school, otherSchool].entries())
    await db.query(
      "insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())",
      [id, "School " + i, "school-" + i],
    );
  for (const [i, id] of [user, other].entries()) {
    await db.query(
      "insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",
      [id, `student${i}@example.invalid`],
    );
    await db.query(
      "insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())",
      [id, "student" + i, "Student " + i, i ? otherSchool : school],
    );
    tokens.set(
      id,
      (
        await createSession(env, {
          id,
          email: `student${i}@example.invalid`,
          roles: ["STUDENT"],
          operatorRoles: [],
          universityId: i ? otherSchool : school,
        })
      ).accessToken,
    );
  }
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("unified HTTP routes against the saved database schema", () => {
  it.each([
    "/student/me",
    "/student/home",
    "/student/feed",
    "/student/catalog",
    "/student/gpa",
    "/student/tutorials",
    "/student/purchases",
    "/applications",
    "/applications/trial",
    "/communities",
    "/account/notifications",
    "/account/guidelines",
    "/agents/dashboard",
    "/agents/earnings",
  ])("loads %s using actual schema columns", async (path) => {
    await json(await request(path));
  });
  it("loads capability lists without querying imaginary columns", async () => {
    expect(await json(await request("/account/capabilities"))).toEqual({
      profiles: [],
      communities: [],
    });
  });
  it("edits only the signed-in profile and creates an audit event", async () => {
    await json(
      await request("/account/profile", "PATCH", {
        firstName: "Ada",
        lastName: "Test",
        username: "ada_test",
        biography: "Computer engineering",
      }),
    );
    const rows = (
      await db.query<{ user_id: string; display_name: string }>(
        "select user_id,display_name from public.profiles order by user_id",
      )
    ).rows;
    expect(rows).toEqual([
      { user_id: user, display_name: "Ada Test" },
      { user_id: other, display_name: "Student 1" },
    ]);
    expect(
      (
        await db.query(
          "select id from app_private.audit_events where action='profile.updated'",
        )
      ).rows,
    ).toHaveLength(1);
    await json(
      await request("/account/profile", "PATCH", {
        firstName: "Ada",
        lastName: "Test",
        username: "student1",
        biography: "",
      }),
      409,
    );
  });
  it("persists settings per user", async () => {
    const settings = {
      appearance: "dark",
      notifications: true,
      marketing: false,
      haptics: false,
      hideCgpa: true,
    };
    await json(await request("/account/settings", "PUT", settings));
    expect((await json(await request("/account/settings"))).settings).toEqual(
      settings,
    );
    expect(
      (await json(await request("/account/settings", "GET", undefined, other)))
        .settings,
    ).toEqual({});
  });
  it("creates weekly alarms and rejects another user's update", async () => {
    const alarm = {
      label: "Read notes",
      time: "18:30",
      days: [1, 3, 5],
      enabled: true,
      sound: "default",
      vibration: true,
      snoozeMinutes: 5,
    };
    const created = await json(
      await request("/learning/alarms", "POST", alarm),
      201,
    );
    const loaded = await json(await request("/learning/alarms"));
    expect(loaded.alarms[0]).toMatchObject({
      label: alarm.label,
      time: alarm.time,
      days: alarm.days,
    });
    await json(
      await request(
        "/learning/alarms/" + created.id,
        "PUT",
        { ...alarm, label: "Not mine" },
        other,
      ),
      404,
    );
    expect(
      (await json(await request("/learning/alarms", "GET", undefined, other)))
        .alarms,
    ).toEqual([]);
  });
  it("imports reviewed classes and preserves blank units and grades", async () => {
    await json(
      await request("/learning/timetable/import", "POST", {
        entries: [
          {
            title: "Calculus",
            courseCode: "MTH101",
            dayOfWeek: 1,
            startsAt: "08:00",
            endsAt: "09:00",
            reminderMinutes: 15,
            reminderEnabled: true,
          },
        ],
      }),
      201,
    );
    const courses = await json(await request("/learning/courses"));
    expect(courses.courses).toEqual([
      { course_code: "MTH101", title: "Calculus", units: null, grade: null },
    ]);
    expect(
      (await json(await request("/learning/courses", "GET", undefined, other)))
        .courses,
    ).toEqual([]);
    await json(
      await request("/learning/courses", "PUT", {
        courses: [
          { courseCode: "MTH101", title: "Calculus", units: 3, grade: "A" },
        ],
      }),
    );
    await json(
      await request("/learning/courses", "PUT", {
        courses: [
          { courseCode: "MTH101", title: "Calculus", units: 3, grade: "TOO-LONG" },
        ],
      }),
      400,
    );
    expect(
      (await json(await request("/learning/courses"))).courses[0],
    ).toMatchObject({ units: "3.0", grade: "A" });
  });
  it("does not expose administrative data to a student", async () => {
    await json(await request("/manage/users"), 403);
    await json(await request("/manage/trials"), 403);
  });
  it("keeps support messages private", async () => {
    await json(
      await request("/account/support", "POST", {
        category: "ACCOUNT",
        subject: "Profile question",
        body: "Please check my profile.",
      }),
      201,
    );
    expect(
      (await json(await request("/account/support"))).requests,
    ).toHaveLength(1);
    expect(
      (await json(await request("/account/support", "GET", undefined, other)))
        .requests,
    ).toHaveLength(0);
  });
  it("blocks oversized JSON before parsing it", async () => {
    await json(
      await request("/account/support", "POST", { body: "x".repeat(300000) }),
      413,
    );
  });
  it("supports a one-time alarm without silently repeating it", async () => {
    const firesAt = new Date(Date.now() + 3600000).toISOString();
    const created = await json(
      await request("/learning/alarms", "POST", {
        label: "Take a break",
        time: "13:00",
        days: [],
        enabled: true,
        sound: "silent",
        vibration: false,
        snoozeMinutes: 5,
        firesAt,
      }),
      201,
    );
    const saved = (await json(await request("/learning/alarms"))).alarms.find(
      (a: { id: string }) => a.id === created.id,
    );
    expect(saved.days).toEqual([]);
    expect(new Date(saved.fires_at).toISOString()).toBe(firesAt);
    await json(
      await request("/learning/alarms", "POST", {
        label: "Past time",
        time: "13:00",
        days: [],
        enabled: true,
        sound: "default",
        vibration: false,
        snoozeMinutes: 5,
        firesAt: "2020-01-01T00:00:00Z",
      }),
      400,
    );
  });
  it("revokes an entire device session immediately", async () => {
    const session = await createSession(env, {
      id: other,
      email: "student1@example.invalid",
      roles: ["STUDENT"],
      operatorRoles: [],
      universityId: otherSchool,
    });
    const oldToken = tokens.get(other)!;
    tokens.set(other, session.accessToken);
    const sessions = (
      await json(await request("/account/sessions", "GET", undefined, other))
    ).sessions;
    await json(
      await request(
        "/account/sessions/" + sessions[0].id,
        "DELETE",
        undefined,
        other,
      ),
    );
    await json(
      await request("/account/settings", "GET", undefined, other),
      401,
    );
    tokens.set(other, oldToken);
  });
  it("restricts banned accounts while preserving the appeal route", async () => {
    await db.query(
      "insert into public.account_restrictions(user_id,kind,reason,created_by) values($1,'BANNED','Test restriction',$2)",
      [user, other],
    );
    await json(await request("/account/capabilities"), 403);
    expect(
      (await json(await request("/account/restrictions"))).restriction.kind,
    ).toBe("BANNED");
    await json(
      await request("/account/support", "POST", {
        category: "APPEAL",
        subject: "Please review",
        body: "I would like to appeal this restriction.",
      }),
      201,
    );
  });
});

describe("application, private-file and trial boundaries", () => {
  const applicant = "20000000-0000-4000-8000-000000000001",
    operator = "20000000-0000-4000-8000-000000000002",
    foreignReviewer = "20000000-0000-4000-8000-000000000003";
  const identity = "20000000-0000-4000-8000-000000000011",
    portrait = "20000000-0000-4000-8000-000000000012";
  let applicationId = "";
  const form = {
    universityId: school,
    agentType: "VENDOR",
    displayName: "Test shop",
    businessName: "Test shop",
    businessAddress: "Test campus address",
    campusPermission: "NOT_REQUIRED",
    phoneE164: "+2348000000001",
    statement: "A test application for schema verification only.",
    legalName: "Test Applicant",
    address: "Test address, not a real home",
    emergencyContactName: "Test Guardian",
    emergencyContactPhone: "+2348000000002",
    acceptedAgentTerms: true,
    termsVersion: "2026-09-13",
    birthDate: `${new Date().getUTCFullYear() - 17}-01-01`,
    isStudent: false,
    identityDocumentId: identity,
    portraitDocumentId: portrait,
    guardianName: "Test Guardian",
    guardianPhone: "+2348000000002",
    guardianEmail: "guardian@example.invalid",
    guardianRelationship: "Parent",
  };
  beforeAll(async () => {
    for (const [i, person] of [
      applicant,
      operator,
      foreignReviewer,
    ].entries()) {
      await db.query(
        "insert into public.users(id,email,password_hash,email_verified_at,updated_at) values($1,$2,'test-only',now(),now())",
        [person, `application${i}@example.invalid`],
      );
      await db.query(
        "insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,'Test person',$3,now())",
        [person, "application" + i, i === 2 ? otherSchool : school],
      );
      tokens.set(
        person,
        (
          await createSession(env, {
            id: person,
            email: `application${i}@example.invalid`,
            roles: ["STUDENT"],
            operatorRoles: [],
            universityId: i === 2 ? otherSchool : school,
          })
        ).accessToken,
      );
    }
    await db.query(
      "insert into public.operator_roles(user_id,role,university_id) values($1,'PLATFORM_ADMIN',null),($2,'VERIFICATION_REVIEWER',$3)",
      [operator, foreignReviewer, otherSchool],
    );
    for (const [i, mediaId] of [identity, portrait].entries())
      await db.query(
        "insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'kyc',$4,$5,10,'test-file')",
        [
          mediaId,
          applicant,
          school,
          "test/" + mediaId,
          i ? "image/jpeg" : "application/pdf",
        ],
      );
    env.PRIVATE_BUCKET = {
      get: async () => ({ body: new Response("test file only").body }),
    } as unknown as R2Bucket;
  });
  it("accepts owned documents and rejects application spoofing", async () => {
    await json(
      await request(
        "/applications",
        "POST",
        { ...form, universityId: otherSchool },
        applicant,
      ),
      403,
    );
    const result = await json(
      await request("/applications", "POST", form, applicant),
      201,
    );
    applicationId = result.id;
    await json(await request("/applications", "POST", form, applicant), 409);
    const d = await json(
      await request(
        `/manage/applications/${applicationId}/documents`,
        "GET",
        undefined,
        operator,
      ),
    );
    expect(d.details.portrait_document_id).toBe(portrait);
  });
  it("does not accept a checkbox as completed KYC or guardian consent", async () => {
    await expect(requireFullKyc(env, applicationId)).rejects.toThrow(
      "Complete identity",
    );
    await json(
      await request(
        `/admin/applications/${applicationId}/review`,
        "POST",
        { decision: "APPROVED", note: "Test approval" },
        operator,
      ),
      409,
    );
    expect(
      (
        await db.query(
          "select id from public.agent_profiles where user_id=$1",
          [applicant],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("enforces university scopes even for verification staff", async () => {
    await json(
      await request(
        `/manage/applications/${applicationId}/documents`,
        "GET",
        undefined,
        foreignReviewer,
      ),
      403,
    );
    await json(
      await request(
        `/media/${identity}/access`,
        "POST",
        undefined,
        foreignReviewer,
      ),
      403,
    );
    await json(
      await request(
        `/admin/applications/${applicationId}/verification`,
        "POST",
        {
          identityStatus: "MANUALLY_VERIFIED",
          phoneVerified: true,
          bankStatus: "VERIFIED",
          bankAccountName: "Test Applicant",
          bankAccountLast4: "0001",
          note: "Test evidence verified",
        },
        foreignReviewer,
      ),
      403,
    );
  });
  it("serves private documents only after authorization, with a short signed link", async () => {
    expect(
      (
        await app.request(
          `https://api.example.invalid/v1/media/${identity}`,
          {},
          env,
        )
      ).status,
    ).toBe(401);
    const signed = await json(
      await request(`/media/${identity}/access`, "POST", undefined, operator),
    );
    expect(signed.expiresIn).toBe(90);
    const viewed = await app.request(signed.url, {}, env);
    expect(viewed.status).toBe(200);
    expect(viewed.headers.get("Cache-Control")).toBe("private, no-store");
    const tampered = new URL(signed.url);
    tampered.pathname = "/v1/media/" + portrait;
    expect((await app.request(tampered.toString(), {}, env)).status).toBe(401);
  });
  it("deduplicates identity without saving the raw NIN", async () => {
    await json(
      await request(
        `/manage/applications/${applicationId}/identity`,
        "POST",
        {
          nin: "00000000001",
          evidence: "Test-only identity evidence reviewed.",
        },
        operator,
      ),
    );
    const row = (
      await db.query<{ identity_fingerprint: string }>(
        "select identity_fingerprint from app_private.verified_people where user_id=$1",
        [applicant],
      )
    ).rows[0]!;
    expect(row.identity_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(row.identity_fingerprint).not.toBe("00000000001");
    await json(
      await request(
        `/manage/applications/${applicationId}/identity`,
        "POST",
        {
          nin: "00000000002",
          evidence: "Attempt to change an already verified identity.",
        },
        operator,
      ),
      409,
    );
  });
  it("requires independent guardian evidence before approval at age seventeen", async () => {
    await json(
      await request(
        `/admin/applications/${applicationId}/verification`,
        "POST",
        {
          identityStatus: "MANUALLY_VERIFIED",
          phoneVerified: true,
          bankStatus: "VERIFIED",
          bankAccountName: "Test Applicant",
          bankAccountLast4: "0001",
          note: "Test identity and bank evidence reviewed",
        },
        operator,
      ),
    );
    await expect(requireFullKyc(env, applicationId)).rejects.toThrow(
      "Guardian approval",
    );
    await json(
      await request(
        `/manage/applications/${applicationId}/guardian`,
        "POST",
        {
          evidence:
            "Independent test guardian identity and consent were confirmed.",
        },
        operator,
      ),
    );
    await json(
      await request(
        `/admin/applications/${applicationId}/review`,
        "POST",
        {
          decision: "APPROVED",
          note: "Reviewed identity, bank and guardian evidence",
        },
        operator,
      ),
    );
    expect(
      (
        await json(
          await request("/account/capabilities", "GET", undefined, applicant),
        )
      ).profiles[0].agent_type,
    ).toBe("VENDOR");
  });
  it("claims twelve months internally exactly once, without a payment provider", async () => {
    const r = await json(
      await request("/applications/trial", "POST", undefined, applicant),
      201,
    );
    const claimed = new Date(r.trial.claimed_at),
      expires = new Date(r.trial.expires_at);
    const expected = new Date(claimed);
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(expires.getTime()).toBe(expected.getTime());
    await json(
      await request("/applications/trial", "POST", undefined, applicant),
      409,
    );
    const trials = await json(
      await request("/manage/trials", "GET", undefined, operator),
    );
    expect(trials.rows).toHaveLength(1);
  });
});
