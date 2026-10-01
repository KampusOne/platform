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

Validation: server, mobile and contracts type checks, server build and mobile production web export (83 routes) pass. All 427 server tests in 44 files, 125 root regression tests and 10 contract tests pass. Thirteen profile tests include pending-schema reads, commerce paused, owner/tenant checks, owned public images, rejected KYC images, no personal avatar mutation, cleared bio/contact fields, and review eligibility/aggregate checks.

## Seller orders and messaging checkpoint

- The missing `/vendor-orders` screen now has All/New/Active/Completed tabs, item and delivery details, an activity timeline, accept/ready actions, customer telephone contact, and the authenticated rider pickup code.
- Order reads enforce vendor ownership and the current campus. Mutations require an active vendor and an approved storefront. Two real PostgreSQL schema tests exercise ownership, campus changes, invalid IDs, staged transitions, suspension and the recorded timeline.
- Conversation drafts retain text, attachments, reply targets, recorded voice notes and interrupted send batches per account and thread. Native attachments are copied from cache to the app's document directory. Web attachments use IndexedDB blobs. The inbox displays a Draft preview.
- Message and uploaded-media identifiers are saved before sending. Reopening an interrupted batch requires an explicit Retry and preserves already-confirmed items. Draft contents clear after confirmed sends or the user's discard action. Writes serialize to prevent an older edit overwriting a newer one; missing files produce a recovery state.
- Six storage tests cover account isolation, restored reply/retry identifiers, cache clearing, partial media sends, failed persistence, rapid edits, voice metadata and acknowledged-send cleanup using mocked Android storage. Browser IndexedDB and physical Android kill/reopen tests remain acceptance checks.
- Swipe reply now uses left for received messages and right for the student's own messages. The existing focused long-press reactions/menu is retained.
- The recorder's subscription no longer restarts on each duration update. Finished/background recordings publish a persistent draft; a failed send retains the same voice message/media identifiers.

## Fulfilment and reviews checkpoint

- Store pickup, vendor delivery and recommended rider delivery are separate checkout modes. Pickup uses the approved store address and instructions from an immutable order snapshot. Vendor delivery requires the seller's opt-in and a customer address. Pickup and vendor delivery currently have no delivery fee; the store can configure availability from Store profile.
- New orders reserve stock transactionally and keep the existing payment-readiness gate. Real payments remain disabled for an unconfigured settlement policy. This checkpoint does not implement inclusive processing allowances, cash commissions or rider debt.
- A vendor accepts an order, marks it ready, and posts a rider request explicitly. Unposted requests are hidden and cannot be claimed by guessing the delivery ID. Database locks enforce a single rider and existing capacity limits. Only the accepting rider receives the buyer address and operational vendor telephone. Vendor and rider can open an existing direct-message thread; public WhatsApp numbers remain owner-published fields.
- Vendor delivery must be dispatched before completion. A pickup or vendor delivery requires the buyer's six-digit handoff code. Five incorrect attempts lock it. A successful code records completion and leaves earnings pending under the existing dispute/payout policy. Repeating completion fails without another state change.
- Completed product purchases have an optional rating/review form in Your order, linked from Purchases and the brand profile when an unreviewed purchase exists. The product must belong to the actual order and the current campus. No star rating is preselected. Tutorial ratings also begin unselected; past tutorial customers can review while new tutorial sales are paused.
- Completion schedules a review reminder three hours later. Bounded scheduled work and foreground/inbox reads share notification dedupe keys. An atomic claim allows a popup once, with Review/Later/No thanks; manual reviewing remains available after dismissal. Early reminders, disputed or incomplete purchases and existing reviews do not trigger it. Foreground checks do not add continuous polling.
- The existing payment review screen called a missing server endpoint. It now reads an ownership/campus-scoped stored total and reflects checkout readiness.
- Six integration tests execute all three fulfilment modes and tutorial completion in PostgreSQL, checking reservations, immutable pickup details, dispatch, buyer-only completed-purchase reviews, tenant isolation, repeated handoff, five-attempt lockout, delayed/deduplicated reminders, decline-then-review, competing rider claims, contact privacy and payment-summary ownership. No provider payment is invoked by these tests.

## Inclusive store payments and rider accounting checkpoint

