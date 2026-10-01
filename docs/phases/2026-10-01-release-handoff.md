# KampusOne platform upgrade: release handoff

The requested implementation is on `feat/business-platform-20260930`, based on main `f8f2f5b312a7793ec938439c97080a94760cfe87`. A final fetch confirmed main has not advanced. Changes are committed locally; publishing, production migration, deployment and the signed APK are still pending. This is a tested implementation checkpoint, not a claim that the live app has changed.

## What is implemented

| Area | Result | Release dependency |
| --- | --- | --- |
| Public business profiles | Approved Vendor/Tutor/Rider links; business name, owner, username, photos, tags, editable bio/contact, shared followers, reviews and catalogue; no following list | New profile migration; device layout acceptance |
| Seller fulfilment | Seller order workspace; pickup, opted-in vendor delivery and recommended rider; pickup codes, staged handoffs and one atomic rider claim | Reviewed delivery coverage; fulfilment acceptance |
| Reviews | Completed-purchase eligibility, optional stars/review, delayed three-hour prompt, Later/No thanks and app notification | Scheduled worker and device acceptance |
| Rider finance | Distance-banded fares, 10% commission, cash debt, available-earnings offsets, four-unpaid-commission claim block and verified exact repayment | Reviewed zone distances and live provider acceptance |
| Inclusive prices | Sealed store/tutorial/material checkout; no increasing checkout surcharge; exactly ₦6,000 Kira monthly plan; versioned rate evidence and receipt reconciliation | Approved commercial policies and merchant fee settings |
| Withdrawals | Atomic ledger reservation, verified recipient, scoped review, stable transfer reference, recovery/OTP, verified settlement and reversals | Bank/KYC eligibility, transfer-duty reconciliation and provider acceptance |
| Discovery | Top/Latest/People/Media, `@` usernames, author/date/language/activity filters, reply exclusion and cursor pagination | Search indexes and visual acceptance |
| Sharing | Common inbox-recipient share sheet, explicit Send/retry, WhatsApp/Copy/More, canonical app destinations and branded website fallback | Public link host, real signing identities and installed/absent-device acceptance |
| Messages | Per-account persistent text/media/reply/voice drafts and inbox Draft; interrupted-send recovery; received-left/own-right swipe reply; existing focused long-press menu retained | Physical app kill/reopen, attachment, voice and gesture acceptance |
| First-install introduction | Three simple Skip/Back/Next screens using the current illustration family; persisted completion and existing account screen | Device acceptance; new original Higgsfield artwork is plan-blocked |
| Agent application | Five progressive steps, saved draft, camera oval/capture/retake, optional CAC, private evidence, encrypted NIN, deduplicated receipt and scoped current-identity review | Encryption secrets, manual verification procedure and actual receipt/approval email delivery |
| Administration | Preferred white-panel layout; staff email/password accounts, scoped permissions, account/detail CSV, support/review/blocklists, private documents, sounds, reviewed publishers and existing campaign controls | Operations prerequisites, GA4 access/configuration, live notification/email acceptance |
| Analytics | Actual first-party account/platform/action/scroll reports plus separate validated, read-only GA4 reports and graphs; explicit setup/readiness states | GA4 property service account, optional registered custom dimensions, consent/device verification |
| Repository privacy | Checkout credential-pattern review; no private KYC/public-profile leakage; source visibility assessment | Explicit public/private publication choice |

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

- 506 server tests in 53 files, 130 root regression tests, 11 post-link tests and 10 shared-contract tests pass.
- Server/mobile/portal/contracts type checks and server build pass; portal lint and production build pass (28 generated static pages); mobile web production export passes (89 routes).
- The twelve new SQL files apply in exact order on the schema-only PostgreSQL baseline. SHA-256 and git-blob hashes, validated constraints, private ACLs, journal/idempotency behaviour and lack of seeded staff/broadcast/pricing authority are checked.
- Browser/native visual acceptance remains pending because this environment has no functioning browser/device runner. No real payment, transfer, email campaign, push broadcast or GA4 property request was made.
- The rejected detailed illustrations are removed. The selected personal Higgsfield connection returned “Requires basic plan or higher”, with zero replacement jobs submitted. Existing approved character artwork is bundled.

## Migration state and execution order

