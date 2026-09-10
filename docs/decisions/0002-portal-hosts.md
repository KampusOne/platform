# ADR 0002: Separate deployments for operational surfaces

- Status: accepted
- Date: 2026-09-09

## Context

The original foundation proposed one Vercel deployment with host-aware routing. Product review requires the operations portal, agent portal, and build tracker to have separate URLs and release controls. Cross-surface navigation also creates an unnecessary discovery path between trust boundaries.

## Decision

Deploy the same reviewed Next.js codebase as three independent Vercel projects. Each project sets `KAMPUSONE_PORTAL_SURFACE` and exposes only its root experience:

| Surface | Production host | Environment value |
| --- | --- | --- |
| Operations | `ops.kampusone.app` | `admin` |
| Agents | `agents.kampusone.app` | `agents` |
| Build tracker | `build.kampusone.app` | `engineering` |

Internal routes remain available for local review, but production navigation never links between the surfaces. A difficult-to-guess path is not a security control; authenticated identity, scoped roles, tenant checks, and audited actions remain mandatory.

## Guardrails

- No shared catch-all role such as `admin = true`.
- Each mutation declares a capability, tenant boundary, and audit event.
- Engineering health is read-only by default and never exposes secrets or raw personal data.
- Agent access is scoped to assigned institution and workflow.
- Each Vercel project has separate deployment approval, environment variables, and access policy.
- The build tracker is read-only and contains no secret values or personal data.
