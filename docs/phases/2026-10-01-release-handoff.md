# KampusOne platform upgrade: release handoff

The reviewed implementation and migration evidence are published on public main at `5038a1cbbe49440900e69b1d36d3fd417cf17810`, with an exact match to the reviewed local source tree. All 41 selected migrations succeeded; 50 registered versions have matching source hashes. The updated Worker is deployed and healthy. Vercel stopped before deployment because its token resolved to an empty value; the matching APK correctly skipped. The production credential-scope correction and retry are the current release work.

Current deployment evidence is `docs/phases/2026-10-01-production-release.md`; migration evidence and release ordering are in `2026-10-01-live-migration-rollout.md`. The earlier settings/catalogue and release-attempt records are historical preparation checkpoints. The approved archived-branch deletion resolved Neon capacity, and the owner's explicit public-source approval resolved the publication block.

## What is implemented

| Area | Result | Release dependency |
| --- | --- | --- |
| Public business profiles | Approved Vendor/Tutor/Rider links; business name, owner, username, photos, tags, editable bio/contact, shared followers, reviews and catalogue; no following list | Deployed code and device layout acceptance |
| Seller fulfilment | Seller order workspace; pickup, opted-in vendor delivery and recommended rider; pickup codes, staged handoffs and one atomic rider claim | Reviewed delivery coverage; fulfilment acceptance |
| Reviews | Completed-purchase eligibility, optional stars/review, delayed three-hour prompt, Later/No thanks and app notification | Scheduled worker and device acceptance |
| Rider finance | Distance-banded fares, 10% commission, cash debt, available-earnings offsets, four-unpaid-commission claim block and verified exact repayment | Reviewed zone distances and live provider acceptance |
| Inclusive prices | Sealed store/tutorial/material checkout; no increasing checkout surcharge; exactly ₦6,000 Kira monthly plan; versioned rate evidence and receipt reconciliation | Approved commercial policies and merchant fee settings |
| Withdrawals | Atomic ledger reservation, verified recipient, scoped review, stable transfer reference, recovery/OTP, verified settlement and reversals | Bank/KYC eligibility, transfer-duty reconciliation and provider acceptance |
| Discovery | Top/Latest/People/Media, `@` usernames, author/date/language/activity filters, reply exclusion and cursor pagination | Deployed code and visual acceptance |
| Sharing | Common inbox-recipient share sheet, explicit Send/retry, WhatsApp/Copy/More, canonical app destinations and branded website fallback | Public link host, real signing identities and installed/absent-device acceptance |
| Messages | Per-account persistent text/media/reply/voice drafts and inbox Draft; interrupted-send recovery; received-left/own-right swipe reply; existing focused long-press menu retained | Physical app kill/reopen, attachment, voice and gesture acceptance |
| First-install introduction | Three simple Skip/Back/Next screens with a new original character in three poses; persisted completion and existing account screen | Native layout acceptance |
| Account settings | Settings → Account manager → Profile settings → Account ownership → Delete account; existing confirmation preserved | Native navigation acceptance |
| Academic onboarding | Institution list separated from selected university structure; parent-scoped choices and stale-response protection; repeat imports preserve existing IDs | Deployed code; department data remains incomplete outside the 62 covered institutions |
| Agent application | Five progressive steps, saved draft, camera oval/capture/retake, optional CAC, private evidence, encrypted NIN, deduplicated receipt and scoped current-identity review | Encryption secrets, manual verification procedure and actual receipt/approval email delivery |
| Administration | Preferred white-panel layout; staff email/password accounts, scoped permissions, account/detail CSV, support/review/blocklists, private documents, sounds, reviewed publishers and existing campaign controls | Operations prerequisites, GA4 access/configuration, live notification/email acceptance |
| Analytics | Actual first-party account/platform/action/scroll reports plus separate validated, read-only GA4 reports and graphs; explicit setup/readiness states | GA4 property service account, optional registered custom dimensions, consent/device verification |
| Repository privacy | Checkout credential-pattern review; no private KYC/public-profile leakage; source visibility assessment | Public visibility retained; reviewed public-payload publication approval |

## Rider calculation

For a reviewed campus-zone distance in metres:

`fare = min(₦450, ₦300 + ₦50 × ceil(max(0, distance − 1,000) / 1,000))`

| Reviewed distance | Fare | CampusOne 10% | Rider 90% |
| --- | ---: | ---: | ---: |
| Up to 1 km | ₦300 | ₦30 | ₦270 |
| Over 1 km, up to 2 km | ₦350 | ₦35 | ₦315 |
| Over 2 km, up to 3 km | ₦400 | ₦40 | ₦360 |
| Over 3 km, within reviewed coverage | ₦450 | ₦45 | ₦405 |

The current distance is an explicitly reviewed delivery-zone estimate, not a road-routing integration. Unknown/unreviewed zones do not receive an invented fare. All financial calculation uses integer kobo. A cash rider keeps the physical fare; only the platform commission becomes a debt or is offset against available earnings. Four **unpaid commission records**, regardless of their different amounts, block the next claim. Four ₦300 rides produce ₦120 debt; repayment is verified server-side before dispatch eligibility returns.

## Verified checkpoint

