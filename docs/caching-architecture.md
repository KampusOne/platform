# Cache architecture — KampusOne (October 2026)

**Scope:** Caching applies across the student and operator experience, but all
**financial, security, live-location and AI usage decisions remain authoritative**.
"Everything cached" means every area benefits from an appropriate read strategy,
not that every response can safely be reused for minutes.

## Current implementation

1. **Mobile API transport (all /v1 feature groups):** GET requests without
   custom headers or `cache: "no-store"` are coalesced while in flight. Read
   snapshots are held **only in per-session RAM**, never in AsyncStorage,
   browsers' shared caches or a CDN. On account switch/logout, cached reads
   are invalidated. Writes invalidate related reads before and after requests.
2. **Academic/map/static directories:** 30 seconds–5 minutes of fresh reuse,
   with a bounded stale snapshot for loading placeholders/offline presentation.
   Backend stores non-personal campus places/features by institution, campus,
   map revision, and search query. Catalogs are cached independently.
3. **Feed, profiles, communities, marketplace:** short-lived, in-memory
   client snapshots (5–12 seconds), with scoped mutation invalidation.
4. **DMs and notifications:** very short-lived, account-local RAM cache only
   (1.5–2 seconds), with a maximum retained snapshot of 10–12 seconds for
   existing-view placeholders. Live updates still refresh from the server.
5. **Payments, orders, wallets, commissions, payouts, auth, admin, AI usage,
   live GPS and checkout:** no reusable cache snapshot. Concurrent reads can
   share a single in-flight request, but every later read revalidates against
   the authoritative system. Writes are never cached. Prices and permissions
   are verified again server-side.

## Backend rules

- Only explicitly non-personal datasets call `cachedSharedRead()`. It runs
  after route authentication (where required), never caches auth headers, and
  caches JSON values rather than full user-facing responses.
- Map cache scope uses `institution_id:campus_id:map_revision` (and normalized
  search query). A revision change yields a new key. Cache failures fall back
  to Neon. Short TTLs are a backstop if an editor forgets to bump the revision.
- Catalogs are public data and use `institutionsOnly` and validated university
  identifiers in the cache key.
- The actual API responses remain `private, no-store`, so the Worker object
  cache cannot replay another person's credentials or stale session metadata.
- The helper deduplicates concurrent misses per Worker isolate. The Cache API
  is per data center, so this is **not a global distributed lock**. If traffic
  grows enough to cause cross-region stampedes, add a durable lock / queue or
  use Cloudflare's Worker caching SWR for a separately authenticated public
  entrypoint.
- **Kill switch:** set `SHARED_READ_CACHE_ENABLED=false` in the Worker runtime
  vars; no code deployment is needed to bypass the cache.

## Rollout and observability

1. Confirm source lint/typecheck/tests; test two institutions, two accounts,
   admin updates, map_revision changes, bad network, and malformed cached data.
2. Record p50/p95 API latency, Neon query counts, 4xx/5xx, and cache-hit rates
   before/after the change. Cache is an optimization, never a correctness gate.
3. Validate receipt, payment summary, vendor price change, wallet and rider
   location always read fresh; invalidate local cached screens after mutation.
4. Check memory limits, response sizes, and security/per-tenant isolation
   before expanding Worker shared caching to new endpoints.

**Hyperdrive:** The existing server uses `@neondatabase/serverless` over HTTP.
It cannot be switched to Hyperdrive simply by adding a binding. A separate
PostgreSQL driver migration with connection pooling and performance tests would
be needed. Do not expose DATABASE_URL or start caching SQL with writes enabled.

## Limitations

This change does not promise zero network latency or offline processing of
payments, authentication, AI requests or messages. Those features must still
contact the service for a newly authoritative result. Stale snapshots are for
display continuity where safe, **not** for permissions or charging decisions.
