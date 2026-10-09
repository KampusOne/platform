import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { createBachsPricingQuote, publishedBachsProfiles, type BachsFeeProfile, type BachsPricingQuote } from "../src/lib/bachs-pricing";

const campus = "11111111-1111-4111-8111-111111111111", otherCampus = "99999999-9999-4999-8999-999999999999";
const user = "22222222-2222-4222-8222-222222222222", profileId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444", secondQuoteId = "55555555-5555-4555-8555-555555555555";
const fees: BachsFeeProfile = { ...publishedBachsProfiles[0]!, id: profileId, universityId: campus, version: "account-reviewed-v1", status: "APPROVED" };
const quote = createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, fees, Date.parse("2026-10-09T12:00:00Z"));

async function fixture() {
  const db = new PGlite();
  await db.exec(`create schema app_private;
    create table public.universities(id uuid primary key);
    create table public.users(id uuid primary key);
    create function app_private.prevent_append_only_mutation() returns trigger language plpgsql as $$begin raise exception 'APPEND_ONLY';end$$;
    create table public.payment_attempts(provider_reference text primary key, amount_kobo bigint);
    insert into public.universities values('${campus}'),('${otherCampus}');
    insert into public.users values('${user}');
    insert into public.payment_attempts values('K1-O-old-paystack',600000);`);
  await db.exec(await readFile(new URL("../../database/neon/migrations/20261009100000_bachs_pricing_psychology.sql", import.meta.url), "utf8"));
  await db.query(`insert into app_private.bachs_fee_profiles(id,university_id,version,context,collection,status,effective_from,effective_to,source_url,variance_tolerance_kobo,approval_note,eligibility_evidence,approved_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Reviewed NGN checkout pricing','Confirmed merchant checkout capability',$11)`,
    [profileId, campus, fees.version, fees.context, fees.collection, fees.status, fees.effectiveFrom, fees.effectiveTo, fees.sourceUrl, fees.varianceToleranceKobo, user]);
  return db;
}
async function insertQuote(db: PGlite, id = quoteId, value: BachsPricingQuote = quote, universityId = campus) {
  return db.query(`insert into app_private.bachs_checkout_quotes(id,user_id,university_id,resource_type,resource_id,resource_fingerprint,resource_snapshot,provider_reference,fee_profile_id,fee_profile_version,quote,created_at,expires_at)
    values($1,$2,$3,'KIRA_SUBSCRIPTION',$1,$10,'{"planVersion":"reviewed-v1"}',$4,$5,$6,$7,$8,$9)`,
    [id, user, universityId, `K1-B-${id}`, profileId, fees.version, value, value.createdAt, value.expiresAt, "a".repeat(64)]);
}
async function insertSession(db: PGlite, id = quoteId, expiresAt = "2026-10-09T12:14:00Z") {
  return db.query(`insert into app_private.bachs_priced_sessions(quote_id,checkout_id,provider_mode,checkout_url,expires_at)
    values($1,$2,'test','https://sandbox-checkout.bachs.io/c/fixture',$3)`, [id, `chk_${id}`, expiresAt]);
}

