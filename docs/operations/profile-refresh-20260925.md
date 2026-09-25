# Profile refresh failure — September 25

The reported screenshot shows a cached profile, empty statistics, the API's generic 500 message, and the browser's offline indicator. These are separate signals; the screenshot alone does not establish the original server exception.

The profile screen previously awaited `/v1/student/me` before starting GPA, purchases, and saved-post requests. It now starts all four independently, preserves existing successful values on partial failure, distinguishes offline/connection/timeout errors, and refreshes on browser reconnection or app activation while focused. Identity still renders without waiting for statistics. Focus cleanup invalidates late results and removes recovery listeners.

Verification: mobile TypeScript check and 12 targeted profile/session tests passed. The last successful Worker deployment found was run 36013919647, commit `a81e7ed5d94d3803b0973806749432181f91529c`. Its profile SQL was executed read-only against production and returned one matching profile for the reporting user. This does not reproduce an authenticated HTTP request or rule out a transient Worker/database failure.

Worker deployment 36107977936 at main `b6976d1` stopped at the September 21 migration-proof guard; deployment was skipped. Production lacks `academic_missing_submissions` and `profiles.provisional_academic_submission_id`, which the pending backend uses. Do not deploy that backend by bypassing the guard. The reviewed migration rollout and production attestation remain prerequisites. This profile UI repair neither changes production schema nor claims the original 500 is resolved.
