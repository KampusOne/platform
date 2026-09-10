# Environment and secret contract

| Variable | Mobile | Portal | Worker | Secret |
| --- | ---: | ---: | ---: | ---: |
| KampusOne API URL | Yes | Yes | — | No |
| Pooled Neon `DATABASE_URL` | Never | Never | Yes | **Yes** |
| `JWT_SECRET` | Never | Never | Yes | **Yes** |
| `OTP_PEPPER` | Never | Never | Yes | **Yes** |
| Resend API/from/reply-to | Never | Never | Yes | **Yes** |
| Paystack secret/webhook key | Never | Never | Yes | **Yes** |
| One-time admin bootstrap token | Never | Never | Temporary | **Yes** |
| KYC, storage, push, analytics keys | Never | Never | When selected | **Yes** |

Public client configuration contains only the API origin. Secrets are encrypted runtime configuration and must not appear in logs, error payloads, screenshots, client bundles, or committed files.

Local, staging, and production use the same verification and authorization code. Provider-backed actions fail closed when their credential is absent. Production registration requires a verified Resend sending domain; payments remain disabled until signed webhook and reconciliation acceptance tests pass.
