# Neon database delivery

KampusOne uses one Neon PostgreSQL project as the system of record. Application traffic reaches the database through the Cloudflare Worker; database credentials are never shipped to the Expo or Next.js clients.

## Migration order

Reconcile the live ledger and structural state before selecting files in `migrations/`. Apply only genuinely missing reviewed versions in filename order with a direct, non-pooled Neon connection. Test each migration on a Neon branch created from production before promoting the same reviewed SQL to production. Never replay every inventory file simply because its ledger entry is absent.

The October 1 live rollout applied 41 reviewed versions on a fresh production child and production. The 67-file inventory now has 50 registered source matches, 15 older unregistered baseline sources and 2 deliberately superseded prerequisites. All 14 versions introduced by the platform update are registered. Do not replay the unregistered baseline or superseded files; source/object review and the compatible replacement are recorded in `docs/phases/2026-10-01-live-migration-rollout.md`.

Run `node database/neon/reconcile-migrations.mjs` from the repository root to verify the inventory against the current metadata-only production snapshot. The script makes no network call or database write and intentionally produces no automatic apply list. `server/tests/platform-migration-rehearsal.test.ts` tests the fourteen introduced versions together; actual production-child and production acceptance evidence is in `database/verification/production-20261001-platform.json`. Each newly applied version and its exact source ledger record committed atomically. Successful database verification does not authorize financial activation or establish provider/device acceptance.

`20260912010000_shared_agent_email_login.sql` adds the private, hashed, one-time email challenges used to issue a separate agent-portal session for an existing verified KampusOne account. It is independent from email-verification and password-reset tokens.

`20260912200000_phase_3_commerce_foundation.sql` adds the independently gated Store and bicycle-logistics foundation plus revision-safe vendor storefront operations. Run both Phase 3 verification files on a fresh production branch before promotion; the migration is re-runnable on earlier rehearsal drafts, does not authorize feature activation, and does not choose commercial policy values.

The Phase 1–3 migration is additive. It preserves the earlier `kampusone_v12` schema and imports its Argon2id student identities into the current `public.users` table only when that legacy schema exists. Password hashes are copied as hashes; plaintext passwords are never available or created by the migration.

## Runtime boundaries

- `DATABASE_URL` is the pooled URL used by the Cloudflare Worker.
- `DATABASE_URL_UNPOOLED` is used only for migrations and database administration.
- Every student, content, tutorial, commerce, and delivery record carries a university boundary.
- All privileged writes create an append-only audit event.
- Financial balances are calculated from append-only double-entry ledger lines; no mutable balance column is authoritative.
