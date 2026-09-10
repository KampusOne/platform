# ADR 0002: One deployment, three operational hosts

- Status: accepted
- Date: 2026-09-09

## Decision

Serve admin, agent, and engineering experiences from one Next.js application, with host-aware routing and independent role gates. Local and staging paths are `/admin`, `/agents`, and `/engineering`; production hostnames will be `admin.kampusone.app`, `agents.kampusone.app`, and `engineering.kampusone.app`.

## Guardrails

- No shared catch-all role such as `admin = true`.
- Each mutation declares a capability, tenant boundary, and audit event.
- Engineering health is read-only by default and never exposes secrets or raw personal data.
- Agent access is scoped to assigned institution and workflow.
- A future deployment split must retain these same contracts.
