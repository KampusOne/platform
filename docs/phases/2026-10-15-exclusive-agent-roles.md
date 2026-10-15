# Exclusive onboarding for every agent role

The shared `https://agents.kampusone.app/exclusive` link previously opened a vendor-only questionnaire. Its API, submission function, acquisition record, approval function, emails and admin labels also assumed Vendor. Selecting a different entry route could not correct the stored or approved role.

Exclusive now asks the applicant to choose Vendor, Tutor or Rider. Profile labels, addresses and offer questions follow that role; only vendors choose a product category. The existing four-step question-only application, shared KampusOne identity, university scope and campaign switch remain in use. One account can apply for multiple roles; existing applications are shown and their roles cannot be submitted again from the form. Earlier vendor drafts and already-open vendor API clients remain compatible.

The Worker validates the role and its category and includes the actual role in the review response. Submission, manual approval, acquisition attribution and notification subjects carry that role into the existing agent profile. An exact retried tokenless request returns its existing application without creating another internal invitation. The internal table and function names are retained for compatibility; no existing applications, profiles, balances or payout requirements are rewritten.

Validation:

- All 1,117 Worker tests across 130 files passed, including 12 campaign tests covering all three roles, exact retries, duplicate roles, application status, authorized approval, self-approval rejection, acquisition attribution, role-specific notices, invalid roles and campaign closure.
- Portal lint, TypeScript check and production build passed. Worker TypeScript check and build passed.
- The checked-in migration was rehearsed transactionally on the existing release rehearsal branch, then installed on production. The SQL acceptance fixture submitted and approved Vendor, Tutor and Rider, exercised legacy vendor input and retries, and rolled back every synthetic record. Public execution grants remain zero and the campaign state is preserved. The dated production proof binds the migration source; the Worker deployment checks it before release.
- `tests/exclusive-agent-roles-browser.mjs` runs the compiled portal with synthetic browser/API fixtures. It covers four-step submissions for each role, role-specific fields and request payloads, review and success, another-role access, error recovery, mobile/desktop overflow and disabled-campaign HTTP 404. Set `EXCLUSIVE_TEST_PLAYWRIGHT_MODULE` and `EXCLUSIVE_TEST_CHROMIUM` when using an existing browser installation.

Release through `main` and the existing Worker and Vercel production workflows. `/portal-version.json` and the Worker version identify the published source.
