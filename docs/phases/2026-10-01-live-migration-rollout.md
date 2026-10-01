# Live migration rollout and ordered release

The reviewed database rollout is complete. On 1 October 2026, all **41 selected migration versions** succeeded first on a fresh production child and then on production. Production now has **50 registered versions**, all matching the original source hashes. The updated application code, Vercel portals and APK have not yet been published or deployed.

This record supersedes the earlier nine-version, branch-capacity and offline-only checkpoints. It does not claim that all 67 historical source files were executed or that provider/device acceptance is complete.

## Approval and production rehearsal

The owner's “I approve / Continue” authorized deletion of archived `phase-3-rehearsal-20260912` (`br-gentle-art-ayea2p50`). Its production parent was rechecked; it was neither primary nor default. Deletion freed one of the ten branch slots. No production branch was deleted.

The new `platform-update-rehearsal-20261001` child (`br-fragrant-paper-ayq7ay0y`) was created at `2026-10-01T03:22:28Z` from production `br-quiet-butterfly-ayrj264q`, project `rough-breeze-36415261`, database `neondb`. It remains available for evidence. A compute suspend override was rejected by the plan before creation; the successful request used project defaults.

Each selected migration used its unchanged source SQL and exact git-blob/SHA-256 hashes. The SQL statements and the corresponding `app_private.schema_migrations` row committed in one Neon transaction. `server/scripts/migration-statements.mjs` separates actual SQL commands while preserving quoted strings, comments and dollar-quoted function bodies; it removes only the original transaction wrapper before the transaction API supplies that boundary. A rejected multi-command prepared statement made no changes.

## Verified database state

| Check | Production result |
| --- | --- |
| Registered versions before / after | 9 / 50 |
| Newly applied reviewed versions | 41, all successful on rehearsal and production |
| Original source matches / unknown ledger versions | 50 / 0 |
| Original tables checked / unchanged | 91 / 86 |
| Preserved users, profiles, media and tutorial bookings | 14 users, 14 profiles, 74 media objects, 6 bookings |
| Expected changed original tables | Campus places, departments, faculties, institution configuration and university metadata |
| Private PUBLIC/client grants | None on private schema, tables or functions |
| Constraints / definer search paths | All constraints validated; no unsafe definer search paths |
| Commerce structure and behavior acceptance | Passed on both branches |
| Journal/receipt idempotency, append-only and deferred-balance acceptance | Passed on both branches; synthetic fixtures rolled back |
| Existing live API readiness after migration | `/health/ready` reports ready; anonymous account route returns 401 |

Preservation fingerprints use every original table's original column tuple, sorted row hashes and counts. They do not export customer rows. The only five expected original-table changes publish the academic/map catalogue; the other 86 fingerprints match, including account, message, booking and financial data. Acceptance fixtures left no persistent rows.

The added `20261001030000_server_only_private_privileges.sql` revokes default PUBLIC execute privileges and private schema/table/sequence access, including future function defaults and any existing client roles. It changes no customer records and retains owner/runtime authority. SHA-256: `f0cdebbd2a5c614fd56606f44f0adf43b40c8ba1d4bc8e6cda774b10f440d70b`.

## Inventory reconciliation

The inventory has **67 sources**: 50 genuinely registered, 15 older unregistered baseline sources and 2 superseded prerequisites. All 14 sources introduced by this platform update are now registered. No newly introduced migration remains queued.

The fifteen baseline files were not replayed merely because their ledger entries are absent. Their named tables/functions and added columns exist; all 24 effective function references match the trimmed live body hashes of the latest applicable source definitions. Eight already-registered function variants were additionally compared with quoted text preserved; their differences are unquoted case/whitespace. This is structural/effective-source review, not proof that every original historical statement was executed. The baseline versions remain unregistered.

The two original prerequisite sources remain unchanged and unregistered:

| Original source | Reason for compatible replacement |
| --- | --- |
| `20260925110000_notification_sound_catalogue` | Its old media constraint rejects existing message attachments |
| `20260928120500_profile_activity_dismissals_and_demo_retirement` | Its retirement writes would cancel six existing bookings |

`20260930190000_live_legacy_prerequisites` supplies the required sound/dismissal tables, indexes and RLS without those side effects. Neither original file is falsely marked applied. Read-only reconciliation intentionally produces no automatic replay list.

## Academic coverage

