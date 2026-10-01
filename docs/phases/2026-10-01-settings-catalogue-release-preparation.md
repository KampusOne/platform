# Account settings, original introduction art and release preparation

Historical preparation checkpoint; its migration/capacity blockers are superseded by `docs/phases/2026-10-01-live-migration-rollout.md`. All 41 reviewed versions have since succeeded on the production child and production; deployment and the updated APK remain pending. The observations below retain the earlier pre-rollout state.

Code was prepared locally on `feat/business-platform-20260930`. The October 1 live recheck still finds nine registered migration versions. No production migration, source publication, Vercel/Worker deployment, repository visibility change, branch deletion or APK build was performed in this update.

## App changes

- Settings now opens Account manager instead of displaying Delete account. Account manager opens Profile settings, which contains Personal details, Data and privacy, and Account ownership. Delete account appears only on the Account ownership screen; the existing email code and typed DELETE confirmation remain required.
- Three original transparent character illustrations replace the reused introduction/agent artwork. One new student plans with a notebook, waves with a phone, and gathers a campus purchase. The three introduction pages retain Skip, Back, Next, short accessible captions and saved first-install completion. Final asset sizes are 154,983, 107,278 and 171,964 bytes (434,225 bytes total); all are 600 × 900 PNGs.
- The institution list and the selected university's academic structure use separate state. Refreshing institution identities cannot erase loaded faculties/departments, and an obsolete university response cannot replace the current selection. Department/programme options require their selected parent. Normal completion requires the matching structure; the existing missing-faculty submission path remains available when an institution lacks sourced data.

## Live evidence and migration preparation

Neon project `rough-breeze-36415261`, production `br-quiet-butterfly-ayrj264q`, database `neondb` was read at `2026-10-01T02:31:52.343541+00:00`. All nine registered source hashes still match. The inventory now contains 66 source versions: nine registered, 44 older unregistered, and thirteen new queued versions. There are no unknown ledger versions.

Production contains 328 active universities. Only UNIBEN currently has academic children: two faculties and five departments. The missing academic-structure migration explains the empty onboarding lists.

An offline PostgreSQL rehearsal restored the freshly exported production table/type/constraint/index/function/trigger structure, plus **public academic catalogue records only**. It applied forty candidate versions in order with matching SHA-256/git-blob hashes. It did not copy customer accounts, profiles, chats, orders, identity evidence, or media rows; it does not prove cloud/live-data readiness.

| Coverage after offline rehearsal | Result |
| --- | ---: |
| Institutions retained | 328 |
| Institutions with faculties | 239 |
| Institutions with departments | 62 |
| UNIBEN faculty/school units | 21 |
| UNIBEN departments | 150 |

Existing UNIBEN UUID `6a79211e-6e85-4d95-be24-976edb26ba58` is retained. Integration tests also preserve legacy institution slugs, academic IDs and student selections across repeat imports, and switch between UNIBEN and FUT Minna without mixing their children. Nationwide department coverage is incomplete; missing records continue through the submission/review workflow rather than invented academic data.

Two older migrations need compatible prerequisites instead of bulk replay:

| Original version | Observed conflict | Replacement |
| --- | --- | --- |
| `20260925110000_notification_sound_catalogue` | Its older media-kind constraint rejects the ten message attachments already in production | `20260930190000_live_legacy_prerequisites` adds sound tables/indexes/RLS without changing existing media kinds |
| `20260928120500_profile_activity_dismissals_and_demo_retirement` | Its retirement writes would cancel six existing pending/confirmed demo bookings | The same replacement adds dismissal tables/indexes/RLS without cancelling bookings or changing earnings |

The original sources remain unchanged and are not falsely registered as applied. Fifteen earlier unregistered baseline versions remain preserved for structural/signature review; the rehearsal does not replay them. The candidate source list and limitations are in `database/verification/2026-10-01-offline-live-schema-rehearsal.json`. The fresh metadata-only schema and read-only reconciliation are `2026-10-01-live-schema-refresh.json` and `2026-10-01-migration-reconciliation-refresh.json` in the same directory.

Read-only default reconciliation now uses the manifest's latest schema snapshot:

```sh
node database/neon/reconcile-migrations.mjs
```

