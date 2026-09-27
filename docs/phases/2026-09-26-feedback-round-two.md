# Round-two feedback checkpoint

Implementation commit: `276c4fca14986040e9db0d65a7e13f6cb652479e`.
App version: 0.3.2 / Android 32. This checkpoint is not a production release acceptance.

## Changes and boundaries

- Native alarms re-register after permission/app-state changes. A native full-screen activity presents ringing, countdown, snooze and dismissal independently of React startup.
- A local Android media bridge downloads HTTPS feed media, limits concurrency to two, limits input size to 80 MiB, applies network/processing deadlines, adds the supplied brand watermark and publishes completed output through MediaStore. Progress survives navigation within the running app. OS process-death continuation and physical-device codecs/gallery behavior are not accepted.
- The image editor uses draggable crop selection and handles. Avatar and cover ratios remain constrained; post ratios are independently selectable. Source-coordinate geometry has regression tests.
- Media width/height travels from selection/trimming through publishing and feed/quote responses. Legacy records without dimensions still need metadata discovery.
- Upload/trim operations release stuck busy states. Kira links are pressable and server video discovery excludes older/non-HD results.
- Updated carousel timing/art, official-mark favicon, Android back configuration, stable time-wheel initialization and concise course/activity, notification and messages copy.

## Verification

422 server tests, 107 client regressions, mobile types/web export, portal lint/types/production build and all eight verification workflows passed on the implementation commit. Android prebuild passed; APK compilation/publishing is tracked by https://github.com/KampusOne/platform/actions/runs/36278511054 .

The portal preview for commit 44d2418 is READY and reaches staff sign-in. Portal source is unchanged in 276c4fc. No authenticated dashboard acceptance is claimed.

All 30 pending migrations and the full-fix synthetic checks passed a 328-statement production-data transaction ending ROLLBACK. See `database/verification/production-rollback-rehearsal-20260926.json`. This file intentionally is not a successful production schema proof.

## Release gate

Automatic approval review rejected the actual production migration commit because it changes constraints, triggers, account-deletion and notification behavior, financial procedures and data backfills. Production remains at eight registered migrations. Do not bypass this gate by merging, triggering an indirect deployment or manufacturing schema-ready evidence.

Obtain specific approval for the reviewed migrations and matching API activation. Recheck source/production drift and backup/restore readiness, apply transactionally, validate the actual schema, then record true production evidence and release the API. The reviewed university catalogue requires its separate explicit publication step; it does not provide nationwide complete faculties/departments.

The permanent admin domain and production social link destination still require hosting configuration. Provider, push, approved fees and feature flags need live configuration/acceptance. Remaining engineering work includes durable long-PDF processing, complete academic hierarchy coverage, universal response contracts, full token consolidation and end-to-end diagnostics. Physical Android and multi-role production QA remains open.

The private 132-item feedback report and second-review workbook were returned directly to the user; user notes are not committed to the public repository.
