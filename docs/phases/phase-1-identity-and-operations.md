# Phase 1 — identity, onboarding and controlled operations

## Status

In progress. The implementation is reviewable and all local build gates pass, but production delivery is deliberately blocked on campus data ownership, email delivery and deployment credentials.

## Delivered in this slice

- a three-part illustrated student introduction using the KampusOne brand system;
- Supabase-ready sign-up, password sign-in, email OTP, resend, recovery, session refresh and logout;
- institution/academic onboarding and clear notification/location permission education;
- dedicated navigation for inbox, Study tools, GPA, timetable, AI summary and KampusOne Pro;
- a five-point GPA calculator with on-device semester history;
- service-only inbox structure without classmate direct messages;
- a permissions centre with browser/Android requests and an in-app alarm vibration test;
- three independently deployable Next.js surfaces for operations, agents and the build tracker;
- an interactive build tracker covering Phases 00–11, requirements, evidence and builder notes;
- authenticated agent application, local draft recovery, private evidence upload and application status;
- an operations queue with signed evidence viewing and reasoned document/application decisions;
- additive Supabase migrations for applications, private evidence, RLS, role grants, human/automated check records and append-only audit evidence;
- Cloudflare Worker routes for privileged verification decisions; signed-in browser clients cannot invoke the elevated database functions directly;
- Cloudflare static-assets configuration and a manual verified deployment workflow for the Expo web build.

## Trust and verification behavior

Automated file integrity, malware, OCR, name matching and future NIN checks produce signals. The public states are `pending`, `pass`, `review`, and `fail`. A provider outage or inconclusive signal remains `pending`/`review`, never an automatic failure. Every human decision requires a reason and writes append-only review and audit evidence.

An obscure admin path is not a security control. The production operations surface is planned at `ops.kampusone.app`, isolated from `agents.kampusone.app` and `build.kampusone.app`, with invited identities, trusted role assignments, institution scope and a Cloudflare privileged API boundary.

## Applied database evidence

- `20260910093000_agent_applications.sql`
- `20260910094500_agent_application_hardening.sql`
- `20260910100500_agent_review_state_guards.sql`
- Supabase security advisor: no findings after hardening.
- Performance advisor: only unused-index informational findings are expected while all new tables are empty.

## Acceptance record

- [x] Shared contracts type-check and tests pass.
- [x] Worker type-check and tests pass.
- [x] Worker dry-run deployment bundle succeeds.
- [x] Portal lint, type-check and production build pass.
- [x] Mobile type-check and static web export pass.
- [x] Expo static assets pass a Cloudflare Wrangler dry run with SPA routing.
- [x] Both additive migrations applied successfully to the connected Supabase project.
- [x] Supabase security advisor returns no findings.
- [ ] Production SMTP sends branded verification and recovery messages.
- [ ] Verified academic catalogue is loaded with a named owner.
- [ ] Pilot admin and agent accounts pass the cross-portal acceptance journey.
- [ ] Cloudflare, Vercel and Expo production deployments are connected and smoke-tested.

## Inputs required to finish the phase

1. Verified UNIBEN faculty, department, programme, level, course and venue catalogue plus the person responsible for approving corrections.
2. Custom SMTP/Resend credentials and a verified KampusOne sender domain.
3. Pilot admin and agent email addresses for least-privilege role assignment.
4. Cloudflare account ID, scoped deployment token and DNS access when deployment starts.
5. Three Vercel projects/domain mappings and the Expo organization/project.
6. Privacy, document-retention, legal-hold and human-escalation ownership.

Secrets must be entered in the relevant provider or deployment environment, never pasted into source, screenshots, tracker notes or chat logs.
