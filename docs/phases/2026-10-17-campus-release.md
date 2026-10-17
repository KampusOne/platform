# 17 October campus release — work record

Requested deliverable: a newly built Android APK containing the complete requested app, Worker and admin changes. Prepare the investor/law-firm business overview after the APK is ready. The source branch is `codex/oct17-campus-release`, based on `5533074`.

Implementation checklist. Checked items are implemented and covered by source, regression or deployment checks. Physical-device acceptance is still required as stated below.

- [x] Cold start offline restores the previous account's encrypted profile, timetable, feed and eligible content. Disconnection never proves auth expiry; explicit server revocation still clears the account. Writes require connectivity. Reconnect restores live reads.
- [x] Home slider pauses and shows an offline illustration; it resumes on connection.
- [x] All payment entry points use the shared in-app Bachs WebView. Closing/callback only triggers server verification; success routes to receipt/tracking. No client assertion grants entitlement.
- [x] Cart remains on pending, cancelled or failed payment, and only purchased quantities clear after a verified receipt, once.
- [x] Opportunity upload dropdown and subtype feed filtering: internship, scholarship, grant, student loan, sponsorship, skill acquisition, fellowship, competition, other.
- [x] Delivery range ₦500–₦1,500 using distance, quantity, actual/volumetric weight; one pair costs less than ten on the same route.
- [x] Multiple vendors in a cart, one combined payment; per-vendor accounting and stock reservation; admin coordinates multi-vendor readiness, riders see all pickup stops and quantities.
- [x] Only pickup/rider fulfilment; vendors can save multiple pickup points; multi-vendor defaults Engineering, June 12, Anatomy back gate, Main gate, and Ekosodin back gate.
- [x] Admin order detail lists items, quantities, vendors and phone/WhatsApp links; ready/dispatch and campus-delivery actions work.
- [x] Available/pending agent earnings and ledger release follow actual completed delivery; no withdrawal of pending money. Minimum vendor/tutor/other withdrawal ₦5,000, rider ₦2,000, enforced both server and database policy.
- [x] Per-role suspension: permanent hides role dashboard/actions, temporary retains read-only view with reason/end date and blocks mutations/payouts. Other roles and student account remain available; expiry restores role.
- [x] Vendor/rider DM contact warning, server-side phone/account detection, removal and 3-day chat pause; tutor conversations exempt. Paid order contact permissions stay separate from DM content moderation.
- [x] Alarms collapsed initially. All reply gestures swipe left. Rider dashboard duplicate/circled sections removed; useful actions live in top menu.
- [x] Tutor files (including VIDEO), optional covers, subjects/course filters, free/paid materials, whole-playlist upload, original chronological feed with wide videos/document rail, tutor search and optional booking fees.
- [x] Purchased/free learning files open in-app with no download controls, saved learning on profile, playlist entitlements enforced for every private part.
- [x] Scanned PDF rendering/OCR and valid text extraction; per-page retries cache results and reuse one import allowance. Unreadable/refusal results cannot be labeled success. Local Android document previews use safe sharing/file access.
- [x] Responsive crop gestures/corners; title/description stay editable during image/media upload.
- [x] Product gallery pagination dots, half-star reviews throughout API/storage/UI, useful order timeline and improved preview cards.
- [x] Community profile/cover layout; foreground notification popup; cart notice expires after five seconds and supports swipe dismissal.
- [x] Admin operations/disputes and featured brands load independently and expose authorized working actions.
- [x] Public blog cards use actual cover and published articles provide crawlable body/metadata/canonical/JSON-LD/sitemap.
- [x] Server and client checks, regressions, migration rehearsal/acceptance and production build pass.
- [x] Reviewed migration installed, required Worker/web deployed from release commit, installable signed APK built and inspected, same signing identity as prior APK, download delivered.

No deployment, migration installation or APK completion is implied by source changes. Record actual checks and receipts below as they finish.


## Verified release preparation

