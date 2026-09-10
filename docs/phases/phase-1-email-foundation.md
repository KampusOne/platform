# Phase 1 slice — account email foundation

## Goal

Provision the branded transactional-email layer and a safe provider boundary without claiming that authentication itself is complete.

## Completed — 10 September 2026

- [x] Verified `kampusone.app` sending domain confirmed in Resend.
- [x] Seven branded, plain-text-backed account templates published.
- [x] Seven typed Resend events created.
- [x] Seven matching dashboard automations retained disabled as implementation references.
- [x] Cloudflare Worker direct-template adapter implemented without a client-side SDK or secret.
- [x] Payload validation, idempotency, KampusOne-only action links, timeout handling and a delivery kill switch added.
- [x] Unit tests cover disabled delivery, template dispatch, idempotency, missing configuration, malformed OTPs, unsafe links and provider rate limits.
- [x] Environment and deployment documentation updated.

## Still gated

- [ ] Set the domain-scoped, send-only `RESEND_API_KEY` as a preview Worker secret.
- [ ] Implement database-backed signup and password-reset OTP lifecycle.
- [ ] Add account/IP/device rate limits and resend cooldowns.
- [ ] Connect successful auth state changes to the typed email adapter through an outbox.
- [ ] Test Gmail, Outlook and mobile rendering with controlled accounts.
- [ ] Set the production Worker secret and enable email delivery only after preview acceptance.

## Acceptance rule

Published Resend templates do not mean public auth is live. The Worker delivery flag stays off until OTP storage, expiry, one-time use, enumeration resistance, rate limiting and session revocation pass tests. Resend dashboard workflows stay disabled while direct Worker sending is active.
