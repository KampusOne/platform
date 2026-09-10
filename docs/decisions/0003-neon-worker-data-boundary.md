# ADR 0003: Keep Neon behind the Worker API

- Status: accepted
- Date: 2026-09-10
- Supersedes: the Supabase-specific access boundary in ADR 0001

## Context

The production database is Neon PostgreSQL. The platform owns authentication, tenant resolution, financial state transitions, provider callbacks, and audit history. Supplying a browser or mobile database credential would create a second authorization path and weaken the invariant that sensitive writes pass through one policy boundary.

## Decision

All mobile and portal data requests cross the Cloudflare Worker API. Only the Worker receives the pooled Neon connection string and may call `app_private` transaction functions. Clients receive short-lived application access tokens and never receive a PostgreSQL credential.

Use parameterized queries, ownership and university filters, role checks, feature gates, state-machine guards, database constraints, and transactions in the Worker/database boundary. A future direct data API requires a separate reviewed decision, row-level security, and automated tenant-isolation evidence before any table is exposed.

## Consequences

- Authentication and object authorization have one runtime enforcement path.
- Financial, inventory, capacity, and handoff operations remain server-owned and transactional.
- Public clients cannot bypass API validation with direct database queries.
- Ordinary reads incur a Worker hop; caching and pagination should be added based on measured traffic.
