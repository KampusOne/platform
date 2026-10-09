# BACHS pricing psychology — 9 October 2026

This implements the NGN pricing portion of
`KampusOne_Paystack_Charges_and_Pricing_Psychology_Implementation.txt` for BACHS,
on top of the checkout foundation in PR #80. The accepted customer total is the
exact amount submitted to BACHS. Quotes include processing before acceptance;
later fee variance does not increase the customer's price.

## Verified provider rates

Published references checked at https://docs.bachs.io/for-you/fees:

| BACHS product | Published NGN fee | Treatment |
| --- | --- | --- |
| Checkout bank transfer | 1.5%, capped at ₦2,000 | No Paystack ₦100 flat fee or ₦2,500 waiver |
| Nigerian card, beta | 2%, no documented cap | Separate NGN card profile and corridor |
| Fixed virtual-account deposit | 1.5%, capped at ₦300 | Does not price hosted checkout |
| Merchant bank withdrawal | ₦50 flat | Added to recipient money in total debit |

These reference profiles are disabled, not account approvals. Campus fee versions
must record the merchant's capability and commercial terms. International USD
checkout, terminals, Connect marketplace transfers and recurring subscription
fees do not inherit these NGN rules. BACHS recurring checkout currently supports
USD cards; NGN Kira renewals remain one-time monthly payments.

The create-checkout API documents raw decimal NGN pricing, a method list and
`expires_in_minutes`; it does not document a per-request merchant-fee override.
Do not invent `merchant_bears_cost` in the create request. Confirm account fee
treatment before enabling priced sessions, then require `merchant_bears_cost`
to be true on the verified payment receipt.

References:
- https://docs.bachs.io/guides/checkout/checkout-sessions
- https://docs.bachs.io/api-reference/payments/create-checkout-session
- https://docs.bachs.io/api-reference/payments/object
- https://docs.bachs.io/guides/webhooks/overview

## Pricing and quote contract

`server/src/lib/bachs-pricing.ts` owns whole-kobo economics:

- `FIXED_TOTAL` keeps list-price discounts exact. ₦6,000 less 20% is ₦4,800;
  estimated bank-transfer processing is ₦72, leaving ₦4,728. Extra platform
  revenue and post-discount rounding are refused for fixed list prices.
- `RECOVER_FEES` finds the minimum gross that funds discounted goods, delivery
  and commercial revenue, then applies an approved rounding mode and maximum
  adjustment. A ₦6,000 net target with bank transfer needs ₦6,091.38; rounding
  upward to ₦6,100 records ₦8.62 as the pricing adjustment. BACHS receives ₦6,100.
- `bachsMarketplacePrices` uses approved buyer markup, seller commission and
  fee-bearer/split policies with the BACHS profile. Combined checkout cannot
  increase the displayed item budget and accepted delivery fare. Savings are
  the actual difference from those displayed prices. Cash delivery remains
  outside the provider amount and creates no digital rider earnings.
- `bachsWithdrawalQuote` shows recipient money, fee and total debit separately.
  A ₦1,000 recipient withdrawal debits ₦1,050; a maximum ₦1,000 debit sends ₦950.
  This is a merchant-withdrawal estimate, not a Connect seller-transfer quote.

`server/src/lib/bachs-pricing-store.ts` is the internal domain boundary:

1. Fetch and authorize the product, plan, discount, quantity, campus and delivery
   through the existing domain service. Never accept client prices as authority.
2. Build an authoritative `resourceSnapshot` and compute its SHA-256 with
   `fingerprintBachsPurchase`, including
   commercial policy/plan and discount versions, item IDs/quantities, and delivery
   address/method and the complete commercial fee allocation. Save both snapshot
   and `resourceFingerprint` with a new `K1-B-...` reference. Their hash must agree;
   the snapshot is retained for later accounting and audit.
3. Save the price through `saveBachsPricingQuote`. For marketplace prices already
   computed by `bachsMarketplacePrices`, save `checkout.payableKobo` with
   `FIXED_TOTAL`; do not recover processing a second time. For Kira, pass its
   authoritative plan list price and percentage discount with `FIXED_TOTAL`.
