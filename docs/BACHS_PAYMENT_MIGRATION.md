# KampusOne — Bachs Payment Migration

**Status: FOUNDATION ONLY — NOT DEPLOYED AND NOT A LIVE PAYMENT SWITCH.**

This branch adds an isolated Bachs hosted-checkout API boundary and tests. It does
**not** change the active Paystack checkout, webhooks, payout/refund routines,
database settlement, mobile screens, price displays or deployed Worker secrets.

## Why this cannot be a secret-key swap

Production currently assumes Paystack in:
- `server/src/routes/payments.ts` — initialization, status and charge-success webhook.
- `server/src/lib/kira-billing.ts` — NGN Kira plan, discount, renewal checkout and receipt.
- `server/src/lib/commerce-pricing.ts`, `tutorial-pricing.ts`, `material-commerce.ts`, `rider-finance.ts` — buyer purchases and rider commission reconciliation.
- `server/src/lib/payment-pricing.ts` and `database/neon/migrations/20261003123000_payment_pricing_profiles.sql` — approved fee profiles, estimated/actual fees, payment snapshot trace.
- `server/src/lib/payout-provider.ts`, `paystack-transfers.ts`, `payouts.ts` and payout routes — bank verification, Paystack recipient IDs, transfer OTP and payout proofs.
- `server/src/lib/paystack-refunds.ts` — legacy Paystack refund evidence.

The provider's transaction IDs, receipts, fee structure and payout recipient
tokens are **not interchangeable**. Never credit a buyer, seller or wallet solely
because a Bachs webhook, browser return or checkout initialization said success.

## Phased rollout

### A. Foundation (this branch)
- [x] Add `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET` optional Worker bindings.
- [x] Add isolated Bachs NGN raw-amount checkout client with environment isolation,
      exact decimal money, idempotency and trusted checkout origins.
- [x] Add provider-side session/payment GET operations for subsequent verification.
- [x] Add signed raw-body HMAC-SHA256 verification with a five-minute replay window.
- [x] Add isolated unit tests. These were authored but need CI confirmation.
- [x] **No new live checkout path**, no changes to existing Paystack transactions.

### B. Provider-aware accounting and migration (required before any cutover)
- [ ] Confirm Bachs merchant verification and Nigeria NGN bank/card capability.
- [ ] Add separate provider registry (PAYSTACK / BACHS), provider transaction IDs,
      Bachs checkout IDs and unique Bachs event IDs; migrate without overwriting
      historical Paystack references or completed transactions.
- [ ] Update DB price/fee policies for Bachs. Original Paystack customer-fee
      pass-through assumptions must *not* be copied as if equivalent.
- [ ] Snapshot immutable reference, customer, university, order, expected gross
      kobo, currency and fees when a Bachs checkout is initialized.
- [ ] Add provider-specific Bachs initialization and return handling
      (`success_url` appends `?checkout_id=`), without changing the existing
      mobile response contract until UI tests pass.
- [ ] Add `POST /v1/payments/bachs/webhook`: verify HMAC on **raw** request bytes,
      deduplicate `event.id`, then GET checkout **and** payment with Bachs API.
      Confirm our stored checkout ID, reference, amount, NGN currency, succeeded
      status, charge ID, provider mode and fee; only then perform one atomic
      DB fulfillment. Uncertain or inconsistent evidence goes to finance review.
- [ ] Recover lost webhooks via controlled scheduled provider GET reconciliation;
      handle out-of-order and duplicate events.
- [ ] Migrate storefront/tutoring/materials/rider commission and Kira purchases;
      test expired quote, retry, partial payment, disconnect and duplicate
      webhook handling.
- [ ] Retain Paystack verification/webhook handling for historical payments,
      refunds, chargebacks, and pending payout references until fully settled.

### C. Payouts and marketplace money movement (separate release gate)
- [ ] Verify the merchant can use Bachs Connect connected accounts and their
      payment/transfer capabilities before promising vendor, tutor or rider payouts.
- [ ] Confirm seller/rider KYC and bank approval equivalence, account ownership
      rules, recipient tokens and beneficiaries with actual Bachs API responses.
- [ ] Rewrite payout quoting to use reviewed Bachs transfer/withdrawal fees;
      do not re-label Paystack `RCP_...` recipients as Bachs accounts.
- [ ] Preserve existing payout reservations and idempotent settlement. Verify each
      final payout using provider GET before releasing or reconciling wallet funds.
- [ ] Review rider **micro-commission** repayment amounts against Bachs permitted
      minimum NGN charge (to be tested; no assumption).
- [ ] Implement Bachs-specific verified refunds and chargeback accounting.
- [ ] Roll over only after end-to-end sandbox + low-value live transactions and
      accounting reconciliation (gross, fees, net, payout).
- [ ] Confirm all essential routes on iOS, Android, web and admin panels.
- [ ] Add a payment-provider kill switch and rollback plan.

### D. Kira
Bachs recurring subscriptions currently support **USD cards only**. KampusOne's
NGN Kira plan should continue as explicit one-time monthly renewals through NGN
checkout; do not market it as Bachs automatic recurring billing or silently
convert the plan to USD.

## Secret configuration — DO NOT COMMIT KEYS

Obtain sandbox and live API keys and webhook destination signing secrets from
the Bachs dashboard. Store `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET` as **separate
encrypted Cloudflare Worker secrets** in the applicable environment (sandbox on
test workers; live only on production). Keep `PAYSTACK_SECRET_KEY` securely for
historical reconciliation. Do not store keys in `wrangler.jsonc`, source code,
screenshots, support tickets or chat messages.

The new module intentionally fails closed if the key is absent or its sandbox/live
prefix mismatches `ENVIRONMENT`. It does not start collecting money.

## Bachs facts to revalidate at go-live
- One-time NGN Checkout via `POST /v1/checkout-sessions`; `pricing.amount`
  is a decimal NGN string, unlike Paystack's integer kobo amounts.
- Checkout status comes from provider GET and webhooks; customer return alone
  is not payment proof.
- Sign webhooks HMAC-SHA256 over `timestamp + "." + rawBody`; verify timestamp
  and deduplicate `event.id`.
- Published NGN processing: bank transfer 1.5% capped at ₦2,000; local card
  beta 2%. NGN merchant withdrawals: ₦100 flat. Actual fee treatment can
  change; settlement must be based on verified provider receipts.
- The Bachs Connect marketplace flow requires separately approved capabilities.
- Automatic subscription billing currently USD-card only; not NGN.

Official references:
- https://docs.bachs.io/guides/checkout/checkout-sessions
- https://docs.bachs.io/api-reference/payments/create-checkout-session
- https://docs.bachs.io/api-reference/checkout-sessions/get-checkout-session
- https://docs.bachs.io/api-reference/payments/get-payment
- https://docs.bachs.io/developer-portal/webhooks
- https://docs.bachs.io/for-you/fees
- https://docs.bachs.io/guides/subscriptions/overview
