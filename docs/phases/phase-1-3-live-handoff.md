# Phase 1–3 implementation and live-launch handoff

Date: 2026-09-10
Release candidate: `0.2.0`

## The honest current state

The app, portals, API, and database workflows are implemented as real, data-backed software. They are not deployed to the production domains from this workspace, and the production Neon branch was not modified. The reviewed migration chain is applied and tested on the isolated branch `br-morning-mountain-aygxgoel` (`codex-live-phase-1-3-20260910`).

No phase should be labelled `LIVE` merely because its screens compile. A phase becomes live only after its provider, policy, content, deployment, and acceptance gates below are satisfied. The release-phase rows deliberately remain `IN_PROGRESS` until that evidence exists.

## Implemented software

### Phase 1 — student utility and administration

- Real registration, Argon2id password storage, Resend email verification, one-time hashed six-digit codes, ten-minute expiry, five-attempt limit, resend cooldown, forgot/reset password, fifteen-minute access tokens, rotating refresh-token families, revocation, and verified-email login guard.
- Atomic OTP consumption and atomic refresh rotation; concurrent reuse cannot create two valid sessions.
- First-run student onboarding tied to a real university profile.
- Today dashboard, social-style verified campus Feed, Campus directory and map handoff, timetable CRUD, GPA/CGPA records, profile, live empty/error/loading states, and a student purchases area.
- Admin user directory, actual record counts, 30-day GMV chart, agent review, content-source verification, feed/place publishing, dispute, payment reconciliation, payout, audit, and release-requirement views.
- One-time administrator bootstrap after ordinary email-verified registration. There is intentionally no hard-coded default administrator password.

### Phase 2 — controlled tutorial pilot

- Agent web sessions use a six-digit email code against the existing verified KampusOne identity; the portal never creates a separate agent account or password.
- Tutor application fields, role terms, layered manual-review records, identity/phone/bank result fields, approval guard, and an audit trail.
- Tutor listings and learning materials with submission, administrator moderation, publishing, pause/archive, and safe removal transitions.
- Future availability windows; the database locks a selected window, enforces server-calculated price and capacity, and rejects duplicate/late bookings.
- A no-cost mode confirms free bookings without Paystack; removable demo sessions and preview materials let the pilot operate before paid providers or object storage.
- Cancellation cutoffs, student/tutor completion confirmation, verified-purchase reviews, no-show review, pending/available earnings, a 48-hour dispute window, dispute freezes, manual payout requests, and finance transitions.
- Paystack payment initialization, immutable idempotent attempts, signed webhook processing, and double-entry ledger records remain implemented but disabled until the paid-flow gate passes.

### Phase 3 — controlled store and bicycle logistics

- Approved/restricted/prohibited product categories and active delivery zones with fees.
- Approved-vendor product drafts and lifecycle transitions, server-validated catalogue fields, and stock tracking.
- Transactional single-vendor checkout, backend totals, row locks, inventory reservation, automatic 30-minute expiry, stock restoration, and payment-anomaly capture for late/unknown/mismatched provider events.
- Vendor order queue and accepted/ready transitions.
- Approved-rider online/capacity presence, single-active-job enforcement, atomic job reservation, separate deterministic six-digit pickup and delivery codes, row-locked five-attempt/expiry controls, timestamped delivery events, completion, rider earnings state, disputes, and payout review.

## Production requirements to provide or approve

### Infrastructure and domains

1. Confirm ownership and DNS access for `api.kampusone.app`, `admin.kampusone.app`, `agents.kampusone.app`, `engineering.kampusone.app`, and the intended email subdomain.
2. Provide the Cloudflare account/project access used for the Worker custom domain and cron trigger.
3. Provide the Vercel team/project and attach the three portal domains.
4. Approve promotion of the ordered `database/neon/migrations/*.sql` files to the protected Neon production branch and name the rollback owner.
5. Provide a pooled production `DATABASE_URL` as a Worker secret.

### Authentication and email

