# October 3 backend reliability

Implemented in this checkout. No live credentials were used and no production sends, migrations or deployments were performed by this task.

## Notifications

- Push delivery rechecks recipient accounts, sessions, institution, preferences, managed-publisher authority and current community membership before contacting Expo.
- Urgent group notices and class announcements take queue priority over bulk newsletter delivery. Dispatch works in bounded batches of eight, at most 200 queued recipients per scheduled invocation.
- Confirmed Expo throttling is retried with bounded backoff using the same delivery record. Network timeouts and missing acknowledgements remain unconfirmed and are not blindly sent twice, because Expo has no send idempotency key.
- Users without a registered eligible device remain pending instead of falsely appearing sent. Muted notifications, invalid credentials, removed devices, changed audiences and expired pushes have observable reasons. Urgent notices expire after one hour, class reminders after thirty minutes and ordinary queued push after one day.
- Added authenticated user and scoped admin delivery-status endpoints. Provider tickets/receipts remain separate from explicit device observations.
- Mention notices have independent in-app and push controls, use the native social notification channel, and recheck published status, audience, live author, current tagged handle and mutual blocks before push delivery. The inbox honors the in-app mention preference.
- Class alarm import saves the requested fifteen-minute lead regardless of legacy custom-minutes input.
- Manual restoration queues a deduplicated service email and inbox notice after all active restrictions are lifted. Expired suspensions also queue a restoration email once.
- Scheduled notification/broadcast recovery now runs each minute. Immediate broadcasts start through the Worker request's execution context after the reviewed audience is queued; sending still respects sender permission, subscription/suppression, immutable payload and rate-budget controls.

Required migration: `20261003080000_push_delivery_reliability.sql`.

## Sessions

- A lost or concurrent refresh response can be recovered for sixty seconds using the exact same HMAC-derived successor. The database stores only token hashes.
- Recovery checks the replacement's live family and account. Logout still revokes the entire family. A consumed token replay outside the grace period still revokes the family.
- Configuration/signing failures happen before rotation consumes the existing refresh token. Recoverable races return conflict instead of revoking an otherwise valid session.
- Successful new sessions and first rotations record `auth.signin` and `auth.resume` audit events for daily reports. No bearer token is placed in audit metadata.

## Checkout and withdrawals

- Inclusive catalogue prices use reviewed processing policies. New policy approvals default to upward rounding in increments of ₦100; an explicit increment can be reviewed. Existing policy JSON without that field retains its former ₦1 rounding and existing quote snapshots remain unchanged.
- Checkout sends exactly the reviewed digital payable amount to Paystack once, with merchant fee bearer. Cash delivery stays outside the digital amount. Provider receipts settle actual processing costs separately.
- Current primary documentation was checked on October 3: https://paystack.com/docs/api/transaction/ ; https://paystack.com/pricing ; https://paystack.com/docs/transfers/how-transfers-work/ . The supplied example arithmetic is illustrative, not a fee policy. Paystack does not automatically add the estimated charge to the initialized customer amount.
- A server-verified conclusive failed/abandoned/blocked/rejected transfer releases the full reserved wallet liability exactly once using an append-only, balanced journal. Network failures, initiation acknowledgements and transfer-not-found responses keep the reservation intact.
- Released references cannot be initiated again. A fresh reviewed withdrawal can use the returned balance. Later contradictory success is flagged for review without posting another release or paid journal. Stale provider observations cannot overwrite a newer observation.
- Scheduled verification recovers missed payout webhooks. Agent/admin payout data includes `returned_to_wallet`.
- Mobile earnings, agent portal history and admin transfers show “Returned to wallet”. Admins cannot retry a released reference. The agent portal's former unquoted withdrawal request now obtains a bank/net-amount quote, presents it for confirmation and submits a stable request ID; the ₦5,000 minimum matches the server.

Required migration: `20261003081000_verified_failed_payout_release.sql`, after the September 30 verified-agent-payout migration.

## Store pickup follow-up

The customer cart now shows the vendor's actual saved pickup address in a read-only panel for pickup/rider orders, with contact access. Personal pickup defaults to the store, with a separate option for a meeting point already agreed with the vendor; that point is carried in the existing order handoff note and shown to the vendor. It does not override the approved rider route. Quote changes invalidate the previous reviewed payload. The quote's returned pricing notice is shown beside the total, with the exact online payable amount separately visible when the rider fare is paid in cash.

Vendor storefront settings clarify the saved store address versus a sourced agreed pickup map point. Vendors can explicitly share an accurate current pickup position through the existing GPS adapter. The existing server routing uses that fresh position for two minutes, then falls back to the approved storefront map point. No coordinates are invented, and financial calculation/provider contracts are unchanged.

Changed mobile files: `app/(tabs)/store.tsx` and `app/store-settings.tsx`. Mobile TypeScript checking passed. A physical-device walkthrough of store pickup, agreed handoff and GPS rider collection remains necessary.

## Validation

`npm --prefix server run build` passed.

101 tests passed across eight targeted suites: integer-kobo pricing, Paystack initialization/receipt boundaries, push provider status, actual PostgreSQL-compatible push queue/retries/device receipts/restoration emails/mention visibility and preferences, actual refresh rotation/replay behavior, broadcast permission/consent/idempotency/immediate execution, and financial settlement/reservation/release journals. The legacy alarm expectation now checks fifteen minutes, and the receipt fixture ages the last provider update as well as its creation time to meet the fifteen-minute polling delay.

Portal TypeScript checking, focused ESLint for the agent dashboard and payout transfers, mobile TypeScript checking and the final server TypeScript check passed.

The checked-in tests apply the migrations to a schema-only PGlite database. No production rows or secrets are required.

## Live verification still required

Apply and review both migrations before deploying code that references their columns. Rebuild mobile with its real EAS project ID and Expo native notification configuration; check Android FCM and iOS APNs credentials, notification permission and device registration. Perform one designated newsletter post and one urgent subscribed-community post on physical phones, then compare acceptance, receipt and observed status. Review the merchant's actual current collection/transfer fees in the finance policy UI; the official public baseline is a staged reference rather than an automatic change to approved payments. Test an operational broadcast on an owned account and confirm the Resend acceptance/event receipt. No live success is claimed by this handoff.
