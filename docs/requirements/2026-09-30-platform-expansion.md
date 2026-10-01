# KampusOne implementation plan and migration addendum
Prepared: 30 September 2026, Africa/Lagos  
Target deployment window: 1 October 2026, once database capacity and deployment prerequisites are confirmed  
Status: implementation is on `feat/business-platform-20260930`; thirteen new SQL versions are queued, and forty candidate versions pass an offline rehearsal against refreshed live structure. See `docs/phases/2026-10-01-settings-catalogue-release-preparation.md` for current evidence and release blockers. Production migrations, deployments and a new APK remain pending.

## Scope and continuity

This plan captures Gideon's latest instructions and the supplied UI references. Begin with the seller dashboard and public vendor/tutor/rider profiles. Extend the existing app, API and portals; preserve completed work and confirmed fixes.

The earlier **KampusOne-Round2-Report.txt**, version 2, contains a 27 September follow-up and an appendix of 30 reviewed, pending production migrations. Its historical checkpoint reported only eight migrations registered in production, a portal origin problem, a prepared proxy fix that was not live, and different active/pending Worker versions. Those figures describe that checkpoint, not a fresh inspection of today's production.

The original planning snapshot preceded repository access. The 30 filenames and hashes below preserve the supplied report for historical reconciliation. A checkout and executable SQL now exist; the dated migration manifest and October 1 read-only reconciliation supersede this planning snapshot for current delivery state.

The July PRDs are planning baselines. This request and the existing implementation take precedence over older stack or pricing assumptions. The recent supplied security screenshots describe an Expo app, Next.js portals, a Cloudflare Worker API and Neon. Retain the actual deployed architecture after inspecting the repository; do not rebuild the project or switch database providers.

### October 1 owner corrections

- Move Delete account under Account manager → Profile settings → Account ownership, retaining explicit account-deletion confirmation.
- Use three new illustrations of one original character doing different activities in the current terracotta/cream drawing style. Existing illustrations may inform style, but must not be substituted as the final originals.
- Preserve the full institution catalogue and the selected institution's faculties/departments in separate state. Ignore obsolete requests and preserve existing academic/student IDs across imports. Fill missing structure from sourced data rather than inventing it.
- Reconcile and rehearse the necessary migrations before production; update the API before releasing the matching Vercel agent/admin portal. Verify the actual project, owned hostnames and source revision. Prepare an APK only after deployed service checks succeed.
- Current academic seeds provide departments for 62 of 328 institutions; full national coverage remains open. Neon branch capacity and repository publication authorization are separate release blockers, recorded in the latest phase report.

## 1. Public business profiles and seller dashboard

### Approval and navigation

- Every approved vendor, tutor or rider has a public role-specific entry on their normal profile: **View Vendor Profile**, **View Tutor Profile**, or **View Rider Profile**.
- Other users can see those entries. Multiple approved roles can each have an entry.
- Pending applications do not grant agent actions. Suspension removes the affected role's ability to take new business while preserving account access, historical records and commission repayment.
- Approval, role permissions and profile publication come from the server, rather than editable client role labels.

### Profile layout

The upper portion of the screen should explain the business before the catalogue begins:

1. Cover photo and overlapping profile/business photo.
2. Business name as the primary heading.
3. Owner's full name underneath.
4. The existing @username.
5. Category tags such as Restaurant or Supermarket, and the business bio.
6. Follow and message actions, published phone and WhatsApp actions, and share.
7. The account's existing follower count and published product count.
8. Rating summary and a horizontal carousel of genuine reviews.
9. Products with the final displayed prices and purchase actions.

Do not show a following count or following list on this business view. Business followers use the same relationship and count as the owner's main profile; following through either view must update both.

For tutors, use published sessions/materials and subject tags. For riders, show service coverage, availability and completed delivery activity rather than an invented product count. Maintain the same identity hierarchy across all three.

Account Center must support editing business name, bio, categories, phone, WhatsApp, pickup location, profile photo and cover photo, including the existing crop/preview/save/cancel behavior. Private onboarding records never appear in the public profile. Public contact details must be the details the agent chose to publish.

### Seller workspace

Provide usable pages for overview, products, orders, fulfilment, delivery requests, reviews, earnings, withdrawals and business settings. Include real order states, filters, stock, previews, clear empty states and recoverable failures. A business profile alone does not complete the seller dashboard request.

**Acceptance:** Two accounts can open and follow the same approved store, see matching follower counts, browse only published products, buy, contact the seller and share a working link. Account Center edits persist and refresh the public view.

## 2. Verified purchase reviews and reminders

