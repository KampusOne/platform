# Deployment map

## Environments

| Environment | Purpose | Data | Deployment rule |
| --- | --- | --- | --- |
| Local | Development and automated checks | Disposable developer data | Providers may be disabled, but each dependent action fails closed |
| Staging | Release candidate and provider acceptance | Isolated pilot-safe Neon branch | Same authentication and mutation code paths as production |
| Production | Student and operator traffic | Protected production Neon branch | Explicit migration, secret, domain, acceptance, and rollback approval |

“Staging” describes an isolated release environment; it does not enable permissive codes, fake dashboards, or alternate business logic.

## Portal on Vercel

Create one Vercel project with repository root `portal`. Attach `admin.kampusone.app`, `agents.kampusone.app`, and `engineering.kampusone.app`; `proxy.ts` maps each hostname to its role-specific surface. Set only:

- `NEXT_PUBLIC_KAMPUSONE_API_URL=https://api.kampusone.app`

The browser receives no database or provider secret.

## API on Cloudflare Workers

`server/wrangler.jsonc` disables `workers.dev` and generated preview URLs and declares `api.kampusone.app` as the production custom domain. Configure the runtime secrets listed in the live handoff. The five-minute scheduled handler expires unpaid bookings and orders and restores held inventory.

Keep `PAYMENTS_ENABLED=false` until Paystack test and live webhooks, refund ownership, settlement, and reconciliation have been approved. Enabling the flag without its secret still fails closed.

## Mobile with Expo/EAS

The `internal` EAS profile is for signed acceptance builds; the `production` profile is for store submission. Set:

- `EXPO_PUBLIC_KAMPUSONE_API_URL=https://api.kampusone.app`

Configure Expo project ownership, Apple/Google signing, secure native refresh-token storage, push credentials, privacy declarations, and store metadata before submission.

## Database on Neon

Apply `database/neon/migrations` in filename order to an isolated branch, run the acceptance SQL and end-to-end tests, then promote the exact reviewed migrations to the protected production branch. Do not use the historical Supabase seed as production content.
