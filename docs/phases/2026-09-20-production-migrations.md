# Production migration activation — 20 September 2026

The owner explicitly approved applying the missing unified/student and commerce migrations to the production Neon database at 17:49:01 UTC. The seven migration files and their Git blob hashes are recorded in `database/verification/production-20260920.json` and in the private database migration ledger.

## Applied and verified

- Unified student schema, including streaks, institution guidelines, private media metadata, support, notification outbox, course drafts, alarms, agent application details and communities.
- Timetable/course/alarm synchronization and one-time alarm timestamps.
- AI request idempotency storage, verified-identity storage and tutorial media references. This does not activate any paid provider.
- Commerce storefronts, moderation/revision guards, tenant constraints, immutable delivery snapshots, status history, reviews and refund audit structures.

The structural/security checks passed. Functional checks covered same-day and consecutive-day streak counting, invalid goals, server-computed checkout totals, reserved stock, rollback after invalid delivery details, cross-tenant rejection, immutable snapshots/refunds, verified-purchase reviews and material-change moderation. Every acceptance fixture was rolled back. Existing account/profile counts were unchanged; no test orders, products, storefronts, refunds or acceptance institutions remained.

The commerce order table is `public.orders`; there is no required `public.store_orders` table. The v2 order function has the full 15-argument signature recorded in the migration.

## Deployment

Production `UNIFIED_SCHEMA_READY` and `PHASE_3_SCHEMA_READY` can now be true. Other feature switches remain separate: demo store is disabled; store transactions, marketplace, logistics, payments and AI remain off until their non-schema prerequisites are approved and verified. Published guidelines, real vendor listings and external-provider configuration are not invented by this migration.

The existing GitHub migration-proof variables remain valid. If they are absent, deployment may use the explicit dated production verification attestation. The new proof validator checks the deployment target, approval, passed checks, rolled-back fixtures and exact Git blob hashes of every required migration; missing or changed files fail closed. This is not a new live database probe. The release workflow also checks runtime health and confirms that guidelines require authentication rather than failing at the schema gate.

## Limits and recovery

Creating another temporary Neon branch and another snapshot was blocked by the project's limits. No existing branch or snapshot was deleted. The approved database updates used transactions and lock/statement timeouts. Do not describe this release as having a newly created backup or isolated-branch rehearsal. Roll back feature flags or the Worker release before any schema rollback; do not drop new tables containing user data.

Database and unauthenticated API-boundary checks do not establish authenticated mobile end-to-end success. Upload delivery, sign-in, posting and UI behavior still require runtime verification with a valid user session.
