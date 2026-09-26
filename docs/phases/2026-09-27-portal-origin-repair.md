# Portal preview sign-in origin repair

The supplied immutable Vercel preview URL reached the portal but was absent from the live API's exact origin allowlist. The browser therefore received a 403 before password reset validation; session restoration failed for the same reason. The canonical `kampusone-platform-preview.vercel.app` address reached staff sign-in without that warning, but points to the older production portal.

Vercel ownership was checked for project `prj_wFG0WNwuVWk522AL6ocICvgGw2x4`, team `team_abQOZYY74aXZM3GdxfmQWmxP`. The two addresses being added are the supplied immutable deployment `dpl_2wDKTwRQ3JScUuy31DtLvgu4JiFf` (44d2418) and the verified branch alias for `fix/student-experience-20260926`. No wildcard or other Vercel projects are trusted. The branch alias continues to track this reviewed repair branch.

`scripts/repair-portal-origins.mjs` makes one Cloudflare settings PATCH. It appends only those two origins to the current list, inherits every other binding from the active version, rejects split traffic or pending newer versions, rechecks for drift and verifies the code fingerprint and other settings afterwards. Regression checks cover idempotency, inherited secrets/buckets/flags, invalid allowlists and concurrent changes. Live probes use empty input with no cookies, so they cannot issue tokens, send a reset email or change an account.

The workflow runs only for this repair branch and these repair files. It does not run Wrangler deploy, SQL, catalogue publication or schema activation. The separate production migration approval gate remains in force. The Wrangler allowlist is also updated so a later authorized API deployment retains the reviewed addresses.

Reference: [Cloudflare settings PATCH and binding inheritance](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/).

Acceptance: pending configuration workflow and browser verification. Password-reset email delivery and authenticated admin authorization are not implied by an origin check.
