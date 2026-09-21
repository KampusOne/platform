# Post likes

Adds an outlined/filled heart and count to the shared compact post card. Feed, saved posts and post-detail copies share account/campus-scoped state. The UI updates immediately, prevents duplicate taps, rolls back failed writes, refreshes on screen focus and batches reads in groups of at most 50. Read failures expose Retry instead of a fake zero count. Existing copy deduplication, menus, bookmarks and URL sharing are unchanged.

API: authenticated GET /v1/student/feed/likes?ids=... plus PUT and DELETE /v1/student/feed/:id/like. Mutation identity comes only from the trusted session. The additive Neon migration adds one row per (post_id,user_id), a composite institution foreign key and a locked, idempotent database function returning the authoritative count. Draft, scheduled, archived, missing and cross-campus posts are unavailable. No client database access or new environment variables.

Checks: API authorization/validation tests, 10 client-state regression tests and isolated PGlite migration tests. Run `npm test` in server, `npm run check` in mobile and `npm run export:web` in mobile. Apply database/neon/migrations/20260921183000_feed_post_likes.sql before deploying the new Worker. The frontend and Worker must both deploy; this does not replace an installed native binary.
