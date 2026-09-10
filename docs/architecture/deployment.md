# Deployment map

## Environments

| Environment | Purpose | Data | Deployment rule |
| --- | --- | --- | --- |
| Local | Fast implementation and tests | Fixtures only | No external provider credentials required |
| Preview | Reviewable builds per phase | Synthetic/pilot-safe data | Auth and writes remain disabled until their gate passes |
| Production | Student and operator traffic | Production tenant data | Protected branch, explicit environment approval, rollback ready |

## Portal on Vercel

Create one Vercel project with repository root directory `portal`. Preview URLs expose `/admin`, `/agents`, and `/engineering`. After Phase 1 security acceptance, attach the three production hosts to the same project; `proxy.ts` maps each root hostname to its surface.

Required public variables:

- `NEXT_PUBLIC_KAMPUSONE_API_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

No secret key belongs in the Vercel client environment.

## Worker on Cloudflare

The Worker is configured in `server/wrangler.jsonc`. Preview and production are distinct Wrangler environments. The GitHub deployment workflow is manual and verifies the Worker before release.

Repository/environment secrets:

- `CLOUDFLARE_API_TOKEN`, scoped to Workers deployment and the intended account;
- `CLOUDFLARE_ACCOUNT_ID`;
- Worker runtime secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`, configured with Wrangler or the Cloudflare dashboard rather than committed files.

Production begins in maintenance mode with all feature gates off. Activation is a separate reviewed change.

## Mobile with Expo/EAS

The `preview` EAS profile produces an internally distributed Android APK. A downloadable artifact requires the KampusOne Expo organization/project to be linked and an authenticated EAS build. Store builds are not created from unreviewed preview code.

Required public variables:

- `EXPO_PUBLIC_KAMPUSONE_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Database on Supabase

Apply forward migrations to a preview branch/project first. Run the repository verification SQL plus Supabase security and performance advisors. Promote only the same reviewed migration to production; never repair drift by editing an applied file.