- Approved, immutable campus pricing policies publish inclusive product prices. Checkout seals those prices, quantities, recipient and delivery mode for ten minutes. Stock is reserved once under the sealed quote. An edited or stale checkout must obtain a new quote. The quote exposes the listed total, any downward-only checkout saving, delivery and cash due; internal commissions and processing allowances remain private.
- Commercial buyer/seller commission rates are not invented or seeded. An authorized finance operator must preview and approve a policy, including sufficient processing margin or an explicit platform subsidy, before new paid sales open. Checking Paystack's official pricing page stages evidence for review; it does not silently change prices. Verified receipts retain actual processing fees for reconciliation.
- Campus rider tariff: **₦300 through 1 km, then ₦50 for each additional started kilometre, capped at ₦450**. This phase uses an explicitly reviewed campus-zone distance estimate, not a road-route claim. Zones without a reviewed distance cannot quote rider delivery. Fare, method and 90% rider earnings are immutable once ordered. The 10% commission is ₦30/₦35/₦40/₦45; rider net is ₦270/₦315/₦360/₦405.
- Cash fare stays with the rider physically. A verified completed delivery journals the 10% commission receivable, never a digital 90% cash credit. Eligible available earnings offset debt under a per-user financial lock. Four outstanding commission records, including partially unpaid records and debts in another campus, block a new claim and going online. Existing deliveries can still finish.
- Riders can pay the exact commission balance through a stable Paystack checkout. Only a server-verified live NGN receipt clears debt. Replays do not settle twice; a concurrent earnings offset returns the excess repayment to available earnings. A verified amount mismatch goes to review without clearing debt. The platform currently absorbs collection processing costs for debt repayment rather than adding another charge.
- New digital fare settles into a delivery liability, then 90% rider pending and 10% platform revenue at verified completion. Vendor pending earnings and rider digital earnings release only after the 48-hour dispute window and with no open dispute. Balances come from append-only balanced journal lines. Cash collected, available funds, pending earnings, reserved funds and commission debt are separate dashboard fields.
- Every successful verified payment first enters a suspense journal with its actual processing expense. Expired orders, unexpected amounts and a second successful payment for an already-paid order remain traceable there, with no duplicate seller credit or fulfilment. Redirects, API-request success and client flags cannot provide payment proof.
- The admin Prices & fees workspace supports policy previews/approval, official fee evidence checks, reviewed zone distances, immutable policy history and verified receipt reconciliation. It is campus-scoped, permission-gated and audited.
- Legacy recorded earnings remain separately labelled. Legacy withdrawal creation is blocked once the new ledger is installed, until verified transfers and approved transfer-cost policies replace the old record-based flow. Tutorial billing, the fixed ₦6,000 AI plan and verified payouts are the next financial checkpoint.

Financial validation includes real PostgreSQL execution of both queued migrations, balanced/append-only/idempotent journals, cash/digital settlement and release, four-debt locking across campuses, exact verified repayments and late/mismatched receipts, policy approval boundaries, inclusive quotes, stale prices, checkout retry/stock reservation, full cash delivery completion and duplicated successful payments. Provider adapters are tested with synthetic receipts; no real payment was made.

All 457 server tests in 47 files, 125 root regression tests and 10 contract tests pass. Server/mobile/portal/contracts type checks, server build, portal lint and production build, and mobile production web export pass. The first concurrent full-suite run hit an existing fixture-setup timeout while mobile and portal builds competed for CPU; rerunning the full suite with two workers and a 30-second setup timeout passed every test.

## Tutorial and Kira billing checkpoint

- Paid tutorial listings use the approved campus tutorial policy. A booking confirms the displayed inclusive amount, locks the actual listing/window and seals the approved tutor net. Reusing a request returns the same booking/seat; changed sessions, prices, tenants and amounts are rejected. Free sessions keep their existing flow.
- Tutorial checkout initializes exactly the sealed amount. A successful live NGN server receipt allocates the approved net to tutor pending and records actual provider processing expense. Expired or duplicate successful payments stay in suspense for review. Verified tutor earnings release only after completed service plus 48 hours, with no open dispute; changing a sealed booking's price or identity is prohibited.
- Kira Pro costs **exactly ₦6,000 per calendar month**. Processing reduces platform net, never the displayed customer total. With Paystack's published local baseline the expected fee is ₦190 and expected net ₦5,810; merchant-specific rules/taxes must be reviewed rather than assumed. Finance approves a versioned fixed-price plan and processing rule per campus. No plan is seeded.
- Kira checkout also requires `KIRA_SUBSCRIPTIONS_ENABLED`, `PAYMENTS_ENABLED`, a configured Pro provider and the AI switch. The new subscription switch remains false in checked-in runtime configuration. The user explicitly chooses a monthly payment; there is no automatic renewal or saved-card subscription. Renewal opens in the final seven days and extends the current paid period.
- The billing period is an immutable record backed by one exact verified receipt and balanced journal. Its entitlement projection feeds the existing Pro policy; Standard limits are unchanged. Redirects, pending provider transactions, wrong totals and expired checkouts cannot activate Pro. Repeated verification cannot add another month. Owner-scoped pending checkouts survive app exit and can be resumed/checked from the new plan screen.
- The admin finance page adds fixed-price plan approval/history and correct quoted-versus-actual processing reconciliation for store, tutorial and Kira receipts. Approval is tenant-scoped, permission-gated and audited.

