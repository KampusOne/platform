# Environment and secret contract

| Variable | Mobile | Portal | Worker | Secret |
| --- | ---: | ---: | ---: | ---: |
| KampusOne API URL | Yes | Yes | — | No |
| Supabase URL | Yes | Yes | Yes | No |
| Supabase publishable key | Yes | Yes | Yes | No |
| Supabase secret key | Never | Never | Yes | **Yes** |
| Resend key | Never | Never | Later | **Yes** |
| AI/provider keys | Never | Never | Later | **Yes** |
| Payment webhook secrets | Never | Never | Later | **Yes** |

Public variables are safe to reveal but still environment-specific. Secret variables are encrypted runtime configuration and must not appear in logs, error payloads, screenshots, client bundles, or committed files.

Supabase authentication email uses a connected SMTP provider in production. The default Supabase SMTP service is not the production plan because brand templates and reliable external delivery require provider configuration.

Portal deployments also set the non-secret server variable `KAMPUSONE_PORTAL_SURFACE` to exactly one of `admin`, `agents`, or `engineering`. This creates separate release units; it does not replace authentication or authorization.
