# Security baseline

## Trust boundaries

- Mobile and browser code are untrusted clients and contain only the public API origin.
- The Cloudflare Worker holds Neon and provider secrets through encrypted runtime configuration.
- Identity comes from a short-lived Worker-signed access token backed by a database session family.
- University membership and operational roles come from protected database records, never user-editable claims alone.

## Authentication

- Passwords use Argon2id with a random salt.
- Email and password-reset codes are six digits, keyed with a server-only pepper, stored only as hashes, expire after ten minutes, allow five attempts, and are consumed atomically.
- Login is refused until email verification succeeds.
- Access tokens last fifteen minutes. Refresh tokens rotate atomically; reuse revokes the token family.
- Web refresh tokens use `HttpOnly`, `Secure`, `SameSite=Lax` cookies in production.
- The first platform administrator is created through a one-time bootstrap secret after normal email verification; default passwords are forbidden.
- Operator MFA and finance/KYC step-up authentication remain a production gate.

## Authorization sequence

1. Verify token signature, issuer, audience, and expiry.
2. Resolve current user, university membership, and active operator/agent profile.
3. Check the smallest role required for the action.
4. Validate tenant ownership for every referenced record.
5. Apply feature/provider gate, rate limit, state transition, and idempotency rules.
6. Perform consistency-sensitive work in one database transaction.
7. Append an audit event without secrets or unnecessary identity data.

## Data and financial controls

- Clients have no direct database connection.
- `app_private` transaction functions are not granted to the public role.
- Inventory, tutorial capacity, OTP consumption, and session rotation use locks or atomic statements.
- Prices and fees are calculated from server records.
- Paystack webhooks require HMAC verification; duplicate references are idempotent and late/mismatched events enter a finance review queue.
- Earnings move through explicit pending/available/reserved/paid states. Disputes freeze related earnings.
- Ordinary administrators cannot directly edit a balance.

## Remaining production controls

Production operator access requires MFA, least-privilege role provisioning, maker-checker approval for high-risk finance changes, managed KYC/media retention, alerting, backup/restore evidence, and penetration/tenant-isolation testing. These are release gates, not hidden client-side switches.
