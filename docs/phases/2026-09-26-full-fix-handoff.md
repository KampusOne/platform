# KampusOne September 26 repair handoff

This branch implements repairs against the 130-item brief and the additional
account-deletion and activity-notification requests. It preserves the existing
working changes and incorporates upstream main through 93b5fcc.

## Implemented in this pass

- Session-bound deletion confirmation; anonymization and session revocation;
  private media denied immediately and queued for durable object erasure.
- Separate inbox and push preferences; transactional post/comment-like, reply,
  follow, repost and message notifications; unread totals and private pagination.
- Accepted direct conversations support authorized photo, document, video and
  voice attachments. Inbox filters run server-side and paginate past 100 threads.
- Kira document extraction, bounded scanned-page OCR, hierarchical summaries and
  owner/thread-scoped retrieval. Real study-video search replaces hardcoded videos.
- Safe schedule proposals, confirmations, Edit and Undo. The stored receipt and
  timetable write are atomic. Changed entries reject a stale proposal or undo.
- Official icon variants, readiness-driven startup, timetable alarm selection,
  and preservation of the newer keyboard, sign-in and web refresh fixes.

## Verification

- Server: 416 tests across 41 files passed; TypeScript passed.
- Client: 115 regression tests passed; mobile TypeScript passed.
- Shared contracts: 9 tests and TypeScript passed.
- Academic importer: 4 tests and a dry run for 328 university records passed.
- Mobile production web export passed. Portal lint, TypeScript and production
  build passed in the preceding verification pass; no portal source changed later.
- Hosted schema-only rehearsal: all 34 migrations applied on a separate database
  on rehearsal branch br-sparkling-moon-ayq31a8y. Notification, erasure and schedule
  checks passed. Synthetic data rolled back; zero users/campuses/notifications
  remained. See database/verification/rehearsal-20260926-full-fix.json.
- Production database and Worker were not changed. This rehearsal record is not
  production migration proof and must not bypass the existing deployment guard.

## Release gates that remain open

The work is not release complete. The following have no passing production or
physical-device evidence in this session:

- Standalone paid tutor product purchases, tutor package entitlements and expiry,
  and tutor-session messaging authorization are not implemented end to end.
- The effective-dated fee engine is not integrated across checkout, rider
  earnings, withdrawals and reports. Existing commerce gates must stay closed.
- No production catalogue publication; nationwide faculty/programme coverage is
  incomplete. Preserve unresolved source entries rather than inventing them.
- Admin custom-domain routing, auth callbacks and production app share/deep-link
  mapping still need configuration and authenticated validation.
- Native push credentials/project and production signing are not validated.
  GitHub's Android workflow produces a testing APK, not a Play Store release.
- No physical-device fresh install, alarm/Doze, push, voice/video or complete
  multi-account commerce/admin acceptance matrix has been performed.
- Large-document ingestion remains bounded by the request lifetime and does not
  have a resumable job pipeline. OCR extraction is limited to 20 image pages.
- Shared response schemas, complete token cleanup, measured accessibility and a
  unified production diagnostics dashboard remain incomplete.

Do not promote this branch or label an APK release-approved until these gates
are resolved and the production migration and device evidence are recorded.
