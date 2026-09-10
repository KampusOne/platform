# KampusOne database

The active production data target is Neon PostgreSQL. New forward-only migrations live in `neon/migrations`. The earlier `supabase/` foundation is retained as historical source material and must not be applied over the Neon migration chain.

## Rules

- Apply migrations to an isolated Neon branch before production.
- Run rollback-safe transactional tests and `EXPLAIN` checks against that branch.
- Mobile and web never receive a database connection string; every privileged query goes through the Worker.
- The `app_private` schema contains server-only transaction functions and is not exposed as a public API.
- The runtime uses the pooled Neon URL only from a Cloudflare Worker secret.
- Never edit an applied migration. Add a new migration that safely moves state forward.

## Current scope

The Neon chain imports the compatible identity foundation and adds live student, content, agent, tutorial, store, logistics, dispute, ledger, reconciliation, and release-gate records. See the launch handoff for the exact promotion order.
