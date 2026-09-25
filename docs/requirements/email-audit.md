# Email communications implementation and release evidence

Requirements: 42–53, 68, and the email portion of 69. Inspection and local implementation date: 21 September 2026. No live test email or campaign was sent. This is implementation evidence, not a production delivery certification.

## Implemented flow

The admin Broadcast workspace at `/admin/broadcasts` uses a separate reviewed campaign outbox. Opening the workspace, preparing a draft, choosing a template, or generating an audience preview does not send email. Existing authentication and application transactional email remain on their existing services.

1. A staff member with `broadcasts.manage` creates a university-scoped or globally authorized draft. The draft records the real staff actor and selected managed sender persona.
2. The member selects operational or promotional classification, a role, optional selected people, and optional faculty/department or agent-status filters. The server resolves university authority on every request. The selection supports all eligible users, students, agents, vendors, tutors, riders, buyers with matching orders, and assigned staff. Only active, verified, undeleted accounts can become recipients. Staff may belong to a campus through a staff assignment rather than a student profile.
3. Audience review freezes the content, sender, exact eligible account/email list, recipient count, and a 30-minute snapshot. Excluded counts and a 20-person sample support review; no unrestricted contact-export endpoint is provided. The current snapshot survives reopening a campaign. Edits invalidate the review through a monotonically increasing revision.
4. A separate explicit test operation queues exactly one chosen existing account in the authorized university scope. The test has its own request ID, cannot expand into a campaign, respects suppression and promotional consent, and preserves the same provider payload/key across retries. Reusing its request ID for another account or draft revision is rejected.
5. A staff member with `broadcasts.send` must explicitly confirm the reviewed snapshot, content revision, and eligible count. The final queue contains only that snapshot's recipients. A future schedule is optional. Repeating the same final queue action does not add another recipient batch.
6. The scheduled Worker claims leased recipients atomically, honoring pause and per-minute/per-UTC-day attempt budgets. It rechecks sender authority, current recipient account/campus eligibility, suppression, and promotional consent before calling Resend. A pause encountered after a lease returns the record to the queue. Cancellation stops pending recipients; already accepted or in-flight provider work cannot be recalled.
7. Delivery reporting distinguishes pending, processing, provider accepted, recipient-server delivered, bounced, complained, failed, skipped, and unknown states. Provider acceptance is never reported as delivery. Signed provider events reconcile even if they arrive before the send acknowledgement. Campaign `COMPLETED` means its queue has finished processing; inspect recipient counts for failures or unknown outcomes.

Campaign audience size is limited to 10,000 accounts per snapshot and manually selected IDs to 500. Wider campaigns require reviewed separate segments. Shared content is transmitted once when creating the snapshot; PostgreSQL creates individual frozen payloads atomically. The Worker claims at most ten recipients per invocation. Existing scheduled invocation frequency therefore also limits throughput. Configurable limits count reserved **attempts**, including retries and recipients subsequently skipped, not just delivered messages. They protect the provider account without promising an exact sending rate.

## Consent and identity

Promotional consent defaults to false. Authenticated accounts can read or change only their own preference through `GET/PUT /v1/email/preferences`, with a recorded consent version and event history. Promotional preparation requires a real organisation postal address in delivery settings. Each promotional email has a visible unsubscribe link, a plain-text equivalent, and RFC-style one-click unsubscribe headers. GET shows a confirmation form without changing preferences; tokenized POST opts out without a login. Tokens are unguessable random UUIDs and do not expose account IDs.

Signed bounce, complaint, and suppression events add address suppression for future campaigns. The worker rechecks suppression and preferences even after the audience has been reviewed or queued. Existing critical transactional messages are unaffected by this campaign preference implementation. A general student settings control for this preference remains a separate client integration if it is not mounted by the student workspace; the authenticated preference API and emailed unsubscribe page are implemented.

Platform-wide campaign managers can create approved display personas, including “Jeffrey from KampusOne.” The configured verified sending address remains the source address; changing a friendly display name does not invent a mailbox or user account. The real author, queueing actor, and settings/persona changes are audited. Every message says the sender identity is managed by KampusOne. No fake independent customer or testimonial is created.

