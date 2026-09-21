# Comment likes — 21 September 2026

## Delivered code

Every feed comment renders a compact themed heart and count beneath its text, including newly added and paginated comments. Tap to like; tap again to unlike. Existing post action order and comment/post deletion permissions are unchanged.

Comment buttons reuse the post-like state machine with a separate account/campus-scoped cache and comment-only API transport. This preserves optimistic feedback, synchronous duplicate-tap guards, failed-write rollback, stale-read protection, request timeouts, accessible labels, and batch reads capped at 50 IDs. Refreshing comments and returning to the screen reload counts. No new environment variables or provider keys are required.

## API and storage

- GET /v1/student/feed/comment-likes?ids=<comma-separated UUIDs>
- PUT /v1/student/feed/comments/:commentId/like
- DELETE /v1/student/feed/comments/:commentId/like

All endpoints require the existing authenticated session and a campus profile. Server identity is authoritative. Parent-post visibility and publication state are checked for reads and writes. Deleted comments, archived/future posts, and inaccessible campus posts cannot receive likes. One row per comment/account prevents duplicate likes; totals are read from stored rows, not mutable client counts. The additive migration is `database/neon/migrations/20260921184500_feed_comment_likes.sql`.

## Verification and rollout

The additive migration was applied to the connected KampusOne Neon production database. Eleven database checks passed: like, repeated like, unlike, repeated unlike, missing target, null target, public cross-campus access with correct institution binding, campus isolation, archived parent, future parent, and deleted comment. All test fixtures and temporary parent changes were rolled back.

API regression tests are in `server/src/routes/feed-comment-likes.test.ts`; existing post-like-store regressions also cover the reused state machine. CI/server/mobile builds and deployment status must be verified for the final commit before declaring the live UI verified. A signed-in browser/device click-through remains a separate acceptance check.
