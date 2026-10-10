# Cache architecture — 10 October 2026

The [route policy manifest](cache-route-manifest.json) covers all 496 mounted method/path pairs, including nested and overlapping routers, with source locations, classifications, authorization and client TTLs. Generate it with node server/scripts/cache-route-manifest.mjs; --check and a real Hono app.routes comparison run in CI. This describes policy, never authorization or generic response-cache middleware. New routes default fresh.

## Client reads

Mobile and portal share identical default GETs in flight and reuse only allowlisted completed results in session RAM. Cancellation belongs to each caller. Explicit headers, no-store and representation-changing options bypass coalescing. Reload/no-cache start independent reads and send Cache-Control: no-cache through the Worker.

| Data | Fresh reuse | Mobile display retention |
| --- | ---: | ---: |
| Public app config | 15 seconds | 30 seconds |
| Academic catalog | 60 seconds | 5 minutes |
| Campus geometry/place directory | 15 seconds | 15 minutes |
| Timetable/GPA/calendar/alarm/course lists | 30 seconds | 5 minutes |
| Today | 8 seconds | 2 minutes, capped at midnight WAT |
| Own profile | 10 seconds | 10 seconds |
| Feed/post/comment | 5 seconds | 5 seconds |
| People/search (mobile only) | 3 seconds | 3 seconds |
| DM inbox/thread | 1.5 seconds | 1.5 seconds |
| Notifications inbox | 2 seconds | 2 seconds |
| Other reads, money, security, AI/quota, inventory, live GPS | None | None |

The actual allowlists in mobile/src/lib/request-policy.ts and portal/lib/api-cache-policy.ts are authoritative. Portal has no extra stale-display window. Display snapshots never authorize financial or security decisions.

Cache context includes trusted account ID, institution, roles and operator roles. A separate session epoch rejects late responses after account/context changes, including A → B → A, bypass requests and refresh waits. Same-context token renewal may preserve reads. Mutation generations prevent late cache repopulation. Mobile invalidates related resources before/after writes; portal clears snapshots before/after writes. Focus/foreground and foreground push clear local reads. Each transport has a 60-entry LRU limit.

Generic device cache persists only UUID-scoped streak-open and push-registration bookkeeping. Profiles, last-session and unknown payloads stay in RAM; startup removes their legacy unencrypted AsyncStorage entries. Storage operations are serialized and generation-guarded. Secure refresh-token storage is unchanged. The separate institution/campus map disk store contains public reference places/geometry, chunked for Android limits and refreshed by the map screen.

## Shared Worker values

Fresh authentication, active session/account, restrictions, tenant and object checks precede shared lookup. No shared value includes credentials, sessions, user permissions, personalized social state, paid decisions, GPS origins or signed media URLs.

| Resource | Revision namespace | Worker TTL maximum | Scope / fresh dependencies |
| --- | --- | ---: | --- |
| Academic catalog | academic.catalog | 300 seconds | Institutions-only/full; validated institution selector |
| Legacy campus directory / campus places | campus.maps | 120 seconds | Institution; campus/revision and normalized search where applicable |
| Campus features | campus.maps | 600 seconds | Institution/campus/map revision; publication check fresh |
| Walking path graph | campus.maps | 120 seconds | Institution/campus/revision; current endpoints/GPS fresh |
| Campus map counts/toggles | campus.maps | 120 seconds | Map display capabilities; auth/runtime satellite config fresh |
| Approved product categories | commerce.categories | 300 seconds | Sorted institutions from a fresh agent authorization lookup |
| Default sound metadata | notification.sounds | 60 seconds | Institution/global; media URL composed fresh |
| Published articles / article | website.articles | 30 seconds | Published projection; validated slug; personal like state fresh |
| Public website settings | website.settings | 60 seconds | Settings only; latest Android R2 manifest fresh |

The revision-aware wrapper reads a small uncached namespace revision on every request, trading one SQL execution for avoiding larger reference reads. Missing schema/row, invalid revision, disabled flags or cache failure load fresh data. There is no unversioned fallback. Explicit refresh skips revision and cache lookups.

The value helper hashes environment/resource/scope into internal v2 keys, bounds JSON at 8 MiB, validates its own envelope/timestamps/expiry, caps TTL at 900 seconds and adds downward jitter. Cache-Control on this internal response applies only to the value store. Authenticated outward JSON remains private, no-store; articles are no-store. Website config keeps the existing 15-second public HTTP window. APK download/latest remains no-store.

Singleflight covers match/load and pending cache.put within one isolate, with at most 128 tracked keys. waitUntil handles writes without delaying the live result. Cache API is per data center, not a global distributed lock. Oversize/busy cases bypass caching without changing correctness.

## Transactional invalidation

Migration 20261010120000_versioned_read_cache creates six private revision rows and statement triggers. Catalog, map, category, sound, article/like and website-setting edits increment revisions in the write transaction, including direct scripts/imports. Failed transactions roll back both data and revision.

Transition-table triggers increment each affected campus map_revision once per source statement, including old/new campuses on movement. Sources include places, geometry, paths, entrances, photo metadata and controls. Campus metadata revisions stay monotonic; media updates/deletions invalidate dependent maps/sounds. Existing procedures may also increment a revision: monotonicity matters, not consecutive numbering. Old keys expire normally.

Resource revisions are global per family, so one campus edit can invalidate other campuses without sharing tenant data. This conservative dependency coverage avoids missed writes; partition only after measurement. Statement triggers avoid per-row namespace writes during imports but may contend under high concurrent write traffic.

The table has RLS and no PUBLIC privileges; trigger functions have no PUBLIC execute grant. The current server owner can use them. Review revision SELECT/UPDATE privileges and RLS before changing the Worker database role. Never expose this table through a client data API.

## Metrics, rollout and rollback

READ_CACHE_METRICS_ENABLED=true emits read.performance with request ID, method, route template, status, wall time, SQL executions/HTTP round trips, summed DB time/failures, auth duration/query count/DB time and cache outcomes. It records no SQL, parameters, tokens, raw paths, search terms, emails or user IDs. Parallel queries can make summed DB time exceed wall time. read.cache.background records a late cache-write failure. Client rendering, provider billing and Worker CPU/memory require separate measurements.

Shared reuse requires BOTH SHARED_READ_CACHE_ENABLED=true and VERSIONED_READ_CACHE_ENABLED=true. This PR leaves the versioned gate false in staging/production pending reviewed migration and rollout evidence. The deployment workflow requires exact-source production-20261010-cache.json proof before activation. The rollback-only rehearsal is not production proof.

Wrangler keep_vars=false can overwrite dashboard changes on deploy. Change the correct checked-in environment and deploy a reviewed SHA; reconcile emergency runtime changes immediately. Either shared flag false bypasses storage. If invalidation was unavailable while data changed, bump revision before enabling again.

EXPO_PUBLIC_READ_CACHE_ENABLED=false and NEXT_PUBLIC_READ_CACHE_ENABLED=false disable completed client reuse in NEW builds, not remotely on installed APKs. Revert/deploy the verified transport for urgent client rollback.

Before activation, measure cold/warm p50/p95/p99 and query counts on isolated staging, test two synthetic tenants/accounts, edits/path closures, revocation, cache failure, signed-media expiry and payment sandbox replays. Follow tests/load/README.md for a budgeted synthetic load/soak test. No production latency or capacity result follows from unit tests. Retain Neon HTTP; Hyperdrive needs a separate measured driver migration.
