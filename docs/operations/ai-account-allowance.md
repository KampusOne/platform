# Account-specific AI daily allowance exemption — 2026-09-24

A project-owner request authorizes one account to bypass the personal daily AI request cap. This does not grant an operator role, remove authentication, expand access to another user's history, or change provider billing.

## Configuration and identity

`AI_UNLIMITED_EMAIL_HASHES` is a Worker-only comma/whitespace-separated allowlist of SHA-256 digests of exact lowercased, trimmed login emails. The production configuration contains the one approved digest. The source email is intentionally not included in the public repository. Hashes are identifiers, not secrets or login credentials.

Both `/v1/ai/status` and the atomic reservation in `POST /v1/ai` use the database-backed identity supplied by `requireAuth` and `currentUser`. Request-body email, roles, profile metadata and client-side unlimited flags never grant the exemption. The exemption applies to study questions, summaries, notes, quizzes and timetable extraction.

An exempt response includes `allowance.unlimited: true`, `limit: null` and `remaining: null`; this is not an artificial large numeric quota. The app displays “Unlimited personal AI usage · no daily account cap”. Normal accounts retain their existing numeric allowance.

## Boundaries retained

The shared service budget (`AI_DAILY_GLOBAL_LIMIT`, default 100 attempts per WAT day), AI kill switch, request rate protection, provider access/credits/rate limits, file and context size limits, output limit, timeouts, private history, consent, and atomic idempotency remain in place. Exempt attempts still count toward the shared budget and remain recorded, including failed provider attempts. The account-specific exemption cannot fix a rejected provider key.

No provider key, model, paid plan or fallback is changed. No database migration or usage-record deletion is required. Normal account limits are unchanged.

## Layout repair

Tool pages now use a full-width safe area and scroll viewport with a responsive content container capped at 540 px. This removes the measured-window-width dependency in the Study page wrapper that could leave its header, tabs and text compressed into narrow columns on the mobile web view. It retains the theme, back navigation, form controls and keyboard behaviour. Device rendering still needs a browser/device check after deployment; a passing type check is not a screenshot test.

## Validation and rollout

`server/tests/ai-account-allowance.test.ts` exercises real authenticated HTTP routes against the test database, with only external model responses mocked. It covers use beyond the old cap, all five AI modes, normal accounts, trusted identity versus request/claim spoofing, revocation, shared budget, kill switch, provider rejection, and idempotent replay. Production credentials are not read or used by these tests.

Deploy through the existing verified Worker workflow and the existing mobile-web deployment. A real signed-in provider answer is a separate acceptance check; do not report it as successful based only on build, quota or health tests.

## Rollback

Remove the approved digest (or set the Worker variable to an empty string) and deploy. Existing usage records immediately determine the ordinary daily allowance again. Keep the repository configuration synchronized with dashboard changes so a future deploy does not restore a revoked exemption. Reverting this change also restores the earlier mobile tool-page wrapper.
