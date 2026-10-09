import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../database/neon/migrations/20261009100000_payment_idempotency_inbox.sql",
  import.meta.url,
);
async function fixture() {
  const db = new PGlite();
  await db.exec("create schema app_private");
  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);
  return db;
}
const reference = "K1-O-idempotency-fixture";
const hash = "a".repeat(64);

describe("durable Paystack idempotency database guards", () => {
  it("allows exactly one provider initialization, replays the same session, and rejects amount drift", async () => {
    const db = await fixture();
    try {
      const claim = async (amount = 600000) =>
        (await db.query<{ claim_state: string; authorization_url: string | null; access_code: string | null }>(
          "select * from app_private.claim_payment_initialization($1,$2)",[reference,amount],
        )).rows[0]!;
      expect((await claim()).claim_state).toBe("CLAIMED");
      expect((await claim()).claim_state).toBe("IN_PROGRESS");
      await expect(claim(650000)).rejects.toThrow("PAYMENT_INITIALIZATION_AMOUNT_CHANGED");

      const url = "https://checkout.paystack.com/synthetic-link";
      expect((await db.query<{ saved: boolean }>(
        "select app_private.finish_payment_initialization($1,'READY',$2,$3) as saved",
        [reference,url,"synthetic-access"],
      )).rows[0]?.saved).toBe(true);
      expect(await claim()).toMatchObject({
        claim_state:"READY",authorization_url:url,access_code:"synthetic-access",
      });
      expect((await db.query("select * from app_private.payment_initialization_claims")).rows).toHaveLength(1);
      await expect(db.query(
        "select app_private.finish_payment_initialization($1,'READY',$2,$3)",
        [reference,url,"wrong-access"],
      )).rejects.toThrow("PAYMENT_INITIALIZATION_ALREADY_COMPLETED");
    } finally { await db.close(); }
  });

  it("does not allow a second provider POST after a timeout or crashed worker", async () => {
    const db = await fixture();
    try {
      await db.query("select * from app_private.claim_payment_initialization($1,$2)",[reference,600000]);
      await db.query("select app_private.finish_payment_initialization($1,'UNCERTAIN')",[reference]);
      const uncertain = await db.query<{ claim_state:string }>(
        "select * from app_private.claim_payment_initialization($1,$2)",[reference,600000],
      );
      expect(uncertain.rows[0]?.claim_state).toBe("UNCERTAIN");
      await expect(db.query(
        "select app_private.finish_payment_initialization($1,'READY',$2,$3)",
        [reference,"https://checkout.paystack.com/synthetic","access"],
      )).rejects.toThrow("PAYMENT_INITIALIZATION_REQUIRES_REVIEW");
      await db.query(
        "update app_private.payment_initialization_claims set created_at=now()-interval '3 minutes',state='IN_PROGRESS' where provider_reference=$1",
        [reference],
      );
      expect((await db.query<{claim_state:string}>(
        "select * from app_private.claim_payment_initialization($1,$2)",
        [reference,600000],
      )).rows[0]?.claim_state).toBe("UNCERTAIN");
    } finally { await db.close(); }
  });

  it("deduplicates concurrent signed deliveries and preserves retry semantics", async () => {
    const db = await fixture();
    try {
      const claim = async (token: string, event = "charge.success") =>
        (await db.query<{state:string}>(
          "select app_private.claim_provider_webhook('PAYSTACK',$1,$2,$3,$4) as state",
          [event,reference,hash,token],
        )).rows[0]!.state;
      const finish = async (token: string, state: string) =>
        (await db.query<{saved:boolean}>(
          "select app_private.finish_provider_webhook('PAYSTACK','charge.success',$1,$2,$3,$4) as saved",
          [reference,hash,token,state],
        )).rows[0]!.saved;

      const first = randomUUID(), second = randomUUID(), third = randomUUID();
      expect(await claim(first)).toBe("CLAIMED");
      expect(await claim(second)).toBe("BUSY");
      expect(await finish(second,"PROCESSED")).toBe(false);
      expect(await finish(first,"RETRYABLE")).toBe(true);
      expect(await claim(second)).toBe("CLAIMED");
      expect(await finish(second,"PROCESSED")).toBe(true);
      expect(await claim(third)).toBe("DUPLICATE");
      expect(await claim(third,"transfer.success")).toBe("CLAIMED");
      expect((await db.query<{attempts:number}>(
        "select attempts from app_private.provider_webhook_inbox where event_type='charge.success'",
      )).rows[0]?.attempts).toBe(2);
    } finally { await db.close(); }
  });

  it("keeps provider finance-review events terminal without permitting replay", async () => {
    const db = await fixture();
    try {
      const first = randomUUID();
      await db.query(
        "select app_private.claim_provider_webhook('PAYSTACK','charge.success',$1,$2,$3)",
        [reference,hash,first],
      );
      const settled = await db.query<{saved:boolean}>(
        "select app_private.finish_provider_webhook('PAYSTACK','charge.success',$1,$2,$3,'REQUIRES_REVIEW','MISMATCH') as saved",
        [reference,hash,first],
      );
      expect(settled.rows[0]?.saved).toBe(true);
      const replay = await db.query<{state:string}>(
        "select app_private.claim_provider_webhook('PAYSTACK','charge.success',$1,$2,$3) as state",
        [reference,hash,randomUUID()],
      );
      expect(replay.rows[0]?.state).toBe("REQUIRES_REVIEW");
    } finally { await db.close(); }
  });
});