The reusable offline runner is `server/scripts/rehearse-live-schema.mjs`. It requires externally saved schema/catalogue JSON and an output path; the read-only export queries are `database/neon/export-rehearsal-schema.sql` and `export-rehearsal-catalogue.sql`. Keep raw schema exports outside the repository. Never use offline results as production promotion proof.

## Deployment preparation

The connected Vercel project is `kampusone-platform-preview` (`prj_wFG0WNwuVWk522AL6ocICvgGw2x4`), team `team_abQOZYY74aXZM3GdxfmQWmxP`. Its production deployment `dpl_EeFQgrfdEj4BDJhgAeR5etRYnF89` serves old main `f8f2f5b312a7793ec938439c97080a94760cfe87`. `agents.kampusone.app` is attached; the intended anonymous admin hostname is absent from that project's domain list.

The observed existing agent hostname is `agents.kampusone.app`. The transcribed `agent.totscampus1.app` was not substituted for an owned deployment domain without evidence.

- Worker origins now include the intended anonymous admin hostname instead of the legacy admin hostname.
- Portal configuration documents its server-only Worker upstream; production clients keep the same-origin `/api` proxy.
- A new platform proof guard requires exact source hashes, a separate rehearsal branch rooted in current production, preserved account/media/booking evidence and private privilege checks. It rejects the offline report. The production proof file is deliberately absent until actual verification succeeds.
- The Worker release is serialized. Client/portal changes trigger that release; the Vercel workflow follows its successful release and checks out the same commit. Its explicit manual path also requires verified production evidence. Portal type/lint checks run before deployment, then the agent and anonymous admin aliases are assigned. Mobile web preview follows the portal job.
- No financial gate was enabled. Encryption, GA4 service access, real email/push delivery, fee-policy reconciliation and native acceptance remain separate live prerequisites described in the earlier phase records.

## Verification

- Full server regression: 509 tests in 54 files pass, including the three new academic migration/API integration tests. Five deployment-proof tests pass separately after the guard change (two additional tests).
- 130 root regression tests and eleven post-link tests pass.
- Server/mobile/portal type checks, server build, portal lint and production build pass. Portal generates 28 static pages; mobile production web export generates 91 routes including the two new settings screens.
- Both edited deployment workflows parse as YAML. Source whitespace and JavaScript syntax checks pass.
- Final illustration assets were visually inspected. Browser/native journey acceptance is still pending; build success does not establish camera, gesture, App Links, email, push or live payment behaviour.

## Live blockers and next action

1. Neon refused creation of `platform-update-rehearsal-20261001` with `branches limit exceeded`. All ten project branch slots are occupied, including archived rehearsal branches. The proposed slot to free is archived `phase-3-rehearsal-20260912` (`br-gentle-art-ayea2p50`). The Neon delete-branch tool explicitly says **"Delete a branch and all its data. NEVER run autonomously; always ask the user first."** No branch was deleted. Obtain approval for that specific deletion, create a fresh production child, and rehearse the forty candidates plus data/permission acceptance on that child before promotion.
2. Automatic approval review previously rejected publishing this branch to public `KampusOne/platform`, because the source/migration payload and public destination were not explicitly authorized. Do not retry or bypass that rejection. The owner subsequently declined a visibility change and explicitly keeps the repository public. Honor that preference; any renewed publication must resolve the actual public-payload approval. GitHub documents public repositories as accessible to everyone on the internet, so a guarantee that Meta AI cannot discover/read this public source is unavailable. The app/portal/Worker source review found no repository links in product code; portal metadata already requests `index: false, follow: false`. These website settings do not restrict `github.com`. Reference: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories .
3. Vercel's deployment connector returned `UNAVAILABLE` (`deploy_to_vercel` not returned by tools/list); the local Vercel CLI is not authenticated/available and Wrangler reports unauthenticated. Existing GitHub deployment workflows are the prepared path after authorized source publication, live proof and provider configuration. No browser/session fallback was used without approval.

The user has already requested necessary migration execution and deployment. These blockers concern deleting an existing branch and publishing to the repository destination, not a request to repeat migration/deployment authorization.

Hold the updated APK until the reviewed backend/portals are deployed and smoke-tested. The existing GitHub Android workflow can build an installable test APK from updated source using Expo-generated test signing; it does not require EAS to compile that artifact. An owned EAS project ID is needed for Expo push registration, and a real release/upload keystore is needed for Play Store distribution. No updated APK exists in this checkpoint.
