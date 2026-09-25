import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Hono } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import { payoutSetupRoutes } from "../src/routes/payout-setup";
import { createSession } from "../src/services/sessions";
import { compareBankName } from "../src/lib/payout-provider";
import { AppError } from "../src/lib/errors";
import type { Bindings, Variables } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
const uuid = (n: number) =>
  `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1),
  reviewer = uuid(2),
  foreign = uuid(3),
  school = uuid(10),
  otherSchool = uuid(11),
  application = uuid(20),
  profile = uuid(21),
  document = uuid(22),
  portrait = uuid(23);
const env = {
  ENVIRONMENT: "local",
  UNIFIED_SCHEMA_READY: "true",
  ALLOWED_ORIGINS: "https://app.example.invalid",
  JWT_SECRET: "test-signing-key-never-for-production-123456789",
  KYC_FINGERPRINT_SECRET: "test-identity-secret-never-for-production-123456789",
  PAYMENTS_ENABLED: "true",
  PAYSTACK_SECRET_KEY: "sk_test_never-a-real-key",
} as Bindings;
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.route("/v1/payout-setup", payoutSetupRoutes);
app.onError((e, c) =>
  e instanceof AppError
    ? c.json({ error: { code: e.code, message: e.message } }, e.status)
    : c.json({ error: { message: e.message } }, 500),
);
const tokens = new Map<string, string>();
function request(path: string, method = "GET", body?: unknown, actor = owner) {
  return app.request(
    "https://api.example.invalid/v1/payout-setup" + path,
    {
      method,
      headers: {
        Authorization: `Bearer ${tokens.get(actor)}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}
