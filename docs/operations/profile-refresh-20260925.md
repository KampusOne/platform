# Profile refresh failure — September 25

The reported screenshot shows a cached profile, empty statistics, the API's generic 500 message, and the browser's offline indicator. These are separate signals; the screenshot alone does not establish the original server exception.

The profile screen previously awaited `/v1/student/me` before starting GPA, purchases, and saved-post requests. It now starts all four independently, preserves existing successful values on partial failure, distinguishes offline/connection/timeout errors, and refreshes on browser reconnection or app activation while focused. Identity still renders without waiting for statistics. Focus cleanup invalidates late results and removes recovery listeners.

Verification: mobile and server TypeScript checks, mobile web export, and 35 targeted tests passed. The route test removes the pending academic table and profile columns inside a rolled-back test transaction and verifies an authenticated `/student/me` still succeeds. Existing provisional academic profile coverage also passes. The corrected SELECT was executed read-only against production and returned the reporting user's profile.

Deployment diagnosis: GitHub Worker deployment 36107977936 at main `b6976d1` stopped at the September 21 migration-proof guard. However, the separate `Workers Builds: platformp` check succeeded at that commit, reporting version `25e6fefc-e94d-4537-a169-de044b88e6ec` and build `418df8f4-96dd-47a9-ab50-918c912965bf`. Therefore the failed GitHub job does not establish that production still runs the previous backend.

Production lacks `academic_missing_submissions`, `profiles.admission_year`, and `profiles.provisional_academic_submission_id`. The new profile query referenced them unconditionally. The repair reads optional profile fields through JSON projection and only fetches provisional academic details when an existing submission ID is present. Ordinary profiles work on both schema versions without applying migrations or suppressing unrelated database errors.

The broader reviewed migration rollout and production attestation remain pending. The independent Cloudflare deployment path must also enforce release prerequisites; the GitHub gate alone does not control it. No production schema changes, secrets, or deployment guard changes are included in this repair. An authenticated production browser request still needs verification; the screenshot's original request has no trace ID.
