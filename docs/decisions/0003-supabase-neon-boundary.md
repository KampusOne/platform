# ADR 0003: Supabase core with isolated Neon analytics

- Status: accepted for Phase 1
- Date: 2026-09-10

## Context

KampusOne already has a live Supabase foundation and an older Neon project containing legacy application schemas. The product owner requires Neon to remain part of the platform. Writing the same user and transaction records to both databases would create inconsistent identity, permissions and deletion behavior.

## Decision

- Supabase is authoritative for Auth, role assignments, institutions, academic and commerce transactions, consent state, audit evidence and private Storage.
- Neon stores consent-aware product analytics and, later, purpose-built reporting/read models.
- Clients never connect to Neon. A Cloudflare Worker authenticates Supabase sessions, verifies consent, applies an allow-list and writes pseudonymous events.
- The Supabase user UUID may be used as `subject_id`; email, phone, NIN, matriculation numbers, document/message content and precise coordinates are prohibited.
- The existing Neon schemas are preserved. New work begins on a child branch in `kampusone_analytics`.

## Consequences

There is no cross-database transaction. Future read-model synchronisation must use an outbox/retry design and report lag explicitly. Account closure or analytics opt-out writes a suppression before optional ingestion continues, followed by retention/anonymisation jobs under the privacy policy.
