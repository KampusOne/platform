# Neon database delivery

KampusOne uses one Neon PostgreSQL project as the system of record. Application traffic reaches the database through the Cloudflare Worker; database credentials are never shipped to the Expo or Next.js clients.

## Migration order

Apply files in `migrations/` in filename order with a direct, non-pooled Neon connection. Test each migration on a Neon branch created from production before promoting the same reviewed SQL to production.

`20260912010000_shared_agent_email_login.sql` adds the private, hashed, one-time email challenges used to issue a separate agent-portal session for an existing verified KampusOne account. It is independent from email-verification and password-reset tokens.

The Phase 1–3 migration is additive. It preserves the earlier `kampusone_v12` schema and imports its Argon2id student identities into the current `public.users` table only when that legacy schema exists. Password hashes are copied as hashes; plaintext passwords are never available or created by the migration.

## Runtime boundaries

- `DATABASE_URL` is the pooled URL used by the Cloudflare Worker.
- `DATABASE_URL_UNPOOLED` is used only for migrations and database administration.
- Every student, content, tutorial, commerce, and delivery record carries a university boundary.
- All privileged writes create an append-only audit event.
- Financial balances are calculated from append-only double-entry ledger lines; no mutable balance column is authoritative.
