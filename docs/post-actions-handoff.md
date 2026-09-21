# Post actions and link sharing — 21 September 2026

## Scope

The top-right ellipsis on each feed card opens Share post, Copy link, Save/Unsave, and Delete post for the authenticated author. Delete requires an explicit confirmation and only removes the card after the server succeeds. The original share icon and feed card layout are retained. The detail screen reuses the same card and menu.

## Server contract

- GET /v1/student/feed/:id requires authentication, validates the UUID, limits access to the authenticated university and published/corrected posts, and calculates can_delete from the authenticated author ID.
- DELETE /v1/student/feed/:id checks author and university in a single SQL mutation. It archives the post and removes bookmarks in one statement; retries are idempotent. Missing, cross-tenant, and non-owned posts return a nondisclosing 404. No author ID or university ID from a request body is trusted.
- Archived posts are excluded by the existing feed/home publication filters and the new detail route. API read caches are invalidated on successful deletion. An in-memory tombstone prevents an older in-flight feed response from restoring a deleted card.

## Links and access

Links target the existing student web app at https://kampusone-mobile-preview.vercel.app/post?id=<UUID>, not the separate kampusone.app marketing site. Android receives the URL as its share message, iOS receives a URL item, and browsers use Web Share with clipboard/manual fallback. Cancelling sharing does not report an error or silently copy. No post body or summary is shared as a substitute for a link.

The standalone static /post route supports links to posts outside the first 100 feed results. Signed-out visitors receive a sign-in prompt. The post ID is retained across normal login navigation and browser OAuth reloads, then resumed after profile/onboarding checks. Other-campus, archived, and missing posts remain unavailable. This does not configure OS-level universal/app links; the HTTPS link opens the student web app.

Native Copy link opens selectable text for long-press copying without introducing a new native clipboard module. Web uses one-click copying when permitted and the same selectable fallback otherwise. No false copied-success message is shown when the clipboard is unavailable.

## Configuration

No new environment variables, provider keys, paid services, npm dependencies, or database migrations. Both the Worker and mobile web deployment must include this change. Existing installed native builds need the updated JavaScript/native release through the project's normal release process.

## Verification

Run `node tests/post-links.cjs` after installing mobile dependencies: 11 sharing/navigation/cache regression cases. These exercise platform payload logic using mocks, not physical devices.

Run `cd server && npm run check && npm test && npm run build`: the new feed-posts.test.ts verifies route authentication wiring, malformed IDs, profile requirements, tenant/author SQL predicates, hidden unavailable posts, atomic bookmark cleanup, retry behavior, and storage failures. Route unit tests use a mocked identity/database boundary and inspect generated SQL; they are not live-database integration tests.

Run `cd mobile && npm run check && npm run export:web`. Existing repository CI also checks contracts, portal, and database records.

Manual acceptance: create a disposable student post; verify menu actions and the unchanged share icon; cancel then confirm deletion; refresh the feed; open a copied link while signed out and signed in; check another-campus/removed links; verify keyboard, screen-reader and real Android/iOS share sheets. Never delete real user content merely for a smoke test.