- A review requires an eligible purchase owned by the reviewer and fulfilled by the reviewed business.
- Paid/completed pickup orders qualify after pickup confirmation. Delivery orders qualify after confirmed delivery. Completed paid tutor bookings qualify under the equivalent rule.
- Pending, cancelled or unresolved disputed transactions do not qualify. Never rely on a client-side “purchased” flag.
- Provide stars, optional written feedback and a visible verified purchase marker.
- Define one review per eligible purchase item/booking, with editing rather than repeated submissions. Calculate business ratings from eligible, published reviews.
- Buying one item must not unlock reviews of unrelated items from that seller.
- Offer a review after completion without requiring it.
- Schedule an optional reminder approximately three hours **after fulfilment**. It can appear the next time the user opens the app, even if they left earlier, and as an in-app bell notification.
- Support Later and No thanks. Do not repeatedly interrupt a user who declined.
- Keep review reminders in the in-app category by default. Important class/operational push policies remain distinct.
- Deduplicate reminder jobs and check eligibility again before delivery. Suppress prompts after a review, reversal or cancellation.

**Acceptance:** A buyer can leave and reopen the app to review an eligible item. A nonbuyer cannot submit through a direct API request. Duplicate jobs create one notification, and declining the prompt is respected.

## 3. Fulfilment options and rider dispatch

Expose three clear choices:

| Option | Address and behavior |
|---|---|
| Pickup | Show the vendor's pickup address and instructions. The customer goes there. |
| Vendor delivery | Collect the customer's destination. Offer this only when the vendor supports it; show any delivery price before payment. |
| Rider delivery | Mark as recommended when service is available. Collect the destination and show a campus distance quote. |

The vendor posts a delivery request for a specific order. Eligible, approved riders in the applicable campus/coverage can see it.

Claiming must be atomic on the server. Only one rider can transition an open request to assigned. A second simultaneous claimant receives a clear “Already accepted” response and cannot become assigned. Refresh other riders' lists after a claim. Recheck approval, debt suspension, job availability and campus scope within the same transaction.

Use explicit states such as requested, assigned, at pickup, picked up, delivered and cancelled. Record vendor handoff and customer receipt using existing fulfilment proof mechanisms or single-use codes. Do not let a rider unilaterally fabricate completion.

The assigned rider and vendor can message, tap a published telephone number to call, and open the vendor's WhatsApp. Show the relevant delivery address only to authorized order participants.

Prevent a rider from accepting unlimited concurrent cash jobs before commissions are posted. Prefer one active job initially; if existing functionality supports multiple jobs, reserve the available commission credit slots atomically.

**Acceptance:** Simultaneous claims yield exactly one assignment. Unapproved, suspended and out-of-scope riders are rejected. Cancelling or retrying does not create extra assignments or charges.

## 4. Rider fare, 10% commission and debt

### Proposed distance calculation

Use a permitted campus route distance, not an unlabelled straight-line distance. The following bands are an initial implementation proposal and need calibration against real campus routes:

| Routed distance inside approved coverage | Customer fare | KampusOne commission, 10% | Rider earnings, 90% |
|---|---:|---:|---:|
| Up to 1 km | ₦300 | ₦30 | ₦270 |
| Over 1 km to 2 km | ₦350 | ₦35 | ₦315 |
| Over 2 km to 3 km | ₦400 | ₦40 | ₦360 |
| Over 3 km within approved campus coverage | ₦450 | ₦45 | ₦405 |

For example, 1.7 km falls in the ₦350 band: 350 × 0.10 = ₦35 commission and 350 − 35 = ₦315 earnings.

Out-of-coverage trips must not receive a misleading campus quote. If route calculation is unavailable, use only an explicitly configured and labelled fallback or ask for a usable pickup/destination. Store the distance source, tariff version and accepted quote. Later tariff changes must not alter an accepted ride.

### Cash and digital accounting

For a cash fare of ₦300, the rider already receives ₦300 physically. Charge ₦30 against available dashboard earnings. With no available balance, the dashboard becomes −₦30. Do not also credit ₦270 as withdrawable digital earnings, which would pay a cash ride twice.

For an in-app paid ride, recognize ₦270 rider earnings through the existing pending/available ledger after fulfilment, and recognize the ₦30 platform commission once. Reversals must reference the original entries.

| Unpaid completed cash rides at ₦300 each | Dashboard balance from zero | New ride eligibility |
|---|---:|---|
| 1 | −₦30 | Eligible |
| 2 | −₦60 | Eligible |
| 3 | −₦90 | Eligible |
| 4 | −₦120 | New rides suspended |

The threshold is **four outstanding ride commission entries**, not a universal ₦120 balance. Four ₦450 rides can create ₦180 debt. Track remaining debt per ride, including partial repayment; exclude fully settled or reversed entries.

The proposed repayment rule is oldest debt first. At four outstanding entries, stop new assignments, while allowing existing delivery completion and access to **Pay your commission**. After a verified repayment or eligible earnings credit, recompute the outstanding count and remove debt suspension when it falls below four. A separate safety/identity suspension is not lifted by payment.

