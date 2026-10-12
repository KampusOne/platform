# KampusOne repair and release-gate report — 12 October 2026

The repair work is published on draft PR #90. Production readiness is still blocked. Source fixes and synthetic checks are recorded separately from device, provider, legal and deployed-service acceptance. Both supplied master text files were reconciled; v1.1 owns the continuous horizontal import bars and result-shaped search skeleton requirements. Existing first-pass work was retained and extended.

## Source and artifact identity

- Repository: KampusOne/platform; PR https://github.com/KampusOne/platform/pull/90.
- Base/main: 7cbedcdbe2e8dc992f52ee049d392cce1fa54b88.
- Original repair head: 4cf11a8bc4703b34c977c334ea9c146b94b1dede.
- Source phases: 4b72e45f3bdddf7b71e8c3bd9bfc636f27f3f08b, fd9a578725d7bd58d32079280dc74df267ab4227, 8fd51d8b3f979a890359dd3153c1a065a72ce4c9.
- Current implementation source tree: f1f4cf63a6790ce86ceb8640ac31590c2eb1abd9. Documentation commits may follow this implementation revision; see PR head and attached validation receipt.
- Mobile config: versionName 0.3.25; Android versionCode 55; iOS buildNumber 55. Build ID accepts explicit CI SHA, GitHub SHA and Vercel git SHA; absent provenance displays unknown.
- Final reviewed main merge: NONE. The GitHub PR test merge reference is not a reviewed main merge.
- Installed APK provenance: UNVERIFIED. Final APK filename/checksum/signature/ABI/install URL: NOT PRODUCED.
- No production database migration, ledger/payment/account mutation, real charge, payout or manual production deployment invocation. A current-source frontend preview was explicitly created on the existing preview project for public UI testing. Existing connected build integrations also automatically run on branch pushes; their results do not prove serving traffic.
- Realtime flag and Durable Object binding are absent in both checked Wrangler environments. The gateway remains OFF. No production feature/provider switch was made.

## Validation evidence

P1: Root regressions (`node --test tests/*.test.mjs tests/post-like-store.test.ts`): 228/228 pass. This includes performance-restoration, cache-isolation, native-api-timeout, keyboard-layout, product-form-recovery, production-recovery and text-recovery suites. Original available baseline was 200/200.

P2: `tests/production-recovery.test.mjs`: real Node AES-GCM adapter exercises encrypted restart, tamper/record swap, account/tenant/role isolation, A→B→A, expiry/key deletion, protected-record and scope limits, calendar round-trip, logout files/new login, single refresh deadline, no programming-error fallback, gateway block, and late disk/network hydration. Runtime is a simulated host, not Expo native.

P3: `tests/text-recovery.test.mjs`: fake clock/connectivity, 1,000 wake events, transient backoff, permanent denial/manual retry, abort/late acknowledgement, bounded storage failures, exact-intent transfer sharing and invalid identifier/body/path rejection.

P4: `server/tests/message-drafts.test.ts`: 11 tests using encrypted storage adapter and synthetic files. Text/reply/voice/media recovery, partial-send identifiers, missing file, explicit clear, old plaintext retry exclusion, composer preservation, completion tombstones and 40-thread refusal/reuse.

P5: Shared ImportProgress states and source guard suites verify true upload percentage versus indeterminate reading/analysis/review/save; uploader cancellation, strict legacy compatibility and confirmed save-count semantics. All eligible import screens share this component. These checks do not mean a real upload reached R2 or an AI provider.

P6: `server/tests/tutorial-create-retry.test.ts`: three isolated PostgreSQL integration cases for same-ID same-payload replay, changed/deleted/other-owner rejection and current-campus binding. Product form regressions cover coherent roles and retries.

P7: Existing schedule-document, ai-document, academic-import-quota, calendar-api, AI worker/provider/allowance suites exercise synthetic digital/empty PDFs, mocked AI output, dates/types/duplicates, limits and idempotent reviewed save. Actual scanned/rotated/low-contrast provider matrices remain missing.

P8: Existing payment-idempotency-migration, payment-pricing, BACHS-cutover/pricing, Kira-learning-verification and rider-finance suites cover synthetic money-state boundaries. PostgreSQL/WASM fixture startup moved to existing beforeEach/afterEach hooks after test timeouts; five-second transaction assertion deadlines were retained. This changes test setup only, not payment behavior.

P9: `server/scripts/live-runtime-smoke.mjs`: PASS for real local workerd websocket upgrade, ordered invalidations, duplicate suppression, automatic lease alarm and socket cleanup. Synthetic client close acknowledgement is bounded to 250ms. Local environment needed a loopback-only networkInterfaces shim; normal GitHub Actions smoke also passes. This is not a deployed phone latency/cost test.

