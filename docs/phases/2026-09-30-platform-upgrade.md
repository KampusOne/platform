# September 30 platform upgrade

Approved scope: `docs/requirements/2026-09-30-platform-expansion.md`.
Baseline: current main `f8f2f5b312a7793ec938439c97080a94760cfe87`.
Work branch: `feat/business-platform-20260930`.

## Business profiles checkpoint

- Personal profiles link to approved Vendor, Tutor and Rider Profiles. Existing role privacy preferences are preserved.
- Public business projection shows the business identity, owner name, username, cover/avatar, category tags, bio, shared personal follower count, catalogue count, published verified-purchase reviews, and contact actions.
- The business view has no following count or following list. Following a business modifies the existing personal follower relationship.
- The owner edits public business fields from Account & security or the business profile. Photo uploads do not mutate the personal profile. Contact numbers are explicitly published by the owner; application/KYC evidence is never projected.
- Business profiles remain readable with commerce paused. The editor reports database readiness and stays disabled until its migration is applied.
- Campus and block boundaries, active approval, completed purchase, moderation state, purchased item and media ownership are enforced server-side.
- One migration adds only a checked public JSON object and lookup index. No identity evidence or financial tables change.

Validation: server and mobile type checks, server build, mobile production web export, and all 421 server tests in 43 files pass. All 125 root regression tests pass. Thirteen profile tests include pending-schema reads, commerce paused, owner/tenant checks, owned public images, rejected KYC images, no personal avatar mutation, cleared bio/contact fields, and review eligibility/aggregate checks.

## Seller orders and messaging checkpoint

- The missing `/vendor-orders` screen now has All/New/Active/Completed tabs, item and delivery details, an activity timeline, accept/ready actions, customer telephone contact, and the authenticated rider pickup code. It uses the existing order state machine. Pickup, self-delivery, rider posting and cash settlement still require the fulfilment tranche below.
- Order reads enforce vendor ownership and the current campus. Mutations require an active vendor and an approved storefront. Two real PostgreSQL schema tests exercise ownership, campus changes, invalid IDs, staged transitions, suspension and the recorded timeline.
- Conversation drafts retain text, attachments, reply targets, recorded voice notes and interrupted send batches per account and thread. Native attachments are copied from cache to the app's document directory. Web attachments use IndexedDB blobs. The inbox displays a Draft preview.
- Message and uploaded-media identifiers are saved before sending. Reopening an interrupted batch requires an explicit Retry and preserves already-confirmed items. Draft contents clear after confirmed sends or the user's discard action. Writes serialize to prevent an older edit overwriting a newer one; missing files produce a recovery state.
- Six storage tests cover account isolation, restored reply/retry identifiers, cache clearing, partial media sends, failed persistence, rapid edits, voice metadata and acknowledged-send cleanup using mocked Android storage. Browser IndexedDB and physical Android kill/reopen tests remain acceptance checks.
- Swipe reply now uses left for received messages and right for the student's own messages. The existing focused long-press reactions/menu is retained.
- The recorder's subscription no longer restarts on each duration update. Finished/background recordings publish a persistent draft; a failed send retains the same voice message/media identifiers.

## Publication and visual checks

Changes are committed locally. Automatic approval review rejected pushing to the public `KampusOne/platform` repository because it would publish source and migration details without specific approval for that public payload and destination. No connector or other execution path was used to bypass the rejection.

No deployment, production migration, payment, campaign, approval email or Android APK build was performed. Browser verification remains blocked in this environment: the runner has no installed Chrome, the official installer cannot validate its network certificate, and the cloud browser rejects localhost. Type checks, regression tests and production exports are verified; these are not a substitute for device and visual acceptance.

## Migration queue

`database/verification/2026-09-30-migration-manifest.json` inventories exact repository versions and checksums. It records September 20 historical attestations separately from current live status. **No production migrations ran in this checkpoint.** Reconcile the live migration ledger after database availability returns, apply only missing versions, and record exact checksums/results. Do not treat every inventory entry as pending or replay applied migrations.

New queued migration: `20260930210000_public_business_profiles.sql`.

## Remaining implementation

1. Fulfilment modes and delayed optional review reminders.
2. Campus route fares, atomic rider claims, cash commission debt, repayment and debt-count suspension.
3. Inclusive catalogue/tutorial/subscription pricing, snapshot settlement and approved provider-rate configuration.
4. Common internal/external share sheet; device acceptance of persistent drafts and message interactions.
5. Search tabs, working filters and profile/brand app links with website fallback.
6. First-install illustrated introduction and progressive agent documents/selfie onboarding.
7. Admin workspace redesign, staff accounts, analytics/exports/campaigns/private operations and moderation integration.
8. Repository exposure audit, ordered migration rehearsal, deployment checks and Android APK.

Existing main already contains recent GA4 and messaging fixes. Port missing earlier branch work selectively rather than replacing current main or assuming historical pending lists are current.
