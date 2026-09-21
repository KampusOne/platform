# Comment likes and author identity

## Requested behavior

Every comment has its author's saved profile photo, display name, optional username, verification indicator and timestamp. Comments use the existing compact brown product styling, with the text and like action aligned beneath the author identity. A missing or failed photo falls back to initials; post attachments are never used as avatars.

Each comment has its own heart and count. Tapping again removes the current user's like. Pending writes reject duplicate taps, failures restore the previous UI state, and late reads cannot overwrite newer mutations. Reads are batched in groups of at most 50, refresh on screen focus/comment refresh, and are isolated from post likes and other signed-in accounts.

Existing comment creation, draft retry IDs, pagination and owner-only comment deletion are retained. The post action order is untouched: Like remains before Comments.

## API and persistence

- `GET /v1/student/feed/comment-likes?ids=...` returns only accessible, undeleted comments and their per-viewer state.
- `PUT /v1/student/feed/comments/:commentId/like` and `DELETE` set an explicit desired state using the authenticated actor, not request-body identity.
- `public.feed_comment_likes` uses a composite `(comment_id, user_id)` primary key and an institution-bound foreign key. The database function locks the real parent post before the comment, enforces publication/audience/deletion and counts stored rows.
- `GET` and `POST` comment responses both include `author_image_url` from `profiles.profile_image_url` and `author_username` from `profiles.username`. Private profile fields are not added.
- The new route checks schema readiness and returns a recoverable 503 when comment-like storage is not installed. Existing comment reading/posting does not depend on the new like table.

## Rollout and verification

The production Neon database already contained the compatible comment-like table and four-argument function when inspected. The repeatable migration in this change records that schema for other environments; existing user data is not rewritten. No new API keys or environment variables are needed.

Automated coverage is in `server/src/routes/feed-comment-likes.test.ts` and `tests/feed-comment-interactions.test.mjs`. The former runs with the Worker tests; the latter has a dedicated read-only CI workflow. Full mobile/Worker type checks and builds remain part of the existing platform workflow. Check actual CI and deployment results for this commit before describing it as live. A signed-in two-account device check is still required for end-to-end visual acceptance.
