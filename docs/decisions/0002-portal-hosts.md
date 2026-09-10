# ADR 0002: One deployment, three operational hosts

- Status: accepted
- Date: 2026-09-09

## Decision

Serve operations, agent, and build-tracking experiences from one Next.js application, with host-aware routing and independent role gates. Preview routes are `/admin`, `/agents`, and `/engineering`; production hostnames are `ops.kampusone.app`, `agents.kampusone.app`, and `build.kampusone.app`.

## Guardrails

- No shared catch-all role such as `admin = true`.
- Each mutation declares a capability, tenant boundary, and audit event.
- Engineering health is read-only by default and never exposes secrets or raw personal data.
- Agent access is scoped to assigned institution and workflow.
- Surface navigation does not link to the other workspaces.
- Hostname secrecy is never treated as authorization.
- A future deployment split must retain these same contracts.
