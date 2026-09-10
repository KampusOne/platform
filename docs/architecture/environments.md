# Environment and secret contract

| Variable | Mobile | Portal | Worker | Secret |
| --- | ---: | ---: | ---: | ---: |
| KampusOne API URL | Yes | Yes | — | No |
| Supabase URL | Yes | Yes | Yes | No |
| Supabase publishable key | Yes | Yes | Yes | No |
| Supabase secret key | Never | Never | Yes | **Yes** |
| Email automations enabled | Never | Never | Yes | No |
| Resend API key | Never | Never | Yes | **Yes** |
| AI/provider keys | Never | Never | Later | **Yes** |
| Payment webhook secrets | Never | Never | Later | **Yes** |

Public variables are safe to reveal but still environment-specific. Secret variables are encrypted runtime configuration and must not appear in logs, error payloads, screenshots, client bundles or committed files.

KampusOne account email uses published Resend templates sent through the Worker. The Worker holds a domain-scoped, send-only provider key, validates each payload, and requires an idempotency key; mobile and portal clients never call Resend. `EMAIL_AUTOMATIONS_ENABLED` remains the operational kill switch and is enabled per environment only after auth-side OTP, rate-limit and abuse controls pass review.