“Pay your commission” initializes Paystack for the exact debt selected. Credit the verified gross repayment to the debt ledger once; account for processing costs separately. A callback page alone cannot clear debt. Duplicate webhooks, repeated completion events or failed payments must not change balances twice.

For the initial model, preserve the quoted rider earnings and absorb digital processing/transfer costs in the platform's margin. Any different payout cost allocation needs an explicit policy before activation. The 10% ride commission must not silently become the vendor/tutor rate.

**Acceptance:** Cash and digital cases, mixed fares, partial repayments, four-debt suspension, restored eligibility, concurrent claims, refunds and duplicate payment events all preserve the correct ledger.

## 5. Inclusive prices, Paystack, tutorials and Kira Pro

### Buyer experience

The product/listing price includes the configured platform component and payment processing allowance before the buyer begins checkout. The payment provider must charge the accepted checkout quote.

- Delivery, quantity changes and genuine selected options may change the total, with their price visible before confirmation.
- Do not add a payment surcharge only at the Paystack screen.
- Disable Paystack's **Pass fees to customers** setting when our displayed prices already include processing; otherwise fees can be charged twice.
- Keep product/service price and delivery understandable without a special “Paystack fee” row in the consumer interface.
- Do not display a fictitious discount. A lower amount is valid only when a real price rule/discount recalculates it and the user sees the final amount before paying.
- For multi-item orders, calculate gateway fees at the actual transaction level. Reconcile any allowance already included in item prices; do not charge a second processing allowance at checkout.
- If an exact rider fare is added, fund any incremental processing cost from the configured platform margin so the shown delivery quote remains the amount charged.
- Keep accepted price snapshots for orders, tutor bookings and subscription purchases. Use integer kobo for money.

### Fee calculation

Paystack's published Nigerian local checkout rate is 1.5%, plus ₦100 for transactions of ₦2,500 or more, with a ₦2,000 fee cap. Validate the merchant's actual channel/rate configuration before launch.

Let G be the charged amount and N the intended net before other allocations. Solve G − fee(G) ≥ N using the applicable fee band and integer currency arithmetic. Evaluate the threshold on G; do not blindly select the band from N.

Illustrative local checkout examples:

| Pricing intention | Calculation | Outcome |
|---|---|---|
| Buyer pays ₦500 | 500 − (500 × 1.5%) | ₦492.50 after gateway processing |
| Buyer pays ₦1,000 | 1,000 − (1,000 × 1.5%) | ₦985 after gateway processing |
| Recover ₦3,500 net, no additional platform component | (3,500 + 100) ÷ 0.985, round safely to kobo | About ₦3,654.83 charged |
| Kira Pro buyer pays exactly ₦6,000 | 6,000 − (90 + 100) | About ₦5,810 before AI/other costs |

The quoted example of a vendor entering ₦3,500 and the customer seeing roughly ₦3,800 depends on the chosen platform component; it is not a universal markup.

Kira Pro is **₦6,000 per month displayed and charged**. Store that as the customer price rather than assuming a ₦5,900 net target automatically yields ₦6,000. Retain the free/Standard allowance and existing account-specific exceptions unless explicitly changed. Show billing interval, cancellation and renewal terms, and activate entitlement only after a verified payment.

Marketplace and tutorial commission percentages need an explicit configured policy. The request to reduce those percentages gives no replacement number; preserve existing approved rates until the replacement is chosen. Decide once whether the vendor input represents intended proceeds or a base price. Do not charge the same platform commission through both buyer markup and a second withdrawal deduction.

### Fee refresh and payouts

Provide an admin fee workspace with source links, effective date, channel, collection rates, thresholds/caps, transfer bands, applicable levies, last verification time, preview calculations and an audit trail.

A **Check provider fees** control can compare published information and actual verified transaction fees. No authoritative fee-configuration endpoint was established in this review. Do not promise that scraping a pricing page can safely and silently change every product. Stage detected changes for review, keep the last approved version on failure, and use new rules only for new quotes.

Paystack presently publishes transfer charges of ₦10 at up to ₦5,000, ₦25 above ₦5,000 through ₦50,000, and ₦50 above ₦50,000. Its transfer support pages also describe an additional ₦50 duty for qualifying transfers of ₦10,000 or more. These are payout costs, distinct from checkout charges.

Keep the existing ₦5,000 withdrawal minimum unless changed. Preview the actual agent bank amount, reserved balance and costs before requesting a payout. Use verified bank details, idempotent transfer references and provider-confirmed states. A fee change cannot silently revise a queued withdrawal.

