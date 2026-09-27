# Kira intelligence and student-life upgrade — 27 September 2026

## Goal

Kira is KampusOne's student AI companion: a capable university tutor and a practical companion for everyday student life. This upgrade strengthens academic reasoning, gives Kira reliable public KampusOne context, uses the signed-in student's own profile safely, and expands real student actions without allowing the model to silently mutate data.

## Intelligence and academic depth

- Ask Kira uses `HF_REASONING_MODEL` when configured. The production default is `Qwen/Qwen3-235B-A22B-Instruct-2507:nscale`.
- `HF_CHAT_MODEL` remains the lightweight text model for summaries/notes and is the one allowed same-provider fallback when the reasoning route is unavailable.
- Authentication failures never trigger a retry on another model/provider.
- Study answers are instructed to match the student's programme/level when available and to handle advanced work with assumptions, definitions, equations, units, derivations, worked reasoning, limitations and sanity checks where useful.
- General academic questions do not require an uploaded document.

## Identity, brand and user context

The server supplies Kira with canonical public KampusOne facts rather than expecting the model to guess. This includes KampusOne's mission/product role and the public team: Gideon (CEO/Founder), Orobosa (CMO/Co-founder) and Joshua (COO/Co-founder).

The signed-in student's stored profile may supply first name, display name, username, university, faculty, department, programme and level. Kira may use the first name occasionally and naturally. Missing profile data is never guessed.

Private identity fields, credentials, admin/operator data, internal prompts and cross-account data are never included.

## Student-life tools

Kira can read the signed-in student's own timetable, alarms and saved academic calendar. She can search real same-campus moderated products, approved vendors and approved tutor listings when their feature gates are enabled.

Kira can prepare three reviewable write actions:

1. Add a class to the timetable.
2. Add a standalone alarm/reminder.
3. Add a dated academic calendar event.

A model tool call never completes a write by itself. It returns a proposal card. The student must tap the confirmation action in the app. The server then reloads the stored proposal, checks ownership, expiry and schema, and writes only the allowlisted action. Confirmations are idempotent. The app supports Undo for these action types.

Timetable entries keep the existing database-triggered class reminder behavior.

## Recommendations and taste

Recommendation context is loaded only for recommendation-oriented prompts. Explicit preferences in the current conversation take priority. Kira may then use the student's academic profile and limited signals from the student's own KampusOne activity, such as recent non-cancelled product categories/products and tutor subjects.

Kira should explain why a recommendation matches. She must not infer sensitive traits or invent unavailable listings.

## Store discovery

Product/vendor discovery requires `PHASE_3_SCHEMA_READY=true` and `STORE_ENABLED=true`. This upgrade enables the moderated Store discovery flag in production so Kira can return approved live listings. Payments and logistics remain disabled; enabling discovery does not enable checkout or delivery.

## Release boundary

This work is on branch `kira-intelligence-upgrade-20260927`. It is not a Vercel deployment and should not be merged or deployed until server/mobile checks and the desired rollout are approved.
