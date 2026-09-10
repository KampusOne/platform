# KampusOne platform

KampusOne is a campus operating layer that helps students know what matters now, complete academic tasks, and navigate campus life with less friction.

This repository contains the private product platform. The existing public landing repository is intentionally separate and is not changed here.

## Applications

| Directory | Runtime | Purpose |
| --- | --- | --- |
| `mobile/` | Expo / React Native | Student-facing application, with **Today** as home |
| `portal/` | Next.js App Router | Separate admin, agent, and engineering surfaces |
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

Phase 0 establishes the repository, tenant/security contracts, preview shells, deployment configuration, and continuous verification. It is not a production launch and contains no live financial or administrative mutation workflows.

Start with [the architecture overview](docs/architecture/README.md) and [the Phase 0 acceptance record](docs/phases/phase-0-foundation.md).
