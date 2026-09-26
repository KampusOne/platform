# Portal preview sign-in origin repair

The supplied immutable Vercel preview URL reached the portal but was absent from the live API's exact origin allowlist. The browser therefore received a 403 before password reset validation; session restoration failed for the same reason. The canonical `kampusone-platform-preview.vercel.app` address reached staff sign-in without that warning, but points to the older production portal.

Vercel ownership was checked for project `prj_wFG0WNwuVWk522AL6ocICvgGw2x4`, team `team_abQOZYY74aXZM3GdxfmQWmxP`. The two addresses being added are the supplied immutable deployment `dpl_2wDKTwRQ3JScUuy31DtLvgu4JiFf` (44d2418) and the verified branch alias for `fix/student-experience-20260926`. No wildcard or other Vercel projects are trusted. The branch alias continues to track this reviewed repair branch.

`scripts/repair-portal-origins.mjs` makes one Cloudflare settings PATCH. It appends only those two origins to the current list, inherits every other binding from the active version, rejects split traffic or pending newer versions, rechecks for drift and verifies the code fingerprint and other settings afterwards. Regression checks cover idempotency, inherited secrets/buckets/flags, invalid allowlists and concurrent changes. Live probes use empty input with no cookies, so they cannot issue tokens, send a reset email or change an account.

The first configuration attempt (Actions run 36280267176) stopped before any mutation because the active and latest Cloudflare version response failed the strict equality guard. That guard is preserved. The workflow now tests the repair utility offline and reads version metadata without mutation. It prints only version IDs, traffic percentage and equality results; secret values and code are not exported. The Wrangler allowlist remains prepared for a later authorized API deployment.

The implemented preview fix is in the portal's existing reverse proxy. Only Vercel preview deployments receive this behavior. Exact deployment/branch hosts come from server-provided Vercel environment variables. The proxy requires an exact same-origin browser request and rejects foreign, sibling, null, missing-write and mismatched Host origins before forwarding through the existing canonical portal origin. Cross-site fetch metadata is rejected, session credentials and role checks remain with the Worker, and hosting-only cookies/headers are not forwarded. Production/local routing and admin/agent/engineering page separation remain unchanged.

This changes only the preview portal. It does not run Wrangler deploy, SQL, catalogue publication or schema activation; the separate production approval gate remains in force.

Reference: [Cloudflare settings PATCH and binding inheritance](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/).

Vercel rejected the portal fix deployment (03b8fb6) with “Deployment rate limited — retry in 24 hours.” The proxy fix is saved and passes eight boundary tests plus portal lint, types and production build, but is not live. The older canonical portal URL was opened and reached staff sign-in without the session-restoration error. Password-reset email delivery and authenticated admin authorization are not implied by that browser check.

## Final verification checkpoint

- Read-only run https://github.com/KampusOne/platform/actions/runs/36280534910 confirmed active version `e0e0b8b2-9d79-485d-b583-a3db569e45f4` serves 100% of traffic and differs in code/resources from latest version `d5851acd-e672-428b-bcaf-e07dab400e3d`. No live update was made.
- All nine verification workflows on `fd06394` passed, including eight portal boundary tests and eight configuration/inspection tests. The focused 12 identity regressions also passed locally.
- The actual compiled Next.js proxy was exercised against a local mock API. A same-origin request reached the upstream with the canonical portal origin and only the API session cookie. Foreign Origin, unowned Host and missing-write Origin requests returned 403 before reaching the upstream. No account, real API or email provider was used. The normal production build was restored afterwards.
- The existing approved `https://kampusone-platform-preview.vercel.app/admin` was opened through a temporary Vercel share link. Staff sign-in and the Reset password form both opened without the previous session warning. No credential or reset-code submission was made.
- The private TXT and second-feedback workbook received an access follow-up with the new screenshot error, available older portal link, saved fix and explicit deployment blocker. All first feedback and blank second-feedback inputs are preserved; no numbered item was upgraded to a false live-Fixed status.

Next release action: deploy the already tested portal commit once Vercel permits a build, then verify the real preview session/reset flow. The original immutable preview still lacks the new proxy. The pending full API/schema release remains separately approval-gated.
