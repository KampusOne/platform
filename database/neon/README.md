# Neon boundary

Neon is the product-analytics and reporting store for KampusOne. It is not a second identity system.

- Supabase remains authoritative for authentication, role assignments, transactional campus data and private files.
- Mobile and browser clients never receive a Neon connection string and never write to Neon directly.
- The Cloudflare Worker verifies a Supabase access token, applies consent and payload limits, then writes a small allow-listed event to Neon.
- Do not copy email addresses, phone numbers, NIN, matriculation numbers, document text/images, messages or precise coordinates into analytics events.
- `subject_id` is the Supabase user UUID. Account closure/analytics opt-out adds a suppression before optional events are accepted; retention jobs later remove or aggregate historical events according to policy.

## Branches

The connected Neon project already contains legacy `public` and `kampusone_v12` schemas. Phase 1 work is isolated on the `phase-1-platform-foundation` branch and in the `kampusone_analytics` schema. Production remains unchanged until a reviewed promotion.

## Applying migrations

Migrations are ordered SQL files. Apply them to a Neon development branch first, run the verification queries beside the phase handoff, and promote only after review. The Cloudflare preview secret should point to the branch connection string; production must use a least-privilege writer role.
