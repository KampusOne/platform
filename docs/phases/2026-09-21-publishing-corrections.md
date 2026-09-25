# Publishing capabilities and Q&A — 21 September 2026

Requirement IDs: 79–86. Local implementation/test evidence; production deployment/device verification remains outstanding.

Repository inspection confirmed ordinary feed posting existed, but no poll/Q&A tables, voting, consent, private answer inbox or selected-answer publication. Verification alone was not an appropriate publishing permission boundary.

`app_private.publishing_capabilities` grants POLL, QA and ANONYMOUS_QA separately per account and institution, with actor/reason/revocation. No grants are automatic or implied by a verification badge. The operations API provides an audited grant/revoke action under `content.capabilities`. Ordinary student text/media publishing is unaffected.

Interactive posts share feed IDs, reporting and archive/moderation. Request hashes and a short per-author database lock prevent duplicate creation and altered request-key reuse. Polls accept 2–6 distinct options, optionally close within 30 days, enforce one immutable vote per account atomically, and return only counts. Closed, archived or different-university polls reject new votes.

Q&A submission requires explicit consent that the publisher can share the answer with their reply. Answers are initially private. Only the publisher can view the inbox or publish selected answers. Named Q&A shows display names to the publisher and, after sharing, campus viewers. Anonymous Q&A exposes neither respondent ID nor name in the inbox/public response. Its protected account linkage is kept separately in `app_private` for ownership/moderation, and the disclosure explains that retention and the risk of self-identifying text. No identity-bearing notifications are generated.

Respondents and publishers can remove answers. Removal clears content, hides it from inbox/public output and prevents republication. Idempotency metadata prevents stale retries recreating removed text. Auth restrictions and institution scope apply. Conservative server rate limits cover post/answer creation.

Migration: `20260921120000_publishing_capabilities.sql`, following operations and AI/streak migrations; additive, no automatic capability grants.

Verification: `npm run check` passes. Five `tests/publishing.test.ts` tests run real PostgreSQL schema/functions in PGlite with route calls: capability denial/grant, concurrent post deduplication, anonymous non-disclosure, other-university isolation, consent, private-before-public results, immutable concurrent votes/closure and removal. Authentication uses fixture middleware; the main auth suite remains a separate gate. Live deployment, moderation staffing, production retention policy, device accessibility and multi-connection load remain unverified.
