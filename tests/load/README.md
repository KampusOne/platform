# Capacity verification — not a capacity claim

This read-heavy campus-day workload is deliberately **not run automatically** in CI. It does not exercise real payments, send emails or use production accounts. No 10,000-user result has been established by adding it.

Before running:

1. Provision an isolated staging stack and authorized load generator; agree a cost ceiling and stop criteria. Never use the live preview's production database.
2. Rehearse all migrations, add a representative synthetic dataset (target 100,000 registered users), and create one distinct synthetic session per virtual user. Save the sessions outside this repository as JSON objects with `accessToken` and `refreshToken`. These are secrets.
3. Run 100 users first. Inspect database compute/connection limits, query plans, Worker errors and provider quotas. Increase through 500, 1,000, 5,000 and 10,000 only after earlier runs meet targets.
4. Provide `STAGING_API_URL` (a dedicated HTTPS host containing `staging`), `STAGING_SESSIONS_FILE`, `CONFIRM_STAGING_LOAD_TEST=YES`, `MAX_VUS`, and, above 100 users, `CONFIRM_PROVIDER_CAPACITY=YES` to k6. Run `k6 run tests/load/academic-read.js`.
5. Record commit, dataset size, infrastructure sizes, duration, request throughput, error rate, p50/p95/p99 and resource utilization. The session file becomes obsolete after refresh rotation; provision fresh sessions before rerunning.

The script aborts on a sustained error rate above 1%; read targets are p95 < 750 ms and p99 < 1,500 ms. These are acceptance targets, not measurements. VUs include realistic pauses and are **not** requests per second.

Also required before launch: browser cold/warm startup on a throttled network, a mid-range physical Android run, native alarm delivery after reboot/battery restrictions, concurrent election/delivery/withdrawal tests, upload traffic, payment-sandbox replay/reversal tests, and a long soak test. Use production-style distributed PostgreSQL tests for true concurrency; embedded schema tests are not load tests.
