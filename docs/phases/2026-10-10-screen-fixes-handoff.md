# Seller, Kira and campus screen corrections

This release extends [PR #89](https://github.com/KampusOne/platform/pull/89) with the requested corrections alongside the versioned cache. Base: `e0fd01069778d76715dbc8ceb98bb77fbcadcf0d`. Matching source, CI, Worker and Android receipts are recorded by the release workflows and PR.

## Screens

- Standard keeps one description line. Pro shows its full benefit list. The extra Paystack paragraph is removed. Failed availability checks expose a retry action; only authoritative availability enables checkout.
- Seller navigation keeps the seller title while capabilities load, eliminating the misleading workspace/trial flash. Create product is the main action; store, orders, earnings, trial and refresh actions use the top-right three-dot menu.
- Store settings load before showing editable fields. One Save store action saves profile and delivery choices. Refresh and review actions use its menu.
- Searchable categories cover 23 common commerce categories, including course materials and student handbooks. Seeding preserves campus restrictions and applies to future institutions.
- DM bubble-side arrows are removed; swipe reply and long-press actions remain.
- Countdown has a compact day count and time row. Exam-awareness labels use sentence case; missing-paper and expired-alarm handling remains intact.
- Accurate cached GPS can start a route immediately when at most 15 seconds old. Live updates continue; expired, inaccurate and invalid fixes remain rejected, with bounded retry and campus-start selection.

## Private document and AI recovery

Images use private Workers AI Markdown conversion before reasoning with the selected text model. Unreadable photos can use native vision. Scanned PDFs use conversion when PDF text extraction finds no text. PDF/text files within the Worker's 16 MiB direct-read limit no longer depend on the separate web document reader; larger files keep the bounded excerpt reader.

Conversion takes private Blob bytes, never a client URL, with a deadline and output bound. Auth, owner/tenant checks, quotas, durable request reservation and kill switches remain intact. Invalid files do not consume the separate import allowance. Classified errors contain no private content or raw provider response.

[Live provider verification](https://github.com/KampusOne/platform/actions/runs/38052674417), source `19642861f981c634f4ffd01b356e5b6be9291ea5`, passed Standard and Pro generation, private text, a synthetic timetable PNG and PDF. HF rejected requests with HTTP 402 for exhausted credit, confirming the need for the working alternative.

## BACHS

New Kira Pro references use `K1-B-AI-` and a fixed NGN total. The live account API confirms bank transfer and merchant-paid fees. Creation uses the existing durable POST claim and provider idempotency key. An unpaid synthetic ₦6,000 checkout opened successfully and expired after two minutes; no live charge was made.

The enabled production webhook already targets `/v1/payments/bachs/webhook` and subscribes to successful payment events. Legacy HMAC and rotating V2 signatures are checked over raw bytes. Event IDs deduplicate delivery; checkout and payment evidence are fetched again. Return links and callback amounts cannot grant access. Amount, currency, owner, campus, saved resource, mode and price snapshot must match. Repeated success events grant one billing period and one allocation.

BACHS evidence and clearing are separate from historical Paystack receipts. An append-only registry references real provider receipts and becomes Kira's billing-period FK parent after a complete legacy backfill and atomic FK replacement. No payment/billing row is removed. Marketplace collections, refunds and bank payouts retain their existing provider path. Unexpected fee variance leaves funds in suspense for review.

## Migrations and evidence

The combined exact-source migrations passed a rollback-only rehearsal on `br-mute-sunset-ayzh9xrc`, then committed atomically on production `br-quiet-butterfly-ayrj264q`, project `rough-breeze-36415261`, database `neondb`.

| Migration | Git source blob |
| --- | --- |
| `20261010120000_versioned_read_cache` | `2e316b2d99e7925789175bf8ea3054ec85d27265` |
| `20261010130000_default_product_categories` | `06773b7f10f0ced1c09fdb1ffbec1e3cda1a2613` |
| `20261010140000_bachs_collection_cutover` | `6af105351bd2a808efba9988c568af6009cb815b` |

Self-cleaning acceptance proved verified-only access, duplicate settlement safety, balanced journals, receipt immutability and resource-forgery rejection. Synthetic records roll back in an exception subtransaction. Production before/after counts match: 19 users, 19 profiles, 136 media objects, 6 bookings, 0 orders and 0 financial/billing records. Fresh verification found six private cache namespaces, 23 UNIBEN categories, BACHS readiness and no fixture leaks.

[Cache proof](../../database/verification/production-20261010-cache.json) and [screen/payment proof](../../database/verification/production-20261010-screen-fixes.json) record exact hashes, preservation and private/replay checks. Worker and Android workflows require the proofs. Production config enables caching and BACHS checkout; staging stays disabled pending its own activation.

## Validation and limits

Full local Worker verification passed 862 tests across 105 files, followed by eight deployment-proof guard tests including the additional release guard. Root regression tests passed 184/184. Type checks, portal lint/production build, GPS/map checks, contract/importer checks and mobile production export are required before release; final matching CI is authoritative.

No real paid purchase, physical Android GPS acquisition or campus-network load test was performed. Unpaid checkout and signed replay/ledger tests verify integration without a charge. Existing Kira capacity limits remain. GPS needs permission and a real fix; no false position is substituted. Cache rollback uses either shared-cache flag false. BACHS creation can be paused with `BACHS_PRICED_CHECKOUT_ENABLED=false`; existing references stay provider-pinned for verification.