Implementation must use server-created transactions, server verification of amount/currency/reference/owner, signature-checked webhooks, idempotent ledger postings, refunds and reconciliation. Preserve server secrets outside APK/web bundles. Supplying keys is configuration, not evidence that real payments, subscriptions, splits or payouts work.

**Acceptance:** Listing price, accepted quote and gateway charge match; threshold and cap cases pass; failed/duplicate payments do not unlock Pro, clear debt, fulfil orders or pay an agent.

## 6. Admin dashboard and staff access

Use the supplied green/white dashboard's hierarchy, white/cream surfaces, chart spacing and card layout, replacing green accents with KampusOne terracotta/clay. Keep a proper sidebar and distinct pages. Overview charts summarize real data; detail pages provide the controls.

| Workspace | Required controls and records |
|---|---|
| Overview | Active users, platform breakdown, orders/bookings, platform revenue versus gross sales, verification queue and service status |
| Users | Search, profile inspection, account status, moderation history and safe CSV exports |
| Agents and verification | Submitted fields, documents, selfie, verification checks, approval/rejection reasons and role publication |
| Support and moderation | Tickets, disputes, reports, blocklists, block reasons and resolution history |
| Commerce and finance | Products, bookings, orders, rider requests, debt suspension, pricing rules, payments, refunds, withdrawals and reconciliation |
| Kira | Free/Pro entitlement, usage, configured exceptions, response feedback and authorized conversation inspection |
| Marketing | Audience segments, campaign drafts, email delivery/bounce/unsubscribe reporting and important-account notification policy |
| Notifications and sounds | Category controls, authorized announcement accounts, uploaded sound catalogue and device sound selection support |
| Operations | Private documents, uploads, categorized records, assigned work and scoped access |
| Staff and audit | Add staff by email and initial password, assign workspace access, deactivate/revoke sessions and view action history |
| Release and health | Migration/deployment evidence, API failures, queued jobs, media/storage status and version diagnostics |

Owner-created staff accounts use their own email/password. No separate admin application process is required. Store password hashes, prevent public self-granting of staff authority and apply permissions on the API. Marketing and operations staff use the same dashboard with their own access. Each action records the actor.

Do not send credentials, broadcasts or invitations during this planning task. Those workflows will be available for the owner to use.

The sound catalogue is managed in admin. Students choose from the approved list in their alarm settings, preview sounds, and cache their chosen sound for offline alarms. They should not need to upload a personal sound to select one. Verify foreground, locked-screen, killed-app, reboot and update behavior on a real device.

The permanent admin host can use an inconspicuous subdomain as requested. It still requires authentication and permission checks. Diagnose deployed API versions, browser origin/cookie handling and domain mapping so the live portal serves the intended revision.

**Acceptance:** Every sidebar destination and supported action is exercised with an authenticated staff account. CSV exports honor permissions and filters. Private KYC documents cannot be reached anonymously or through another campus. No placeholder chart is represented as live data.

## 7. Analytics for Android, iPhone and web

The existing website GA4 setup does not establish mobile instrumentation. Connect web, Android and iOS data streams, with the native app SDK/configuration and a rebuilt app where required.

Define purposeful events: screen/page views, relevant button clicks, scroll depth, search use, product views, checkout steps, completed purchases, tutor bookings, subscription conversion and agent onboarding progress.

For custom scroll thresholds, record once per threshold per screen view and avoid duplicate automatic/custom events. Preserve timestamps, platform, app version and campus dimensions where appropriate. Verify Android and iOS events separately.

The admin overview retrieves real GA4 reports through authorized server-side reporting, with date/platform filters and visible data freshness. Financial totals come from payment/order ledgers, not inferred analytics events. Search Console remains a separate search-performance/indexing source.

Do not send NIN, selfies, private documents, message bodies, passwords or unredacted personal identifiers to analytics. Use consent/preferences where applicable.

**Acceptance:** A known action on each actual platform appears in the correct stream and admin report. Historical graphs are not fabricated for periods before tracking began.

## 8. Agent application portal

Keep the public agent website focused on applying. Operational dashboards appear in the approved user's account/agent workspace.

A proposed five-step application:

1. Choose vendor, tutor or rider; confirm school and basic eligibility.
2. Choose categories/subjects/services and enter the necessary business details.
3. Add contact/fulfilment details, NIN and available school/business documents.
4. Capture a selfie with a camera preview, oval guide, confirm and retake.
5. Review and submit.

Use choices and existing profile data to reduce typing. Keep an editable draft across navigation/restarts. CAC is not mandatory. Retain the existing minimum agent age policy of 16 unless changed, with appropriate eligibility checks for the role.

Request camera permission at the point of capture. Handle denial and unavailable cameras clearly. A still selfie and oval guide are not verified liveness or facial matching. Preserve manual/third-party identity review and do not label an unchecked NIN as verified.

