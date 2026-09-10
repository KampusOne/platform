# KampusOne database

The production data layer is one Supabase PostgreSQL project. Migrations are forward-only and live in `supabase/migrations`; local sample data lives separately in `supabase/seed.sql` and must never be treated as production content.

## Rules

- Apply migrations to a preview branch or project before production.
- Run `verification/phase_0_security.sql` and Supabase security/performance advisors after every schema change.
- All client-visible tables use RLS and explicit grants.
- The `app_private` schema is never added to the Supabase Data API exposed-schema list.
- Mobile and web receive a publishable key only. Secret keys are restricted to the Worker and controlled operations.
- Never edit an applied migration. Add a new migration that safely moves state forward.

## Current scope

Migration `20260909213215_foundation.sql` creates the tenant, identity, academic, timetable, feature-gate, audit, quota, and idempotency foundations. It does not create social, marketplace, payment, or financial ledger user flows.
