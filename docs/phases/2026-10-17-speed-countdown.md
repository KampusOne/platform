# Mobile speed and exam countdown — 17 October 2026

Base: `2ad2cd0b0b790cd72a3ce2ea9a84a7df0c142b02`. Branch: `codex/performance-20261017`.

The user requested faster app behavior while Android 0.3.40 was being delivered, then supplied the profile exam-countdown screenshot. Android 0.3.40/build 70 was deployed, signed, checksum verified and delivered before this follow-up.

## Changes

- Session restoration starts independently of the native connectivity snapshot. A newer connectivity event wins over a late initial snapshot; cleanup prevents changes after unmount. Existing session validation and account-generation guards continue to control acceptance.
- Chat uses a stable cell renderer and callbacks while the composer changes. Message grouping, replies, gestures, actions, media, receipts and markup remain the same. The virtualized window is seven viewports, with eight cells per batch, instead of the default 21 viewports.
- Feed view results are collected per visibility callback and applied once. Counts never decrease. Confirmed unchanged counts preserve the entire list identity; updates preserve untouched post identities.
- The profile countdown is inset to match neighboring cards, displays a prominent days-to-go/days-left value, wraps the date range, and has a descriptive screen-reader label. The card owns a minute clock that pauses on blur/background and isolates accounts/institutions. The full countdown now shows time remaining during exams and transitions at the final Nigeria-time boundary.
- Android follow-up is 0.3.41/build 71. The existing package, API paths, signer and exact-source release gates are retained.

## Verification

- 391 root/mobile regression tests passed, including five new runtime/state regressions.
- Mobile TypeScript and Expo production web export passed; whitespace checks passed.
- The startup and chat regressions were also run against the base source: both fail there and pass after the fix.
- An extraction check confirms that the chat row markup is identical before/after after substituting the captured message-array name.
- Native signature, version, ABI, checksum and matching production deployment receipts are enforced by the release workflow. Its final SHA and result are recorded by Actions and the release receipts.

## Measurement limits

See `docs/performance-2026-10-17.json` for the reproducible synthetic feed-update fixture: 500 loaded posts, 20 already-confirmed views, 1,000 callbacks and median of seven rounds. The helper took about 54.1 ms before and 3.3 ms after in this Node environment. Over 100 callbacks it eliminates 2,000 redundant list copies. This is a helper benchmark, not a whole-app speed claim. The chat harness confirms 60 composer changes preserve the renderer and message data, and startup no longer waits for an unresolved connectivity promise.

Physical Android frame time, memory, startup latency and production network p95 were not measured here. No claim of a 100x app-wide improvement is made. Device QA should cover long conversations, photo groups, left-swipe reply on both sides, keyboard typing, low-memory scrolling, offline restoration and the exam start/end boundaries.