Store NIN, identity documents and selfies privately with restricted reviewer access. Show submission timestamps, source documents, check results and review history in admin. Collect the records required for the actual review workflow, rather than unrelated sensitive data.

Submission queues a confirmation email saying pending approval. Approval/rejection queues a status email and, on approval, grants the selected role and exposes its features in the user's app. Use an email outbox with retries and deduplication so a temporary mail failure does not lose the application.

Use the current isolated-character KampusOne illustration pattern. Distinct original replacements should match the owner's latest welcome/Today references; existing approved assets are used until generation is available.

**Acceptance:** A user completes an application on a phone, confirms/retakes a selfie, reviews private documents, receives the submission message, and gains only the approved role after staff approval. Repeated submission/retry does not create duplicate applications or emails.

## 9. Feed search and filters

Provide keyword search for visible posts and people, plus username-specific search when the input begins with @.

Use the supplied X references for the search bar, recent searches/recent people, result tabs and filter sheet:

- Top: relevance among matching visible posts.
- Latest: newest matching posts.
- People: names and usernames; a keyword can also match people here.
- Media: matching posts with supported media.
- Lists: display only if actual list functionality is present or included in a separately implemented scope. A reference tab must not become a decorative nonfunctional control.

Filter controls must actually constrain the query: From, Date posted, Language, Post activity and Exclude replies. Include Apply and Reset. Specific submenu options should be reconciled with the current data model; language filtering must not guess a language that is absent from stored metadata.

Use server visibility/block rules, pagination, debounced requests and stale-request cancellation. Keep applied filters while switching relevant result tabs. A leading @ selects username discovery rather than searching unrelated post text.

**Acceptance:** Test keyword, @username, People-tab keyword matching, media matching, every supported filter, combined filters, pagination, Reset, no-results and blocked/private content exclusion.

## 10. Messaging drafts, media and long-press actions

### Durable drafts

Save each conversation's unsent text, image/video/document/voice items and reply context. Inbox rows show **Draft** with a suitable preview. Restore after navigating back, restarting and killing the app.

Copy native media to durable app-owned storage instead of relying on temporary picker URLs. On web, use appropriate durable storage and make missing/unrecoverable files clear. Keep drafts separated by account and conversation, and clear local private data on logout as appropriate.

Only clear the draft after a confirmed successful send, or an explicit discard. A failed send preserves text/media and offers retry. Prevent a delayed autosave from restoring an already sent draft.

### Message interaction

Match the supplied reference: the selected message stays readable while the surrounding conversation is blurred/dimmed. A brief long press opens the reaction row and paper-like action sheet with a pop animation; releasing the finger leaves it open.

Support reactions and applicable actions: Reply, Forward, Copy, Pin, Info, Report message and Delete for me. Keep permissions and actual action results consistent. Forward/share open recipient/target selection; they do not silently send.

Implement the requested gestures: swipe left on a received message and swipe right on one's own message to open reply composition. Preserve quoted-message navigation and handle removed originals.

Continue the existing media repairs: actual picture/video previews, document names/types, playable voice notes, upload progress and recoverable failures. Use **Photo**, **Video**, **Voice note**, **PDF** or **Document**, rather than calling every item an attachment.

**Acceptance:** Save and reopen drafts containing each media type; send once; retry a failed upload; reopen the long-press menu after release; test reactions, copy, forwarding, pinning, reporting, per-user deletion and both reply gestures with two accounts.

## 11. Sharing and app links

Use one canonical HTTPS link system for personal profiles, business profiles, products, tutor offerings/materials and posts. Keep identifiers stable when a display name changes.

Installed app: verified Android App Links and iOS Universal Links route to the relevant screen, including a cold start and a deferred destination after login.

App absent: the URL opens a valid KampusOne web page showing an appropriate preview and download action. Deleted/unavailable content gets a useful page. Operating-system and browser preferences control whether a chooser appears; the app cannot force the exact WhatsApp/Chrome prompt described.

Serve the required domain association files for the actual Android package/signing certificate and iOS app identity. Test the production host, not only a preview domain. Privatizing the code repository also requires checking whether APK downloads remain publicly available through an appropriate distribution host.

The share UI starts with recent inbox contacts, then supported external targets, Copy link and More. Show only real supported targets. Internal sharing sends a content card/link after recipient selection and a deliberate send action, honoring block/message permissions.

**Acceptance:** Share from WhatsApp and an inbox to each content type; test app installed/uninstalled, signed in/signed out, cold start, renamed profile and deleted item on production URLs.

## 12. Three-screen first-install onboarding

After the existing branded launch, show three brief illustration-led slides only for a new installation:

1. **Know your day**: timetable and academic tools.
2. **Find your people**: campus community, information and messaging.
3. **Get campus life sorted**: verified stores, tutors and delivery.