1. Provide `JWT_SECRET` (at least 32 high-entropy characters) and `OTP_PEPPER` (at least 24 high-entropy characters).
2. Verify the Resend sending domain and provide `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `RESEND_REPLY_TO`.
3. Provide a working mailbox for `INITIAL_ADMIN_EMAIL`. The first administrator registers normally, verifies the delivered email code, and activates the account once. A one-use `ADMIN_BOOTSTRAP_TOKEN` is an optional deployment recovery path and must be removed after use.
4. Approve the Terms of Service and Privacy Policy version string now represented as `2026-09-10`.
5. Select the production MFA/step-up provider for administrators and finance/KYC actions. This is a required security gate before broad operator access.

### UNIBEN content and student acceptance

1. Supply the authoritative UNIBEN faculties, departments, courses, places, support contacts, coordinates/hours, and initial campus posts.
2. Name an owner and review date for every official content source and campus record.
3. Nominate a closed-test cohort, support owner, incident contact, and production rollback decision-maker.

### KYC and agent policy

1. Select the phone verification, government-ID/liveness/face-match, and bank-name-resolution providers, or sign off a tightly limited manual pilot policy.
2. Provide minimum age, accepted identity documents, retention/deletion schedule, reverification triggers, rejection/appeal reason codes, and role-specific terms.
3. Approve who may review KYC evidence. Raw NIN/BVN and unnecessary identity images must not be copied into ordinary tickets or application notes.

### Payments, refunds, settlement, and revenue

1. Provide Paystack test/live secret keys, webhook secret, business approval, callback URL, subaccount/transfer-recipient strategy, and live webhook registration.
2. Approve tutorial/store take rates, provider-fee treatment, commissions, taxes, delivery margin, rider earning formula/version, minimum payout, and settlement timing.
3. Approve cancellation, no-show, full/partial refund, late-payment, chargeback, reserve, dispute, and appeal matrices.
4. Name the finance maker/checker roles and daily reconciliation owner. `PAYMENTS_ENABLED` stays false until test transactions reconcile to the ledger and the anomaly/refund runbook passes.

### Store and rider operations

1. Approve the initial product categories, prohibited/restricted goods, product/package size and weight limits, listing moderation rules, and vendor fulfilment SLAs.
2. Provide delivery zones, operating hours, base fees, rider earnings, job-capacity rules, failed-delivery handling, emergency contacts, safety training, insurance position, and incident procedure.
3. Approve whether the controlled beta uses rider self-reservation (implemented) or an operations assignment queue.

### Media, observability, analytics, and mobile release

1. Select object storage/CDN and its trusted upload domains. Current brand scenes are bundled; operator content/product media accepts validated URLs until managed uploads are configured.
2. Select error monitoring, privacy-aware analytics, transactional/push notification providers, retention periods, and alert owners.
3. Provide Expo/EAS organization access, Apple Developer and Google Play accounts, signing credentials, store listings, privacy disclosures, and push credentials.
4. Verify encrypted refresh-token persistence on physical iOS and Android devices before store distribution. The native app now uses the Expo-SDK-compatible `expo-secure-store`; the browser flow uses secure HttpOnly cookies and no plaintext browser storage.

## Features deliberately not represented as complete

The following PRD depth is not hidden behind placeholders and must be scheduled after policy/provider selection: automated KYC/liveness, operator MFA and maker-checker role management, managed media uploads and malware scanning, automated tutorial refunds and paid-resource delivery, multi-vendor cart splitting, product variants/reviews/promotions, automated reversing ledger entries, rider incident/evidence uploads and optional operations assignment, push notifications, product analytics, and the second-campus toolkit.

## Deployment and acceptance order

1. Review this handoff and approve providers/policies.
2. Apply the migration chain to a fresh staging branch and rerun schema, atomic-auth, tutorial-capacity, inventory-expiry, webhook-idempotency, and tenant-isolation tests.
3. Configure staging secrets; verify actual email receipt and that five wrong codes lock the token.
4. Run end-to-end student, tutor, vendor, rider, support, finance, and administrator journeys with Paystack test payments and reconciliation.
5. Promote the exact migrations to production, configure production secrets/domains, bootstrap one administrator, remove the bootstrap secret, and import reviewed UNIBEN content.
6. Keep payments disabled while smoke-testing Phase 1. Enable the tutorial pilot for the approved cohort only after finance/KYC evidence passes; enable store/logistics only after its separate operational gate.
7. Record owners, timestamps, build identifiers, test evidence, and rollback decisions in the release-phase requirements before changing a phase to `LIVE`.

## Verification completed on the isolated branch

- TypeScript checks: contracts, Worker API, Expo app, and Next.js portal.
- Unit tests: contracts and Worker API, including wrong-code hash rejection and separate handoff codes.
- Production portal build and static generation.
- Expo web export covering 32 routes, including auth, Feed, Campus, Tutorials, Store, purchases, timetable, GPA, and profile.
- Cloudflare configuration/type generation and an independent Worker bundle.
- PostgreSQL migration application, function-signature inspection, query-plan checks, and rollback-safe tests proving OTP attempt locking and one-time consumption, single-admin bootstrap, request-rate limiting, tutorial double-booking rejection, expired-order stock restoration, late-payment review routing, atomic payout reservation, and failed-payout balance reservation. The new row-locked rider functions were applied successfully to the isolated branch and still require the full staging journey test with real operator accounts.