4. Render `publicBachsQuote` and accept its exact total. Client amounts never
   create a saved quote. The public response excludes internal fee profiles and
   margin allocations; its line amounts sum to the provider total.
5. Recompute the resource fingerprint before initialization. A changed product,
   quantity, plan, discount or delivery needs a fresh quote and acceptance even
   when its new price happens to be the same. Quote lifetime defaults to 15
   minutes, never exceeds 20 minutes, and ends with the fee profile's validity.
6. Initialize only through `initializeBachsPricedCheckout`. It reuses pinned
   sessions, restricts checkout to the quoted `NGN_BANK_TRANSFER` or `NGN_CARD`
   method, and checks the provider's exact amount, currency, reference and expiry.
7. `verifyBachsPricedCheckout` GETs checkout and payment evidence. It requires
   `completed` checkout, `succeeded` payment, matching reference/session/method,
   exact `amount` and `amount_paid`, NGN original fees and merchant-borne processing.
   USD-converted fee fields, partial payments and browser redirects cannot verify
   a price. Timely payments may be reconciled after the quote expires.

The migration adds isolated append-only fee profiles, quotes, sessions and
receipts. Database triggers pin approved profile identity, campus, terms and
validity; sessions cannot extend quotes. Receipt insertion is atomic and
idempotent. Reusing a payment ID for another quote is rejected. Actual fees,
variance and the profile's tolerance are recorded without changing quote amounts.

## Finance controls

Admin → Pricing → Advanced provider and payment policies → BACHS pricing:

- `finance.view` can inspect rates, simulate final prices and review fee differences.
- `finance.review` can record a new campus fee version or disabled version with
  official source, capability evidence and an approval reason. New versions have
  an atomic old/new/reason audit; profiles cannot be edited in place.
- Published references work before migration and are labeled preview-only.
  Simulations create no checkout or financial record.
- Scope changes reset the forms and pending quote display. Loading, retry,
  disabled, empty, success and validation states use existing portal styles.

Routes live under `/v1/admin/finance/payment-pricing/bachs`:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/profiles` | Scoped saved fee history plus disabled references |
| POST | `/profiles` | Audited new fee version |
| POST | `/preview` | Server-only price simulation |
| GET | `/alerts` | Scoped actual-fee variances beyond tolerance |

## Rollout boundary

This change does not complete provider-aware wallet/ledger fulfillment or install
a live BACHS webhook route. Apply the additive migration through the normal Neon
migration process, review account capabilities/terms, and complete phase B of
`docs/BACHS_PAYMENT_MIGRATION.md` before activating customer payments.

Priced checkout requires all three bindings to equal `"true"`:
`PAYMENTS_ENABLED`, `BACHS_PRICED_CHECKOUT_ENABLED`, and
`BACHS_MERCHANT_BEARS_COST_CONFIRMED`. Both BACHS flags default off when absent.
Retain legacy Paystack reconciliation and refunds for historical references.
Actual-fee observations do not independently grant Kira access, fulfill goods or
credit seller, tutor, agent or rider balances.

## Validation

Local validation on 9 October 2026:

- Server `npm test`: 91 test files, 801 tests passed. Includes fee calculations,
  accepted totals, purchase fingerprints, expiry, ownership, product isolation,
  provider evidence, fee allocation and append-only PGlite migration checks.
- Server `npm run check` and `npm run build`: passed.
- Worker `npm exec -- wrangler deploy --dry-run --env ''`: production bundle
  compiled successfully; this command does not deploy a Worker.
- Portal `npm run check`, `npm run lint` and `npm run build`: passed; 36 routes
  built, including `/admin/pricing`.
- `git diff --check`: passed.

The full server suite imports existing Expo helpers, so dependencies were
installed from the committed lockfile in `mobile` as well as `server`, `portal`
and `packages/contracts`. No dependency or lockfile was changed. Provider requests
use test mocks and the migration uses PGlite; no live merchant charge or production
database migration was performed as part of these local checks.
