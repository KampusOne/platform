# Portal preview sign-in origin repair

The supplied immutable Vercel preview URL reached the portal but was absent from the live API's exact origin allowlist. The browser therefore received a 403 before password reset validation; session restoration failed for the same reason. The canonical `kampusone-platform-preview.vercel.app` address reached staff sign-in without that warning, but points to the older production portal.

Vercel ownership was checked for project `prj_wFG0WNwuVWk522AL6ocICvgGw2x4`, team `team_abQOZYY74aXZM3GdxfmQWmxP`. The two addresses being added are the supplied immutable deployment `dpl_2wDKTwRQ3JScUuy31DtLvgu4JiFf` (44d2418) and the verified branch alias for `fix/student-experience-20260926`. No wildcard or other Vercel projects are trusted. The branch alias continues to track this reviewed repair branch.

`scripts/repair-portal-origins.mjs` makes one Cloudflare settings PATCH. It appends only those two origins to the current list, inherits every other binding from the active version, rejects split traffic or pending newer versions, rechecks for drift and verifies the code fingerprint and other settings afterwards. Regression checks cover idempotency, inherited secrets/buckets/flags, invalid allowlists and concurrent changes. Live probes use empty input with no cookies, so they cannot issue tokens, send a reset email or change an account.

The first configuration attempt (Actions run 36280267176) stopped before any mutation because the active and latest Cloudflare versions differ. That guard is preserved. The workflow now only tests the repair utility offline and has no deployment secrets or live mutation step. The Wrangler allowlist remains prepared for a later authorized API deployment.

The implemented preview fix is in the portal's existing reverse proxy. Only Vercel preview deployments receive this behavior. Exact deployment/branch hosts come from server-provided Vercel environment variables. The proxy requires an exact same-origin browser request and rejects foreign, sibling, null, missing-write and mismatched Host origins before forwarding through the existing canonical portal origin. Cross-site fetch metadata is rejected, session credentials and role checks remain with the Worker, and hosting-only cookies/headers are not forwarded. Production/local routing and admin/agent/engineering page separation remain unchanged.

This changes only the preview portal. It does not run Wrangler deploy, SQL, catalogue publication or schema activation; the separate production approval gate remains in force.

Reference: [Cloudflare settings PATCH and binding inheritance](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/).

Acceptance: pending portal preview build and browser verification. Password-reset email delivery and authenticated admin authorization are not implied by an origin check.