Validation: all 464 server tests in 47 files, 125 root regression tests and 10 contract tests pass. Server/mobile/portal/contracts type checks, server build, portal lint/production build and mobile production web export pass. Seven new PostgreSQL/API cases cover approved-policy gating, one-seat retry, tenant/owner isolation, immutable prices, exact receipt/net/release, expired money held, fixed ₦6,000 checkout, no activation from pending receipts, one-month idempotency, manual renewal and actual-fee reconciliation. No payment or production migration ran.

## Learning-material checkout checkpoint

- Paid learning resources now use an inclusive, immutable ten-minute quote. The actual resource, private file and approved tutor are locked when the purchase is created. A changed base price or file requires a fresh quote. Repeated requests reuse the purchase and payment attempt instead of charging twice.
- Only an exact server-verified NGN receipt unlocks a private file for its buyer and campus. Access uses short-lived signed links and the purchased file snapshot. Expired, incorrect or duplicate payments stay in suspense for review without granting access or crediting the tutor.
- Tutor net enters pending earnings with a seven-day dispute window. A buyer's report atomically pauses access and release. Scoped admin review can restore access while preserving the hold; marking a refund required does not pretend a provider refund occurred. Eligible release journals run once under database locks.
- Learning checkout and library screens replace calls to missing endpoints with owned, paginated purchase history, explicit inclusive totals, saved payment recovery, signed file access and reports. Payment-status checks remain available when new charges are paused.
- Transfer initialization now rejects test keys in production, validates HTTPS checkout links and reports an uncertain network result with a saved-reference recovery action.

Validation: all 468 server tests in 47 files and 125 root regression tests pass. Server/mobile/portal type checks, server build, portal lint/production build and mobile production web export pass. PostgreSQL/API cases verify quote privacy, price/file changes, tenant/owner isolation, immutable amounts, exact settlement, single credit, private access, idempotent disputes, admin restoration, delayed release and late receipts held for review. Provider fixtures are synthetic; no production payment or migration ran.

## Verified withdrawals checkpoint

- Withdrawals reserve available ledger funds atomically under the rider financial lock. A ten-minute quote pins the agent, campus, reviewed bank recipient, versioned cost policy and bank amount. Replays reuse the exact request; competing requests cannot reserve the balance twice. Available rider earnings offset same-campus commission debt first, and any remaining debt blocks a withdrawal.
- Identity documents, age/guardian eligibility, active approval and verified bank ownership are rechecked in the database at reservation and transfer. A pending payout also blocks bank-destination changes. Legacy gross records are never imported as available money, and legacy payout history requires reconciliation before another transfer.
- Individual finance staff can review a request, initiate an approved transfer, check its provider result and supply a merchant OTP. They cannot review or transfer their own withdrawal. Transfer initiation saves the reference before the provider request, uses that same reference on retry and never marks a payout paid from an acknowledgement. OTP remains in memory and is never persisted or audited.
- Server GET verification checks the saved reference, NGN amount, provider mode, tokenized recipient, transfer code and actual fee. Signed transfer callbacks use that same verifier. Wrong recipient/amount/mode enters review. Uncertain and failed transfers stay reserved; only a verified reversal or a rejection before initiation releases the funds. Success and reversal journals are append-only and idempotent; a reversal after payment uses a compensating journal.
- Reviewed cost policies contain transfer bands, additional-duty threshold, cost bearer and evidence. No commercial policy is seeded. The initial rider model absorbs these costs; PAYEE allocation is an explicit reviewed alternative. There is no second platform commission at withdrawal. Unused verified fee allowance returns to available earnings; excess cost is absorbed. The provider's separate duty statement still needs reconciliation and is not guessed from `fee_charged` or presumed refunded on reversal.
- Staff now have `/admin/withdrawals`; the old manual Paid/Processing/Failed selector is removed. Earnings shows real pending/available/reserved/withdrawn figures and a Check withdrawal action. `PAYOUTS_ENABLED` remains false in checked-in configuration. Existing verification remains possible when new payments/transfers are paused.
- Inclusive transaction initialization explicitly uses the merchant account as charge bearer. Before enabling real checkout, confirm merchant automatic customer-fee pass-through is disabled and the gateway displays the sealed amount, including exactly ₦6,000 for Kira. This merchant setting is a release check, not an undocumented automatic API promise.

