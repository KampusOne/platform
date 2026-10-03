# Exclusive campaign controls rendering hotfix

The Exclusive onboarding workspace could render its heading and an empty body. The control component returned `null` when a second client-side check of raw permission grants failed, even after the workspace shell had authorized agent review access.

The campaign endpoint now returns `canManage`, derived from the trusted server-side `agents.review` scope check. The panel loads for reviewers using the normal workspace permission and renders the confirmed campaign status. Platform-wide reviewers see the enable/disable action; university reviewers see an explicit read-only explanation. The PATCH endpoint continues to enforce platform-wide agent review access and records successful changes in the audit ledger.

Loading, access restriction, API errors and invalid response shapes all produce visible states. Retry reloads the authoritative campaign state. An interrupted change disables further changes until that state is checked, avoiding a repeat toggle from stale information. Requests have a timeout and abort when the panel unmounts. Missing campaign storage returns an unavailable error rather than an invented closed state or a successful empty update.

Validation passed:

- All 685 server tests across 78 files, including seven new database-backed campaign tests: platform/campus capabilities, audited close/reopen, closed-route 404s, unauthorized access, invalid input and missing storage.
- Portal lint, TypeScript check and production build; Worker TypeScript check and build.
- Seven Chromium checks against the compiled production portal at 390px and 1280px: a flat permission snapshot without raw grants, visible loading, confirmed changes, read-only access, malformed responses, API retry and interrupted-change recovery. Zero page errors and no horizontal overflow.
- Git diff and migration review: no SQL changes are required for this additive API field and panel fix. Browser/API tests used synthetic fixtures.

Reproduce browser validation after building the portal with `node tests/exclusive-campaign-browser.mjs`. Playwright must be available from the portal; an existing Chromium executable can be provided with `CAMPAIGN_TEST_CHROMIUM`. Optional `CAMPAIGN_TEST_OUTPUT` and `CAMPAIGN_TEST_PORT` select the output directory and local port.

Publish through main and the existing Worker/Vercel production workflows. The production version endpoints and exact-source web release receipt identify the deployed source.
