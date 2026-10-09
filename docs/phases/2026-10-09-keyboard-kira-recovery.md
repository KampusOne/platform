# Keyboard and Kira recovery — October 9, 2026

The reported Android screenshots show the Kira composer obscured by Gboard and
a provider-capacity error after sending “Hi”. This release addresses the shared
keyboard boundary and the inference connection behind that error.

## Confirmed causes

- All existing keyboard-avoiding wrappers disabled their behaviour on Android,
  relying entirely on native `adjustResize`. In an edge-to-edge Android window,
  the keyboard can still overlay the scene. Input-bearing modals use separate
  native windows and cannot inherit the navigator's layout correction.
- Chat was exclusively routed to Hugging Face. Its HTTP 402 and 429 responses
  shared the displayed “AI capacity is temporarily unavailable” message.
- An authenticated, expiring preview checked the production Cloudflare account:
  both Standard and Pro Workers AI models generated usable answers. The deployed
  Worker had no Workers AI binding. HF's live connection check failed transport.
  No user account or document was used in this check.

## Changes

- Measure each Android navigator/modal window against the keyboard's screen
  position. Apply only the remaining overlap, avoiding double subtraction when
  `adjustResize` already works. Clear the inset on keyboard close.
- Shared scroll handling reveals the focused field after keyboard/layout changes.
  Hide the floating tab bar while typing and constrain the map drawer to the
  available Android viewport. Kira, DMs, comments, forms and input-bearing modal
  sheets receive the correction.
- Configure the native Workers AI binding and use it for text, extracted PDFs,
  study notes and timetable text. Standard uses the 8B model, Pro uses the 70B
  model. Keep image and speech adapters in place.
- Normalize native function calls into the existing server-controlled student
  tools. Existing tool authorization, action confirmation, request reservation,
  quotas, kill switch and saved-result replay remain enforced. Inference has a
  bounded deadline and redacted provider-specific diagnostic events.
- Preserve the existing provider-boundary rule for history. A conversation saved
  with a different provider asks for a new conversation rather than silently
  forwarding it. Saved conversations remain readable.
- Android release 0.3.23 / version code 53 builds the current commit and checks
  the existing signing certificate, package, SDK, ABI and artifact digest.

## Verification

- Full backend suite: 88 files, 761 tests passed before the additional route case.
- Additional route test: successful Workers AI generation, saved-result replay,
  and follow-up context through the authenticated endpoint. Focused AI suites:
  32 tests passed after this addition.
- Keyboard overlap and existing AI adapter Node tests: 25 passed.
- Mobile/server type checks, server production build and Android Hermes export
  passed. Mobile web static export passed.
- Portal lint/type checks passed. A local Turbopack build rejected the dependency
  symlink outside the project; the production Webpack build passed.
- No schema or financial migration is introduced. Existing deployment schema
  guards must pass before production release.
- Physical-device IME behaviour remains an acceptance check after installing the
  APK: type multiline messages in Kira and DMs; focus bottom form fields; open
  comment/report/community editor sheets; close/reopen the keyboard. Keep the
  composer and send action visible without a second keyboard-sized blank gap.

The release also includes the current GPS recovery changes merged from main.
Production deploy and APK outcomes are recorded by their GitHub Actions runs.