Mobile and server TypeScript checks pass; 85-route Expo web export passes. Final isolated server run: 881/881 tests across 108 files, 280.42 seconds. Matching-source GitHub Actions all pass, including contracts, mobile, Worker, portal, database review, browser review build, loading/cache workerd smoke and all feed/media/comment jobs. Contracts: 10 tests; portal lint/typecheck/build pass. Campus map checks cover 3,595 features, 180 places and 23 layers; GPS recovery covers 11 cases. No Android/iOS native compile or physical test was available. Exact check URLs and local outcomes are in `docs/audits/2026-10-12-validation-receipt.json`.

A full server run with simultaneous heavy mobile checks produced 879 passes and two five-second payment fixture timeouts. An isolated five-case payment run initially reproduced cold-fixture timeout, then passed after moving setup to hooks. Final whole-suite result and exact CI outcomes are supplied in the validation receipt; no failed assertion was removed and no global timeout was increased.

## 88-item matrix

DONE means the specific scoped implementation has automated/source proof; it is not a blanket production certificate. PARTIALLY DONE lists incomplete acceptance or implementation. BLOCKED identifies an external prerequisite. Cross-referenced work has one owner/proof and is not counted twice.

| Item | Status | Work | Evidence and remaining acceptance |
|---|---|---|---|
| 01 | BLOCKED | Installed APK provenance | Source version is 0.3.25/55 and build ID is wired into config/About. Installed APK, signing receipt and embedded SHA were not supplied; no binary equivalence is inferred. |
| 02 | PARTIALLY DONE | Launch and resume | Optional fonts/brand animation no longer hold useful loading UI; profile/session recovery offers sign-in. P1/P2. Before/after native launch timings are missing. |
| 03 | DONE | Usage cache invalidation | Observational POST /v1/usage no longer clears read caches. Root cache/performance regressions verify retained unrelated reads. P1. |
| 04 | DONE | Scoped foreground and push invalidation | Foreground/token updates and notification events invalidate relevant resources, with session/tenant/role isolation tests. P1. Actual notification delivery is separately gated by item 70. |
| 05 | DONE | Timed GET caching | Eligible timed GETs share safe representation caching; distinct caller deadlines remain separate transfers. Finance/auth/quota reads stay fresh. P1/P2. |
| 06 | PARTIALLY DONE | Duplicate reads and waterfalls | Shared GET transport, parallel disk/network hydration and focused reconciliation are implemented. Cancellation and stale response tests pass. Full per-route waterfall/request traces are missing. |
| 07 | PARTIALLY DONE | Polling workstream | One foreground read coordinator, gated live gateway and paused local clocks. Owner: items 81–88. Realtime activation, complete emitters and measured traces remain open. |
| 08 | PARTIALLY DONE | Native alarms | Native lifecycle/ring event support replaces the 1.5s scan; older installed binaries retain a 10s local fallback. Native Java compile, OS exact-alarm/termination and real ringing tests are missing. |
| 09 | PARTIALLY DONE | Push bootstrap | Registration uses session/token/events, daily resume and at most three backoff retries. No minute query loop. Android/iOS token rotation and terminated delivery need devices. |
| 10 | PARTIALLY DONE | Safe session/login | Single refresh/caller deadline, epoch isolation, useful recovery UI and fast native local logout. Public sign-in page inspected. Authenticated staging and cold offline session restoration remain unverified. |
| 11 | PARTIALLY DONE | Worker/Neon performance | Read-only index/query-plan review and bounded source reads completed. Existing correlation IDs retained. Tiny production tables do not establish p50/p95/p99, query budgets or scaling latency. |
| 12 | BLOCKED | Native rendering measurements | No physical device, emulator, adb or native FPS profiler is available here. No 60fps, memory, GPU or rerender improvement is claimed. |
| 13 | PARTIALLY DONE | Lists and navigation | Existing virtualized lists and stable IDs retained; message recovery updates matching intent without deleting newer drafts. Long-list scroll, clipping and render behavior need device review. |
| 14 | PARTIALLY DONE | Media and maps | Existing visibility pause/gallery/map behavior preserved; upload validation, cancellation, bounded chunks and location caching refined. Decode/memory/battery and tile licensing acceptance remain open. |
| 15 | PARTIALLY DONE | Timeout and failure diagnosis | One caller deadline and distinct network/timeout/invalid-response/programming errors tested. CLI API probes return Cloudflare 403/1010 in this environment; that block now preserves credentials/work. The reported phone failure is not reproduced. |
| 16 | PARTIALLY DONE | Secure local storage | Authenticated versioned native snapshots with OS key custody, quotas, indexes and ADR implemented; P2. Node adapter tests do not certify Expo keychain/backup behavior or independent security review. |
| 17 | PARTIALLY DONE | Academic hydration | Scoped timetable/GPA/courses/exam/calendar snapshots, parallel hydration and sync markers added. Native personal dates persist without cache expiry. Complete offline route/device acceptance is missing. |
| 18 | PARTIALLY DONE | Messages and drafts | Encrypted history/draft metadata, missing-attachment recovery, pending status, exact-intent acknowledgement and protected composer edits. P2/P3/P4. Native restart/history ordering/voice playback acceptance remains. |
| 19 | PARTIALLY DONE | Store/cart/map recovery | Scoped catalogue/product snapshots and bounded account cart restore; live quote remains authority. Permitted place/position caching retained. Durable licensed tile packs and cross-seller/device cart testing are missing. |
| 20 | PARTIALLY DONE | Incremental sync | Sequence invalidations/gap reconciliation and selective focused refresh implemented. No general cursor-based delta API or transactionally applied offline database replica; background synchronization is not claimed. |
| 21 | PARTIALLY DONE | Safe text outbox | Encrypted, previously submitted text only; stable message IDs, one transfer, foreground/connectivity gate, bounded retry, no financial/media/KYC outbox. P3/P4. Native crash/relaunch and two-device acceptance remain. |
| 22 | PARTIALLY DONE | Conflict recovery | Completion tombstones, composer-preserving acknowledgement and explicit blocked-message replacement conflict UI. 40-thread capacity rejects rather than drops work. P3/P4. Clock skew/general multidevice conflict acceptance remains. |
| 23 | PARTIALLY DONE | Isolation and deletion | AEAD, scope epochs, A→B→A, role-stable owned work, tenant-scoped server views, key destruction and concurrent-login file cleanup tested. P2/P4. Native backup/privacy and broader route revocation acceptance remain. |
| 24 | PARTIALLY DONE | Every-screen inventory | 85 TSX entries with source/state/accessibility/keyboard indicators recorded, including layouts/redirects; six primary interfaces protected. Complete redesign and visual/device acceptance of every eligible view remains open. |
| 25 | PARTIALLY DONE | Brand and reusable UI | Official marks, Lato/Inter and existing tokens preserved; search skeleton/progress/sync/recovery components shared. Full contrast, theme and typography acceptance across secondary routes remains. |
| 26 | PARTIALLY DONE | Visual quality | Functional fixes retain intended six main designs; secondary cards/forms use existing brand surfaces. An all-screen aesthetic review in both themes is not complete. |
| 27 | PARTIALLY DONE | Complete action states | Running search skeletons, retained results, stage errors, stopped clocks and targeted recovery added. Source pattern presence does not prove every loading/empty/focus/keyboard/reduced-motion state. |
| 28 | PARTIALLY DONE | Continuous import progress | One horizontal progress model/component owns class, exam, calendar and Kira stages; true upload fraction only, indeterminate processing/save states. P2/P5. Real-device accessibility and actual input matrix remain. |
| 29 | PARTIALLY DONE | Product/vendor search | Immediate running label plus product-shaped skeletons, debounce, stale-result guards, retained results and usable cart. Live seller results, accessibility and weak-network acceptance remain. |
| 30 | PARTIALLY DONE | Feed search | Posts/people/replies skeletons retained, clear/cancel/filter/recent-query behavior refined; recents are private. Protected main Feed styling retained. Live results/device keyboard acceptance remains. |
| 31 | PARTIALLY DONE | Tutor/course search | Offering-shaped skeletons and running search state retained; stale responses ignored and truthful listing states preserved. Live course/tutor/network acceptance remains. |
| 32 | PARTIALLY DONE | Other discovery search | Community search uses shaped skeletons and running state; existing discovery privacy controls retained. All business/rider/filter/search subflows still need live owner acceptance. |
| 33 | PARTIALLY DONE | Product cards | Earlier branch card repairs retained: stable aspect ratio, legible price/identity, failure placeholder and no category-adjacent share button. Small-screen/theme/stock acceptance remains. |
| 34 | PARTIALLY DONE | Store navigation | Category/search transitions, previous results, scoped cache and cart hydration refined. No fabricated live catalogue. Carousel/featured-shop and full browsing acceptance remain. |
| 35 | PARTIALLY DONE | Product details | Existing multiple-photo/gallery/seller/price behavior preserved with scoped display snapshots. Complete verified purchase-review/stock/delivery UI acceptance is missing. |
| 36 | PARTIALLY DONE | Seller dashboard | Earlier create-product primary action and organized secondary menu retained, using server data. Full seller states, analytics and live role flow acceptance remain. |
| 37 | PARTIALLY DONE | Seller capability/profile | Capability loading gates and coherent edit/save flow retained. New account/role guards prevent late draft restore. Full trial/approved/denied navigation acceptance remains. |
| 38 | PARTIALLY DONE | Create product | Encrypted draft restore, immediate busy lock, stable request ID, photo/category/price hierarchy and partial-create recovery. P6. Image reorder/crop/device and live publish acceptance remain. |
| 39 | PARTIALLY DONE | Tutor dashboard | Existing real teaching context and organized actions preserved. Full learner/bookings/earnings/schedule UI acceptance remains. |
| 40 | PARTIALLY DONE | Create tutorial | Draft recovery and stable create/re-submit IDs; backend same-payload retry preserves one record and checks current campus/owner. P6. Removed unsupported package-days claim. Live approval/attachment acceptance remains. |
| 41 | PARTIALLY DONE | Rider dashboard | Available/active/history and authoritative eligibility retained; focused read coordination and consented location heartbeat optimized. Dispatch stream and real motion/battery testing remain. |
| 42 | PARTIALLY DONE | Delivery workflow | Existing server transitions, route/contact/code handling and tests retained. Complete pickup/reserve/complete/proof/cash scenario acceptance has not been performed. |
| 43 | PARTIALLY DONE | Orders/history/earnings | Server-backed financial views preserved and existing integration suites executed. Full filter/timeline/payout/support design and approved staging role acceptance remain. |
| 44 | PARTIALLY DONE | Cart/checkout | Account cart restore and draft preservation; authoritative quote/payment status retained and disabled checkout explained. Full quantity/expiry/provider return/restart UI acceptance remains. |
| 45 | PARTIALLY DONE | Communities | Earlier square artwork/membership/search/countdown repairs retained; search feedback refined. Approval-all/private moderation/push wording acceptance on live roles remains. |
| 46 | PARTIALLY DONE | Exam countdown | Compact source design retained; ticker pauses offscreen/background and stops at completion. Nigerian boundary helpers tested. Physical transitions/share/reduced-motion review remains. |
| 47 | PARTIALLY DONE | Remaining secondary routes | Shared toolkit/recovery/legal and academic/edit states refined; complete source inventory includes obscure routes. Every secondary keyboard, accessibility and redesign acceptance is still required. |
| 48 | PARTIALLY DONE | Upload pipeline | Local validation, real acknowledged chunks, cancel boundaries, stage-aware errors and retained uploaded IDs implemented. P5/P7. Actual R2 signed access/provider document extraction remains blocked from this environment. |
| 49 | PARTIALLY DONE | Import/Kira progress | Same owner implementation and proof as item 28; no double-counted work. Progress continues through reading/AI/review/save. Real-device actual-file acceptance remains. |
| 50 | PARTIALLY DONE | Formats and size limits | JPEG/PNG/WebP image bounds, PDF/text bounds and >16MiB bounded reader path aligned in source; P5/P7. Scanned/rotated/large real provider uploads are unverified. |
| 51 | PARTIALLY DONE | Class timetable AI | Strict class document classification, review editing, retained text/file/request IDs and confirmed save counts. P5/P7. Real photo/PDF/text extraction and alarms on staging/device remain. |
| 52 | PARTIALLY DONE | Exam timetable AI | Independent exam schema/date/duplicate guards, safe save counts and existing first-paper alarm model retained. P5/P7. Real scanned exam imports and 2h/1h/30m/15m native alerts remain. |
| 53 | PARTIALLY DONE | Calendar AI | Calendar document classification and calendar quota scope, date/duplicate warnings and review/save retained. P5/P7. Actual Nigerian ambiguous dates/provider matrix remains. |
| 54 | PARTIALLY DONE | Parsing and errors | Strict document kind, bad dates/duplicates and structured provider/API errors; P5/P7. Complete hallucination/illegibility/orientation matrix and provider output correctness remain. |
| 55 | PARTIALLY DONE | Review and import save | Editable review, encrypted retained import drafts, durable request IDs, exact saved counts and distinct alarm-after-save errors. P5/P7. Native interruption and multi-device confirmation remain. |
| 56 | PARTIALLY DONE | Quota and paid retry | Existing provider/quota guards retained, calendar scope corrected and same request key preserved on retry. P7 includes quota tests. Actual Standard/Pro provider consumption and billing behavior remain. |
| 57 | PARTIALLY DONE | Kira processing | File/upload stage recovery and active-screen wait clocks refined while preserving primary Kira layout. Existing subscription/benefit/provider logic retained. Live long-form Pro and independent BACHS acceptance remain. |
| 58 | BLOCKED | Actual document matrix | No approved reachable staging provider/account and no affected Android device. Digital/empty synthetic fixtures and mocked outputs pass; real photo/scanned/digital/pasted cases are not certified. |
| 59 | PARTIALLY DONE | Paystack marketplace | Existing quote/order/payment/ledger idempotency guards and tests pass; checkout recovery copy retained. The user's live checkout fault is not reproduced or confirmed repaired. |
| 60 | PARTIALLY DONE | BACHS Kira Pro | Independent BACHS price/webhook/activation logic and synthetic tests preserved. No unpaid entitlement bypass. Current provider configuration/hosted checkout/renewal acceptance is unverified. |
| 61 | PARTIALLY DONE | Learning payments | Existing reservation/payment/access/refund logic covered by the existing suite. Free-resource behavior preserved. End-to-end approved staging booking and tutor receipt acceptance remain. |
| 62 | PARTIALLY DONE | Rider finance | Existing fee/debt/suspension and ledger tests executed without production mutations. Full staging cash/in-app/commission paths and real eligibility acceptance remain. |
| 63 | PARTIALLY DONE | Payouts and balances | Append-only financial semantics unchanged; synthetic initialization/payout/review tests run. No client-fabricated settlement. Live provider receipts and dashboard/reconciliation acceptance remain. |
| 64 | PARTIALLY DONE | Transparent pricing | Server-controlled quoted totals/fees preserved; misleading provider-specific/general package copy corrected. Full displayed-vs-provider amount acceptance across all paid features remains. |
| 65 | PARTIALLY DONE | Both webhooks | Existing signature/dedup/replay/refetch/tenant/amount checks exercised by synthetic integration suites. P8. Approved provider-delivered sandbox callbacks and deployment connectivity remain. |
| 66 | PARTIALLY DONE | Payment recovery | Existing uncertain/requires-review/terminal states and immutable initialization guards retained; no financial outbox. P8. Real close/reopen, callback conflict, refunds and settlement staging tests remain. |
| 67 | BLOCKED | Provider-approved payment matrix | No approved reachable sandbox account/credentials/events were supplied. Synthetic tests use isolated local PostgreSQL and mocked adapters; no real charge/payout/production account mutation executed. |
| 68 | PARTIALLY DONE | Logout | Native local credential removal before bounded remote revoke, truthful remote result, web confirmed cookie removal, encrypted keys/cache/draft cleanup and concurrent-login guards. P1/P2. Native offline logout/token reuse acceptance remains. |
| 69 | PARTIALLY DONE | Crash/error loops | Programming errors are not reclassified as internet failure; recognised gateway blocks do not force logout; pending work and targeted recovery preserved. Native audio/viewer/insets/navigation crash matrix remains. |
| 70 | PARTIALLY DONE | Notifications and alarms | Event-driven push registration, scoped reconciliation and native alarm events implemented; existing notification integration tests run. Actual remote/local/terminated delivery, channels and vendor events need devices. |
| 71 | PARTIALLY DONE | Dead/duplicate code | Source searches and 85-route/231-site inventory completed; unsupported tutorial package claim removed, compatibility branches retained deliberately. Full orphan/dependency and measured bundle-removal audit remains. |
| 72 | DONE | Privacy policy draft | 24 substantial feature-specific sections with explicit draft/operator verification status. Coverage and legal draft guard tests pass; browser privacy navigation inspected. Legal publication remains item 74. |
| 73 | DONE | Terms draft | 27 substantial readable sections on accounts/AI/commerce/riders/pricing/disputes/consumer protections; guarded draft state and browser cross-link checked. Legal publication remains item 74. |
| 74 | BLOCKED | Legal operator approval | Entity/address/privacy contact/processor roster/retention/minors/refund/renewal/effective-date decisions are not established. Qualified Nigerian legal review is required by the supplied master prompt; DRAFT remains. |
| 75 | PARTIALLY DONE | Automation | Root 228 regressions, full server suite, contracts, mobile export/typecheck, portal CI and workerd smoke. P1–P8. Authenticated UI E2E, emulator and physical accessibility tests remain missing. |
| 76 | BLOCKED | Physical-device acceptance | No affected or reference Android device/emulator/native tooling is attached. No browser screenshot is represented as a native test. |
| 77 | PARTIALLY DONE | Network matrix | Injected timeout/offline/403/5xx/reconnect/storage failure and event burst tests pass; live environment block recorded. Actual weak-3G/2G-like RTT/loss and phone transitions are unverified. |
| 78 | BLOCKED | Comparable performance metrics | No matching before/after installed build and device/network traces. Launch <2s, cached <300ms, 60fps, p95, RAM and battery remain targets only. |
| 79 | PARTIALLY DONE | Release integrity | Repair branch and draft PR preserved; exact source trees verified through normal fast-forward commits, no production DB migration. GitHub Actions pass while a separate platform Cloudflare build remains red. Production/staging acceptance and review/merge remain gated. |
| 80 | BLOCKED | Final verified APK | No agreed passing main merge exists and live/native/legal gates remain open. Version stays 0.3.25/55. No final production APK, checksum, signing certificate or install URL is fabricated. |
| 81 | PARTIALLY DONE | Timer inventory | Deterministic inventory: 231 timer/focus/lifecycle/native scheduling sites across mobile, portal and Worker plus cron; critical-loop table below. General source-pattern inventory is not full per-site cleanup/rate proof. |
| 82 | PARTIALLY DONE | Event-driven updates | Authenticated invalidation gateway and relevant message mutation publishers implemented; one focused HTTP coordinator. P2/P9. Gateway is OFF, notification/community/rider producers and deployed two-device tests remain incomplete. |
| 83 | PARTIALLY DONE | Workers/Neon architecture | ADR chooses optional user/institution Durable Objects with short auth leases, bounded sockets/events and no client DB credentials. P9. Operational cost/capacity approval and staging activation remain. |
| 84 | PARTIALLY DONE | Subscription lifecycle | One foreground socket per authenticated app; role/tenant/session/background/offline cleanup, shared focus clocks and burst coalescing. P2/P3/P9. Physical native socket lifecycle/leak traces remain. |
| 85 | PARTIALLY DONE | Reconnect/fallback | Capped jittered backoff, handshake watchdog, seq dedup/gap reconciliation, disabled-feature stop and focused HTTP fallback. P2/P9. Durable replay/delta APIs and live reconnect acceptance remain. |
| 86 | PARTIALLY DONE | Rider presence | Consent, foreground/focus guards and 30s location checks retained; stationary <15m samples suppressed within 90s, bounded previous-position cache. Dispatch events, active-assignment/battery adaptation and real motion acceptance remain. |
| 87 | PARTIALLY DONE | Local timer reduction | Offscreen/background exam/study/alarm/map/Kira clocks pause; streak rolls at WAT midnight; native event support and recorder-only clocks preserved. Native alarm/audio precision and all portal background loops remain to review. |
| 88 | PARTIALLY DONE | Measured polling proof | Synthetic 1,000-event coalescing, ordered/deduped stream, lease alarm, disconnect and account-change tests pass. No measured per-minute traffic, throughput, native battery/FPS or deployed message-delay comparison. |

