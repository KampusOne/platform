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

Validation: server and mobile type checks, server build, mobile production web export, and all 413 server tests pass. Thirteen profile tests include pending-schema reads, commerce paused, owner/tenant checks, owned public images, rejected KYC images, no personal avatar mutation, cleared bio/contact fields, and review eligibility/aggregate checks. Visual verification is still in progress.

## Migration queue

`database/verification/2026-09-30-migration-manifest.json` inventories exact repository versions and checksums. It records September 20 historical attestations separately from current live status. **No production migrations ran in this checkpoint.** Reconcile the live migration ledger after database availability returns, apply only missing versions, and record exact checksums/results. Do not treat every inventory entry as pending or replay applied migrations.

New queued migration: `20260930210000_public_business_profiles.sql`.

## Remaining implementation

1. Seller order workspace and fulfilment modes; delayed optional review reminders.
2. Campus route fares, atomic rider claims, cash commission debt, repayment and debt-count suspension.
3. Inclusive catalogue/tutorial/subscription pricing, snapshot settlement and approved provider-rate configuration.
4. Persistent message drafts, focused long-press menu, swipe reply and common internal/external share sheet.
5. Search tabs, working filters and profile/brand app links with website fallback.
6. First-install illustrated introduction and progressive agent documents/selfie onboarding.
7. Admin workspace redesign, staff accounts, analytics/exports/campaigns/private operations and moderation integration.
8. Repository exposure audit, ordered migration rehearsal, deployment checks and Android APK.

Existing main already contains recent GA4 and messaging fixes. Port missing earlier branch work selectively rather than replacing current main or assuming historical pending lists are current.