Each screen has an illustration matching the current approved character family, header, one short description and appropriate Next/Back/Skip controls. The final action opens the existing Create account / Already have an account screen.

Persist completion locally. Do not replay after an app update or normal restart, or block returning signed-in users. Review existing-user marker handling before adding the new flow. This is separate from agent application onboarding and should not introduce an extra loading sequence.

**Acceptance:** A fresh installation sees the slides; completing or skipping goes to the existing auth choice; restarting/updating does not replay them; returning-user login/startup remains fast.

## 13. Repository exposure and the supplied security screenshots

The Meta conversation says it found the repository through public web search, including AGENTS.md. That is a reported explanation, not proof of private access or a confirmed application exploit.

A public GitHub repository is accessible to the public, including search services. It cannot reliably remain public while denying every AI access. Restricting future unauthenticated source access requires making it private and maintaining authorized deployment/team access. Previously indexed links, copies and public forks may remain.

Audit published website links, repository metadata, source maps/bundles and secret exposure. Rotate any credential actually found exposed; do not assume the screenshots establish a leak. Search Console access for kampusone.app does not grant ownership over github.com URLs.

The Chrome screenshots are a **threat-model document**, not a demonstrated list of exploited findings. Use the described authorization, private media, session, AI, payment and tenant boundaries as a verification checklist before expanding live commerce.

No repository visibility, credential or hosting change was made during this planning turn.

## 14. New migration and release backlog

These are proposed work packages. Names below are identifiers for this plan, not filenames of SQL migrations that already exist. Inspect current schema before deciding whether each package needs new SQL or an extension of an existing migration.

| ID | Work package | Likely migration/configuration work | Acceptance evidence |
|---|---|---|---|
| NEW-01 | Approved business identities and profiles | Role publication, business fields/categories, public lookup and existing follower relationships | Multi-role profile and edit/follow tests |
| NEW-02 | Verified reviews and reminders | Eligibility, review uniqueness, aggregates, scheduled reminder/outbox dedupe | Nonbuyer rejected; delayed reminder once |
| NEW-03 | Fulfilment and dispatch | Delivery choices, coverage, lifecycle, atomic assignment and completion proof | Two-rider claim race |
| NEW-04 | Rider ledger and debt | Commission entries, outstanding count, credit reservations, repayments and suspension | Cash/digital/partial repayment/concurrency cases |
| NEW-05 | Inclusive prices and provider fees | Versioned fee rules, immutable quotes, reconciliation and approved payout allocation | Exact amount; threshold/cap/multi-item cases |
| NEW-06 | Kira Pro | ₦6,000 plan, payment references, entitlement/renewal/cancellation, free limits | Exact charge and verified activation |
| NEW-07 | Agent applications | Role-specific answers, private document/selfie references, reviewer checks and email outbox | Submission-to-approved-role flow |
| NEW-08 | Admin workspaces and staff | Permissions/audit extensions, CSV export scope, operations records and campaign policies | Authenticated staff matrix |
| NEW-09 | Analytics | Web/native streams, event schema and server report credentials; SQL only where needed | Android/iOS/web event evidence |
| NEW-10 | Search | Relevant indexes/query contracts and supported filter metadata | Search/filter visibility matrix |
| NEW-11 | Drafts and message actions | Local durable draft storage; server changes for missing reactions/pins/actions | Restart/media/action tests |
| NEW-12 | Sharing and onboarding | Canonical routes, domain association, content cards and install marker; mostly app/host changes | Production link and fresh-install checks |
| NEW-13 | Repository and release hosting | Visibility/access/distribution review; not a database migration | Deployment/APK access after changes |
| NEW-14 | Existing unfinished release work | Reconcile original 30 migrations, API version drift, admin auth/proxy/origins, catalogue and media/alarm gaps | Recorded live schema and end-to-end checks |

### Work that can proceed before Neon is available

Inspect repository status, uncommitted changes, latest commits, AGENTS.md and the active repair branch. Reconcile completed implementation against this scope. Prepare UI, original illustrations, local drafts, onboarding, API contracts, fixtures, necessary regression tests and reviewed additive SQL. Verify and commit/push each completed checkpoint when repository access is available.

Do not mark integrations complete because a mock or local preview works.

### Deployment sequence once capacity is confirmed

