# Tutor commerce and fee-policy continuation

The earlier repair branch had resource uploads and scheduled bookings, but no paid-material entitlement or renewable tutor package. Requirements 52–54 and 115–116 now have connected database, API and client implementations.

- Approved tutors can offer 1–366-day packages and private PDFs, notes, audio or video. Checkout recomputes the price, keeps the accepted fee version, reserves package capacity and uses the existing Paystack adapter with bounded initialization, request limits and payment kill switch.
- Signed, matching NGN payment events activate purchases. Row locks, payment references and journal idempotency prevent duplicate access or money movement. Late, cancelled or mismatched events enter finance review. Redirecting from checkout never grants access.
- Student learning purchases and tutor learner screens show access dates and earnings. Renewals extend the paid period. Tutor threads reuse general messages, private media, read receipts and blocking. Both API and database reject sends after expiry; signed attachment access is rechecked. Historical messages remain readable.
- Fee rules are append-only, scoped by university, effective-dated and optionally zone-specific. Integer kobo calculations use flat + rounded basis points with explicit bounds. No business rates are seeded. The admin Fees screen records versions and reasons. Checkout, tutor net earnings, rider net earnings, withdrawal quotes and journals use these snapshots.
- Store checkout collects the required recipient and delivery details and displays final fees before payment. Published campus pickup/delivery coordinates produce a labelled straight-line map estimate; missing coordinates use the configured zone fallback. Changing a vendor pickup map point requires renewed storefront review.
- Withdrawal requests reserve gross earnings before review; bank net and fees are shown separately. Rejections reverse reservations with new journal entries. Failed/uncertain withdrawals remain reserved. This does not implement or claim a live provider transfer.
- Learning disputes pause access and reserve earnings. Unpaid reservations expire automatically. Undisputed digital earnings become available seven days after purchase, and package earnings seven days after the purchased access ends. Finance can inspect disputes; provider refunds still require the existing controlled review process.
- The obsolete hardcoded launch commission helper was removed. Broadcast eligibility now rechecks active agent membership, preserving financial tenant history when a student changes campus.

## Migration ordering

The schema-only test/rehearsal baseline was missing `20260912200000_phase_3_commerce_foundation.sql`. It is now an explicit prerequisite in the test database helper and was applied in the isolated rehearsal. Apply it before the three continuation migrations when absent. Do not silently skip it.

The continuation adds `20260926230000_tutor_commerce.sql`, `20260926240000_commerce_fee_snapshots.sql` and `20260926250000_campus_delivery_quotes.sql`. The generated order total expression requires PostgreSQL 17 or newer; rehearsal used Neon PostgreSQL 18.6. Existing rows keep their amounts because the new buyer fee defaults to zero. The generated-column change rewrites the table; schedule production migration appropriately. Deploy the schema before the new Worker and clients.

## Verification

- Server: 422 tests in 42 files passed, including 15 commerce tests covering payments, replay, ownership, mismatches, expiry, renewal, capacity, fees, stored price versions, actual order creation, rider journals, withdrawal reservations and map estimates.
- Mobile type check and web export passed; portal lint, types and production build passed.
- All 38 migrations applied in the isolated rehearsal database. The Neon smoke test exercised pricing, denied unpaid resource access, settled a paid resource, checked balanced entries and retried the webhook without a duplicate journal. All synthetic rows rolled back: zero users, purchases, fee rules and journals remained.
- Verification sources: `server/tests/tutor-commerce.test.ts`, `database/verification/tutor_commerce_20260926.sql`, and the updated rehearsal JSON.
- App version is 0.3.1 / Android build 31. The Android workflow runs when this branch is pushed; its final result is recorded in the user-facing TXT report.

Production has not been promoted. Real fee-policy configuration, payment-provider operation, domain/push configuration and physical Android acceptance are separate release gates. No rates, live charges, payouts or external email messages were created during this continuation.

The existing production evidence guard now includes every September 26 migration. Rehearsal evidence cannot satisfy it; no production attestation was manufactured.
