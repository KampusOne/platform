# KampusOne engineering instructions

These rules apply to the entire repository.

## Product boundary

- Build the student utility first. Social, marketplace, payments, and broad AI features remain gated until their prerequisites are complete.
- The mobile home is **Today**. The social feed is a separate destination.
- UNIBEN is tenant one; never hard-code UNIBEN as the only possible institution.
- Keep admin, agent, and engineering operations separate in navigation, authorization, and audit history.
- Do not modify or replace the public landing site from this repository.

## Architecture

- Keep one repository, one PostgreSQL database, and a modular-monolith structure.
- Use npm only. Do not add Turborepo, pnpm, Yarn, Bun, Docker, or a local PostgreSQL requirement.
- Mobile is Expo/React Native. Portals are Next.js App Router. Privileged API work runs on Cloudflare Workers with Hono.
- Route browser and mobile data access through the Worker. Neon credentials and transaction functions are server-only; clients never connect directly to PostgreSQL.
- Put provider-specific logic behind adapters. Every paid or externally metered path needs a quota, timeout, idempotency strategy, kill switch, and observable failure state.

## Security and data

- Do not expose database tables through a public data API. If a direct data API is introduced later, RLS and automated tenant-isolation tests are mandatory before exposure.
- Tenant-owned records carry `institution_id`, and access policies must enforce that boundary.
- Never authorize from user-editable metadata. Verify identity and roles from trusted claims or database records.
- Never put database credentials, provider secrets, or Cloudflare tokens in browser or mobile bundles.
- Financial records are append-only double-entry ledger records. No balance-only mutation model.
- Admin access is least privilege, role-gated, and audited. There is no unrestricted universal admin surface.
- Private uploads remain private. Use short-lived signed URLs for authorized access.

## Product quality

- Every user-facing feature must account for loading, empty, error, offline, success, focus, disabled, and reduced-motion states.
- Preserve the official outlined KampusOne logo assets. Do not redraw the K1 mark.
- Use Lato for display headings and Inter for product UI, body, forms, labels, and numbers. Do not introduce decorative script typography into functional screens.
- Avoid generic SaaS visual tropes: purple gradients, excessive glow, glass everywhere, pill-shaped everything, and decorative card grids.
- Motion communicates state or continuity. Respect reduced motion and avoid blocking interaction for animation.
- Optimize for real Nigerian campus networks and mid-range Android phones before adding visual weight.

## Delivery

- Keep changes phase-sized and reversible.
- Update the relevant architecture decision or phase record when a boundary changes.
- A phase is not complete until linting, type checks, tests, production builds, migration review, and a concise handoff record are complete.