1. Recheck current source, migration registry and provider/runtime versions. Confirm the usable restore strategy. Preserve unrelated work and stop on unexpected drift.
2. Reconcile the reported 30-migration list with the repository and live registry. Remove already-applied work from the run list; never edit applied migration history to force alignment.
3. Add only the necessary new migrations after reconciling schema overlap. Review financial/notification backfills and ordering. Rehearse against an appropriate branch/restore point and verify expected effects.
4. Apply the reviewed ordered changes in supported, controlled batches. Use transactional boundaries where valid; record any steps that cannot run inside a transaction. Verify each batch before continuing.
5. Deploy the matching API and portal/app configuration. Repair permanent domain routing, origin/session handling, media access and link association.
6. Run authenticated student, vendor, tutor, rider and staff workflows. Verify payment test mode first, then explicitly chosen live verification where authorized; do not send broadcasts or execute real payouts as incidental tests.
7. Confirm logs, queues, actual notifications/emails and real-device alarm behavior. Test recovery from offline/provider failures with clear messages and preserved drafts.
8. Build the updated APK from the verified revision, preserve update-compatible signing, record version/API target and provide the download. Separate a successfully built APK from a fully verified live release.

Tomorrow's capacity reset alone is not evidence that the backend, dashboard, payments and APK have become functional. The release report must identify what passed, what is deployed and any unresolved dependency.

## 15. Definition of done

- Every supported page loads with its real permissions and data contract.
- Completed actions persist and appear consistently in the app, portal and API.
- No raw “failed to fetch” dead ends or unexplained “something went wrong” pages in expected workflows; external failures receive actionable retry/recovery without fake success.
- Financial and role transitions enforce server authorization and idempotency.
- Real graphs are traceable to their source and period.
- Business/agent/media/privacy and sharing checks use multiple accounts.
- Required Android/iOS/web checks are reported honestly; an Android APK is not iPhone verification.
- Previously confirmed features, startup speed and alarm/media behavior are preserved.
- Checkpoints are verified and committed/pushed as implementation proceeds.
- Review labels distinguish Drafted, Implemented, Tested locally, Deployed, Verified live and Blocked.

## Appendix A. Previously reported 30 migrations

Provenance: KampusOne-Round2-Report.txt, version 2, Appendix A; the report's September checkpoint. Files were reported under database/neon/migrations/. The recorded hashes must be compared with actual source before application. No SQL file was inspected or applied in this planning turn.

| No. | Reported filename | Recorded SHA-256 |
|---:|---|---|
| 1 | 20260921100000_operations_permissions_academic.sql | 57362a0553287c9c45dd055cf6c3d3baf42b30beb60e94f8ba8eca3e409aab6d |
| 2 | 20260921110000_ai_history_and_streak_activity.sql | 2970489189e48197b0f4645ab0a63831025951dba14fe11f297dcb82c367fe5a |
| 3 | 20260921120000_publishing_capabilities.sql | 3bce1c2591f16cf4a1e19f4bde36f67e3754e1b343835b1fbb7b8fdf6a9bd0c7 |
| 4 | 20260921130000_academic_publication.sql | 304f7738dc25cd19fbbb0e5be8b33b96253c1b56243a397cd73cac5834d12ec7 |
| 5 | 20260921140000_notification_delivery.sql | e6af1feffd3e1d3a16fea8aa633e402e73efc063830fae93a5091a0e1a4279c8 |
| 6 | 20260921150000_broadcasts.sql | 822f9bcfc7ae675ba3de8ae765671fc9d21bc5269a3dbc86769fbbd729bc6df8 |
| 7 | 20260921160000_payout_setup.sql | d46d76e35d169a15885a8685345814d228f0ecaa1a7e2c9c5620127321f66935 |
| 8 | 20260921170000_application_checks.sql | cac796ee16efce1f2645fdeca4610b30b0d443012e6068856a7c706254229b41 |
| 9 | 20260921180000_feed_social_interactions.sql | 25815d3414458ba350e31a5bdc8a81a8190bcf1de35a247ae109669c6c7acf26 |
| 10 | 20260921180000_idempotent_timetable_import.sql | 257a2dbdc4803bbce8ea06e06b79b79433348b67490b35b0468f555cb1b9aaab |
| 11 | 20260921184500_feed_comment_likes.sql | 66724bff4ea2040d57f1d940293dd382f2be95d796167e1ba91b29a820ab6c46 |
| 12 | 20260921200000_feed_comment_replies.sql | b22d8a63fcb3c3062cbd04d17d05ea7f616ddbb3efd7fb55f4db22bf2e70e752 |
| 13 | 20260922140000_feed_conversation_experience.sql | db8e248037c75403b00f95d709ace3431d38f107e4e630ad64b8a0707484b4ea |
| 14 | 20260924000000_student_ai_profiles.sql | 634f908d64031ee7bfefcd4cd26f157d38f8ba507741d33882ffffc8437a52c2 |
| 15 | 20260925090000_calendar_and_campus_places.sql | 14767fe67953f04b9be24c2cff2d4e94ec0d81a856a26662c7e2a4e501e38669 |
| 16 | 20260925100000_campus_map_foundation.sql | 2ea815572bcf31a6e8cea8212c98fd82a35b999a246b7f7813c3cdc314bc72ed |
| 17 | 20260925110000_notification_sound_catalogue.sql | 8b5d8a5a142de748abadbcee951aed5fc6f4582432c8624463506a53700c3a70 |
| 18 | 20260925120000_community_push_delivery.sql | 1c35e39612206c73657e5c443f9e2b930e514bdec41396a6b20f1c439d41b355 |
| 19 | 20260925130000_programme_metadata.sql | f0d016f1d255da7dc4501b2f6612827da6fe07717f307750d558a706008840f6 |
| 20 | 20260926120000_profile_safety_and_messages.sql | 9b74a03eba0e9648606ba1cf84725a05ca3855829cae53f7ccab63e65ee7d59d |
| 21 | 20260926120000_reviewed_calendars_and_progression.sql | eb23e1ee5f01304a440cb35ed6f6c389710ba599cacdf113be88bfebc7b3bc23 |
| 22 | 20260926150000_marketplace_promotions_resources.sql | e92b1618402015b7c4f01173b854e62a56c765b322257e45a982cc818b476b4a |
| 23 | 20260926170000_academic_catalogue_provenance.sql | dd9c48037c4540603859d736974b9dcf2053eff8fd11a887adcea847c7c9cbaa |
| 24 | 20260926190000_account_deletion.sql | 8f513c04e8a08333377e7f337dd0ae852d81d387e9f5d16be674c67981151c78 |
| 25 | 20260926200000_notification_channels.sql | cd1521f3b4729d5ec27d36ae6d551f83c02a4ad4fa6458cc81175edf1effdfee |
| 26 | 20260926210000_message_attachments.sql | 4ea82b5744a612445f222d6d4e08ff70c2146b08ab5786611d1a368f359c878e |
| 27 | 20260926220000_ai_schedule_actions.sql | b5f593610b250743cba6a0a33489abc2aea6f58b98cf0fd2cafeb753af001a66 |
| 28 | 20260926230000_tutor_commerce.sql | 1882d2d32b5371188fda7a2bf2f9ab96089bfc2cc6cfd9cbedc9c1646e8f85f9 |
| 29 | 20260926240000_commerce_fee_snapshots.sql | c82d675d9b0d7d0d514bb75e887116b622acf2929d8d5d400bfdbc8c39494158 |
| 30 | 20260926250000_campus_delivery_quotes.sql | 2b2d6358eced97388caab332602b532549fbd4c3cde127ff635363a0a45f3c09 |

