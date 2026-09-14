# KampusOne launch build — agreed scope

This checklist consolidates the 13 September conversation and supersedes the old release-phase scope. The UI/UX Master Rules v2 and official assets remain the design baseline. The user's later instruction wins where it differs: empty states are an illustration and short heading, the first screen has no back arrow, and the splash has no tagline.

## Product decisions

- One account; Supabase identity, Worker-authorized application data in Neon, R2 media.
- Home / Feed / Explore / Map / Profile. Preserve the approved compact search-first screens.
- Agents website is application/KYC only. Vendor, tutor and rider operations belong in the app.
- Verified permissions are checked by the API, never inferred from a badge or cached role.
- Students and non-students can apply. Minimum agent age 16; verified guardian consent for 16–17, full KYC and bank review before approval/withdrawal. Provider/legal eligibility still requires launch review.
- Ten-month trial is claimed internally, without a Paystack checkout or card. One trial per verified person across roles; show claimant, university, start, expiry, and lifecycle in a dedicated admin section.
- Approved commission table: 2% up to ₦2,500, 3% above ₦2,500 through ₦5,000, 5% above ₦5,000. Snapshot the rate on each earning allocation, exclude payment-provider fees/another party's delivery share, disclose gross/commission/net to the agent. Do not charge commission again at withdrawal.
- Minimum withdrawal ₦5,000; transfer fee shown before confirmation, deducted from the agent's withdrawal. API automation follows review; never trust a payment redirect as proof of payment.
- Separate administration, application and engineering hosts, permissions and navigation. Separate admin pages, tenant filters, least privilege and audited changes.
- Special publishing accounts are real login-enabled accounts with their own permissions and brand-coloured verification. Admin may publish as explicitly delegated accounts; audit retains the real actor.
- Universities have independent catalogues/status, campus information, maps, guidelines and communities. UNIBEN first. No invented official rules or maps. AI imports are drafts requiring review.
- Cohort communities persist as the set advances. Rep elections default to 30 days, bounded by admin-controlled times; authenticated cohort-only voting, unique ballots, explicit tie handling, audited transfers with acceptance.
- Local session/onboarding persistence; account-scoped offline academic cache, no cached money/KYC represented as current. Clear personal cache on logout.
- Device files only for avatars, covers, products, documents and learning resources. Private KYC objects never public.
- Class and personal alarms, timetable ingestion/review/editing, automatic course drafts for GPA, functional GPA/CGPA, streaks, settings, support, privacy/terms and account management.
- AI study/summarizer/quiz/timetable interfaces and provider boundary; no simulated AI answers when the provider is absent. Mapping content/provider setup remains external work.
- Design capacity: 100,000 registered accounts; staged performance validation up to 10,000 concurrent sessions on an authorized staging environment. No claim of tested capacity without a report.
- Launch-only test-data cleanup requires explicit target review and backup. Do not delete Gideon's or other test accounts during this build. Preserve financial/audit retention and special accounts.

## Acceptance inventory

| Area           | Required checks                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Sign-up/email code/password recovery, OAuth, refresh, logout, session revocation, account restrictions                    |
| Profile        | Avatar/cover uploads, username/name/bio, account menu, settings, appearance, support, policy pages                        |
| UI             | Compact layouts, brief empty states, timed toast overlay, skeletons, local fonts/art, reduced motion, accessible controls |
| Academics      | Timetable create/edit/delete/import review, course draft sync, grade simulation/history, alarms and permission handling   |
| Agent          | Student/non-student application, age checks, guardian consent evidence, document review, trial claim, real approval gates |
| Commerce       | Role dashboards, product/material uploads, bookings/orders, atomic delivery claim and handoff, truthful earnings          |
| Finance        | Commission snapshots, bounded/idempotent withdrawals, provider transfer/refund adapter, webhooks, reconciliation          |
| Communities    | Tenant/cohort membership, elections, candidate/vote uniqueness, finalization, announcements, rep transfer                 |
| Administration | Scoped user activity, sanctions/appeals, trials, KYC, content, commerce, finance, universities, communities, audit        |
| Delivery       | Type/lint/tests/builds, migration rehearsal, visual/browser review, preview deployment, signed Android testing artifact   |

Implementation and verification evidence is recorded separately in the handoff. A listed requirement is not a claim that it has been completed.
