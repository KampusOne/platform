# 2026-10-09 · Payment idempotency and replay safety

## Boundary and scope
This change prevents a retry, a second tap, a duplicated signed Paystack event, or a network timeout from silently creating additional financial side effects. It preserves the existing snapshot-priced checkout policy, immutable ledger journals and refund accounting.

- **Outgoing collections:** `/v1/payments/initialize` (store and tutorial), Kira subscription, paid learning material, and rider commission repayments use `initializePaystackOnce`. A database claim is committed **before** contacting Paystack. The first caller sends the provider POST once. A second caller receives the original saved authorization URL, `CHECKOUT_IN_PROGRESS`, or `CHECKOUT_REQUIRES_REVIEW`. The same provider reference cannot be claimed with a different amount.
- **Payouts:** payout transfer initiation and OTP confirmation now use independent claims scoped to the sealed provider reference and operation. The transfer amount and bank recipient / transfer code must match the initial claim. OTPs are not persisted. Once initiated, a timeout causes a reviewable uncertain state, never a blind resubmission.
- **Incoming webhooks:** only Paystack-HMAC-verified, recognized charge/transfer events can claim a durable `(provider,event_type,reference,SHA-256(raw body))` inbox key. Concurrent duplicates receive a retryable response; completed deliveries return `already_processed`. Reconciliation failures release the claim for retry, while explicit legacy/price mismatch goes to review. Success is acknowledged only after the relevant verified settlement has been persisted.
- **Financial posting:** existing atomic `record_*_receipt`, unique verified Paystack transaction IDs, unique ledger journal idempotency keys, and partial unique live-checkout constraints remain authoritative for balance and fulfilment safety. This patch does not invent new balances or trigger client-side credits.

## Forward migration (mandatory before Worker deploy)
Run `database/neon/migrations/20261009100000_payment_idempotency_inbox.sql` against the intended Neon environment using the existing reviewed migration process. It adds only private guard tables/functions; it does not backfill, change historic journal entries, or alter current commissions.

**Do not deploy the new Worker before the migration.** All new provider calls fail closed when the guard functions are missing. Leave payment feature flags disabled until a staging probe verifies the migration, a signed webhook replay, the approved Paystack live/test mode, and the original amount snapshots. Apply in staging, verify, then promote to production in the regular release flow. Production secrets, service roles and provider dashboards remain owner-controlled.

## Verification
Run `npm ci` in `packages/contracts` then `server`; run `npm run check`, `npm test -- --maxWorkers=2`, and `npm run build` from `server`. Dedicated tests:
- `server/tests/payment-idempotency-migration.test.ts` — first-call claim, repeated same-key return, amount and recipient conflicts, uncertain responses, duplicate/processing/retry webhook transitions, rejected stale finish tokens.
- `server/src/lib/payment-idempotency.test.ts` — exactly one provider initializer on the first call, zero initializer calls for ready and concurrent replays, uncertain state after timeout.

**Provider sandbox acceptance:** test simultaneous duplicate POSTs with the same key; a second key against the same live order; successful webhook delivered 3–5 times; failed verification followed by redelivery; payout initiate and OTP retries; and a provider success with a lost Worker response. Check one order transition, one receipt, one journal with balanced lines, and one payout reservation. Do not use real student money for rehearsal.

## Support / operator recovery
An `UNCERTAIN` outbound claim must not be reset to permit a blind second provider call. Verify the saved Paystack reference from the server and reconcile the existing financial record; if no checkout exists, require a deliberate new quote/request under the normal live-attempt rules. Review `REQUIRES_REVIEW` signed events manually with the provider dashboard and journal evidence before authorizing a refund or another payment.

Read-only checks:

```sql
select state,count(*),min(created_at) earliest
  from app_private.payment_initialization_claims group by state;
select operation,state,count(*)
  from app_private.paystack_transfer_operation_claims group by operation,state;
select event_type,state,count(*),min(updated_at) earliest
  from app_private.provider_webhook_inbox group by event_type,state;
```

Alert on aged `IN_PROGRESS`, `UNCERTAIN`, `RETRYABLE`, `REQUIRES_REVIEW` and repeated `503` webhook responses. The inbox is durable; provider redelivery is still required for retries because this phase does not introduce a queue worker.

## Rollout status
Code is isolated in the finance idempotency branch for review/CI. No production migration, customer debit, Cloudflare production deployment, or APK publication is implied by this code change.
