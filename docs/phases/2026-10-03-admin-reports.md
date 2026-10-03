# Daily app records, contextual charts and operating expenses

## Result

The admin overview and reports now show a selectable daily record in Africa/Lagos time. Each report is stored by date and university scope. It includes new accounts, successful sign-ins, session resumes, measured activity, post creation/publication, product creation/edits, recorded sales, coupons, agent approvals, message counts, foreground time, and recipient delivery states. Finance details appear only to staff with `finance.view` in the same scope. CSV exports contain daily counters.

The existing cron calls `captureDailyAppReports`. It collects today's report and revisits the previous two days in six-hour buckets so delayed foreground samples can arrive. Historical reports persist. A manual report refresh can rebuild the selected date, including subsequently recorded/backdated operating expenses. Previous product changes and approval transitions are not reconstructed from mutable timestamps. Collection dates and coverage are visible in the report.

Charts also appear in user, application, content, product and finance workspaces. Campaign and message insights aggregate stored records over the full selected university rather than the current table page. Message statistics contain counts and formats, never conversation bodies. Screen-time reports now support a historical date with a loading state keyed to university and day, preventing a previous scope's result appearing while new data loads.

## Finance definitions

The Revenue and expenses page distinguishes store GMV, processed transactions, recognized platform revenue, marketplace revenue, commission, allocated vendor proceeds, expenses and recorded profit/loss. Revenue uses posted credits less reversals; expenses use debits less reversals. Vendor wallet-release transfers do not create another sale or reduce the original vendor allocation in the report. A regression test covers a sale, earnings release and expense together.

When verified provider receipts exist, transaction counts cover all receipt categories. Before that finance prerequisite, the report explicitly labels the journal-backed store transaction fallback. Store GMV is labelled as store sales including delivery; it does not claim all-platform payment volume.

Kira currently sells one prepaid month without automatic renewal. It does not create contracted recurring revenue, so the ARR field says Not applicable instead of inventing an annualized amount.

Finance reviewers can record an incurred operating expense with a university, category, description, amount and date. The operation is idempotent, stores an append-only expense, and posts a balanced debit to operating expense and credit to operating payable. It does not initiate payment or alter vendor wallets. Its journal payload enables the existing deferred balance checks. A changed replay of an already-recorded request is rejected. A separate calculator lets staff try revenue/expense scenarios without storing them.

## Milestones and exclusive campaign control

The dashboard celebrates actual signup thresholds of 50, 100, 500 and 1,000 accounts. Actual recognized platform revenue thresholds are shown only to finance-authorized staff. Milestone acknowledgements are stored per staff account and scope, so achieved milestones are not replayed on every visit. The banner is dismissible, never blocks the dashboard, and respects reduced motion.

The exclusive campaign control consumes the agent intake team's role-gated global API. All-university agent reviewers can disable the campaign, after which the exclusive URL returns Page not found and intake is blocked. Normal onboarding retains its document workflow; exclusive onboarding uses business questions. The control is included in invited-vendor review and has a dedicated admin navigation entry.

## Migration and boundaries

`database/neon/migrations/20261003110000_admin_daily_reports_and_expenses.sql` adds stored daily reports, cron collection claims, append-only operational record events, expense records and their balanced-journal function, and per-staff milestone acknowledgements. Private tables have public privileges revoked; report/expense routes enforce staff permission and university scope. It preserves existing records and does not seed metrics or revenue.

New admin reporting routes mount through `admin-extensions.ts`; the main admin handler and authentication provider were not rewritten. Dashboard charts and record views remain permission-aware. Component styling uses a CSS module, including mobile layouts and reduced-motion rules.

## Validation

- Seven integration tests cover WAT date boundaries and invalid dates, daily counts and scope isolation, real/no-op product updates and first approvals, expense idempotency and balanced append-only journals, financial separation across a sale/earnings release, historical usage/full-dataset graphs, cron snapshots, and milestone acknowledgements.
- The existing October intake/usage suite is also run to verify backward-compatible usage responses.
- Server and portal TypeScript checks pass. Targeted ESLint passes for the added and modified reporting components.
- Final portal-wide `npm run lint`, `npm run check` and `npm run build` pass after visual fixes. Root owns the combined server suite and migration deployment review. These source changes do not by themselves establish that the production migration has been applied or that a production dashboard has been smoke tested.

## Compiled portal browser verification

`tests/october-3-admin-browser.mjs` starts the actual compiled Next portal, a local fixture API and supplied Chromium inside one process tree. The fixture's administrator, daily counts and financial figures are explicitly synthetic; this checks UI behavior and API contract handling, not production balances or providers. The agent-browser CLI could not start its daemon in this runtime, so verification used direct Playwright with the same Chromium. The initial failure and fallback are recorded.

The final run passes all 12 captured states at 390×844 and 1280×844, with no document horizontal overflow, Next error overlays, page JavaScript errors or unexpected console errors. It covers overview/day reports, selecting and exporting a historical WAT date, historical foreground time, revenue and expense forms, saving one expense and refreshing its displayed totals, a loss calculator scenario, university-scoped message charts, empty data, an interrupted report and successful retry. Reduced-motion confetti is disabled and the milestone is acknowledged.

Visual inspection led to concrete fixes: finance values no longer split across several lines in narrow KPI columns; dashboard accent cards retain readable dark backgrounds; expense fields have no native fieldset frame; save feedback survives the subsequent data refresh; mobile charts show their full date range with readable ticks and a stacked header rather than clipping later days. Empty message contexts have a clear state instead of a redundant zero line chart.

Evidence from this run is in the working `inspection/admin_verification/` directory: `verification.json`, full-page and viewport PNGs, `daily-export.csv`, and logs. Portal checks are recorded in `inspection/admin-final-portal.log`.

The checked-in harness is portable: install Playwright in the portal (or provide `ADMIN_TEST_PLAYWRIGHT_MODULE`), install its Chromium browser (or provide `ADMIN_TEST_CHROMIUM`), and run `node tests/october-3-admin-browser.mjs` after building the portal with its default local API URL. It starts the fixture API on port 8787 and Next on port 3112 (`ADMIN_TEST_PORT` can change the Next port). Evidence is written to a new temporary directory and its location is printed; `ADMIN_TEST_OUTPUT` chooses another directory. `ADMIN_TEST_TRY_AGENT_BROWSER=1` optionally attempts the CLI smoke check, while the complete interaction checks use Playwright. No runtime-owned module path, browser path, or existing CLI log is required.

## Screenshot evidence

`inspection/image_review_c.md` records individual visual observations for all 23 assigned images. Direct defects include Standard/Pro selection ambiguity, literal Until Invalid Date, a missing back action on the error boundary, blank notification avatars, absent mention suggestions, an anonymous Q&A publish failure, native document-upload controls/footer overlap, and a broadcast audience with zero eligible recipients. References include the continuous soft AI perimeter glow, group member study timers and calendar insights, invitation/verification email hierarchy, milestone celebration and onboarding success states. Static images are not used to claim unobserved animation or provider behavior.
