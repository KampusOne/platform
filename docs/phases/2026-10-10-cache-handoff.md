# KampusOne cache implementation handoff

## 1. Current branch / PR / base SHA / head SHA.

Branch: perf/secure-universal-cache-20261010. [PR #89](https://github.com/KampusOne/platform/pull/89).
Audited base/main: e0fd01069778d76715dbc8ceb98bb77fbcadcf0d.
Original PR head: 8b6d8e15cb5a41999268846b4005a2e1a346b7d1.
A fresh fetch confirmed both before publishing. Final implementation SHA and matching Actions links are recorded in the PR completion message; this file belongs to that implementation tree.

## 2. Source files read and architecture summary.

Read AGENTS.md/portal guidance, supplied audit, Worker app/index/config/types/database/auth/security, mobile API/transport/policy/device/map storage/auth/notifications, portal session/API/policy and installed Next fetch docs, student/maps/map-capture/campus-admin/agents/notifications/website/learning/media/payments/messages/AI/account boundaries, cache/native/session tests and CI/deployment/release workflows.

Stack remains Hono/Workers, Neon HTTP/Drizzle, Expo/React Native, Next App Router and R2. No Redis/KV/Hyperdrive, replacement framework, pricing/checkout rewrite, landing redesign or user-data export. Auth stays request-local; shared caches contain audited reference values; private snapshots stay in session RAM.

## 3. Route-by-route policy manifest: shared / private RAM / coalesced / fresh.

[Manifest](../cache-route-manifest.json): all 496 mounted method/path pairs, source locations, authorization, backend namespace and client TTLs. AST generation follows nested mounts and merges overlapping registrations; a separate test compares real Hono routes. New/unknown routes default fresh. [Architecture](../caching-architecture.md) contains loader scopes/TTLs. Writes are fresh; financial/security/metered completed TTLs are zero.

## 4. Existing PR #89 bugs found and actual fixes.

- Mobile late responses could resolve to old-account callers: session epochs cover coalesced/bypass reads and token-refresh waits.
- Portal missed A → B → A and institution/role changes: trusted context scope and epochs cover every private response.
- Unknown or sensitive GET subpaths inherited reuse: explicit allowlists default to zero.
- Forced refresh joined old flights: independent reads and invalidation generations block old cache population.
- Catalog had no durable revision; map writes relied on selective hooks: transactional triggers cover direct writes/imports and all map sources.
- Independent map place detail lacked tenant checks: trusted institution and campus/place relationship now constrain SQL.
- Shared helper trusted Cache API expiry, lacked bounds, and repeated loads during slow puts: envelopes, limits, jitter and write-window singleflight.
- Generic AsyncStorage held profile/session snapshots: RAM only plus legacy scrubbing.
- Portal unreadable successful JSON could cache null: explicit invalid-response error; abort/timeout semantics preserved.
- Today survived midnight WAT: expiry capped at the day boundary.

## 5. New cache helpers, backend routes and invalidation hooks added.

Revision wrapper, value cache, request/auth/DB metrics, mounted route policy generator/manifest. Loaders cover catalog, map directories/geometry/counts/path graph, approved categories, default sound metadata, published articles and website settings. Latest release and personalized likes remain fresh.

Migration source Git blob: 2e316b2d99e7925789175bf8ea3054ec85d27265. Six private namespaces, transactional statement triggers and affected-campus transition triggers. Tests cover rollback, 1,000-row import, moves/deletes, source tables/controls, monotonic metadata, dependencies, reruns and privileges.

Mobile invalidation covers social/block/follow, timetable/alarms/home/calendar, learning, accounts and commerce. Foreground focus/push clears RAM. Same-context token renewal retains safe reads; account/context changes clear them.

## 6. Security / tenant / finance exceptions intentionally left uncached.

No shared profile, feed personalization, DM, membership, operator permission, session/restriction, media entitlement, signed URL, balance, checkout/order/payment state, subscriptions, commissions/payouts, stock reservation, Kira entitlement/quota/provider response or GPS result. Store mixes prices/eligibility and stays fresh. Only route reference graphs may be shared; current endpoints and origins are fresh.

Published campus lists support institution discovery; detail/geometry/place objects require the user's institution. This preserves explicit reference discovery while fixing independent place-detail access.

Private social display reuse has a stated 1.5–5 second window and no extended stale retention. Other-device edits may take that window to appear; API authorization always runs fresh on network requests.

## 7. Tests executed, test results, CI run links; no cherry-picked results.

Local results: 852 Worker tests across 102 files; 10 contracts tests; 194 root regression tests; 6 academic-importer tests. Server/contracts/mobile/portal type checks, portal lint/build, mobile GPS/map/alarm checks and production web export, route manifest check and Worker bundle dry-run passed. Local Wrangler runtime startup failed with uv_interface_addresses / network-interface error in this workspace. Matching GitHub Actions must establish the unmodified runtime crypto check. Final CI links appear in the PR description; old-head CI is not evidence for new code.

Initial full Worker verification found five failures because the browser fixture lacked addEventListener after focus invalidation was added. The fixture was completed without weakening assertions; session tests passed and full verification was rerun.

Real Neon rollback rehearsal: project rough-breeze-36415261, branch br-mute-sunset-ayzh9xrc, neondb. New branch creation hit the project limit; reused the existing isolated branch without reset/deletion. All 18 prerequisites present. Migration and verification ran in one transaction ending ROLLBACK; result cache-rehearsal-passed. A separate request confirmed the new revision table remained absent.
[Exact source/method evidence](../../database/verification/rehearsal-20261010-cache.json). Production unmodified.

## 8. Before/after p50/p95/p99 and Neon query counts, with environment/method.

Synthetic Hono campus-features test with an in-memory Cache API adapter and counted SQL: cold 4 queries; warm 3, including one fresh auth query in both. Warm reads skip geometry but retain auth, tenant/publication and revision checks. Revoked/restricted/cross-tenant requests fail before cache lookup. This validates query shape, not production latency.

Live p50/p95/p99, active-session totals, Worker CPU/memory, Android rendering, hit ratios, provider costs and capacity are unmeasured. Metrics support controlled staging measurement. Guarded k6 workload is not run against production or assumed to establish 10,000-user capacity.

## 9. Deployment evidence: staging/production and rollback flags.

No Worker/portal/mobile deployment or production migration was performed. Both Wrangler environments keep VERSIONED_READ_CACHE_ENABLED=false; shared loaders read origin fresh until activation. SHARED_READ_CACHE_ENABLED=true alone is insufficient. Metrics enabled in reviewed configuration.

An authorized operator must review/apply migration, run transactional/privilege checks, record exact-source production-20261010-cache.json, test staging with two synthetic tenants and promote a verified SHA. Production deployment guard rejects activation without this proof. Either shared flag false bypasses shared caching. With keep_vars=false, reconcile dashboard changes before the next deploy. Client kill switches require new builds.

## 10. Current Android APK artifact linked to SAME source SHA, if produced.

No APK produced. Web export is not an Android artifact. No unrelated existing APK is presented as this release.

## 11. Remaining risks and deferred/blocked work, with reasons and owners.

| Audit question | Answer / remaining owner |
| --- | --- |
| Q01 auth wall-time share | New auth/DB counters permit measurement; live percentage pending operations baseline. |
| Q02 slowest live p95 | Unmeasured; operations aggregate route-template logs before expanding caches. |
| Q03 missing indexes/N+1 | No unmeasured index claim; existing count batching preserved. Backend owner samples synthetic staging plans. |
| Q04 map mutation coverage | Statement/transition triggers cover sources and direct SQL; local and real Neon rollback rehearsal pass. |
| Q05 cross-institution campus list | Published reference discovery allowed; detail/geometry remain institution-bound. |
| Q06 independent place lookup | Fixed with trusted institution guard. |
| Q07 personalized responses | Feed liked/bookmarked, follow/block, store eligibility, DM/membership are not shared wholesale. |
| Q08 portal fetch bypass | Exclusive availability direct fetch uses no-store; transport bypasses RAM/coalescing during SSR. |
| Q09 private disk snapshots | Generic profiles/session RAM only; legacy disk scrubbed; secure tokens unchanged. |
| Q10 geometry device size/CPU | Internal JSON bound 8 MiB; 5,000-feature query/chunked map persistence retained. Physical device QA pending. |
| Q11 durable switch | Checked-in environment flags/proof gate/deployment reconciliation cover keep_vars=false. |
| Q12 safe hit metrics | Route template and counts only, with privacy assertions. |
| Q13 expiry storms | Downward jitter/bounded per-isolate singleflight includes put; cross-region load impact unmeasured. |
| Q14 stale OK masks failure | Unknown/critical routes fresh; explicit refresh bypasses; failed loads not cached. |
| Q15 retry side effects | Existing payment/message/media/AI tests preserved; no write replay added. Paid/push sandbox soak remains QA. |
| Q16 moderation/restriction | Local mutation/push/focus invalidation; maximum 5-second social reuse; fresh network restrictions. |
| Q17 rider GPS | GPS/route result fresh; reference map/path data only shared. |
| Q18 Hyperdrive | Binding-only switch incompatible with current Neon HTTP; separate measured driver evaluation deferred. |
| Q19 scaled monthly costs | No new paid cache provider; operations must measure actual traffic/CPU/write contention. |
| Q20 no-store layers | Neon request no-store, outward response no-store and internal value TTL are separate boundaries. |
| Q21 latest APK/links | R2 manifest fresh, download no-store, config at most existing 15-second HTTP window. |
| Q22 offline private content | No new private disk payload; encrypted opt-in retention needs separate product/privacy review. |
| Q23 DM counters/receipts | Read invalidates inbox; send invalidates messages/notifications; cancellation caller-local. Multi-device soak pending QA. |
| Q24 shared academics/alarms | Timetable/learning/alarm/calendar/exam writes invalidate relevant lists/Today; WAT test passes; server transaction behavior unchanged. |
| Q25 remote branch/CI | Main/original PR head rechecked before publish; final matching checks linked in PR. |

Global resource revisions can contend on busy writes and invalidate unaffected tenants conservatively; revision queries add miss cost. Cache API and singleflight are not globally distributed locks. Operations owns deployment/live measurements; mobile QA owns physical Android/network/multi-device validation. Feed/store read-model splits, indexes, per-tenant revision sharding and Redis remain measurement-driven follow-ups.

## 12. Summary of user-visible impact on home/feed/DM/map/marketplace/Kira.

Late old-session payloads are rejected. Safe repeated reads use bounded RAM; explicit refresh fetches new data; cancellation stays caller-local; Today expires at midnight WAT; private generic snapshots leave shared disk storage. Once migration/cache gate is activated, reference loaders can avoid large backend reads. Feed/DM retain brief display reuse; prices/orders/permissions and Kira quota/provider operations remain authoritative.
