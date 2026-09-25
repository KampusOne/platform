# September 25 reconciled correction release

This branch has not been deployed to the production Worker or had its schema migrations applied to the production database. The explicitly requested UNIBEN profile/programme maintenance was applied and audited; see `september-25-handoff.md`. A ready frontend deployment does not establish backend readiness. Do not merge until the schema and provider acceptance gates below have evidence.

## Database order and protection

Review the 20 migration files in `groups.corrections` in `server/scripts/verify-schema-proof.mjs`; apply only missing versions and the explicitly changed timetable-import function in filename order to an isolated test database based on the existing schema, using the existing secret connection configuration. The repository's PGlite tests run the same migration files against the schema-only snapshot. They are not a live Neon migration rehearsal.

The connected Neon free project has all ten branch slots occupied. No existing branch was repurposed or deleted. Provision an appropriate isolated staging target or deliberately release a branch slot after inspecting ownership. Do not run an unreviewed migration directly on production to avoid that limit.

After staging verification and the required production migration approval, apply the exact reviewed files through the established migration process. Record the target project, branch and database; approval identity/time; file Git blob hashes; checks; verification time; and rolled-back verification fixtures in `database/verification/production-20260921-corrections.json`. The checker validates the declared production target, approval before verification, `checks.corrections: "passed"`, `checks.fixturesRolledBack: true`, and every migration hash. It validates an operator attestation, not independent live database evidence. Never generate a passed attestation from local tests alone.

The Worker deployment workflow always executes `node server/scripts/verify-schema-proof.mjs corrections`. Old phase flags or the September 20 proof cannot bypass it. Until reviewed production evidence exists, this guard intentionally rejects deployment. No extra environment variable is required for the new guard.

The new permissions, AI, source-review, notifications, broadcasting and payout handlers use the added tables. Frontend previews connected to the old Worker are not functional end-to-end previews of these changes. Release the backend after schema validation, then deploy the matching mobile/portal commit and verify the actual target URLs.

## Academic data

Run `node server/scripts/import-academic-sources.mjs --dry-run` first. The importer can stage the 530 documented claims with `--apply --environment staging` once its target is independently checked. The environment label does not select a database. Staging does not publish any institution, programme or rule.

Use the authorized source workspace to review institution identities against primary sources, link duplicates or reject claims. Guidelines require source provenance, applicable scope and explicit human publication. Resolve the BUK, UNIBEN and Babcock conflicts before publication. The scoped faculty/department/programme/duration editor is implemented; nationwide source normalization and publication remain incomplete; source coverage must not be described as a complete Nigerian academic catalogue.

## Provider and device checks

- Configure only the new keys in `example.env.txt`; preserve existing secrets. Validate the selected Hugging Face hosted model against representative text and images. Check Hugging Face study, persisted history, allowance exhaustion, retry and source deletion using a controlled account.
- Enable Google and Apple in the existing Supabase project with the actual provider credentials and reviewed web/native callbacks. Both were disabled during the live read-only audit.
- Configure the signed Resend delivery-event endpoint, legitimate sender/reply handling and campaign controls. Test one explicitly selected account before a separately authorized reviewed audience. No live message was sent during this change.
- Register a real supported native build and device. Record permission, build, session, provider ticket, receipt and recipient observation. A mocked request or Expo receipt alone is not device delivery.
- Resolve payout details only for an approved agent through the secure form. Provider account-name resolution is not proof of ownership. Finance review and the existing identity gates remain required. No live money movement was authorized or tested here.
- Verify marketplace and seller inventory using genuine records, then consider existing feature controls. Do not enable dormant features simply because their UI builds.

## Acceptance evidence still needed

Run the master brief's fourteen cross-surface journeys in staging and then the approved production smoke scope. Include a non-UNIBEN account, finance-only staff, denied university access, actual storage upload/video playback, expiry/revocation, slow/offline recovery and small-screen keyboard use. The local browser tool could not reach localhost; no authenticated visual acceptance is claimed. Source tests and build checks are recorded separately.

Rollback application versions before any schema downgrade. Retain additive source/audit/history records; do not drop tables or alter genuine user records as a blanket rollback. Any production demo cleanup requires an exact record manifest and backup before an irreversible operation.

## New September 25 checks

The release group now includes calendar events, campus/place hierarchy, notification sounds, community push delivery records and programme metadata. The historical `production-20260921-corrections.json` filename is retained by the guard; its required hashes include all 20 current files. Previously applied feed migrations must be verified and recorded, not blindly reapplied.

Test the provided academic calendar as dated events, not classes. Recheck restored AI threads and follow-up questions, video seek on web/native, public CGPA opt-in, comment/reply navigation, transparent Following state, latest profile repost privacy, semester reopen/removal, source-article images and university-scoped admin reports. Verify browser alarm limitations and native permissions on the target build.