## Critical loops and calculated budgets

Rates below are configuration arithmetic for successful steady-state work, not measured traces. Initial focus, user actions, retries and incoming events add requests. Multiple consumers can share one transport read. All 231 detected sites are listed in `docs/audits/2026-10-12-timers.md`; source classifications still require per-site owner/runtime review.

| Source / purpose | Endpoint or operation | Interval / budget | Scope and cleanup | Failure / replacement decision |
|---|---|---|---|---|
| conversation / chat | /v1/messages/threads/:id | 60s fallback: about 1 scheduled read/min; 300s with healthy stream: 0.2/min | Focused, foreground, connected; unsubscribe on blur/session change | Shared coordinator; jitter/backoff up to 5min; event reconciliation. Slower contingency than previous 10s is a release acceptance risk while live stream is OFF. |
| messages / inbox | /v1/messages/inbox | 90s fallback: 0.67/min; healthy stream max300s | Same coordinator; no screen-owned interval | Burst coalescing; preserve previous data. |
| notifications and unread badge | /v1/notifications/inbox | 90s: 0.67/min per logical consumer; timed same-turn reads can share | Focused/foreground/connected | Relevant push invalidation, no whole-app flush. |
| agent / rider queue | /v1/agents | 90s: 0.67/min; healthy stream max300s | Rider role and focused foreground | HTTP fallback retained; dispatch producer incomplete. |
| agent location | PUT /v1/agents/location | Local check30s; moving at most2 writes/min; stationary roughly0.67/min | Consented online rider with screen open and app active; interval cleanup | Suppress <15m within90s; manual refresh available. No automatic offline tracking. |
| notification bootstrap | Device/session/token endpoints | No periodic minute loop; one delayed bootstrap, token/events/daily resume; <=3 error retries | Signed-in eligible app; listener/timer cleanup | Backoff capped5min; denied permission does not repeatedly prompt. |
| alarm sync | Native ringing state / alarm REST on meaningful events | Native callbacks; old binary local10s compatibility scan (6 local checks/min, not six network calls) | Active app; callback/fallback removed on cleanup | Native exact alarm schedule remains OS-owned; device gate. |
| usage tracker | POST /v1/usage | Existing30s foreground sample: up to2 samples/min plus queue replay | No sample while background; mounted timer still needs complete local audit | Observational write, never cache invalidation; bounded48h/300-sample queue. |
| local clocks | Countdown/study/AI wait/map age/alarm display | Usually1s display only while useful; no network rate | Shared focus + foreground observer; stops on background/completion | Recorder/ring safety cadence retained. No frame/battery improvement claimed without measurements. |
| text retry coordinator | POST /v1/messages/threads/:id/messages | One transfer; capped exponential retry, max5 failures; <=40 pending threads | Foreground + connected + original trusted account/session; abort cleanup | Permanent denial blocks; manual same-ID retry or explicit new-draft conflict UI. No money/media queue. |
| live connection / user hub | POST /v1/live/ticket + one websocket | Ticket12/min/user cap; reconnect<=30s, handshake10s; authorization lease<=65s; max8 sockets/user-tenant | Active signed-in app; offline/background/logout closes | Invalidations only; sequence gap triggers HTTP reconciliation; featureOFF avoids busy retry. |
| portal payment return | GET /v1/payments/status/:reference | Initial plus at most5 retries every2.5s; bounded attempt, not continuous24/min | Mounted return page; clears timeout on exit | Stops on terminal state/error; authoritative status only. Hidden-page acceptance remains. |
| portal map studio | Import-job detail | Existing3s while RUNNING: up to20/min | Timer cleared on unmount; hidden/offline gating not complete | Retained in source inventory; requires separate event/backoff/visibility work. |
| portal broadcast campaign | Campaign detail | Existing10s while QUEUED/SENDING: up to6/min | Clears on status/unmount; hidden/offline gating not complete | No email sent by this task. Requires separate scheduler/background acceptance. |
| Worker cron | Existing delivery/payment/reconciliation jobs | Once/minute invocation; outbound work depends on actual queued rows | Server scheduled execution | Retained provider-safe job semantics; not replaced with client polling. |

