# AI and streak correction evidence — 21 September 2026

Scope: master requirement IDs 121–126, 130–143, 231–237. These changes are local implementation/test evidence, not a production verification claim.

## Confirmed repository defects

- Account streak had POST/PATCH only; student home GET called check-in and therefore a refresh earned activity. No historical activity table existed (121–123, 126).
- A goal update before the first check-in updated zero rows (129 supporting behaviour).
- AI request persistence retained output/idempotency but no source prompt or user history API existed (130–135).
- Timetable work was always sent to Gemini; no Hugging Face binding/adapter existed (138–142).
- Per-user quota was consumed before global quota/idempotency claim. Duplicate calls and global rejection could charge user allowance without doing work (231–233).
- Every failure said a draft was saved even though the service had not saved it; all upstream failures collapsed into one message (143, 235–236).

## Implemented behaviour

- GET streak is read-only. Explicit POST check-in qualifies at midnight Africa/Lagos. Missing a full day resets the displayed current streak; personal best remains. Calendar days are backed by unique user/day activity records. Historical calendar activity is never fabricated from the older totals.
- Study sessions are a separate private table from timetable jobs, with source references and owner-only list/search/filter/detail/deletion routes. Older completed study outputs are backfilled with blank prompts because those prompts were never retained. Deleting a session also clears cached text, while opaque idempotency metadata prevents a stale client retry regenerating deleted work.
- Gemini generates study/summary/quiz output. Hugging Face Router's documented chat completion API handles timetable text/images, with a required explicitly configured model/provider. Timetable JSON and class time order are validated before editable review; the AI route never commits classes to a timetable.
- A single database function atomically claims the request key and reserves both daily quotas before contacting any provider. Repeating an identical completed request returns the saved result. Changing its input is rejected. Failures refund the user's reservation once; the global provider-attempt budget stays charged because failed/timed-out calls can still cost money. Interrupted jobs are marked failed and their user allowance released when the same request key is retried after two minutes.
- GET usage exposes remaining allowance and next midnight reset. Existing safety defaults (5 user/100 global requests) remain configurable; these are rollout safety caps, not an agreed commercial plan.
- Configuration, provider authentication/model errors, provider limits, timeout/network failures, blocked/incomplete/invalid output and local allowance exhaustion are distinct. Private diagnostics store codes/status only, never credentials or provider error bodies.

## Verification and remaining blockers

`npm run check` passes. `server/tests/ai-streak.test.ts` exercises actual PGlite PostgreSQL schema/functions and Hono routes with fake external provider responses, including cross-owner access, concurrent request reservation, duplicate check-ins, missed days, deletion, provider errors and media validation. It does not prove live Gemini/HF availability or multi-connection production database load.

Migration: `20260921110000_ai_history_and_streak_activity.sql`, following the operations/academic migration. Apply and verify migrations before deploying the dependent Worker/UI.

New server configuration: `HUGGING_FACE_API_KEY` and `HUGGING_FACE_MODEL`. These belong only in Worker configuration; use the existing Gemini, R2 and AI settings rather than asking for duplicate keys. No provider secret was read or changed in this work.

Blocked/unverified: deployed bindings/provider permission and credits; representative live model/provider quality evaluation; direct timetable PDF OCR (the API instead explains paste-text/page-image/manual alternatives before charging); exact AI trial beneficiaries/entitlements; production retention/storage-limit policy and scheduled cleanup; actual monetary cost reporting and native/end-to-end device verification. Study PDF input is supported through Gemini; timetable PDF parsing must not be marked complete.

## Provider contract sources inspected

- [Hugging Face chat completion documentation](https://huggingface.co/docs/inference-providers/tasks/chat-completion): Router base URL, provider/model selection, text/image messages and response contract. No recommended example model was assumed to be validated for KampusOne timetable data.
- [Gemini generateContent API](https://ai.google.dev/api/generate-content): REST request/response, key header, inline document parts and generation completion/safety states.
