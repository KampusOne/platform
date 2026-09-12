# Phase 3 commerce foundation handoff

Date: 2026-09-12
Target release: `0.3.0`
Release mode: controlled UNIBEN Store and bicycle-logistics beta
Tracker status: `IN_PROGRESS`
Production activation: **not authorized and not performed**

## Delivered in this slice

- Added the independent `PHASE_3_SCHEMA_READY` runtime gate. Store and Logistics now require both their own feature flag and the reviewed Phase 3 schema binding.
- Kept production and staging `PHASE_3_SCHEMA_READY`, Store, Logistics, Marketplace and Payments bindings off.
- Added a deployment guard that requires `PHASE_3_MIGRATION_20260912_READY=true` before the schema binding can be enabled.
- Kept existing Phase 2 administration compatible before the Phase 3 migration is applied; new administrative reads and mutations are schema-gated.
- Replaced direct first publication with `DRAFT → SUBMITTED → PUBLISHED / NEEDS_CORRECTION / REJECTED` moderation. Publication requires an active vendor, approved category, complete bicycle-package data and a documented operator review at the current listing revision.
- Added a database guard that allows stock-only changes without re-review and automatically removes a published product from sale after material listing changes.
- Added institution-scoped vendor storefront and product-media foundations. Store discovery requires an approved storefront as well as an approved product.
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
- `GET /v1/student/orders/:id` returns the buyer's order, immutable delivery snapshot, items, timeline and review records after the schema gate is ready.
- `POST /v1/student/product-reviews` accepts one review per delivered product and verifies the purchase inside the database transaction.
- Vendor product submission no longer permits a draft to publish directly.
- `POST /v1/admin/operations/products/:id/review` records a scoped, audited moderation decision.
- The administration operations response includes the Phase 3 product-review queue only after the schema gate is ready.

## Neon rehearsal evidence

- Source branch: production (`br-quiet-butterfly-ayrj264q`).
- Final untouched rehearsal branch: `phase-3-rc2-rehearsal-20260912` (`br-sparkling-moon-ayq31a8y`).
- Applied the exact checked-in migration as 85 statements in one transaction.
- Ran `database/verification/phase_3_commerce_foundation.sql` successfully.
- Ran the self-cleaning `database/verification/phase_3_commerce_acceptance.sql` successfully.
- The acceptance journey proved moderated publication, server-derived totals, atomic stock reservation and rollback, buyer/storefront tenant checks, immutable delivery snapshots, status history, refund history, verified-purchase reviews and material-change re-review.
- Verified that the acceptance transaction left zero fixture products, orders, snapshots, reviews, refunds or universities.
- Captured the database-schema comparison against production. Production was not mutated.

## Deliberately still blocked

- The production migration has not been applied and the migration-proof repository variable has not been set.
- The existing student Store screen does not yet collect the new delivery fields or use a server quote; it must remain disabled until the Phase 3 checkout UI slice lands.
- The existing agent portal still needs storefront setup, full package editing, submit-for-review feedback and correction handling.
- The admin portal still needs the visual product-moderation queue and storefront review workflow.
- Cloudflare R2 upload, validation and image processing are not connected.
- Zone hours and package limits are stored but not yet enforced during quote/job allocation.
- Reservation timeout/requeue behavior, delivery incidents and support overrides are not implemented.
- Commission, payment-fee treatment, rider earnings, refund rules and payout rules have no approved values. `UNCONFIGURED` remains a hard payment block.
- Paystack server-side transaction verification, live reconciliation, refunds and reversing ledger entries remain Phase 3 finance work.
- No vendor, rider, product, order or payment pilot data was added to production.

## Next build slice

Build P3.2 vendor operations and moderation UI: storefront setup, product edit/package fields, submit/correction states, stock-safe updates, and the administrator product/storefront review queue. After that, implement the server quote and complete the student checkout form before any public Store activation is considered.