## Feature input and result matrix

| Area | Inputs executed | Observed result | Still required |
|---|---|---|---|
| Class/exam/calendar parsing | Synthetic text/digital/empty PDF, valid/invalid times/dates/document kind/duplicates, mocked AI | Strict schemas, separate types, retained review and idempotent counts in automated tests | Actual photo/scanned/digital/pasted provider matrix, database/alarms after reviewed save |
| Kira/upload | Synthetic limits/transport/cancel/progress, mocked provider responses | Stage continuity, bounded retry, saved uploaded identifier, preserved text | Real Standard/Pro files, extraction, long output, hosted subscription/payment |
| Seller/tutor | Synthetic product drafts, repeated request IDs, campus/owner/deleted record cases | One same-payload create; invalid replays rejected; draft/busy gates | Authenticated publish/approval/gallery/keyboard/role UI |
| Rider | Existing finance tests, source GPS bounds, map/GPS helper cases | Authoritative source transitions and stationary suppression | Two riders, dispatch, cash/in-app, device motion/permissions/battery |
| Paystack/BACHS/learning | Isolated SQL, synthetic signatures/receipts/provider failures | Existing immutable amount/dedup/review/payout guards exercised | Approved sandbox-origin callbacks and hosted returns; no real money was tested |
| Messaging | Simulated encrypted restart, files, 40/41 threads, permission/offline/session changes, 1,000 wakes | No unsafe second intent; preserved newer draft; one shared transfer and bounded retry | Native process restart, two devices, real provider/push, media/audio usability |
| Communities/search | Source-shaped loading/previous result guards and existing contract suites | Search request states retained; no fabricated results | Real private/public roles, moderation, weak networks, full visual accessibility |
| Push/alarms | Existing routing/delivery unit/integration checks; native source event changes | Correct source routing and coalesced lifecycle | Actual channels, token rotation, foreground/background/terminated sound and permissions |
| Public web UI | Current 8fd51d8 preview root recovery→sign-in, terms→privacy cross-link and section-title headings | Exact origin-not-allowed error; usable labelled sign-in page; draft legal notice and 24/27 accessible headings present | Authenticated flows blocked by the preview origin allowlist; no credentials or account mutations made |
| Logout/isolation | Fake offline revocation, AEAD snapshots, epochs and concurrent account file cleanup | Local native credential path bounded; cached data stays scoped; gateway block preserves credentials | Real offline token-reuse test and web cookie revocation acceptance |