Production retains 328 active institutions. Faculties are available for 239 institutions and departments for 62. UNIBEN now has 21 faculty/school units and 150 departments; its existing institution UUID and student references are preserved. The imported catalogue contains 1,451 faculties and 579 departments overall. Missing sourced academic data still uses the submission/review path. The client fixes that preserve institution choices and ignore stale structure responses await app deployment.

## Evidence and checks

- `database/verification/production-20261001-platform.json`: production attestation, exact ledger/source matches, 41 transaction outcomes, preservation fingerprints, permissions, acceptance and limitations; verified `2026-10-01T03:41:22.569Z`.
- `database/verification/production-20260921-corrections.json`: the same current production attestation for the historical corrections guard. The filename identifies the migration group; the evidence timestamp is October 1.
- `database/verification/2026-10-01-live-platform-rehearsal.json`: actual production-child outcomes and checks.
- `database/verification/2026-10-01-production-platform-schema.json` and `2026-10-01-production-platform-reconciliation.json`: fresh metadata-only snapshot and read-only reconciliation at `2026-10-01T03:38:11.641Z`.
- `database/verification/2026-10-01-historical-baseline-review.json`: baseline object/effective-function review and formatting comparisons; no raw function bodies.
- `database/verification/2026-09-30-migration-manifest.json`: current applied/superseded statuses, unchanged source hashes and introduced-version markers.

`verify-schema-proof.mjs platform` passes for 43 required files; `corrections` passes for 20. The complete server regression passes: **513 tests in 55 files**, plus the server type check. This includes the ordered fourteen-version rehearsal, source-splitter and proof guard tests. The settings/catalogue checkpoint retains earlier root/mobile/portal/build results. Release workflow YAML, embedded shell scripts, receipt selection, JSON configuration and source whitespace checks pass.

## Worker → Vercel → APK

Vercel production still serves `f8f2f5b312a7793ec938439c97080a94760cfe87` on project `kampusone-platform-preview`. No application deployment was made during the database rollout. The observed owned agent hostname is `agents.kampusone.app`; the intended administration hostname is `a7f3c9e1b6d2f8a4c5e9b1d7f3a6c2e8.kampusone.app`. The workflow attaches both to the updated portal and checks their responses and API authentication boundary.

The prepared release chain is:

1. Main publication triggers `Deploy Worker`, which checks source, tests, recorded production migration proof, live readiness and authentication.
2. `Deploy verified Vercel surfaces` follows a successful matching Worker run. Manual deployment requires a successful Worker run for the same main SHA. Superseded source is rejected before deployment. Portal and mobile preview use the same checkout and publish a receipt containing the actual deployed source SHA after their smoke checks pass.
3. `Build Android test APK` follows the successful Vercel workflow and downloads that run's receipt. It checks out the receipt's exact SHA, verifies schema/API readiness, then builds and saves the test artifact. Only this verified workflow path can publish `apk-latest`, and only while its source is current main. Manual APK runs save testing artifacts. Historical APK snapshots are left unchanged.

Git auto-deployment is disabled in each application's `vercel.json` so it cannot race the ordered pipeline. The obsolete workflow that republished a hard-coded old APK artifact is removed. Reference: https://vercel.com/docs/project-configuration/git-configuration . Receipt transfer avoids using the default-branch event SHA as a substitute for the actual deployed checkout. The two workflow-run links are within GitHub's documented chaining limit: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run .

The owner explicitly retains the public repository. Automatic approval review previously rejected publication of the source/migration payload to public `KampusOne/platform` because that payload and destination were not explicitly authorized. The latest approval addressed the named Neon branch deletion. Do not bypass or retry the rejected public push until this specific publication is approved. Local commits and the review bundle make the release concrete; publishing the reviewed public main update is the remaining release authorization.

Vercel's deployment connector was unavailable and local deployment CLIs lack authenticated credentials. The existing GitHub CI secrets provide the prepared deployment path after source publication. No credential value is recorded here. No browser/session fallback was used.

## Remaining acceptance

Financial flags remain false; no pricing policy, staff access or publisher authority was seeded. Provider fee policies, verified real payment/transfer/refund behavior, KYC encryption/provider settings, actual receipt/approval email and push delivery, GA4 property access, App Links signing identities and physical camera/draft/gesture/fulfilment acceptance remain separate. API readiness confirms current configuration/database connectivity, not successful delivery through each provider.

The APK workflow can compile a sideload testing APK with Expo-generated test signing. An owned EAS project is still needed for Expo push registration and a real upload/release keystore for Play Store distribution. There is no new APK to install yet, and no public landing-site or repository-visibility change was made.
