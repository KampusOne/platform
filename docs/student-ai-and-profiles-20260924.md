# Student AI and public profiles — 24 September 2026

## Product behavior

Ask is separate from Summary/Notes. Standard is the default; Pro is the only alternative label. Normal Ask counters and provider/model names are absent from the student interface. Standard Ask defaults to 15 messages in a rolling 15-minute window. Summary, Notes and the existing Quiz API share five lifetime trials; failed study generations do not consume a trial. Deleting history, switching modes, changing sessions and refreshing cannot reset these server-side counts. Account exemptions are resolved using the existing trusted server policy, and never bypass shared capacity protection.

All new inference uses Hugging Face. Gemini runtime routing, model variables and the obsolete connection probe are retired. Old saved text remains readable; old-provider conversation context is not forwarded to the new provider. Requests and private attachments are sent only to the application Worker. The Worker authenticates ownership, bounds document size and context, extracts PDF text locally, then sends the requested learning content to the configured hosted model. Do not describe this as an independently trained KampusOne foundation model.

Text-backed PDFs are limited to 40 pages, 8 MB and 45,000 extracted characters. Scanned PDFs receive a clear instruction to attach the relevant page as an image. Image attachments use a separately configured vision model. Source previews have removal/opening controls; failed submissions keep drafts and idempotency keys. Screens use the existing brand theme, concise navigation, safe Markdown rendering and a processing-only edge gradient that respects reduced-motion preferences.

## Student-only actions

The allowlist contains own-timetable reads, own-timetable proposals, published same-campus product search and published approved tutor search. Tools receive the authenticated account and university; neither is accepted from model arguments. No generic SQL, URL-fetching, administrative or cross-account tool exists. Store/tutorial feature gates remain enforced. Listings require active owners, active service profiles and the appropriate publication/moderation status.

Timetable mutations require an explicit review card confirmation. The API accepts only IDs for the stored proposal, checks ownership and expiration, validates the date/time, then inserts under an account lock. Action IDs double as timetable IDs for retry safety. One-time dates create one-time alarms; weekly classes preserve the existing weekly behavior. The model cannot confirm its own proposal.

## Profiles and posting

Feed author names/avatars open public profiles with cover photo, avatar, biography, campus details, follower count and post count. There is no following count. Posts and published organized events are separated into tabs. Follow/unfollow is authenticated and idempotent. Vendor/Tutor/Rider visibility is an account preference, not a permission change; a service still identifies its owner. Private identity, contact, settings, approval and billing fields are not projected in these responses.

The new-post route uses a dedicated composer with a photo toolbar, removable preview, retry state, discard confirmation and image-only posting support. Existing quote-post behavior is retained.

## Release prerequisites and intentionally unfinished work

Apply `database/neon/migrations/20260924000000_student_ai_profiles.sql` before deploying the new Worker. The AI/profile endpoints fail closed while their required schema is absent. Do not activate store, payments or logistics flags as part of this release.

New non-secret defaults are `AI_CHAT_WINDOW_LIMIT=15` and `AI_STUDY_TRIAL_LIMIT=5`. The Worker retains the existing HF token secret, uses `Qwen/Qwen3-4B-Instruct-2507:nscale` for Standard text/tools and `Qwen/Qwen3-VL-30B-A3B-Instruct:novita` for images. Live availability, account permissions and inference credits must be verified independently of mocked tests.

**Paid Pro checkout is not enabled.** The monthly plan sheet and trusted server entitlement checks exist, but no price was supplied and no recurring payment/webhook integration was completed. The interface explicitly says subscriptions are not open, and takes no payment. `HF_PRO_MODEL` must be selected and tested before selling Pro. GIF/sticker search and comment attachments are not part of this patch.

## Validation recorded locally

- Server and mobile TypeScript checks pass.
- 262 server tests across 21 files pass, including actual PostgreSQL-compatible tests for shared quotas, public-profile projection, hidden roles, service ownership, campus boundaries and duplicate timetable confirmations.
- 93 root regression tests pass, including HF-only adapters, media, feed, performance contracts and badges.
- Mobile web production export succeeds.
- Worker dry-run bundle succeeds; this alone is not a deployment or live runtime result.
- Real PDF text and empty-PDF extraction tests pass.
- Browser rendering was not validated locally: the managed browser blocked the localhost target (`ERR_BLOCKED_BY_ADMINISTRATOR`). No visual-pass claim is made.
- Dependency audit reported an existing high-severity development-tool chain (Wrangler / Miniflare / Sharp). The added PDF dependency was not listed in that audit. Review the toolchain separately rather than running an unreviewed force-upgrade.
