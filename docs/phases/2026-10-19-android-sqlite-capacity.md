# Android SQLITE_FULL recovery · 19 October 2026

An Android tester's conversation screen reported `database or disk is full (code 13 SQLITE_FULL[13])` and an unsaved draft. This identifies a local SQLite-backed AsyncStorage failure, not a Neon/PostgreSQL server outage. AsyncStorage 2.x caps the Android database at 6 MB by default, so there may still be free device storage.

## Scope of fix

- Increase the Android SQLite-backed AsyncStorage maximum to 16 MB via an Expo prebuild plugin. This is a **native change requiring a new signed APK**; OTA JavaScript updates cannot raise the limit in an installed APK.
- When an encrypted snapshot write fails with a SQLite capacity error, authenticate stored envelopes, remove only records explicitly marked disposable, and retry the entire write **once**. Rebuilding indexes after the cleanup avoids stale metadata being treated as trustworthy.
- Preserve unsent message drafts, carts, calendar/timetable edits, pending operations and unreadable ciphertext. Do not destroy encryption keys or clear user data on recovery. Expired protected drafts remain recoverable.
- No-space failures without safe cleanup remain visible; do not report successful persistence without a verified read-back.

## Verification

Run `node --test tests/storage-pressure-recovery.test.mjs`, existing draft and cache suites, `npm run check` from `mobile`, and Android native storage runtime CI. PR CI checks the prebuild-generated Gradle property. On Android devices validate both SQLite-quota exhaustion and genuine low disk, including force stop/restart and account isolation.

## Release boundary

Merging source is not the same as updating testers' installed APKs. Publish a signed Android build with this Gradle property before declaring the 6 MB cap fixed on their phones. Do not ask affected students to wipe application data.
