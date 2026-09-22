# Feed conversation UX — 22 September 2026

## Scope

X-inspired interaction patterns, adapted to KampusOne's brown/cream identity. The user's six screenshots are the visual reference. This is not a pixel-identical clone and does not add X branding, handles, voice, GIFs, polls or location tools.

- Post text and its avatar gutter open the conversation. Reply buttons open the full-screen reply composer directly.
- Detail shows the post and replies before a small, fixed bottom reply dock. The former outlined inline form is removed.
- The composer shows the parent context, a thread connector, the signed-in person's avatar, close and Reply controls, and gallery/camera attachments only.
- Drafts survive closing/reopening in the current app session and failed network requests. They are not persisted across a cold app restart. Retry IDs remain stable until the content changes.
- Display names have no inline handles. Feed/reply badges are 13 points, quotes 12 and profile headings 16. The shared seal has no shadow or entrance animation.
- Relative time uses minutes, hours, days and weeks through 27 days; from day 28 it becomes a calendar date. The post detail retains the exact timestamp in metadata. The 28-day cutoff is the requested KampusOne policy, not a claim about X's undocumented thresholds.
- Likes remain first. Existing repost, quote, bookmark, shared-link and author-only deletion behavior is retained.

## View counts

Views count unique authenticated accounts, once per post, after a row is at least 50% visible for one second or after a detail screen is opened. They are not impressions or an exact implementation of X's counting policy. No historic views are invented. An unavailable count displays an em dash, not a fabricated zero. The viewer roster is not exposed by this API.

## Public badges

Admin > Users > user account > Verification badge. Platform administrators can explicitly assign or revoke a badge, supply a reason, and confirm the action. Changes use optimistic concurrency and an atomic audit record. Public badge status is independent of identity/KYC, student eligibility and operator roles. A NULL override preserves legacy badge eligibility; an explicit false revokes the public badge even for an identity-verified account.

## Deployment dependency

Apply `database/neon/migrations/20260922140000_feed_conversation_experience.sql` before releasing the photo/view/admin-control functionality. It adds the public badge override, reply media reference, and account-deduplicated view table and adjusts the reply-content check to allow image-only replies. It is transactional and rerunnable; it does not delete existing posts, replies, accounts or existing uploaded photos.

A Neon test-branch creation was attempted but blocked by the project's branch limit. No existing Neon branch was deleted or reset and this migration has not been applied to production. The isolated SQL test suite exercises the new migration without using customer data.

No new API key or paid media provider is required. Existing media storage configuration is still required. Camera capture follows device/browser capabilities and permission prompts. Existing post-media delivery semantics are retained; this change does not retrofit private blob delivery for older uploads.

## Verification and rollback

Required checks: platform Worker tests/build, mobile TypeScript/export, portal lint/TypeScript/build, like/comment regression tests, time boundaries, public-badge policy and isolated migration tests. Inspect the exported browser build for tap routing, compact layout, draft recovery, no outline, and narrow-screen overflow. Physical Android/iOS camera and software keyboard checks remain a device acceptance step unless separately recorded as completed.

Release status is recorded in PR #16, not assumed from this document. Revert the application commit to roll back the UI/API. Leave the additive schema in place rather than dropping populated view/media data. Old text-only endpoints remain usable while the new schema is unavailable; photo submissions report a recoverable unavailable-service error and retain their draft.

## Primary references consulted

- X conversation and reply flow: https://help.x.com/en/using-x/x-conversations
- X view-count semantics: https://help.x.com/en/using-x/view-counts
- Expo image and camera picker: https://docs.expo.dev/versions/latest/sdk/imagepicker/
- React Native text input and Android underline: https://reactnative.dev/docs/textinput