describe("append-only BACHS pricing migration", () => {
  it("preserves historical Paystack amounts and rejects modified, unapproved or cross-campus fee snapshots", async () => {
    const db = await fixture();
    try {
      expect((await db.query("select * from public.payment_attempts")).rows).toEqual([{ provider_reference: "K1-O-old-paystack", amount_kobo: 600_000 }]);
      await expect(insertQuote(db, quoteId, quote, otherCampus)).rejects.toThrow("BACHS_QUOTE_PROFILE_MISMATCH");
      const changed = structuredClone(quote); changed.profile.collection.basisPoints = 200;
      await expect(insertQuote(db, quoteId, changed)).rejects.toThrow("BACHS_QUOTE_PROFILE_MISMATCH");
      await expect(insertQuote(db, quoteId, { ...quote, providerAmountKobo: 609_000 })).rejects.toThrow("check constraint");
      await insertQuote(db);
      await expect(db.exec("update app_private.bachs_fee_profiles set version='replacement'")).rejects.toThrow("APPEND_ONLY");
      await expect(db.exec("delete from app_private.bachs_checkout_quotes")).rejects.toThrow("APPEND_ONLY");
      await db.query(`insert into app_private.bachs_fee_profiles select '66666666-6666-4666-8666-666666666666',university_id,'disabled-v2',context,collection,'DISABLED',effective_from,effective_to,source_url,variance_tolerance_kobo,approval_note,eligibility_evidence,approved_by,approved_at from app_private.bachs_fee_profiles`);
      const disabled = structuredClone(quote); disabled.profile.id = "66666666-6666-4666-8666-666666666666"; disabled.profile.version = "disabled-v2"; disabled.profile.status = "DISABLED";
      await expect(db.query(`insert into app_private.bachs_checkout_quotes(id,user_id,university_id,resource_type,resource_id,resource_fingerprint,resource_snapshot,provider_reference,fee_profile_id,fee_profile_version,quote,created_at,expires_at)
        values($1,$2,$3,'KIRA_SUBSCRIPTION',$1,$8,'{"planVersion":"disabled-v2"}','K1-B-disabled',$4,'disabled-v2',$5,$6,$7)`, [secondQuoteId, user, campus, disabled.profile.id, disabled, disabled.createdAt, disabled.expiresAt, "a".repeat(64)])).rejects.toThrow("BACHS_QUOTE_PROFILE_MISMATCH");
    } finally { await db.close(); }
  }, 15_000);

  it("pins expiry and exactly-once actual fee evidence without increasing the customer price", async () => {
    const db = await fixture();
    try {
      await insertQuote(db);
      await expect(insertSession(db, quoteId, "2026-10-09T12:16:00Z")).rejects.toThrow("BACHS_SESSION_EXPIRY_MISMATCH");
      await insertSession(db);
      const record = (gross = 600_000, fee = 9_200, paidAt = "2026-10-09T12:01:00Z", mode = "test", id = quoteId) =>
        db.query("select * from app_private.record_bachs_pricing_receipt($1,$2,'ch_fixture',$3,$4,$5)", [id, mode, gross, fee, paidAt]);
      await expect(record(599_999)).rejects.toThrow("BACHS_RECEIPT_QUOTE_MISMATCH");
      await expect(record(600_000, 9_200, "2026-10-09T12:14:01Z")).rejects.toThrow("BACHS_RECEIPT_QUOTE_MISMATCH");
      await expect(record(600_000, 9_200, "2026-10-09T12:01:00Z", "live")).rejects.toThrow("BACHS_RECEIPT_QUOTE_MISMATCH");
      await record(); await record();
      const receipts = (await db.query("select * from app_private.bachs_pricing_receipts")).rows;
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ amount_kobo: 600_000, actual_fee_kobo: 9_200, variance_kobo: 200, variance_alert: true });
      expect((await db.query<{ quote: BachsPricingQuote }>("select quote from app_private.bachs_checkout_quotes")).rows[0]!.quote.finalCustomerAmountKobo).toBe(600_000);
      await expect(record(600_000, 9_100)).rejects.toThrow("BACHS_RECEIPT_IDEMPOTENCY_CONFLICT");
      await expect(db.exec("update app_private.bachs_pricing_receipts set actual_fee_kobo=9100")).rejects.toThrow("APPEND_ONLY");
      await insertQuote(db, secondQuoteId); await insertSession(db, secondQuoteId);
      await expect(record(600_000, 9_200, "2026-10-09T12:01:00Z", "test", secondQuoteId)).rejects.toThrow("unique constraint");
      expect((await db.query("select * from app_private.bachs_pricing_receipts")).rows).toHaveLength(1);
    } finally { await db.close(); }
  }, 15_000);
});
