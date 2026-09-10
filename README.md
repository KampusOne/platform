# KampusOne platform

KampusOne is a campus operating layer that helps students know what matters now, complete academic tasks, and navigate campus life with less friction.

This repository contains the public product platform source. The existing landing repository remains intentionally separate and is not changed here. Runtime secrets, production data, and operator credentials never belong in this repository.

## Applications

| Directory | Runtime | Purpose |
| --- | --- | --- |
| `mobile/` | Expo / React Native | Student-facing application, with **Today** as home |
| `portal/` | Next.js App Router | Separate admin, agent, and engineering surfaces |
| `server/` | Cloudflare Workers + Hono | Thin privileged API and provider boundary |
| `database/` | Neon PostgreSQL | Forward migrations, transactional functions, and verification checks |
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

The repository now contains data-backed Phase 1 student utility, Phase 2 tutorial operations, and Phase 3 controlled store/logistics workflows. Authentication, email verification, administration, agent approval, bookings, inventory, payments, disputes, earnings, payouts, and delivery handoffs fail closed when their required server-side service is unavailable; no client receives a test OTP or fabricated business metric.

This source tree is not the same thing as a production release. Production remains gated until the owner supplies provider credentials and policies, the reviewed Neon migrations are promoted, the applications are deployed to their real domains, and acceptance tests pass. See [the Phase 1–3 implementation and launch handoff](docs/phases/phase-1-3-live-handoff.md).
