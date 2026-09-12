# Phase 2 learning pilot handoff

Date: 2026-09-12
Release candidate: `0.2.0`
Release mode: controlled, free tutorial pilot
Pilot university: University of Benin (`university-of-benin`)
Support owner: existing platform administrator (`igiehongideon52@gmail.com`)

## Delivered scope

- Student tutorial discovery with search, tutor/session cards, availability, free booking, cancellation, completion confirmation, verified-purchase reviews, and full loading/empty/error states.
- A learning library for past questions, notes, PDFs, and audiobooks with filters, previews, access rules, and honest demo labels.
- Tutor drafts for tutorials and learning materials, administrator moderation before publishing, availability management, bookings, completion, and reviewed no-show reports.
- An administrator Tutorials workspace for moderation, individual removal, and one-click creation/removal of four demo tutorials and five demo materials per university.
- Demo removal is reversible at the catalogue level and preserves audit, booking, review, and payment history. Future demo bookings are cancelled safely.
- Tutorial, Store, Logistics, and Payments are independently gated. Tutorials are enabled for the controlled production pilot; Store, Logistics, Marketplace, and Payments remain off.
- Payment attempts are idempotent and auditable for later activation; free pilot bookings bypass Paystack entirely.
- Native rotating refresh tokens are persisted with encrypted device storage; web sessions continue to use secure HttpOnly cookies.

## Zero-cost pilot boundary

The controlled demo does not require SMS, WhatsApp, automated NIN/BVN checks, paid KYC, Paystack, or object storage. Email verification remains required for account security and can use the existing Resend setup. Demo resources are useful text previews; real private files wait for managed object storage.

Tutor approval during this pilot is manual and must remain limited to the named test cohort. An administrator records the evidence and decision; the UI never presents a demo tutor as identity-verified.

## Approved pilot policy

- Manual tutor review is limited to the named UNIBEN pilot cohort. Every approval or rejection requires an administrator note and is written to the audit trail.
- A paid tutorial or material must not be approved while payments are disabled. The seeded pilot catalogue is free (`NGN 0`) and visibly marked as demo content.
- A student cancellation requires a reason and must be submitted before the listing cutoff. The normal default is two hours; seeded demos use a zero-hour cutoff. Free or unpaid bookings cancel immediately.
- A no-show can be reported only once, after a confirmed session ends. It opens a support dispute and reserves any potential earnings instead of paying them automatically.
- Removing demo content archives the catalogue, cancels future active demo bookings, and preserves booking, review, payment, dispute, and audit history. The administrator can seed the catalogue again.

## First administrator access

- Current portal URL: `https://kampusone-platform-preview.vercel.app/admin`.
- Intended custom URL: `https://admin.kampusone.app` after its route is attached; it is not the current sign-in URL.
- Sign-in identifier: email; there is no separate username.
- Existing deployment: use the already provisioned platform-administrator email. If its password is unknown, choose **Forgot your password?** and use the code delivered to that mailbox.
- Fresh deployment: set `INITIAL_ADMIN_EMAIL`, register and verify that mailbox, then choose **Activate this verified account**. This audited action works only while no operator role exists.
- Passwords are created or reset privately by the mailbox owner. No shared or hard-coded administrator password exists.

## Production activation record

1. Created rehearsal branch `phase-2-rehearsal-20260912`, applied `database/neon/migrations/20260912000000_phase_2_learning_pilot.sql`, and passed the complete acceptance journey.
2. Created untouched rollback branch `pre-phase-2-production-20260912` at the production pre-migration point.
3. Applied the exact reviewed migration to the protected production branch and verified its tables, constraints, functions, and restricted grants.
4. Seeded four free demo tutorials and five preview-only demo materials for UNIBEN under the platform administrator, with an audit event.
5. Recorded `PHASE_2_MIGRATION_20260912_READY=true` as a GitHub repository variable and enabled the production schema/tutorial bindings in the reviewed release.
6. Kept `PAYMENTS_ENABLED=false`, `STORE_ENABLED=false`, `LOGISTICS_ENABLED=false`, and `MARKETPLACE_ENABLED=false` for the free pilot.

## Remaining owner requirements

- Complete the final sign-in, tutorial, cancellation, and secure-token test on a physical Android phone.
- Add the small named student/tutor pilot cohort in UNIBEN and remove the seeded demos whenever they are no longer useful.
- Retain access to the administrator mailbox and monitor the support/dispute queue during the pilot.
- Real study files and managed private storage only when moving beyond preview-only demo materials.
- Keep payments off until Paystack live reconciliation, refund, dispute, and finance acceptance are separately approved.

## Verification record

- Contracts and Worker unit suites pass, including feature-gate and authentication coverage.
- Contracts, Worker, Expo, and portal TypeScript checks pass; portal lint also passes.
- The production portal build and Expo web export pass, including Tutorials, Purchases, Agent, Admin, and payment-return routes.
- The Worker production configuration bundles successfully in dry-run mode. Unit coverage proves Tutorials can be enabled only when the schema-ready binding is true; Store, Logistics, Marketplace, and Payments remain safely disabled.
- The actual Phase 2 migration passes an isolated PostgreSQL-compatible acceptance harness covering demo seed/removal, immediate free booking, staged email verification, and duplicate live-checkout prevention.
- The same reviewed migration is applied to production. Production contains four free demo tutorials, five preview-only demo resources, and no Phase 2 payment attempts.

Record the commit SHA and hosted CI run after the push. Custom-domain routing and physical-device Android acceptance remain separate deployment evidence; the current administrator URL stays `https://kampusone-platform-preview.vercel.app/admin` until the custom domain is attached.
