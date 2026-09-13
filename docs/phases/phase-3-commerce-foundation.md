# Phase 3 commerce foundation handoff

Date: 2026-09-13
Target release: `0.3.0`
Release mode: controlled UNIBEN Store and bicycle-logistics beta
Tracker status: `IN_PROGRESS`
Production activation: **not authorized and not performed**

## Delivered in this slice

- Added the independent `PHASE_3_SCHEMA_READY` runtime gate. Store and Logistics now require both their own feature flag and the reviewed Phase 3 schema binding.
- Kept production and staging `PHASE_3_SCHEMA_READY`, live Store, Logistics, Marketplace and Payments bindings off.
- Added an independent `STORE_DEMO_ENABLED` kill switch for a server-owned, read-only catalogue with two clearly marked demo sellers and eight demo products. It does not write vendor/product records or enable ordering.
- Added a deployment guard that requires `PHASE_3_MIGRATION_20260912_READY=true` before the schema binding can be enabled.
- Kept existing Phase 2 administration compatible before the Phase 3 migration is applied; new administrative reads and mutations are schema-gated.
- Replaced direct first publication with `DRAFT → SUBMITTED → PUBLISHED / NEEDS_CORRECTION / REJECTED` moderation. Publication requires an active vendor, approved category, complete bicycle-package data and a documented operator review at the current listing revision.
- Added a database guard that allows stock-only changes without re-review and automatically removes a published product from sale after material listing changes.
- Added institution-scoped vendor storefront and product-media foundations. Store discovery requires an approved storefront as well as an approved product.
- Added the full storefront lifecycle: vendor save and submission, administrator approval/correction/suspension, revision-bound publication and automatic removal from sale after material trust-detail changes.
- Added vendor product editing with a distinct optimistic stock endpoint. Concurrent checkout reservations cannot be overwritten by a stale stock form, and material listing edits still require a fresh review.
- Added vendor order details with immutable recipient/location data, exact line quantities and totals, delivery instructions and the append-only status timeline. Recipient details remain masked before confirmed payment, while existing paid orders can still be fulfilled independently of new-order activation.
- Replaced the portal's direct-publish preview with storefront setup, full package editing, review/correction feedback, stock controls and the `PAID → ACCEPTED → READY` fulfilment desk.
- Added the administrator storefront and product moderation queues, including category policy context, package evidence and audited revision-specific decisions.
- Expanded the delivery-zone form so an administrator must explicitly enter operating hours, package limits, rider earnings, formula version and reservation timeout instead of inheriting invented launch values.
- Added package dimensions, weight, preparation time and bicycle-delivery eligibility to products.
- Added delivery-zone operating-hours, package-limit, rider-earning formula and reservation-timeout fields without inventing launch policy values.
- Added immutable recipient/contact/location snapshots to orders and a new transactional `create_store_order_v2` function.
- Added an append-only order-status timeline with backfill for existing orders.
- Added verified-purchase product reviews through a restricted database function.
- Added institution-scoped refund records and append-only refund events for the later finance workflow.
- Added explicit pricing-formula references. New Phase 3 orders are marked `UNCONFIGURED`, and store payment initialization and webhook fulfilment refuse them until an approved pricing and settlement policy is implemented.
- Revoked public execution on the legacy and Phase 3 order functions and public access to the new sensitive tables.

## API and contract changes

