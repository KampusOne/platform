# Rollout budget assumptions and integration boundaries

Infrastructure pricing checkpoint: 21 September 2026; provider architecture reconciled on 25 September. USD estimates below are scenarios, not account invoices or a 10,000-user performance guarantee. Taxes, FX, staff, app-store accounts, media transcoding, payment fees and domains are excluded.

## Two workloads

| Assumption per 30-day month | Small pilot | 10,000 registered users |
| --- | ---: | ---: |
| Daily active users | 100 | 2,000 (20%) |
| Dynamic API requests per daily active user | 30 | 30 |
| Dynamic requests | 90,000 | 1,800,000 |
| Assumed Worker CPU/request (measure in pilot) | 10 ms | 10 ms |
| Transactional emails | 2,000 | 20,000 |
| AI study sessions | 500 | 12,000 |
| Average text input/output per study session | 4,000 / 1,000 tokens | 4,000 / 1,000 tokens |
| Retained media | 5 GB | 100 GB |
| R2 writes / reads | 20,000 / 100,000 | 100,000 / 2,000,000 |
| Media served | 20 GB | 1 TB |

## Verified pricing inputs and estimates

- Cloudflare Workers Standard has a $5/month minimum, includes 10 million requests and 30 million CPU ms; excess requests cost $0.30/million and CPU costs $0.02/million ms. Both workloads fit the included volumes **under these assumptions**. Free has a 100,000 daily request allowance and 10 ms CPU/invocation, which is not adequate evidence that password hashing or all routes fit. [Official Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- R2 Standard includes 10 GB storage, 1 million Class A and 10 million Class B operations. Additional storage is $0.015/GB-month; internet egress is free. The stated 100 GB scenario is roughly $1.35 storage, before any operations overage. Retention, failed-upload cleanup and video limits still matter. [Official R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- Resend transactional Free allows 3,000/month and 100/day; Pro is $20/month for 50,000, with $0.90/1,000 overage. Pilot signup spikes can exceed the daily limit despite fitting the monthly total. Marketing/audience pricing must be budgeted separately before promotional campaigns. [Official Resend pricing](https://resend.com/pricing).
- Supabase Free lists 50,000 monthly active users; Pro starts at $25 and includes 100,000. Free projects can pause after inactivity. The observed project is an OAuth identity dependency, not the application database; actual plan and provider quotas must be checked before launch. [Official Supabase pricing](https://supabase.com/pricing).
- Hugging Face Free lists $0.10 monthly Inference Providers credit, subject to change; PRO lists $2. A model/provider and representative timetable benchmark must be selected before estimating per-import cost. Do not label this integration unlimited/free. [Official Hugging Face billing](https://huggingface.co/docs/inference-providers/pricing).
- Neon project inspection shows a free plan, approximately 39 MB logical storage and the branch quota already occupied (10/10). Current pricing-page retrieval was unavailable, so no unverified Neon paid price is quoted. Record measured CU-hours, storage, retained history and egress before selecting a plan. A fresh remote rehearsal branch needs available quota.
- Vercel frontend plan charges and usage are excluded until the account's billing terms and appropriate production plan are checked. READY deployments do not establish free hosting entitlement or future capacity.

**Partial non-AI subtotal** using the documented Workers Standard, Resend Pro and R2 assumptions: $25.00 pilot; $26.35 larger scenario. This excludes all AI, Neon, Vercel, any paid Supabase plan, bank/payment costs and the other exclusions above. Hugging Face text and vision calls use the selected routed provider’s rates without a Hugging Face markup. Model IDs alone do not establish the billed amount. Record input/output tokens, images, retries and the exact active provider rate before completing a quote. [Current official Hugging Face billing](https://huggingface.co/docs/inference-providers/en/pricing).

## Required provider boundaries

Authentication uses the existing Worker account/session service; Supabase handles configured external OAuth identities. Google and Apple are currently disabled in the inspected Supabase project and require provider credentials and redirect setup. Adding an already-known Worker key alone will not enable them.

Existing verified Resend sending domain is available. Email templates, preferences and recipient-level delivery records remain application responsibilities. No live test email was sent during this build.

Public user media and private evidence use separate R2 bindings; private document URLs require authorization and short expiry. Buckets are Cloudflare bindings, not string environment variables.

The current Hugging Face-only study/timetable adapter requires compatible models, server-only credentials, schema validation, atomic usage reservations and deliberate activation. Numeric free AI offer beneficiaries/reset policy remain an owner decision; no unlimited entitlement is assumed.

Native remote notifications require the real Expo EAS project ID in app configuration, platform credentials and a development/release build. Web preview and local reminders are distinct. Test-ticket acceptance, provider receipt and recipient observation are separate states. [Expo setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) and [delivery receipts](https://docs.expo.dev/push-notifications/sending-notifications/).

Bank resolution uses a selected provider's account-name lookup. It is neither proof of beneficial ownership nor automatic payout approval. Provider onboarding and cost must be checked; live money movement is outside the code-only validation in this change.
