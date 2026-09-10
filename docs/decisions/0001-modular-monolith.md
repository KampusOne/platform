# ADR 0001: Start as a modular monolith

- Status: accepted; database access boundary superseded by ADR 0003
- Date: 2026-09-09

## Context

KampusOne has a broad eventual product surface but is beginning with one institution and a student-utility wedge. Independent services would increase deployment, observability, security, and data-consistency work before those costs solve a measured problem.

## Decision

Use one public source repository and one PostgreSQL database, with runtime secrets and production data kept outside Git. Keep mobile, portal, Worker, database, contracts, and design tokens as clear directories. Treat product areas as internal modules and deploy only three runtime units: mobile, portal, and Worker.

## Consequences

- Cross-feature transactions and tenant policies remain straightforward.
- CI and local setup stay lightweight.
- Admin, agent, and engineering portals share a deployment but remain separate route and authorization trees.
- A module can be extracted later after measured scale, compliance, or availability needs justify the split.
