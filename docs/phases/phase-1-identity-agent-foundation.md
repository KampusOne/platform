# Phase 1 handoff: identity, onboarding and agent foundation

- Status: implementation complete; live migration and configured-environment round trips remain release gates
- Updated: 2026-09-10

## Delivered code

- Mobile welcome, four-slide illustrated introduction, account creation, password login, email OTP, recovery and a resumable 14-step onboarding flow.
- Notification and location explainers, explicit privacy/analytics/personalisation choices, inbox and notification entry points.
- Agent application UI with role/profile details, private-document states, consent, review and a pending/manual verification timeline.
- Operations review UI with redacted sample evidence, deterministic versus uncertain checks, reasoned decisions and audit messaging.
- A separate build-tracker surface containing the complete phased product plan, evidence, requirements, decisions and blockers.
- Supabase migration for onboarding, device-permission health, agent evidence, server-only verification cases/checks, private Storage policies and append-only review decisions.
- A Neon development branch and separate analytics schema, plus an authenticated, consent-gated Cloudflare Worker ingestion endpoint.

## Data boundary

Supabase owns authentication, trusted permissions, operational records, consent and private documents. Neon receives only allow-listed product events through Cloudflare. Email, phone, NIN, matriculation numbers, documents, messages and precise coordinates are prohibited from analytics properties.

The connected Neon production branch already contains older schemas. They were preserved. Phase 1 was applied only to `phase-1-platform-foundation` in `kampusone_analytics`.

## Verification completed

- Contracts: TypeScript check and 2 tests pass.
- Portal: ESLint, TypeScript and Next.js production build pass.
- Mobile: TypeScript and Expo static web export pass.
- Worker: TypeScript, 8 tests and Wrangler dry bundle pass.
- Supabase Phase 1 migration: full transaction validated against the connected project with `ROLLBACK`; no schema change was retained by the validation.
- Neon: migration transaction applied to the development branch; tables and reporting view queried successfully.

## Remaining Phase 1 release gates

1. Obtain the product owner's explicit production approval, apply the reviewed Supabase migration and regenerate checked-in TypeScript database types.
2. Configure Supabase public variables in Expo/Vercel and secret variables in Cloudflare; run a real account/OTP/onboarding round trip.
3. Set the Neon development-branch connection string as the Cloudflare preview secret and keep ingestion disabled until the consent test passes.
4. Bootstrap the first trusted platform operator out of band, then test cross-tenant denial and every review decision.
5. Attach `ops.kampusone.app`, `agents.kampusone.app` and `build.kampusone.app` in Vercel/Cloudflare DNS.
6. Complete device notification/location permission tests on signed Expo builds.

## Product and safety opinion

- A difficult admin URL is not security. The real boundary is authentication, trusted roles, tenant scope, RLS and an audit trail.
- Generic AI cannot certify a Nigerian identity or prove a document genuine. File/OCR consistency can triage; licensed provider evidence and accountable manual review decide. Uncertainty stays pending.
- Account closure should remove access immediately, then retain only records covered by a published legal/operational schedule or legal hold. Indefinite hidden retention is not acceptable.