## Appendix B. Reference inventory

All 29 visual assets in Prompt .zip were inspected:

| Asset numbers in extracted order | References | Use |
|---|---|---|
| 01–10 | Chrome security/threat-model screenshots | Existing architecture and security verification boundaries |
| 11–13 | Meta AI conversation screenshots | Reported public repository discovery; do not treat as independent exploit proof |
| 14–15 | Share with Friends examples | Inbox recipients and external app targets |
| 16 | Three-screen illustrated onboarding | Short illustration-led first-install flow |
| 17 | X message long-press menu | Reactions, focused message, blurred surroundings and paper action panel |
| 18–24 | X search/filter/result examples | Filter sheet, tabs, recent searches, people and media |
| 25–27 | Admin dashboard examples | Prefer asset 26's green/white structure, recolored to KampusOne |
| 28–29 | Profile reference and animated GIF | Cover/avatar hierarchy and smooth profile movement |

Brand baseline: Terracotta #C35D38, Deep Terracotta #A8462E, Clay #D9855F, Soft Peach #E9B18E, Sand #F1DFC8, Warm Cream #FBF7F2, Campus Ink #29231F and Soft Stone #9A8D84. Use the supplied official K1 marks without distortion, Lato for display and Inter for product text, subject to the current implemented design tokens.

## Appendix C. Primary documentation checked on 30 September 2026

- Paystack checkout pricing: https://paystack.com/pricing
- Paystack fee inclusion/pass-through configuration: https://support.paystack.com/en/articles/2130306
- Paystack transfer pricing: https://support.paystack.com/en/articles/2130370
- Paystack transfer duty: https://support.paystack.com/en/articles/7573314
- Paystack transaction initialization/verification: https://paystack.com/docs/api/transaction/
- Paystack webhook processing: https://paystack.com/docs/payments/webhooks/
- GitHub public/private repository access: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
- Android App Links: https://developer.android.com/training/app-links
- iOS Universal Links: https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
- GA4 web/Android/iOS stream setup: https://support.google.com/analytics/answer/9304153
- GA4 reporting API: https://developers.google.com/analytics/devguides/reporting/data/v1

Fee examples are indicative arithmetic for the cited local checkout schedule, not a promise of the merchant's final settlement. Verify applicable account-specific/channel rules and actual provider records during implementation.
