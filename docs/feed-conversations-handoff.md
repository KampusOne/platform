# Feed conversations — 21 September 2026

## Requested behavior

Students can comment and delete their own comments. Only the author can delete a post or quote. Repost preserves the original author and content; Undo repost removes only the caller's repost. Quote publishes the caller's own text above a linked original. Existing share buttons continue sharing the exact post URL.

## Audience decision

New student posts explicitly use audience.visibility=GLOBAL and are readable by signed-in, onboarded students across institutions. This is a shared feed, not a push/email/SMS blast. Historical campus posts, official institution notices and private academic/community records are not retroactively made global. A quote of campus-only content stays campus-only. All read, bookmark, comment and repost paths apply the same publication/audience policy. Deleted/unavailable originals are not embedded as copied snapshots. Their quotes retain only the quote author's own contribution and show an unavailable-original placeholder.

The social publication exception does not weaken tenancy in any other product module. University metadata remains on posts and interactions. Clients never submit a trusted author ID; server identity controls every mutation. Post ownership survives a university transfer. No UI role is treated as authorization.

## Data and operation

Apply `database/neon/migrations/20260921180000_feed_conversations.sql` before deploying the new routes. Adds feed_comments, feed_reposts, quoted_post_id and indexes. Public table grants are revoked and RLS is enabled for the new tables; access remains through the privileged Worker. No new provider, secret, API key or client environment variable is introduced.

The expanded feed-post route module is intentionally mounted before legacy student feed handlers. It owns the collection, detail, bookmark, comment and repost endpoints. Other student routes are unchanged. A subsequent mechanical extraction may remove dead legacy feed handlers.

Page sizes are bounded to 30. Cursor timestamps preserve database precision. Comments and posts have author/request-id uniqueness; reposts have one row per user/post. Parent row locks serialize insertions against archiving. Spam quotas use the existing rate-limit function. Empty/offline/error states must never fabricate a successful mutation.

## Release blocker

A Neon temporary migration branch was requested on 21 September 2026. Neon returned `branches limit exceeded` (HTTP 422). No production migration was applied, no existing branch was deleted, and the release must not be merged/deployed until migration validation and production rollout are authorized and completed. Automated route/type/build results are recorded in the pull request, not assumed here.
