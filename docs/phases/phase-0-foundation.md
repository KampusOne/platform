# Phase 0 — platform foundation

## Goal

Create a verifiable, deployable product skeleton without implying that authentication, real campus data, or operational mutations are production-ready.

## Included

- public platform repository with documented secret and data boundaries;
- official KampusOne design tokens, Lato display typography, Inter product typography, and outlined logo assets;
- Expo student preview centered on Today, with a consistent consumer-product layout and interactive sample states;
- separate admin, agent, and engineering preview surfaces;
- thin Cloudflare Worker with health and public-configuration endpoints;
- tenant-aware Supabase foundation migration with explicit grants and RLS;
- CI for type checking, linting, tests, and production builds;
- environment contracts and provider/cost-control rules.

## Intentionally not included

- public landing-page changes;
- live authentication or role assignment;
- production subdomain attachment;
- real email, push, AI, payment, or SMS delivery;
- downloadable store builds;
- financial mutation workflows;
- social feed or marketplace functionality.

## Acceptance checks

- [x] Contracts package type-checks and tests pass.
- [x] Worker type-checks, tests, and dry-run deployment build pass.
- [x] Portal lints, type-checks, and builds for production.
- [x] Mobile type-checks and exports for web.
- [x] SQL migration passes review and Supabase security/performance advisors after application.
- [x] Preview surfaces clearly label simulated data and disabled operations.
- [x] No secret or populated environment file is tracked.

## Interface baseline correction

The student preview uses the official Lato and Inter product typography. Home, Feed, Campus, Tutorials, and Store share the same compact header, search/filter language, content-card rhythm, touch feedback, and floating navigation. Reference products may inform layout discipline, but KampusOne colors, assets, copy, and product hierarchy remain authoritative.

## Inputs required for Phase 1

- confirmed production and preview domain ownership in Cloudflare;
- approved authentication flow and verification-email copy;
- Resend connection or SMTP credentials for Supabase Auth;
- Expo organization/project access for installable Android artifacts;
- initial UNIBEN faculty, department, programme, course, venue, and grading data owners;
- named admin and agent pilot accounts with least-privilege roles;
- privacy policy, terms, retention periods, and escalation contacts.
