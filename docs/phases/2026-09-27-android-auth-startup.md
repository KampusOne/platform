# Android authentication and launch checkpoint

Preserves branch `fix/student-experience-20260926` through `1b01ab1` and all round-two changes. Release target: 0.3.3, Android version code 33.

## Confirmed cause and repair

- The installed React Native runtime assigns `abort-controller` to its global AbortSignal. That implementation has no static `timeout` method. All default mobile API calls invoked it before fetching, including login and registration.
- Use the supported AbortController and a cleared timer; also race request/body promises so an unresponsive native fetch cannot leave actions pending forever. Preserve caller cancellation, per-operation upload/AI budgets and independently cancellable shared reads.
- Fresh or signed-out native devices without a SecureStore refresh token skip the unnecessary refresh HTTP call. Browser cookie restoration remains unchanged. A stalled refresh expires after 12 seconds and cannot later persist stale credentials ahead of interactive sign-in.
- Start session restoration alongside optional cache reads. Accept a validated sign-in immediately while profile loading has its own visible state. Cached profile data never authorizes a session.
- The brand animation no longer waits for session, profile or Today network requests. It releases after local animation readiness, with a 1.2-second JavaScript readiness cap plus 160ms fade. This is not a measured cold-start promise; Android/runtime initialization precedes it. Session loading shows usable sign-in/create-account controls instead of a blank screen.

## Verification

- Regression tests run against the actual installed native AbortController: login/registration request dispatch, secure token persistence, no-token startup, stalled network/body deadlines, late refresh response isolation and caller cancellation.
- Existing browser/native session-preservation and shared-reader cancellation tests retained.
- Type checks and mobile web export are required before publishing the checkpoint. The Android workflow compiles and publishes the separately numbered APK.
- The build probes production health and invalid empty auth requests without creating an account or sending email. This verifies reachability and input validation, not a successful real-user sign-in or email delivery.

No production schema, Worker deployment, provider secret or origin allowlist changes are included. The previously rejected broad production rollout remains separate. A Vercel retry is triggered by the checkpoint push; publish a fresh preview URL only if that deployment actually succeeds.
