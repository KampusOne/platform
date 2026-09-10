# KampusOne platform

KampusOne is a campus operating layer that helps students know what matters now, complete academic tasks, and navigate campus life with less friction.

This repository contains the public product platform source. The existing landing repository remains intentionally separate and is not changed here. Runtime secrets, production data, and operator credentials never belong in this repository.

## Applications

| Directory | Runtime | Purpose |
| --- | --- | --- |
| `mobile/` | Expo / React Native | Student-facing application, with **Today** as home |
| `portal/` | Next.js App Router | Separately deployed operations, agent, and build-tracker surfaces |
| `server/` | Cloudflare Workers + Hono | Thin privileged API and provider boundary |
| `database/` | Supabase PostgreSQL | Migrations, seed data, and verification checks |
| `packages/` | TypeScript/CSS | Shared contracts and official design tokens |

## Local start

Use Node.js 22 or newer and npm. Each application owns its dependencies and lockfile.

```bash
cd packages/contracts && npm install && npm run check
cd ../../server && npm install && npm run dev
cd ../portal && npm install && npm run dev
cd ../mobile && npm install && npm start
```

Copy each `.env.example` only when you need that application. Never commit populated environment files.

## Delivery state

Phase 0 established the repository and tenant/security contracts. Phase 1 is building student identity/onboarding and a controlled agent application/review workflow; financial, NIN-provider, social and marketplace capabilities remain gated.

Start with [the architecture overview](docs/architecture/README.md), [the Phase 0 acceptance record](docs/phases/phase-0-foundation.md), and [the active Phase 1 record](docs/phases/phase-1-identity-and-operations.md).