Validation: the full 475-test server suite in 47 files passes; three additional transfer-adapter tests cover production test-key rejection, paused transfers, wrong currency/mode/reference, missing recipient/fee and read-only verification. All 125 root and 10 contract tests pass. Server/mobile/portal/contracts type checks, server build, portal lint/production build and mobile production web export pass. Seven new PostgreSQL/API cases cover KYC/tenant/policy gates, racing reservations, immutable quotes, manual paid-state denial, incorrect provider proof, uncertain/failed retries, exact settlement, reversal, fee-return accounting, cross-campus commission debt and OTP secrecy. No real transfer or production migration ran.

Official references: https://paystack.com/docs/transfers/single-transfers/ · https://paystack.com/docs/api/transfer/ · https://support.paystack.com/en/articles/2130370 · https://support.paystack.com/en/articles/7573314 · https://support.paystack.com/en/articles/2130306

## Discovery, sharing and introduction checkpoint

Dedicated feed search now has real Top/Latest/People/Media tabs, username mode, author/date/language/activity/reply filters, visibility checks and cursor pagination. A common share sheet supports explicit sends to recent conversations, WhatsApp, copy and native sharing. Canonical business/profile/post/product/tutorial/material links preserve their destination through sign-in and have a website fallback with signing-identity association handlers. Three original illustrated first-install pages lead into the existing account screen. Implementation and release configuration are recorded in `docs/phases/2026-10-01-discovery-sharing.md`.

Validation: all 483 server tests in 49 files, 130 root regression tests, 11 post-link tests and 10 contract tests pass. Server/mobile/portal/contracts type checks, server build, portal lint/production build and mobile production web export pass. The full publishing regression caught a missing parameter cast introduced with language metadata; it was corrected and the entire suite passed. Release certificate/domain configuration and browser/native acceptance remain outstanding.

## Agent onboarding checkpoint

Five progressive application steps, original illustrations, camera capture/retake, optional-CAC business evidence, encrypted NIN drafts/submissions and scoped current-identity review are implemented. Receipt retries are deduplicated; submission cannot activate a role. NIN reveal requires a reason and audit record, and new approval checks the current submitted fingerprint and documents. Details and release configuration are in `docs/phases/2026-10-01-agent-intake.md`.

Validation: all 490 server tests in 50 files and 130 root regression tests pass. Server/mobile/portal type checks, server build, portal lint/production build and mobile production web export pass. Private encryption secrets, actual email delivery and browser/device camera acceptance remain release dependencies.

## Publication and visual checks

Changes are committed locally. Automatic approval review rejected pushing to the public `KampusOne/platform` repository because it would publish source and migration details without specific approval for that public payload and destination. No connector or other execution path was used to bypass the rejection.

No deployment, production migration, payment, campaign, approval email or Android APK build was performed. Browser verification remains blocked in this environment: the runner has no installed Chrome, the official installer cannot validate its network certificate, and the cloud browser rejects localhost. Type checks, regression tests and production exports are verified; these are not a substitute for device and visual acceptance.

## Migration queue

`database/verification/2026-09-30-migration-manifest.json` inventories exact repository versions and checksums. It records September 20 historical attestations separately from current live status. **No production migrations ran in this checkpoint.** Reconcile the live migration ledger after database availability returns, apply only missing versions, and record exact checksums/results. Do not treat every inventory entry as pending or replay applied migrations.

New queued migrations:

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

These depend on the current account/agent schema, the Phase 3 commerce foundation and the unified notification tables. Readiness checks let the code be deployed before those migrations without querying absent new columns/functions. No earlier applied migration was edited.

## Remaining implementation

1. Actual campus road-route integration and reviewed fare coverage; cash commissions, four-debt locking and repayment are implemented with reviewed zone estimates.
2. Merchant fee-setting acceptance, transfer-duty statement reconciliation and provider refunds/held-receipt recovery. Store/tutorial-session/material/Kira billing, verified payout reservations/transfers and approved provider-rate configuration are implemented.
3. Device acceptance of persistent drafts, focused message interactions, the common share sheet and signed app links.
4. Admin workspace redesign, staff accounts, analytics/exports/campaigns/private operations and moderation integration.
5. Repository exposure audit, ordered migration rehearsal, deployment checks and Android APK.

Existing main already contains recent GA4 and messaging fixes. Port missing earlier branch work selectively rather than replacing current main or assuming historical pending lists are current.