## Performance and operational facts

No comparable physical-device before/after performance dataset exists. Device model/OS/installed SHA, Wi-Fi/4G/2G/3G conditions, useful cold/warm start, cached reopen, frame times, RAM, battery, backend percentiles, payload bytes and timeout rate are all UNMEASURED. Passing regression/build commands is not substituted for those values.

Read-only Neon inspection found the expected message(thread_id,created_at,id) and notification(user_id,created_at) access indexes. The inspected database was small (about50 messages/3 threads/111 notifications/1 product); sequential plans on tiny tables do not prove an indexing fault. No database credentials were embedded in clients and no schema/production data was changed.

Unsigned read-only probes from this runtime to the configured Worker origin and mobile API proxy returned HTTP403 with `error code: 1010`, including readiness and public-config endpoints. Cloudflare documents1010 as a client/browser-signature access denial:
https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/
This does not prove that the user's phone is blocked, that all networks fail, or that the server is down. Security rules were not weakened, and no browser/network fingerprint workaround was used. Service security events and build logs need operator inspection through approved access.

A successful platformp Cloudflare build is a build/version receipt, not proof of the serving production revision: build 666c0c97-5177-432b-a91d-aeb9c6146df9, version 32759afc-3e69-4df1-a8ff-d5ad9a349cd3 for source 8fd51d8b3f979a890359dd3153c1a065a72ce4c9. A separate platform build eea26be3-3314-4379-a2ce-8bc9eaea8746 remains red without an exposed error cause. The explicitly created frontend preview dpl_7mWbUBJLoA5YVzurkT79raFMWmup is READY and maps to source 8fd51d8. Its session check returns the precise application error “This sign-in origin is not allowed”; this is distinct from the runtime's CLI Cloudflare 1010 responses. The existing service origin protections were preserved. An approved staging origin is needed for authenticated acceptance. See the validation receipt for exact IDs/outcomes.