The October 1 read-only Neon ledger has **nine registered versions with matching source hashes**. **44 older versions lack ledger entries**; some corresponding objects already exist, so replaying every file is unsafe. **Twelve new versions are queued and unregistered.** The current live schema lacks staff-access/product-event prerequisites and the new identity/document/publisher tables.

The exact inventory is `database/verification/2026-09-30-migration-manifest.json`. The read-only schema and report are `database/verification/2026-10-01-live-schema.json` and `database/verification/2026-10-01-migration-reconciliation.json`. They contain structural metadata and definition hashes, not customer rows or credentials. Verify them with:

```sh
node database/neon/reconcile-migrations.mjs
```

The script intentionally supplies no automatic production apply list. Review older unregistered SQL, function/constraint/index signatures and data effects on an isolated branch of current production, then record genuinely applied source versions and apply only reviewed missing versions. Run the same account, tenant, fulfilment, ledger and notification verification before promotion. Do not alter a source file already registered as applied.

The new ordered chain is:

1. `20260930210000_public_business_profiles.sql`
2. `20260930220000_store_fulfilment_modes.sql`
3. `20260930230000_optional_purchase_review_reminders.sql`
4. `20260930240000_rider_commission_ledger.sql`
5. `20260930250000_inclusive_store_quotes.sql`
6. `20260930260000_inclusive_tutorial_bookings.sql`
7. `20260930270000_verified_kira_subscription.sql`
8. `20260930280000_verified_learning_materials.sql`
9. `20260930290000_verified_agent_payouts.sql`
10. `20261001000000_discovery_search_indexes.sql`
11. `20261001010000_private_agent_identity_submissions.sql`
12. `20261001020000_admin_workspace_extensions.sql`

## Release dependencies

1. Resolve the publication destination. Automatic approval review blocked pushing this payload to the current public repository. Repository privacy requires changing GitHub visibility or using a private destination; app code cannot hide public source from AI. The public landing site remains unchanged.
2. Reconcile and rehearse current production on a separate Neon branch, review its apply list and record migration proof. The local twelve-file rehearsal does not establish the state of older live data effects.
3. Configure server-only `KYC_ENCRYPTION_KEY`, `KYC_FINGERPRINT_SECRET`, GA4 reporting access and the operational mail/push providers. Test permission revocation, privacy and actual receipt/approval delivery. See the agent/admin phase records.
4. Approve store/tutorial/Kira and transfer-cost policies. Verify exact displayed checkout amounts, merchant fee handling, signed callbacks, held-receipt recovery, refunds and transfer-duty statements. Payment, payout and Kira subscription flags remain false until this acceptance succeeds; no price policy is seeded.
5. Deploy the Worker and portal with the correct same-origin API proxy and hostname routing. The existing anonymous admin subdomain routes to `/admin`; `admin` returns 404. Attach and test the intended production domains. Service authority still comes from the server's permissions, not domain secrecy.
6. Establish the Expo project/owner and release signing identities. The checked-in app has no EAS project ID; provide the existing owned project via `EXPO_PUBLIC_EAS_PROJECT_ID` rather than silently creating an account/project. Preserve the existing Android/iOS Firebase configuration. The existing `internal` EAS profile produces an APK.
7. Publish actual release certificate fingerprints and the Apple application prefix to the link host; run physical Android/iOS camera, draft, gesture, review, fulfilment and App Links acceptance. Build the signed APK only against the reviewed deployed API. Configure the APK download URL after that artifact exists.

No production migration, repository visibility change, deployment or APK build has happened in this checkpoint. Do not enable financial gates or describe the live release as complete based solely on compilation and synthetic provider tests.

## Delivery and further detail

The local upgrade bundle contains the reviewed branch changes and requires the main baseline commit above. Import it into an authorized repository checkout with `git fetch /path/to/kampusone-platform-upgrade.bundle feat/business-platform-20260930`, inspect `FETCH_HEAD`, and create a review branch. This does not merge, deploy or migrate anything.

Detailed checkpoints: `docs/phases/2026-09-30-platform-upgrade.md`, `2026-10-01-discovery-sharing.md`, `2026-10-01-agent-intake.md`, `2026-10-01-admin-workspace.md`, `2026-10-01-repository-exposure.md`, and `docs/assets/2026-10-01-onboarding-art.md`.
