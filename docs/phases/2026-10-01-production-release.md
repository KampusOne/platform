# KampusOne production release — 1 October 2026

The owner explicitly approved publishing the reviewed source and migration evidence to public `KampusOne/platform` on main. Publication succeeded at `5038a1cbbe49440900e69b1d36d3fd417cf17810`; its tree `18e5deb77f820295c863b8154c2b1afb989cdc61` exactly matches the reviewed local source. Public repository visibility and the public landing site are unchanged.

## Verified live results

| Surface | Evidence | Result |
| --- | --- | --- |
| Neon production | `2026-10-01-live-migration-rollout.md` and registered source proofs | All 41 selected migrations succeeded; 50 registered versions have matching source hashes. Existing account, media, booking and financial records checked are preserved. |
| Source verification | [Verify platform run 36815682810](https://github.com/KampusOne/platform/actions/runs/36815682810) | Contracts, database review, Worker, portal and mobile jobs passed. |
| Worker production | [Deploy Worker run 36815682871](https://github.com/KampusOne/platform/actions/runs/36815682871) | Deployment succeeded at 04:36 UTC. Cloudflare version `a44b9c93-fd90-42a8-b8a6-ad57757c4fa3`; 513 server tests passed. |
| Worker readiness | `https://platformp.divine-haze-54eb.workers.dev/health/ready` | HTTP 200, database/signing/OTP/email configuration checks true. The active unauthenticated account route returned the expected 401. |
| Vercel release | [Deploy verified Vercel surfaces run 36815879365](https://github.com/KampusOne/platform/actions/runs/36815879365) | Stopped before deployment: `VERCEL_TOKEN` resolved to an empty value. No portal or mobile production release was made by this run. |
| Android release | [Build Android test APK run 36815943688](https://github.com/KampusOne/platform/actions/runs/36815943688) | Correctly skipped because its parent Vercel release failed. No new APK is available from this chain. |

## Release correction

The Vercel jobs did not select the existing GitHub `production` environment used by the Worker. Both Vercel jobs and the Android packaging job now select that environment so environment-scoped provider credentials and configuration are available. The portal checks for a nonempty token before dependency installation. This change does not establish that a Vercel credential is configured: the next actual run must verify access, and a missing token remains an explicit release blocker.

The performance workflow installs server dependencies but does not install mobile dependencies. Its new discovery/sharing test incorrectly resolved TypeScript from the mobile package. The test harness now resolves TypeScript from the server package; the application source is unchanged. All 130 existing root regression tests pass with this correction. Both updated workflow YAML files parse, and every publication/packaging job selects `production`.

The corrected main revision will repeat the Worker → Vercel → Android sequence. The same-source checks, migration guards, alias and API smoke checks, receipt transfer and superseded-APK publication checks remain in place. Do not publish an old or unverified APK to disguise a failed portal release. Repository/environment secrets are not readable through the connected GitHub app, the Vercel deployment connector reports `UNAVAILABLE`, and local deployment credentials are absent; no browser/session fallback was used.

## Scope still requiring acceptance

Build success and API readiness do not prove physical-device behavior or real provider delivery. Real payment/payout/subscription flags remain disabled pending commercial/provider acceptance. Camera, drafts, gestures, reviews, fulfilment, signing identities and App Links need physical-device acceptance. Department coverage remains 62 of 328 institutions; preserve existing verified academic data and use the reviewed submission path for missing data. GA4 property access, private KYC encryption configuration and receipt/approval email delivery require their independent live checks.

This record supersedes the publication-block status in the historical `2026-10-01-release-attempt.md`; that file is retained as the dated earlier attempt.