## Security, legal and rollback

The storage ADR is `docs/architecture/2026-10-12-private-snapshots-and-live-updates.md`. Native records use authenticated AES-GCM and SecureStore key custody. Web private records are session memory only. Media bytes remain in the OS app sandbox; metadata is encrypted. This is not end-to-end encryption or a complete offline database replica. Cold offline login is not granted from editable cached role/profile data. Generic draft autosaves still need explicit per-form storage-pressure UX acceptance.

Unsubmitted primary records do not silently expire as disposable caches. Quotas protect existing drafts and reject new work when full. Owner/tenant changes, session epochs, logout key deletion and file cleanup are checked in synthetic tests. Device sharing, OS backup/keychain reinstall, SecureStore failures and screenshots still need independent/native review.

No financial ledger logic was changed to manufacture success. Existing append-only balanced record semantics remain authoritative. A cart, browser redirect, upload100%, cached entitlement or pending message is not a server-confirmed payment/delivery/save.

Privacy and Terms remain visibly DRAFT. The exact entity/contact/retention/processors/minor/refund/renewal/effective-date decisions and qualified Nigerian legal approval are required by the supplied master prompt and `docs/legal/2026-10-12-publication-checklist.md`.

Rollback uses ordinary source revert commits, preserving concurrent work. No production DB migration needs rollback. Disable staged realtime first if unhealthy; retain bounded push/HTTP reconciliation. Draft export/confirmation is required before intentional data clearing/uninstall or reverting to a build without encrypted-format support. Do not repair app state by editing ledger rows.

## Release blockers and next concrete work

1. Inspect the failing platform build log and client-signature403 security events; establish an approved reachable staging API/provider route and verify the actual traffic-serving Worker version.
2. Complete real class/exam/calendar/Kira file matrices and provider-approved sandbox payment/webhook/return/refund/payout cases, with isolated accounts and no production money.
3. Complete missing event producers and gated live staging capacity/cost/auth-revocation/multidevice tests; verify acceptable freshness while fallback remains active.
4. Audit remaining portal/background timers, general cursor/delta synchronization, every secondary view/state and per-form draft storage failures.
5. Test affected and mid-range Android devices, native crypto/alarm compilation, process restart, push/audio/keyboard and measured weak-network/FPS/battery/performance targets.
6. Obtain operator facts and qualified Nigerian legal review while keeping the DRAFT notice.
7. Review exact-head CI, resolve the separate Cloudflare build failure, pass staging/device/security/legal gates, then agree a main merge. Only that passing agreed main may produce a deliberately versioned/signed/checksummed final APK.

The release gate is RED. There is useful tested implementation in the draft branch, with specific remaining work; this report does not claim that all88 items or live payment/AI failures are complete.
