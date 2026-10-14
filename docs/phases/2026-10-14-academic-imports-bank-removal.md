# Academic imports and agent bank removal — Android 0.3.32 / build 62

The latest production timetable-image attempt failed with `AI_TIMEOUT`. The timetable completion budget was 45 seconds, including OCR, leaving no time for its configured fallback when native inference stalled. The live release probe had verified short transcription rather than complete structured schedule extraction. Production render telemetry also recorded `UI_RANGEERROR_DATE` across navigation, including bank, messages, profile and other screens.

## Resulting behavior

- Class, calendar and exam imports use the shared validated extraction path. Schedule inference receives a bounded 90-second budget, 8,192 output tokens and nonreasoning JSON output for Gemma vision. Scanned PDF transcription also disables thinking. The direct PDF/TXT reader accepts the same 16 MB range as the upload router; a valid 9 MB PDF passes the authenticated route. Uploaded study images receive the document processing budget too. Source reading, inference and fallback share an overall 150-second processing deadline; academic clients allow 180 seconds for the response.
- A receipt reader can recover a completed result after a lost response or follow an existing processing reservation. It never makes a second inference POST. Provider errors remain visible and retain the same retry instructions, owner checks and encrypted draft.
- Every import stage retains a horizontal indicator; actual upload bytes show a percentage, and reading/analysis show an indeterminate bar with real server stages. Reduced motion stops the animation.
- Full timestamp fields from both fresh and cached API responses normalize PostgreSQL spaces, fractional precision and offsets into a Hermes-compatible representation. Calendar dates, class clocks and literal student content remain unchanged. Foreground measurement calls the clock without a receiver and rejects invalid timestamps with observable diagnostics instead of throwing during navigation cleanup.
- A bank overview displays one saved account with Change and Delete actions. Replacement fields open explicitly; the bank list loads only when a form is needed. Name verification and ownership consent remain required before save.
- Authenticated bank removal rechecks owner and institution, serializes on the same profile lock as withdrawal/setup and refuses a pending payout or concurrent resolution. It revokes the active destination, clears application linkage, then erases the encrypted number. Historical masked receipts and financial ledger entries remain intact. An old setup request cannot reactivate a removed destination.

## Validation and release gates

Local focused integration checks passed 70 server tests, including image/PDF/text extraction through the authenticated route for all three schedule kinds, replay isolation, slow inference/fallback and bank-removal protections. The client suite passed 342 tests, including lost acknowledgements, in-progress receipt recovery, cancellation and date/clock regressions; mobile types and web export passed.

The live AI workflow now bundles the same inference and schedule validators as the app and checks printed and handwritten class images, an eight-event, two-page academic-calendar PDF and dated exams. Those checks, full platform CI, Android native compilation and a real Hermes timestamp/foreground/storage smoke test must pass before merge. The Android release workflow verifies source commit, package version, signing identity, deployed Worker/web and published download before delivering the APK.

No new database migration is required. Existing pending-payout, bank immutability, authorization, quota, private-upload and idempotency rules remain active. These checks certify the stated fixtures and release boundaries; they do not certify every photographed source or an untested physical device.
