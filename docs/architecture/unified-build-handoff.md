# Unified application build — verification and activation

## Status

This is an implemented, locally checked expansion, **not a launch-ready sign-off**. No production data has been deleted and no new migration has been applied to production. The release checklist remains the scope of work, not a completed-feature list.

### Implemented in this change

- Application-only agent portal with separate student/non-student documents, age 16 minimum, guardian details and separately recorded consent review; private document access, manual review and one internally claimed ten-month trial. Identity deduplication uses a keyed fingerprint, not a raw NIN stored in the person registry.
- In-app role shortcuts, contextual creation actions, seller/tutor/rider overview, tutor sessions/material upload/booking completion, device photo/document upload boundaries, and restricted-account/appeal screens.
- Editable profile, settings/appearance, account sessions, support, in-app notifications, guidelines, brief illustrated empty states, skeletons, timed toast infrastructure and logo/name animation. Native-device verification is still required, especially notifications presented while native sheets are open.
- Session/profile persistence, account-isolated request caching, serialized refresh, immediate server-side device-session revocation, bounded request timeouts and web route chunks. Academic AI drafts are cached; a complete offline synchronization/conflict-resolution system is **not** implemented.
- Editable timetable import, course drafts with blank units/grades, grade simulation, personal one-time and repeating alarms, class-alarm synchronization and WAT daily streaks.
- Cohort membership/review, one ballot per verified member, elections, finalization, announcements, representative transfer requests/acceptance/admin review. Announcements are stored in-app and queued for push; push delivery is **not yet connected**.
- Separate admin pages for users, applications, tutorials, vendors, riders, universities, communities, free trials, content, support/appeals, operations and audit. University publication statuses and scoped permissions are database-backed.
- Optional Gemini study/summary/quiz/timetable adapter with explicit consent, request deduplication, timeouts, bounded quotas and no simulated answers. Supabase Google/Apple PKCE sign-in adapter; existing email/password authentication is preserved, **not fully migrated to Supabase**.
- Android test-APK workflow, additive migration files, schema-only embedded database checks and an opt-in staging load workload.

### Still needed before launch

1. **Database rehearsal and explicit migration approval.** Neon refused a new rehearsal branch because the project already has its maximum branch count. No branch was deleted or repurposed. The owner must free a slot or explicitly designate a disposable branch. Apply the outstanding reviewed commerce migration separately and then the new unified migrations in order, validate rollback/backups and approve production activation.
2. **Complete finance.** The commission calculator is implemented and unit-tested; it is not yet integrated into immutable earning allocations. Automatic bank-recipient resolution, transfer/refund initiation, transfer fees, withdrawal reservations/reversals, signed transfer/refund webhook handling and reconciliation are not finished end-to-end. Keep `PAYMENTS_ENABLED=false`. Adding a Paystack key alone must not activate this money flow.
3. **Admin hardening and publishing.** Host separation, role/scope checks and audit exist. Enforced administrator MFA/step-up, creation/login and delegated publishing for special accounts, broadcasting with consent/unsubscribe, and full finance/refund administration remain unfinished. Hiding `/admin` is not the security control.
4. **University operations.** Full national catalogue import, faculty/department management, source-document ingestion/AI-reviewed guideline publication, automatic academic-session cohort/election creation, and complete university-specific operational dashboards remain to be completed. Map data is not invented.
5. **Native/external setup.** Configure R2 bindings, OAuth providers/redirects, transactional sender DNS, AI quotas and provider permissions. Native remote push needs a delivery adapter and Firebase/Expo credentials. Validate alarms on physical Android, including denied permissions, reboot and battery restrictions. A generated workflow is not proof of a built APK.
6. **Remaining product depth.** Seller product editing/order handling and rider workflows need full integration/device exercises; audiobook ingestion/playback and complete offline academic behavior need implementation. Audit remaining legacy demo/phase UI and old portal-only operational components before launch. Do not disguise disabled providers as successful operations.
7. **Legal and capacity review.** Operator contact/legal details, privacy retention, consent and under-18/provider eligibility need qualified review. Run the staged workload and a soak test on authorized infrastructure. No 10,000-concurrent-user or 100,000-account capacity claim has been validated.

## Configuration

Exact Worker variable names are in `server/.dev.vars.example`; do not paste live values into chat, source control, browser bundles or mobile bundles.

| Purpose | Worker variables / bindings | Other setup |
| --- | --- | --- |
| Database and sessions | `DATABASE_URL`, `JWT_SECRET`, `OTP_PEPPER` | Pooled Neon runtime URL, approved schema and backups |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO` | Verified sender domain and delivery testing |
| File access | `PUBLIC_API_ORIGIN`, R2 `MEDIA_BUCKET`, R2 `PRIVATE_BUCKET` | Real bucket bindings; private bucket must not have public access |
| Google / Apple | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Enable each provider in Supabase; client ID/secret and approved redirects; native deep link `kampusone://auth-callback` and web `/auth-callback` |
| Identity deduplication | `KYC_FINGERPRINT_SECRET` | Keep the key stable; plan key rotation rather than replacing it without migrating fingerprints |
| Optional AI | `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_DAILY_USER_LIMIT`, `AI_DAILY_GLOBAL_LIMIT` | Explicit provider consent, budgets and model availability |
| Existing checkout | `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Test mode first; preserve the feature kill switch until the full ledger/payout work is complete |
| First admin, only if none exists | `INITIAL_ADMIN_EMAIL` or `ADMIN_BOOTSTRAP_TOKEN` | Existing bootstrap protections remain; remove one-time token afterward |

`UNIFIED_SCHEMA_READY=false` is intentional until the migration rehearsal is approved. The deployment workflow also requires repository proof variable `UNIFIED_MIGRATION_20260913_READY=true` before that flag may be enabled. Existing commerce migration gates are preserved. Provider keys, database migrations, R2 bindings, DNS, callback registration and native signing are different setup steps.

## Local evidence

- Server: TypeScript/build check and **74 tests passed** (including real SQL executed against an embedded schema-only copy, not production data).
- Portal: strict TypeScript, zero-warning ESLint and optimized Next.js production build passed.
- Mobile: TypeScript and static web export passed; web route splitting exports independent screen chunks. This is not a measured cold-start latency claim.
- Tests cover personal record isolation, profile/settings persistence, repeated/one-time alarms, timetable-course sync, access revocation, private signed documents, reviewer university boundaries, age/guardian approval gates, one trial claim, election/announcement invariants and policy arithmetic.
- Local browser access and local native build prerequisites were unavailable in this environment. Deployment/browser and Android artifact results must be recorded separately after they actually succeed.

## Test APK

`.github/workflows/android-apk.yml` builds a sideloadable release-mode APK with bundled JavaScript after a `main` push or manual dispatch. The workflow uses test signing for device trials; it is not Play Store production signing. Its artifact is named `KampusOne-Android-test-<commit>` and expires after fourteen days. A production upload key and actual native verification are separate launch requirements.

## Deployment attempt

Implementation was committed locally on `main` as `87a5ce5741aec3382a2f575836bf31577aee8a77`. The push to `https://github.com/KampusOne/platform.git` was rejected by the environment's approval review because the exact destination had not been explicitly confirmed. No workaround was attempted. The inspected remote workflow list still referenced the previous baseline commit; no preview update or APK build from this change has been confirmed. Request explicit approval for that repository's `main` branch before retrying the push.
