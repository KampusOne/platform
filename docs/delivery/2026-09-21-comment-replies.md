# Comment replies — 21 September 2026

## Delivered behavior
- Reply to comments and replies in expandable threads. Each reply keeps its photo, name, username, verification status, timestamp, like control and author-only deletion.
- Show the exact reply recipient with a cancel control. Preserve unsent drafts on failed writes and when collapsing a thread.
- Lazy-load and paginate each branch independently; cap visual indentation on narrow screens.
- Keep other authors' descendants when a parent is deleted, with a redacted "Comment deleted" placeholder.

## API and data
The existing comment endpoints now accept an optional `parentCommentId`. Root requests still omit it. The database enforces same-post/same-institution parent references. Post audience checks, write limits, retry keys and author-only deletion remain enforced. Reply writes lock the parent against concurrent deletion; a new request cannot reply to a deleted parent. Confirming an already-saved retry remains allowed.

Migration: `20260921200000_feed_comment_replies.sql`. Applied additively to the connected KampusOne production database before code rollout; existing comment IDs and likes are preserved. No additional environment variables, paid providers or credentials are required.

## Verification
Seven transport-independent reply tests passed locally; TypeScript syntax checks passed for the changed source files. The pull request runs full app/API checks plus PostgreSQL-backed tests for nesting, identity, retries, audience isolation, ownership, redaction, cursor pagination and foreign keys. CI and deployment results are recorded on the pull request and commit checks. A signed-in two-account physical-device test has not been performed.
