# Feed comments, reposts and quotes

## Delivery status

Implementation prepared on top of main `650575948d830a1c7fecb6024759f12c8cde8000`.
The latest compact card and `getFeedPostText` deduplication are preserved.
The migration has **not** been applied to the live database. Do not merge/deploy
this Worker before the schema prerequisite is approved and applied.
No new environment variables, provider keys or npm dependencies are required.

## Behavior and permissions

- Public student posts are available across KampusOne in the shared Feed.
  This is an explicit product exception to campus-scoped reads; campus editorial
  posts and private academic, commerce and identity records remain scoped.
  An explicitly private post is not returned by these endpoints.
- Only the authenticated post author can archive their original or quote.
  Request-body author IDs and UI visibility are never authorization sources.
- Comments are paginated, authored by the authenticated user, and deletable only
  by that comment's author. The original post author has no delete override.
  Deletion erases comment text while retaining an idempotency tombstone.
- A repost stores one `(post_id, user_id)` reference. Repeated PUTs cannot create
  duplicates. Undo removes only the caller's reference, never the original.
  The shared feed shows the latest reposter and reorders by latest activity.
- A quote is a new independently owned post, with commentary above an original
  post reference. Deleting a quote does not affect its original. If the original
  is unavailable, the quote retains its own commentary and displays a tombstone;
  archived original text is not returned in the embedded preview.
- Existing ellipsis menu, save action and URL sharing remain intact. Shared links
  point to the existing student web application, not the separate marketing site.
- Feed and comments use bounded cursor pagination. Feeds update on focus or pull
  to refresh. This is not an implementation of realtime push, mass notifications,
  follower ranking, or server-side full-text search.

## Reliability

Comment/quote creation uses a stable client request UUID, with database uniqueness
and same-body/same-target checks. Target-row locks serialize publication checks
with original-post deletion. Mutations read counters after the write statement.
Comments and repost creation are limited to 120 actions/hour/user; quote creation
shares the existing 10-posts/hour/user quota. Request failures preserve drafts.
The UI has a synchronous duplicate-tap lock, an 18-second mutation/read timeout,
confirmed deletion, skeleton loaders, pagination, explicit errors and reduced
motion support. No successful deletion is shown before a successful API response.

## Database and release sequence

1. Review/apply `database/neon/migrations/20260921170000_feed_social_interactions.sql`
   using the project's approved migration workflow. The connected Neon project's
   `feed_posts` schema was inspected read-only; its existing request index and
   title/summary constraints match the migration assumptions.
2. Test on an isolated database branch with separate users: same and different
   campuses, own and other users' posts/comments, private and archived originals,
   repeated request IDs, and concurrent archive/comment/repost/quote requests.
   Run with the same database role as the Worker, not only a privileged test role.
   The new tables have RLS and no public policy/grant. Use the existing trusted
   Worker owner role or explicitly reviewed least-privilege grants/policies;
   never grant a browser or public data API access.
3. Require passing CI type checks, tests and builds, deploy the Worker, then deploy
   the mobile web bundle. Test the authenticated flows on two accounts and an
   Android/iOS device before claiming the feature is live.
4. If rollout fails, revert application code first; keep additive schema and
   interaction data. Do not drop tables containing user content to roll back.

## Verification record

Local TypeScript transpilation/syntax diagnostics: **8 changed TS/TSX files passed**.
The expanded `feed-posts.test.ts` covers route authentication, validation, public
visibility SQL, private/archived exclusions, author predicates, comments, unique
reposts, undo, quotes, rate limiting, pagination and failure responses.
The first CI run passed all 38 route/SQL-contract tests, both server and mobile
type checks, mobile web export, compact-card regressions, contracts, portal checks
and the database review. Its integration suite caught a missing migration in the
test bootstrap; the bootstrap now applies this migration.

`server/tests/feed-social-database.test.ts` additionally exercises the real
authenticated HTTP routes against an isolated PostgreSQL/PGlite schema with the
migration applied, synthetic users from two campuses, actual inserts and reads.
It covers visibility, legacy posting, pagination, comment ownership and request
replay, unique reposts/undo, bookmark cleanup, quote ownership, emoji quotes,
archived originals and transferred authors. This is not a live Neon branch or
a concurrency/physical-device test. The latest CI result is recorded on PR #10.
The local image cannot install project dependencies; full checks run in CI.
No real user content was deleted, no live migration was applied, and physical-
device share sheets or complete signed-in browser journeys have not been tested.
