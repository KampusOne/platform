# October 3 release follow-up

## Delivered code

- Every Expo screen inherits a recovery boundary inside its navigator. A failed route keeps navigation available. Shared editors, downloads, reviews, sharing and offline overlays have independent recovery. Reports record only a known failure category and route token, with no exception text or private content. The older screenshot does not identify its original exception; device validation is still required.
- Web deep links mount interactive routes after hydration. Static export does not have query parameters, storage or the device clock, and previously disagreed with the first browser render on post links. Native navigation remains immediate.
- Kira prices are approved per campus as immutable versions, with a configurable monthly list price and a whole-number discount from 0% to 90%. The app shows the list price, percentage saving and payable total. Paystack receives the exact agreed total with account-borne processing; stale-price checks happen before provider initialization. Existing checkouts and paid periods remain unchanged. Automatic offers do not stack with codes.
- Standard uses the configured chat model. Pro uses the dedicated Pro model or configured reasoning model, twice the conversation context, larger teaching budgets, 30 weekly imports and higher study allowances. Trusted owner access stays complimentary. These are concrete differences, not a quantified claim about intelligence.
- The map adds depth to actual building footprints, separates walking paths and steps from roads and places direction arrows on the sourced route. Malformed route responses become retryable errors before map or text rendering. No invented building heights or straight-line routes are introduced.
- Finance panels validate collection responses before storing them. Incomplete responses display a recoverable message instead of failing the entire pricing page.
- APK and Vercel release workflows also require the October 3 production migration proof. Push-enabled APKs require the real Android Firebase configuration and EAS project identity.

## Verification

- Mobile, portal and server TypeScript checks; portal lint and production build; mobile web export.
- Compiled Expo web: 36 routes using explicit local data or unavailable-feature fixtures, no page errors or horizontal overflow. A deliberately malformed post exercised screen recovery, recorded a privacy-safe diagnostic and returned successfully to the dashboard.
- Compiled admin pricing form: ₦8,000 with a 25% offer previews and submits ₦6,000, then displays the approved version at 390px and 1280px. All calls were local fixtures; no real price was changed.
- Actual Chromium WebGL renderer: 22 accepted layers, 3,595 sourced features, 96 directory places, manual origin/destination selection and route endpoints.
- Kira pending-response glow: three animation phases, reduced motion, stationary perimeter geometry, changing colours and automatic fade after the answer. No page errors.
- Database integration tests cover approval permissions, offer snapshots, receipt replay, one paid month, code stacking rejection, stale-price prevention and integer-kobo rounding.

These checks do not replace Android/iOS device tests, real FCM delivery, provider evaluation or live payment verification.

## Published release

The October 3 experience migrations were rehearsed on `experience-release-rehearsal-20261003` (`br-mute-sunset-ayzh9xrc`) and applied to production. `database/verification/production-20261003-experience.json` records the actual verification, preservation checks and exact source hashes. The production ledger contains 84 migrations through `20261003128000_payment_snapshot_context_eligibility`; a read-only October 4 probe confirmed that ledger state.

Main revision `690fc6b283d05b759060220df7c5ca4997c0daae` completed Worker deployment, verified Vercel publication and Android packaging. The matching successful Actions runs are `37128221620` (Worker), `37128342891` (verified Vercel receipt) and `37128389278` (APK). The APK was published at 2026-10-03T14:22:55Z as version 0.3.17, build 47.

The project still has ten occupied branch slots. The October 4 correction work will rehearse additive migrations on the existing October 3 rehearsal branch, without resetting or deleting branches. That isolated rehearsal predates subsequent production activity and must be described accurately in the new verification record. New corrections and a new APK remain in progress; the published October 3 build does not establish that the new fixes are delivered.
