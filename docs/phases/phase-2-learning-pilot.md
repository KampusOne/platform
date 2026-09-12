# Phase 2 learning pilot handoff

Date: 2026-09-12
Release candidate: `0.2.0`
Release mode: controlled, free tutorial pilot

## Delivered scope

- Student tutorial discovery with search, tutor/session cards, availability, free booking, cancellation, completion confirmation, verified-purchase reviews, and full loading/empty/error states.
- A learning library for past questions, notes, PDFs, and audiobooks with filters, previews, access rules, and honest demo labels.
- Tutor drafts for tutorials and learning materials, administrator moderation before publishing, availability management, bookings, completion, and reviewed no-show reports.
- An administrator Tutorials workspace for moderation, individual removal, and one-click creation/removal of four demo tutorials and five demo materials per university.
- Demo removal is reversible at the catalogue level and preserves audit, booking, review, and payment history. Future demo bookings are cancelled safely.
- Tutorial, Store, Logistics, and Payments are independently gated. The Phase 2 code is complete, while its production Tutorial switch remains off until the reviewed schema migration is promoted.
- Payment attempts are idempotent and auditable for later activation; free pilot bookings bypass Paystack entirely.
- Native rotating refresh tokens are persisted with encrypted device storage; web sessions continue to use secure HttpOnly cookies.

## Zero-cost pilot boundary

The controlled demo does not require SMS, WhatsApp, automated NIN/BVN checks, paid KYC, Paystack, or object storage. Email verification remains required for account security and can use the existing Resend setup. Demo resources are useful text previews; real private files wait for managed object storage.

Tutor approval during this pilot is manual and must remain limited to the named test cohort. An administrator records the evidence and decision; the UI never presents a demo tutor as identity-verified.

## First administrator access

- Current portal URL: `https://kampusone-platform-preview.vercel.app/admin`.
- Intended custom URL: `https://admin.kampusone.app` after its route is attached; it is not the current sign-in URL.
- Sign-in identifier: email; there is no separate username.
- Existing deployment: use the already provisioned platform-administrator email. If its password is unknown, choose **Forgot your password?** and use the code delivered to that mailbox.
- Fresh deployment: set `INITIAL_ADMIN_EMAIL`, register and verify that mailbox, then choose **Activate this verified account**. This audited action works only while no operator role exists.
- Passwords are created or reset privately by the mailbox owner. No shared or hard-coded administrator password exists.

## Safe activation order

1. Create a branch from production and apply `database/neon/migrations/20260912000000_phase_2_learning_pilot.sql` using the direct, non-pooled `DATABASE_URL_UNPOOLED`.
2. Run the migration and acceptance checks on that isolated branch, including seed → browse → book → cancel/complete → review → remove-demo journeys and cross-university rejection.
3. Approve and apply the exact migration to production before deploying the new Worker.
4. Set the GitHub repository variable `PHASE_2_MIGRATION_20260912_READY=true`, then change both runtime bindings `PHASE_2_SCHEMA_READY` and `TUTORIALS_ENABLED` to `true` in the reviewed release and run **Deploy Worker**. CI rejects that activation while the migration proof variable is absent.
5. Confirm Resend email delivery, recover or activate the administrator as appropriate, and load the demo catalogue from **Admin → Tutorials**.
6. Keep `PAYMENTS_ENABLED=false`, `STORE_ENABLED=false`, and `LOGISTICS_ENABLED=false` for the free pilot.

## Owner requirements before activation

- Access to the assigned administrator mailbox, plus the existing Resend API key and verified sender. `INITIAL_ADMIN_EMAIL` is needed only for a fresh database with no operator roles.
- Permission to create/test a Neon branch and approve the production migration.
- The pilot university and test-student/tutor list.
- One named administrator/support owner and an approved manual tutor-review, cancellation, and no-show policy.
- Real study files and managed private storage only when moving beyond preview-only demo materials.

## Verification record

- Contracts and Worker unit suites pass, including feature-gate and authentication coverage.
- Contracts, Worker, Expo, and portal TypeScript checks pass; portal lint also passes.
- The production portal build and Expo web export pass, including Tutorials, Purchases, Agent, Admin, and payment-return routes.
- The Worker production configuration bundles successfully in dry-run mode with Phase 2 schema access, Tutorials, Store, Logistics, and Payments safely disabled. Unit coverage also proves Tutorials can be enabled only when the schema-ready binding is true.
- The actual Phase 2 migration passes an isolated PostgreSQL-compatible acceptance harness covering demo seed/removal, immediate free booking, staged email verification, and duplicate live-checkout prevention.

Record the commit SHA and hosted CI run after the push. Production database migration, live email receipt, custom-domain routing, physical-device secure-storage checks, and authenticated end-to-end acceptance remain deployment evidence and require the corresponding owner accounts.
