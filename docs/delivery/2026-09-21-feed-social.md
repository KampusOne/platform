# Shared feed interactions — 21 September 2026

## Behavior
Signed-in, onboarded KampusOne users can comment, delete their own comments, repost, undo their own repost, and quote a post with commentary above a linked original. Only the authenticated author may delete their post. Compact spacing, deduplicated post text, and URL-only sharing are retained.

## Audience
New student posts explicitly use audience.visibility = PUBLIC: all signed-in, onboarded students across institutions, without a follower requirement. Existing posts are NOT retroactively made public. Quotes of campus-only originals remain campus-only. Every read still requires published/corrected status and publication time. Private communities, academics, marketplace, identity documents and the public landing site are unchanged.

Sent to everyone means discoverable in the shared feed, not mass push/email/SMS notifications. Feed and threads refresh on focus and through visible refresh controls. Pages contain at most 40 records. Reposts bump the original once with attribution instead of duplicating cards. Keyset cursors preserve PostgreSQL microseconds and use ID tie-breakers.

## Storage and security
Migration: database/neon/migrations/20260921180000_feed_social_interactions.sql. Adds quote references, feed_comments, feed_reposts, unique request/repost indexes and institution foreign keys. RLS enabled; no public table grants. The existing authenticated Worker remains the only boundary. No additional environment variables, provider keys or paid services.

Post deletion archives the row and removes bookmarks/reposts. Quotes retain their author's separate text but no longer receive the unavailable original. Comments use author-only soft deletion; owning a parent post does not authorize deleting someone else's comment. Moderation stays separate. Server validation covers bodies, UUIDs and cursors. Posts retain the four-character minimum and a 5,000-code-unit maximum; comments allow 1–2,000 code units. Rate limits, stable retry IDs and unique constraints protect writes.

## API
The new router precedes legacy feed routes. Collection/detail reads fall back when the schema is absent; social writes return unavailable, never false success or an accidental plain post in place of a quote.

- GET/POST /v1/student/feed: paginated shared feed / create plain or quote post.
- GET/DELETE /v1/student/feed/:id: visible detail / author-only archive.
- GET/POST /v1/student/feed/:id/comments: paginate / create comment.
- DELETE /v1/student/feed/:id/comments/:commentId: remove own comment.
- PUT/DELETE /v1/student/feed/:id/repost: idempotent repost / undo own repost.
- PUT /v1/student/feed/:id/bookmark: validate visibility before saving.

## Rollout and verification
The additive schema was applied to the existing KampusOne Neon production branch on 21 September. No existing post body, status or audience was changed by this migration.

Local verification: six Node helper/source-contract checks and TypeScript syntax transpilation passed. These are not full type checks or interactive device tests. New Vitest tests cover auth, ownership predicates, visibility, quote filtering, cursors, validation, retry IDs, repost uniqueness and failed storage. Existing legacy deletion tests remain unchanged. Platform CI runs full Worker/mobile checks/builds; a separate workflow runs old and new pure feed regressions. Record actual CI/deployment status in the pull request before claiming release completion.

Live two-user device testing remains necessary: A posts; B sees/comments/reposts/quotes; B cannot delete A's post; A cannot delete B's comment; B can remove B's comment/repost; deleting the original leaves only B's quote commentary plus an unavailable-original placeholder. Also verify slow/offline retries, narrow Android screens, iOS keyboard, web links and dark mode.

Rollback: revert code first and retain additive tables to preserve interactions. Do not delete data as part of code rollback.