async function payload(r: Response, status = 200) {
  const data = await r.json();
  expect({
    status: r.status,
    ...(r.status !== status ? { data } : {}),
  }).toEqual({ status });
  return data;
}
const details = (id: number) => ({
  agentProfileId: profile,
  bankCode: "058",
  accountNumber: "0123456789",
  requestId: uuid(id),
  authorizedAccount: true,
});
function provider(bankName = "ADA TEST") {
  const fetch = vi.fn(async (url: string) =>
    url.includes("/bank/resolve")
      ? Response.json({
          status: true,
          data: { account_number: "0123456789", account_name: bankName },
        })
      : Response.json({
          status: true,
          data: {
            recipient_code: "RCP_testreference",
            active: true,
            details: {
              bank_code: "058",
              bank_name: "Test Bank",
              account_number: "0123456789",
            },
          },
        }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(
    readFileSync(
      new URL(
        "../../database/neon/migrations/20260921160000_payout_setup.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const id of [school, otherSchool])
    await db.query(
      "insert into public.universities(id,name,slug,updated_at) values($1::uuid,'Test School '||$1::text,$1::text,now())",
      [id],
    );
  for (const [i, id] of [owner, reviewer, foreign].entries()) {
    await db.query(
      "insert into public.users(id,email,password_hash,email_verified_at,updated_at) values($1,$2,'test-only',now(),now())",
      [id, `payout${i}@example.invalid`],
    );
    const s = await createSession(env, {
      id,
      email: `payout${i}@example.invalid`,
      roles: ["STUDENT"],
      operatorRoles: [],
      universityId: i === 2 ? otherSchool : school,
    });
    tokens.set(id, s.accessToken);
  }
  await db.query(
    "insert into app_private.staff_access(user_id,permissions,university_ids,updated_by) values($1,ARRAY['finance.review'],ARRAY[$3::uuid],$1),($2,ARRAY['finance.review'],ARRAY[$4::uuid],$1)",
    [reviewer, foreign, school, otherSchool],
  );
  await db.query(
    "insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,status,legal_name,kyc_status,phone_verified_at,terms_accepted_at) values($1,$2,$3,'VENDOR','Test shop','+2348000000001','This application is a test fixture for bank account verification.','APPROVED','Ada Test','MANUALLY_VERIFIED',now(),now())",
    [application, school, owner],
  );
  await db.query(
    "insert into public.agent_profiles(id,university_id,user_id,application_id,agent_type,display_name,verified_at) values($1,$2,$3,$4,'VENDOR','Test shop',now())",
    [profile, school, owner, application],
  );
  for (const id of [document, portrait])
    await db.query(
      "insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1::uuid,$2,$3,'kyc',$1::text,'image/jpeg',10,'fixture')",
      [id, owner, school],
    );
  await db.query(
    "insert into public.agent_application_details(application_id,birth_date,is_student,identity_document_id,portrait_document_id,terms_version) values($1,'2000-01-01',false,$2,$3,'test-only')",
    [application, document, portrait],
  );
  await db.query(
    "insert into app_private.verified_people(user_id,identity_fingerprint,verified_by) values($1,'test-only-fingerprint',$2)",
    [owner, reviewer],
  );
}, 60000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db?.close();
});
describe("requirements 215–224: payout setup without money movement", () => {
  it("treats name ordering as a signal and divergent names as requiring review", () => {
    expect(compareBankName("Ada Test", "TEST ADA")).toBe("REORDERED");
    expect(compareBankName("Ada Test", "Ada Test")).toBe("EXACT");
    expect(compareBankName("Ada Test", "Different Person")).toBe(
      "REVIEW_REQUIRED",
    );
    expect(compareBankName("Ada Test", "A Test")).toBe("REVIEW_REQUIRED");
  });
  it("denies another user before calling a provider", async () => {
    const fetch = provider();
    await payload(await request("/resolve", "POST", details(40), foreign), 403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves and tokenizes, stores only the masked suffix, and requires ownership review", async () => {
    const fetch = provider();
    const data = await payload(
      await request("/resolve", "POST", details(41)),
      201,
    );
    expect(data.account).toMatchObject({
      status: "PENDING_REVIEW",
      name_match: "EXACT",
      account_name: "ADA TEST",
      account_last4: "6789",
    });
    expect(JSON.stringify(data)).not.toContain("0123456789");
    expect(data.account.recipient_code).toBeUndefined();
    const rows = (
      await db.query(
        "select * from app_private.payout_account_setups where id=$1",
        [uuid(41)],
      )
    ).rows;
    expect(JSON.stringify(rows)).not.toContain("0123456789");
    expect(
      (
        await db.query(
          "select bank_status from public.agent_applications where id=$1",
          [application],
        )
      ).rows[0],
    ).toMatchObject({ bank_status: "PENDING" });
    expect(fetch.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual(
      ["/bank/resolve", "/transferrecipient"],
    );
    const repeated = await payload(
      await request("/resolve", "POST", details(41)),
    );
    expect(repeated.account.id).toBe(uuid(41));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("requires tenant scope and ownership evidence for approval", async () => {
    await payload(
      await request(
        `/${uuid(41)}/review`,
        "POST",
        {
          decision: "APPROVED",
          reason: "Independent evidence inspected",
          ownershipConfirmed: true,
        },
        foreign,
      ),
      403,
    );
    await payload(
      await request(
        `/${uuid(41)}/review`,
        "POST",
        { decision: "APPROVED", reason: "Independent evidence inspected" },
        reviewer,
      ),
      400,
    );
    await payload(
      await request(
        `/${uuid(41)}/review`,
        "POST",
        {
          decision: "APPROVED",
          reason: "Independent account ownership evidence inspected",
          ownershipConfirmed: true,
        },
        reviewer,
      ),
    );
    expect(
      (
        await db.query(
          "select bank_status from public.agent_applications where id=$1",
          [application],
        )
      ).rows[0],
    ).toMatchObject({ bank_status: "PENDING" });
    const approved = await payload(
      await request("/review?status=APPROVED", "GET", undefined, reviewer),
    );
    expect(approved.accounts[0].payout_eligible).toBe(false);
    expect(
      (
        await payload(
          await request("/review?status=APPROVED", "GET", undefined, foreign),
        )
      ).accounts,
    ).toEqual([]);
  });
  it("keeps mismatched bank names pending for explicit reasoned review", async () => {
    provider("DIFFERENT PERSON");
    const data = await payload(
      await request("/resolve", "POST", details(42)),
      201,
    );
    expect(data.account.name_match).toBe("REVIEW_REQUIRED");
    await payload(
      await request(
        `/${uuid(42)}/review`,
        "POST",
        {
          decision: "REJECTED",
          reason:
            "Ownership evidence does not establish the submitted business account.",
        },
        reviewer,
      ),
    );
    const own = await payload(await request(""));
    expect(own.profiles[0].account.status).toBe("REJECTED");
    expect(own.profiles[0].account.review_note).toContain("Ownership evidence");
  });
  it("only marks live reviewed accounts eligible and rechecks full KYC", async () => {
    env.PAYSTACK_SECRET_KEY = "sk_live_test-fixture-only";
    provider();
    await payload(await request("/resolve", "POST", details(43)), 201);
    await payload(
      await request(
        `/${uuid(43)}/review`,
        "POST",
        {
          decision: "APPROVED",
          reason:
            "Independent ownership evidence confirmed for the verified person.",
          ownershipConfirmed: true,
        },
        reviewer,
      ),
    );
    let approved = await payload(
      await request("/review?status=APPROVED", "GET", undefined, reviewer),
    );
    expect(approved.accounts[0].payout_eligible).toBe(true);
    await db.query(
      "update public.media_objects set deleted_at=now() where id=$1",
      [document],
    );
    approved = await payload(
      await request("/review?status=APPROVED", "GET", undefined, reviewer),
    );
    expect(approved.accounts[0].payout_eligible).toBe(false);
    await db.query(
      "update public.media_objects set deleted_at=null where id=$1",
      [document],
    );
  });
  it("preserves an approved destination when provider resolution fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { status: false, message: "sensitive provider detail 0123456789" },
            { status: 500 },
          ),
        ),
    );
    const result = await payload(
      await request("/resolve", "POST", details(44)),
      503,
    );
    expect(JSON.stringify(result)).not.toContain("0123456789");
    expect((await payload(await request(""))).profiles[0].account.id).toBe(
      uuid(43),
    );
  });
  it("blocks changes while a payout is reserved", async () => {
    const fetch = provider();
    await db.query(
      "insert into public.payout_requests(id,university_id,agent_profile_id,requested_by_user_id,amount_kobo) values($1,$2,$3,$4,10000)",
      [uuid(80), school, profile, owner],
    );
    await payload(await request("/resolve", "POST", details(45)), 409);
    expect(fetch).not.toHaveBeenCalled();
    // An older/manual path may have left a pending review beside a live payout.
    await db.query(
      "update app_private.payout_account_setups set status='PENDING_REVIEW' where id=$1",
      [uuid(43)],
    );
    await payload(
      await request(
        `/${uuid(43)}/review`,
        "POST",
        {
          decision: "APPROVED",
          reason: "Independent evidence inspected again",
          ownershipConfirmed: true,
        },
        reviewer,
      ),
      409,
    );
    expect(
      (
        await db.query(
          "select status from app_private.payout_account_setups where id=$1",
          [uuid(43)],
        )
      ).rows[0],
    ).toMatchObject({ status: "PENDING_REVIEW" });
  });
  it("caches a paginated bank list and throttles repeated requests", async () => {
    const fetch = vi.fn(async (url: string) =>
      Response.json({
        status: true,
        data: [
          {
            code: url.includes("next=") ? "044" : "058",
            name: "Fixture Bank",
            active: true,
          },
        ],
        meta: { next: url.includes("next=") ? null : "page2" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await payload(await request("/banks"))).banks).toHaveLength(2);
    for (let i = 0; i < 19; i++) await payload(await request("/banks"));
    await payload(await request("/banks"), 429);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
