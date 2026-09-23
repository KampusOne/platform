# Performance and loading repair — 23 September 2026

## Changes
- Replace circular route/action indicators with feed/profile/list skeletons and compact non-circular action progress. Static placeholders avoid animation CPU cost and respect reduced motion.
- Share timed GETs across independently cancellable consumers. Keep account-scoped memory cache; explicit refresh and mutation invalidation preserve correctness. View tracking no longer flushes the whole app cache.
- Project like counts, viewer like state, avatars and view counts with feed data; skip redundant enrichment. Seed like stores for immediate interaction and keep optimistic rollback/version guards. Comment counts are returned with comments as well.
- Reuse authorization only within the same already-validated Hono request, never across requests/users. All restrictions and session checks still run before the request is marked authenticated.
- Start session restoration while fonts download, remove the cosmetic intro cover, and render the known profile before ancillary purchase/academic/saved-post reads finish.
- Fix same-origin avatar URLs; add fixed-size photo skeleton/retry states. New photo output is bounded to 512px avatars, 1200px covers and 1280px post images; existing uploaded files are not transcoded.
- Preserve public image cache headers through the web proxy while the Worker defaults JSON/private responses to no-store. Do not share private or signed file data in public caches.
- Web exports include a revision manifest; safe entry/login checks refresh stale builds once per target revision. Existing pre-fix browser bundles cannot run a guard they do not yet contain.

## Verification boundaries
Run TypeScript checks, the dependency-free regression tests, Worker tests and Expo production export before merging. Re-test on a mid-range Android device and a constrained network after deployment. This patch is not a 5,000-user capacity certification. Authenticated production timings and a controlled staging load test remain necessary; no large traffic test should target production or create real user data.

## No configuration migration
No new provider key, public database access, database migration or paid service is introduced. Preserve all tenant filters, private file authorization and crop-before-save behavior.
