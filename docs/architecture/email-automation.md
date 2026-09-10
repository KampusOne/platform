# Email automation

KampusOne uses Resend for account and security email. Published templates live in Resend; the Cloudflare Worker sends them through one typed provider adapter. Mobile and portal clients never receive the Resend key and never call the provider directly.

## Provisioned Resend resources

The `kampusone.app` sending domain is verified in `eu-west-1`. Transactional mail uses `KampusOne <hello@kampusone.app>` with `hello@kampusone.app` as the reply address.

| Workflow | Event | Template alias |
| --- | --- | --- |
| Signup verification | `auth.signup_verification.requested` | `k1-signup-code` |
| Onboarding welcome | `user.onboarding.completed` | `k1-welcome` |
| Password reset | `auth.password_reset.requested` | `k1-password-reset` |
| Password changed alert | `auth.password.changed` | `k1-password-changed` |
| Email change verification | `auth.email_change.requested` | `k1-email-change-code` |
| New sign-in alert | `auth.new_login.detected` | `k1-new-login` |
| Account deletion notice | `account.deletion.requested` | `k1-account-deletion` |

All seven templates are published. The HTML is table-based and includes a plain-text alternative. Account codes remain selectable text rather than images or script-based copy controls, which makes them copyable across major mail clients.

Matching event definitions and dashboard workflows are retained in Resend as disabled references. They must stay disabled while the Worker is the sending path; enabling both paths would create duplicate email. Direct template sends let the runtime use a domain-scoped, send-only key and Resend's email idempotency header.

## Worker integration

`server/src/lib/email.ts` is the only provider boundary. It:

- exposes a compile-time payload contract for every event;
- maps every event to an explicit published template alias and variable allowlist;
- validates six-digit codes, short expiry windows, email addresses and text lengths;
- permits action links only on `https://kampusone.app` or its subdomains;
- rejects HTML-like input before it reaches a template;
- requires a stable business-event idempotency key on every send;
- has a five-second provider timeout and classifies retryable provider failures;
- supports an immediate `EMAIL_AUTOMATIONS_ENABLED` kill switch;
- never logs the recipient, code, event payload or Resend key.

Auth services call `sendEmailAutomationEvent` only after the corresponding database state change succeeds. Dispatch should be driven from an outbox row whose immutable ID becomes the idempotency key. Retries must reuse that same key and payload.

## Secret and activation contract

`RESEND_API_KEY` is a Cloudflare Worker secret. Use a Resend `sending_access` key restricted to `kampusone.app`, and add it separately to preview and production. Never put the value in Wrangler variables, GitHub files, Expo variables or Vercel client variables.

```bash
cd server
npx wrangler secret put RESEND_API_KEY --env preview
npx wrangler secret put RESEND_API_KEY --env production
```

Keep `EMAIL_AUTOMATIONS_ENABLED=false` until the matching authentication action, rate limit, OTP storage/expiry and abuse tests are complete. Enable preview first, send only to controlled test accounts, confirm delivery and rendering, then enable production in a reviewed change.

## Required auth-side rules

- Generate verification and reset codes with a cryptographically secure random source.
- Store only a keyed hash of the code, with purpose, user, expiry and attempt count.
- Expire codes after ten minutes, accept each code once, and invalidate older codes after resend.
- Rate-limit by account, destination, IP and device; return the same public response whether an account exists or not.
- Revoke prior sessions after a successful password reset.
- Record delivery state and provider failures without storing email contents or plaintext codes.

## Current boundary

Resend provisioning and the Worker adapter are complete. Live signup and password flows remain gated because authentication routes and their database-backed OTP lifecycle are not yet implemented. Enabling the delivery flag alone does not make authentication production-ready.