## Permissions and reliability

Finance-only staff have no campaign, audience-search, or settings access. View, manage, and send are separate server permissions and are combined with university scope. A scoped manager cannot mutate global sending settings or managed sender identities. Live permission revocation prevents future queued sends.

Provider calls use the existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optional `RESEND_REPLY_TO`, and existing `PUBLIC_API_ORIGIN`. The only new secret is:

```dotenv
RESEND_WEBHOOK_SECRET=whsec_replace_with_the_signing_secret_from_the_Resend_webhook
```

Configure the Resend webhook URL to the deployment's existing public API origin followed by `/v1/email/webhooks/resend`. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`. The raw request body is verified against `svix-id`, `svix-timestamp`, and `svix-signature` using HMAC-SHA256 and a five-minute time tolerance. Duplicate event IDs are ignored. Malformed signatures and signed malformed JSON return 400. The secret belongs only in Worker secrets, never in Expo or Next public variables. No key values from the user's previous configuration are repeated here.

The provider's 24-hour idempotency window is handled explicitly: retries retain the exact stored payload and per-recipient key, have an eight-second request timeout, use bounded exponential retry delays, and stop before 23 hours from the first attempt. Indeterminate sends become `UNKNOWN` for operator reconciliation instead of risking a new send outside the deduplication window. There is no automatic blind re-send button for unknown outcomes. The provider dashboard and event records must be reconciled before any intentional replacement campaign.

Dependencies before a production send: apply `20260921150000_broadcasts.sql` after the earlier shared migrations, deploy the mounted routes and scheduled delivery callback, set the webhook signing secret, configure the endpoint/events in Resend, and verify the existing sender domain's authentication. For promotional email, add the real mailing address and collect explicit subscriber consent. These are configuration/release checks, not steps that were performed live in this task.

## Verification and limits

The focused local suite is `server/tests/broadcasts.test.ts`. It runs the real SQL migration and API handlers against isolated PGlite, with all Resend HTTP calls mocked. Covered behavior includes finance and cross-campus denial, real role/status/buyer/faculty/department segments, persisted preview content, explicit review/count confirmation, immutable revision expiry, selected-only tests, request deduplication and misuse rejection, scheduling/pause/cancellation, permission revocation and campus movement, opt-in and post-review unsubscribe, managed identity disclosure and HTML escaping, stable retry keys/payloads, atomic rate reservations, the 23-hour cutoff, the official Svix signature fixture, tamper/stale/malformed rejection, duplicate webhooks, out-of-order delivery, and permanent suppression.

These checks do not prove live provider credentials, DNS authentication, webhook dashboard setup, production delivery, spam-folder placement, mobile email-client rendering, or production Worker throughput. Templates are three editable built-in starting points; a persistent custom-template library, open/click analytics, automatic legal classification of an administrator's content, and a general CRM/cohort builder are not claimed. The existing account-state eligibility is deliberately active verified users; this implementation does not send campaigns to suspended/deleted accounts. Recipients are bounded and immutable at review; newly eligible accounts are not silently added later. Retention cleanup for historical campaign payloads and recipient addresses requires a separately approved retention policy.

## Primary references checked

- [Resend: send email API](https://resend.com/docs/api-reference/emails/send-email) — verified sender, HTML/text payload, headers, display name.
- [Resend: idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) — 24-hour validity and retry semantics.
- [Resend: verify webhook requests](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests) — raw-body verification and Svix headers.
- [Svix: manual signature verification](https://docs.svix.com/receiving/verifying-payloads/how-manual) — HMAC construction, timestamp validation, official test fixture.
- [Resend: unsubscribe links](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails) — visible link and one-click POST headers.
- [Resend: bounced event](https://resend.com/docs/webhooks/emails/bounced), [complained event](https://resend.com/docs/webhooks/emails/complained), and [delivered event](https://resend.com/docs/webhooks/emails/delivered) — truthful delivery and suppression states.
