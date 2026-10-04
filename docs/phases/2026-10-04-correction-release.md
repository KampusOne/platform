# October 4 correction release

## Requested behavior

Remove the recurring full-screen failure during messaging, Kira study, feed scrolling, support and updates. Repair document processing and media presentation; simplify Kira checkout, pricing administration and vendor approval; implement community profiles and member posting controls; replace event date/time text entry with supported selectors. Deliver a new Android APK after the matching backend and web release.

## Baseline and package identity

Work starts from main revision `690fc6b283d05b759060220df7c5ca4997c0daae`. The prior release completed Worker deployment, verified Vercel publication and Android packaging; its APK is version 0.3.17, build 47. The correction package is version 0.3.18 with Android versionCode 48 and iOS buildNumber 48.

Read-only live inspection confirmed 84 production migrations through `20261003128000_payment_snapshot_context_eligibility`. The production project is `rough-breeze-36415261`, branch `br-quiet-butterfly-ayrj264q`, database `neondb`. Ten branch slots are occupied. Additive corrections will be rehearsed on the existing isolated October 3 branch `br-mute-sunset-ayzh9xrc`; no branch reset or deletion is part of this release.

## Work status

Three reviewed additive migrations have been rehearsed and committed in two production transactions: payment/community corrections first, then the separately reviewed vendor approval function. The production ledger now contains 87 migrations. Exact source evidence and both transaction observations are recorded in `database/verification/production-20261004-corrections.json`; Worker, Vercel and APK workflows require all three October 4 sources before publication. Deployment and APK packaging remain pending the completed application checks and finalized main revision.

Production verification preserved the original community, membership and post projections, all 14 users and profiles, 105 media records and three Kira checkouts. Two compatible provider profiles were imported from already approved Kira plans while preserving their reviewer, approval time, source and collection rule. No merchant-account setting attestation or money movement was created.

Community verification preserved both existing notification subscriptions and backfilled the existing admin post badge. New followers default to notifications off, while new communities permit member posting until an admin restricts it. The notification opt-in, opt-out and blocked-account fixtures passed in both the isolated rehearsal and production transaction; every fixture row was rolled back before commit. Private schema/relation/routine client grants remain zero, community RLS remains enabled and all constraints are validated.

The reused October 3 rehearsal predates the real production community and some uploads. `2026-10-04-isolated-rehearsal.json` describes that limitation. Separate PGlite tests covered memberships and admin posts seeded before the migration; the production transaction also checked the real existing rows. The proof/source/receipt regression subset passed ten checks.

The third migration added an immutable manual approval history and one atomic approval function. Its rolled-back acceptance fixture verified self-review and stale-revision rejection, minimum age, an explicit owner exception with recorded missing fields, repeat approval idempotency, unchanged bank verification and no fabricated identity record. The genuine two applications, one application-details record, existing verified identity and 419 audit rows retained their full original projections; no application was approved as part of release validation. The payout eligibility function still requires verified banking and does not accept manual approval history as a substitute.

## Publication order

1. Review and rehearse additive SQL changes; verify preservation and access boundaries; record actual production migration evidence after applying the authorized fixes.
2. Complete the relevant TypeScript checks, portal lint/build, mobile web export and meaningful regression checks.
3. Publish the finalized source to main and verify the matching Worker deployment and Vercel production aliases.
4. Let the verified Vercel receipt trigger the Android build. Verify that `apk-latest` targets that source revision and contains the new package version before reporting the APK as delivered.

## Application verification

The baseline native teardown regression reproduces a released Expo video SharedObject access; the corrected feed and full-screen components pass that same SDK cleanup ordering. The fix invalidates native handles during layout cleanup, removes native calls from feed unregistering, and creates playback/recording objects only when needed. The newer `media[]` video source format is accepted alongside legacy posts. Bounded Expo FileHandle reads replace full-file reads for every upload chunk. See `docs/engineering/2026-10-04-native-media-lifecycle.md` for the cause, coverage and device limitations.

Mobile, portal and server TypeScript checks pass. Portal lint and its production build pass; mobile static web export passes. The final broad server run passed 723 tests across 83 files and repository regressions passed 150 tests. Final source extraction, inference recovery and native voice transport received 68 focused passing checks, including actual PDF/TXT parsing and account-owned result replay with a stub provider. These are not claims of a real paid checkout or physical Android testing.

Compiled mobile browser checks at 390px passed 12 flow/screen checks with synthetic API responses: support with incomplete old records, immediate typing with 18 historical voice notes and no eager media resolution, text send, TXT attachment/draft/processing/answer, one copy of each plan and discounted checkout, community follow/notification opt-out/member post/admin restriction, and a selected calendar/time successfully submitted as the expected UTC timestamp. No page error, route boundary or horizontal overflow occurred. Screenshots were visually reviewed. Native media teardown is verified separately by the Expo cleanup-order regressions.

Compiled production portal checks passed eight functional cases at 390px and 1280px with synthetic responses and no live writes: simple payment setup and refreshed account review, Kira price/percentage offer save, ordinary and Exclusive one-click approval, and the explicit incomplete-application exception. Kira setup appears before collapsed advanced policy tools; pending application reviews appear before analytics; invitation tools are collapsed. Final portal build, TypeScript and lint checks pass; no page error or horizontal overflow occurred. A deliberate incomplete fixture returned the expected conflict before the owner chose its exception.

The customer plan screen renders complete Standard details followed by complete Pro details, uses current catalogue offers, and resumes the persisted checkout request. The owner can approve a reviewed vendor with one action, including an explicit incomplete-application exception with automatic audit history; age, self-review, tenant and bank/payout boundaries remain enforced. The payment configuration has one clear merchant setup checkbox. Its attestation must truthfully reflect Paystack's actual “Pass fees to customers” setting; this release did not fabricate that setting or move money.

Kira supports UTF-8/UTF-16 text files and readable PDF pages, including mixed PDFs with explicit missing-page markers. A scanned-only PDF still needs a page image. Requests have a bounded document processing deadline and one fallback; after a lost response the client checks its own existing request instead of submitting another inference. Document and image cards remain visible above the processing response.
