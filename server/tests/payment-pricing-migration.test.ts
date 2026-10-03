import { describe,expect,it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
async function financialFixture(){
  const db=new PGlite();
  await db.exec(`create schema app_private;create table public.universities(id uuid primary key);create table public.users(id uuid primary key);
  create function app_private.prevent_append_only_mutation()returns trigger language plpgsql as $$begin raise exception 'APPEND_ONLY';end$$;
  create table app_private.commerce_fee_policies(id uuid primary key,university_id uuid,version text,collection jsonb,approved_by uuid,approval_note text,source_url text,approved_at timestamptz);
  create table public.payment_attempts(provider_reference text,university_id uuid,resource_type text,resource_id uuid,amount_kobo bigint);
  create table app_private.order_price_snapshots(order_id uuid,quote_id uuid);create table app_private.store_checkout_quotes(id uuid,policy_id uuid,pricing jsonb,created_at timestamptz,expires_at timestamptz);
  create table app_private.tutorial_booking_prices(booking_id uuid,policy_id uuid,created_at timestamptz);
  create table app_private.material_checkout_quotes(id uuid,policy_id uuid,pricing jsonb,created_at timestamptz,expires_at timestamptz);
  create table app_private.kira_price_plans(id uuid,version text,collection jsonb,approved_by uuid,approval_note text,source_url text,approved_at timestamptz);
  create table app_private.kira_checkouts(id uuid,university_id uuid,plan_id uuid,provider_reference text,amount_kobo bigint,created_at timestamptz,expires_at timestamptz);
  create table app_private.rider_commission_checkouts(id uuid,university_id uuid,provider_reference text,amount_kobo bigint,created_at timestamptz,expires_at timestamptz);`);
  await db.exec(await readFile(new URL("../../database/neon/migrations/20261003123000_payment_pricing_profiles.sql",import.meta.url),"utf8"));
  await db.exec(`insert into public.universities values('11111111-1111-4111-8111-111111111111');insert into public.users values('22222222-2222-4222-8222-222222222222');
  insert into app_private.commerce_fee_policies(id,university_id,version,collection,approved_by,approval_note,source_url,approved_at)values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','original-rule','{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}','22222222-2222-4222-8222-222222222222','Originally reviewed collection economics','https://paystack.com/pricing','2026-10-01');
  insert into public.payment_attempts values('K1-O-fixture','11111111-1111-4111-8111-111111111111','STORE_ORDER','44444444-4444-4444-8444-444444444444',600000);
  insert into app_private.order_price_snapshots values('44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444');
  insert into app_private.store_checkout_quotes values('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','{"rawRequirementKobo":599900,"pricingAdjustmentKobo":100,"feeBearer":"INCLUDED_IN_PRICE"}','2026-10-03','2026-10-03 00:10');`);
  return db;
}
describe("immutable collection pricing database",()=>{
  it("freezes original policy, rejects changed initialization amounts, and reconciles duplicate success once",async()=>{
    const db=await financialFixture();try{
      await db.query("select app_private.snapshot_collection_payment($1,$2,$3)",["K1-O-fixture",600000,{}]);
      const snap=(await db.query<{expected_provider_fee_kobo:number;raw_requirement_kobo:number;pricing_adjustment_kobo:number}>("select * from app_private.collection_payment_pricing")).rows[0]!;
      expect(Number(snap.expected_provider_fee_kobo)).toBe(19000);expect(Number(snap.raw_requirement_kobo)).toBe(599900);expect(Number(snap.pricing_adjustment_kobo)).toBe(100);
      await expect(db.query("select app_private.snapshot_collection_payment('K1-O-fixture',610000,'{}')")).rejects.toThrow("PAYMENT_AMOUNT_CHANGED");
      await expect(db.exec("update app_private.payment_fee_profiles set version='changed'")).rejects.toThrow("APPEND_ONLY");
      for(let i=0;i<2;i++)await db.exec("select app_private.record_collection_pricing_observation('K1-O-fixture',600000,19200,'123','card','NG','VISA','NGN','test')");
      expect((await db.query("select * from app_private.collection_receipt_contexts")).rows).toHaveLength(1);
      const alerts=(await db.query<{kind:string;metadata:{varianceKobo:number}}>("select * from app_private.payment_pricing_alerts")).rows;expect(alerts).toHaveLength(1);expect(alerts[0]).toMatchObject({kind:"PROVIDER_FEE_VARIANCE",metadata:{varianceKobo:200}});
      await db.exec(`insert into public.payment_attempts values('K1-O-second','11111111-1111-4111-8111-111111111111','STORE_ORDER','55555555-5555-4555-8555-555555555555',600000);
        insert into app_private.order_price_snapshots values('55555555-5555-4555-8555-555555555555','55555555-5555-4555-8555-555555555555');
        insert into app_private.store_checkout_quotes select '55555555-5555-4555-8555-555555555555',policy_id,pricing,created_at,expires_at from app_private.store_checkout_quotes;
        select app_private.snapshot_collection_payment('K1-O-second',600000,'{}');`);
      const duplicate=(await db.query<{state:string}>("select app_private.record_collection_pricing_observation('K1-O-second',600000,19000,'123','card','NG','VISA','NGN','test') as state")).rows[0];
      expect(duplicate?.state).toBe("REQUIRES_REVIEW");
      expect((await db.query("select * from app_private.payment_pricing_alerts where kind='DUPLICATE_PROVIDER_TRANSACTION'")).rows).toHaveLength(1);
      expect((await db.query("select * from app_private.collection_receipt_contexts")).rows).toHaveLength(1);
      expect((await db.query("select pass_fees_disabled from app_private.paystack_account_reviews")).rows).toHaveLength(0);
    }finally{await db.close();}
  },15000);
});