- Store checkout now requires recipient name, Nigerian E.164 phone number, precise delivery location and optional landmark/coordinates.
- `GET /v1/student/store` can return `catalogueMode: "DEMO"` with `checkoutEnabled: false` while the live Store gate remains closed; the live response declares both fields explicitly as well.
- `GET /v1/student/orders/:id` returns the buyer's order, immutable delivery snapshot, items, timeline and review records after the schema gate is ready.
- `POST /v1/student/product-reviews` accepts one review per delivered product and verifies the purchase inside the database transaction.
- Vendor product submission no longer permits a draft to publish directly.
- `GET /v1/agents/storefront`, `PUT /v1/agents/storefront` and `PATCH /v1/agents/storefront/status` implement the vendor trust-profile workflow.
- `PUT /v1/agents/products/:id` updates material listing data; `PATCH /v1/agents/products/:id/stock` performs an audited optimistic inventory-only update.
- `GET /v1/agents/orders/:id` returns the vendor's scoped order detail, immutable delivery snapshot, line items and status timeline. Unapproved response-deadline policy is returned explicitly as `UNCONFIGURED` rather than a fabricated countdown.
- `POST /v1/admin/operations/products/:id/review` records a scoped, audited moderation decision.
- `POST /v1/admin/operations/storefronts/:id/review` records scoped approval, correction, suspension and return-for-correction decisions.
- The administration operations response includes both Phase 3 moderation queues only after the schema gate is ready.

## Neon rehearsal evidence

- Source branch: production (`br-quiet-butterfly-ayrj264q`).
- Final untouched rehearsal branch: `phase-3-rc2-rehearsal-20260912` (`br-sparkling-moon-ayq31a8y`).
- Applied the exact checked-in migration as 85 statements in one transaction.
- Ran `database/verification/phase_3_commerce_foundation.sql` successfully.
- Ran the self-cleaning `database/verification/phase_3_commerce_acceptance.sql` successfully.
- The acceptance journey proved moderated publication, server-derived totals, atomic stock reservation and rollback, buyer/storefront tenant checks, immutable delivery snapshots, status history, refund history, verified-purchase reviews and material-change re-review.
- Verified that the acceptance transaction left zero fixture products, orders, snapshots, reviews, refunds or universities.
- Captured the database-schema comparison against production. Production was not mutated.
- The 2026-09-13 vendor-operations extension was rehearsed without deleting or resetting any branch because the branch quota was full. The exact 103-statement checked-in migration ran as one transaction on the superseded `phase-3-final-rehearsal-20260912` branch (`br-flat-meadow-aypwwr7d`).
- Both Phase 3 verification files passed again. The acceptance journey additionally proved that an approved storefront's material edit increments its revision, clears review evidence and moves it to `NEEDS_CORRECTION`; zero storefront fixtures remained.
- A second superseded branch exposed an early-draft refund-event shape. The migration now converges that shape by adding and backfilling its tenant column before enforcing the composite tenant key.

## Deliberately still blocked

- The production migration has not been applied and the migration-proof repository variable has not been set.
- The student Store now supports safe browsing and cart testing with the demo catalogue, but does not yet collect the new delivery fields or use a server quote; live checkout must remain disabled until the Phase 3 checkout UI slice lands.
- Cloudflare R2 upload, validation and image processing are not connected.
- The vendor image field accepts only a temporary URL workflow; managed upload remains visibly unavailable until R2 credentials, type/size policy and optimization are reviewed.
- Zone hours and package limits are stored but not yet enforced during quote/job allocation.
- Reservation timeout/requeue behavior, delivery incidents and support overrides are not implemented.
- Commission, payment-fee treatment, rider earnings, refund rules and payout rules have no approved values. `UNCONFIGURED` remains a hard payment block.
- Paystack server-side transaction verification, live reconciliation, refunds and reversing ledger entries remain Phase 3 finance work.
- No persisted vendor, rider, product, order or payment pilot data was added to production; the demo catalogue is deterministic application data and can be removed with one runtime flag.
- The local portal could not be opened by the isolated cloud browser because localhost navigation is blocked. Production build, strict TypeScript and lint checks passed; a deployed-preview visual pass remains required before activation.

## Next build slice

Build the server-authored quote and complete the student checkout form, then connect reviewed R2 image upload and enforce zone/package eligibility during quote and job allocation. No public Store activation should be considered until those controls, commercial policy values and a deployed-preview acceptance pass are complete.
