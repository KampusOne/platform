# Security baseline

## Trust boundaries

- Mobile and browser code are untrusted clients. They may contain only public configuration and a Supabase publishable key.
- The Worker may hold Supabase and provider secret keys through encrypted runtime secrets.
- Identity comes from a verified Supabase JWT. A local session object alone is never an authorization decision.
- Institution membership and operational roles come from protected database records, not user-editable profile metadata.

## Authorization sequence

1. Verify the access token and obtain the immutable user identifier.
2. Resolve active institution membership.
3. Check the smallest role or capability required by the operation.
4. Validate tenant ownership for every referenced record.
5. Apply quota, feature flag, provider kill switch, and idempotency rules.
6. Perform the operation in a transaction where consistency requires it.
7. Append an audit event without storing secrets or unnecessary personal data.

## Database rules

- RLS is enabled and forced on exposed application tables.
- Policies include both `USING` and `WITH CHECK` when mutation is allowed.
- Explicit grants are used; there is no reliance on implicit Data API exposure.
- Operational tables such as provider controls, idempotency records, usage counters, and audit payloads are not granted to client roles.
- Views exposed to clients must use `security_invoker = true`.

## Phase 0 limitations

The preview dashboards contain non-sensitive demonstration state only. Administrative mutations, agent verification actions, real provider delivery, uploads, and financial workflows remain disabled until their policies and audit paths are implemented and tested.
