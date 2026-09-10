# KampusOne data stores

Supabase PostgreSQL is the transactional source of truth. Migrations are forward-only and live in `supabase/migrations`; local sample data lives separately in `supabase/seed.sql` and must never be treated as production content.

Neon is an isolated analytics/reporting store required by the product owner. Its migrations live in `neon/migrations`. Clients never connect to Neon, and core user/permission/transaction records are not dual-written there.

## Rules

- Apply migrations to a preview branch or project before production.
- Run the relevant SQL in `verification/` and Supabase security/performance advisors after every schema change.
- All client-visible tables use RLS and explicit grants.
- The `app_private` schema is never added to the Supabase Data API exposed-schema list.
- Mobile and web receive a publishable key only. Secret keys are restricted to the Worker and controlled operations.
- Never edit an applied migration. Add a new migration that safely moves state forward.
- Apply Neon migrations to a child branch first; keep legacy schemas untouched and promote reviewed changes only.

## Current scope

The foundation migrations create tenancy, academic/timetable records, trusted roles, feature gates, audit, quota and idempotency controls. Phase 1 adds resumable onboarding, permission health, private agent evidence and reasoned review decisions. Neon Phase 1 adds only consent-aware analytics ingestion tables.