- The final full server regression passes: 513 tests in 55 files, including migration statement splitting, source proofs and the fourteen-version rehearsal. The 130 root regression tests, 11 post-link tests and previously verified 10 shared-contract tests passed at the unchanged app checkpoint.
- Server/mobile/portal type checks and server build pass; portal lint and production build pass (28 generated static pages); mobile web production export passes (91 routes). Shared-contract checks passed in the preceding unchanged checkpoint.
- All 41 selected versions succeeded on the actual current-production child and production. All 14 introduced versions also pass the schema-only ordered rehearsal. Exact registered hashes, preservation fingerprints, validated constraints, private privileges and rollback-only commerce/financial acceptance pass. No reviewed newly introduced version remains queued.
- Browser/native visual acceptance remains pending because this environment has no functioning browser/device runner. No real payment, transfer, email campaign, push broadcast or GA4 property request was made.
- The rejected detailed illustrations are removed. Three built-in image-generation originals replace the reused drawings after the selected personal Higgsfield account's plan blocked submission. Final transparent assets were visually inspected and total 434,225 bytes.

## Migration state and execution order

Production has **50 registered versions with matching source hashes** after 41 reviewed atomic transactions. The 67-source inventory retains **15 older unregistered baseline versions** that already have their named objects/effective functions and **2 deliberately superseded prerequisites**. These 17 historical sources were not replayed or falsely registered. The compatible replacement preserves message attachments and six existing bookings. All fourteen versions introduced by this update have succeeded.

Current metadata and read-only reconciliation are `database/verification/2026-10-01-production-platform-schema.json` and `2026-10-01-production-platform-reconciliation.json`. Actual production/rehearsal proof and the baseline review are linked in the live rollout record. They contain hashes/counts/structure, not customer rows or credentials. Verify with:

```sh
node database/neon/reconcile-migrations.mjs
node server/scripts/verify-schema-proof.mjs platform
node server/scripts/verify-schema-proof.mjs corrections
```

Read-only reconciliation intentionally supplies no automatic apply list. Do not edit registered source SQL or replay old scripts solely because their ledger entries are absent. The introduced chain, now applied, is:

1. `20260930190000_live_legacy_prerequisites.sql`
2. `20260930210000_public_business_profiles.sql`
3. `20260930220000_store_fulfilment_modes.sql`
4. `20260930230000_optional_purchase_review_reminders.sql`
5. `20260930240000_rider_commission_ledger.sql`
6. `20260930250000_inclusive_store_quotes.sql`
7. `20260930260000_inclusive_tutorial_bookings.sql`
8. `20260930270000_verified_kira_subscription.sql`
9. `20260930280000_verified_learning_materials.sql`
10. `20260930290000_verified_agent_payouts.sql`
11. `20261001000000_discovery_search_indexes.sql`
12. `20261001010000_private_agent_identity_submissions.sql`
13. `20261001020000_admin_workspace_extensions.sql`
14. `20261001030000_server_only_private_privileges.sql`

The production proof lists all 41 newly applied versions and 50 exact ledger matches. Eighty-six of 91 original table fingerprints match; the only five expected changes update the campus/academic catalogue. All account, media, booking and finance records checked are preserved.

## Release dependencies

1. Public source publication is complete under the owner's explicit approval. Keep the existing public visibility and public landing site unchanged. The earlier automatic rejection is historical; do not request the same approval again. App code cannot restrict readers of public GitHub pages.
2. Deploy through the ordered Worker → Vercel → APK workflows. Recorded live migration proof now passes. Portal and mobile Git auto-deploy are disabled so they cannot race the verified backend. A successful matching Worker run is required before Vercel publication; verified portal aliases/mobile preview create a source receipt used by the APK build. Only a successful verified release can publish the current main APK. Manual APK runs save test artifacts. See the live rollout record for exact hostnames and workflow behavior.
3. Configure server-only KYC encryption/fingerprint secrets, GA4 reporting access and operational mail/push providers. Verify permission revocation and actual application receipt/approval delivery; API readiness alone does not verify provider delivery.
4. Approve commercial policies and complete real signed payment/transfer/refund/provider-fee acceptance. Payment, payout and Kira subscription flags remain false; no price policy was seeded. Exact displayed/charged amounts require the merchant settings and receipt reconciliation already documented.
5. Supply the existing owned Expo project ID for push registration and real release signing identities for distribution. The GitHub Gradle workflow can compile a sideload test APK without EAS using Expo-generated testing signing; a real upload/release keystore is required before Play Store publication.
6. Publish actual signing identities to the link host and run physical Android/iOS camera, draft persistence, gestures, reviews, fulfilment and App Links acceptance. Configure the download URL only after the matching APK exists. Department coverage remains 62 of 328 institutions; unsourced records use the submission/review path.

The database rollout is complete for the reviewed apply list, and the updated Worker is live and ready. The first Vercel release failed before deployment, so no new matching APK was produced. Production-scoped Vercel credentials are the next check. No repository visibility change or provider transaction was made. Compilation and synthetic acceptance do not establish full live/native readiness.

## Delivery and further detail

The local upgrade bundle contains the reviewed branch changes and requires the main baseline commit above. Import it into an authorized repository checkout with `git fetch /path/to/kampusone-platform-upgrade.bundle feat/business-platform-20260930`, inspect `FETCH_HEAD`, and create a review branch. This does not merge, deploy or migrate anything.

Detailed checkpoints: `docs/phases/2026-09-30-platform-upgrade.md`, `2026-10-01-discovery-sharing.md`, `2026-10-01-agent-intake.md`, `2026-10-01-admin-workspace.md`, `2026-10-01-repository-exposure.md`, and `docs/assets/2026-10-01-onboarding-art.md`.