- 1,135 Worker tests across 131 files passed; the additional opportunity publishing/filter API test passed separately (1 test).
- 364 client/session/cart/draft regressions passed. Mobile and Worker TypeScript checks passed. Mobile web export, portal lint/typecheck/build, and public blog lint/typecheck/build passed.
- Both migrations were rehearsed with rollback, then installed in production on 2026-10-17 at 12:10:08Z. The Bachs combined-order acceptance passed before and after installation; all synthetic users, orders, receipts and journals rolled back. Existing users (21), agent profiles (4), orders (11), ledger transactions (10), ledger lines (23), media (194) and learning resources (5) were preserved. New private functions have no PUBLIC execute grants.
- Signed Android 0.3.37 / build 67 was built and published successfully. APK bytes and the embedded v2 signing certificate were checked locally against the published verification receipt. Physical-device acceptance remains open.
- Agent withdrawals remain gated by the previously documented Bachs Connect activation and live transfer verification dependency. No approved active withdrawal fee policies exist in production. The requested business minimum is enforced in app/server/new database quotes; no unverified provider fees or live test transfers were introduced.
- Blog source was released to the authenticated owner’s `warriorpikin/kampusone-landing` main branch at `e3abdb42d9bdd78bef4ac803b56dbc12d62e83b6`. Production deployment dpl_Ej1FQRxpoTxgsyYnrwjwvC3yzns7 is READY. The live blog and article returned HTTP 200 with the real cover, article body, canonical URL, Open Graph image and JSON-LD; sitemap includes both published articles.
- Bundled PDF scripts are generated during web and native builds from the checked-in reader/viewer sources. Generated bundles are excluded from source tracking.


## Published release evidence

- Source: `44feb4c806301b91fb45d5c522e38c9cff7560fd`; version `0.3.37`, Android build `67`, package `app.kampusone.mobile`, ARM64 only, target API 36.
- APK build and website publication: https://github.com/KampusOne/platform/actions/runs/39031686415 — both jobs succeeded. Versioned release: https://github.com/KampusOne/platform/releases/tag/android-0.3.37.
- APK size: 73,191,425 bytes. SHA-256: `6d9a16745bc2156efb1f839cc6f1ab3211a2857a46108a6809bd0828fafe3e85`.
- Signing certificate SHA-256: `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`; matches the established signing identity and was independently extracted from the downloaded APK v2 signing block. CI apksigner signature verification passed.
- Backend deployment: https://github.com/KampusOne/platform/actions/runs/39031686431 — succeeded.
- Matching web source and production aliases verified: https://github.com/KampusOne/platform/actions/runs/39031842067 — succeeded. Required platform, performance, AI provider, live Kira, timetable extraction and conversation checks succeeded.
- Production portal deployment: `dpl_7BVTLyH9qN4LTYi5WCWgLTGye1wY`; mobile deployment: `dpl_CMK4qBp48PFPutL8BCzjVET8Q893`. Both READY from the same source revision.
- Browser smoke check: released intro and welcome screens loaded and navigation succeeded. No authenticated physical-device or live payment acceptance is implied.
- Final APK was made available as `KampusOne-Android-0.3.37-arm64.apk`. The four-page business overview and law-firm briefing were prepared after the APK completed, rendered and visually inspected as PDF and editable DOCX.

## Remaining owner and field acceptance

Bachs Connect activation, an approved active payout cost policy and verified bank transfers are still needed before enabling live agent withdrawals. No provider fee was invented and no real payment or payout was initiated during verification.

On the target Android device, accept offline cold start/reconnection; in-app Bachs success/cancellation and cart recovery; combined-vendor readiness, rider pickup and buyer handoff; tutor playlist uploads and scanned PDF OCR; crop gestures, swipe-left replies, half-star reviews, covers and transient notifications. The automated checks and signed package do not substitute for this hardware acceptance.

Interface references reviewed: Material cards https://github.com/material-components/material-components-android/blob/master/docs/components/Card.md and Android transient feedback https://developer.android.com/develop/ui/views/notifications/snackbar. The user's YouTube screenshots informed the wide video and document rail layout.
