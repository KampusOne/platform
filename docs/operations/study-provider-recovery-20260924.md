# Study provider recovery — 24 September 2026

## Live evidence

These are actual provider-generation responses, not health-check or build results. No user documents or conversation history were used.

- Fresh Gemini check: run `35985228574`, job `107591901229`, at `2026-09-24T10:24:21Z`: HTTP 403, `PERMISSION_DENIED`, fixed hint `project_access_denied`. The hint matches only the known upstream text `project has been denied access`. No answer was generated. The root cause of Google's restriction remains unknown.
- Existing Hugging Face text model: run `35987346815`, job `107593023742`, at `2026-09-24T10:28:04Z`: HTTP 400, fixed hint `model_unavailable`. The stored token remained within Cloudflare; its value was not read by CI or printed.
- Catalogue-verified alternative: run `35987672878`, job `107594038660`, at `2026-09-24T10:31:11Z`: `Qwen/Qwen3-4B-Instruct-2507:nscale`, HTTP 200, `generation_succeeded`. This required nonempty answer content and a `stop` finish reason. It proves that the existing HF token generated an answer through that model/provider at test time; it is not a guarantee about future capacity, all study modes, or answer accuracy.

The successful request used only “State Ohm's law in one short sentence.” and capped output at 128 tokens. The test model was selected from the official router's live catalogue, restricted to an explicit small-model shortlist with input and output prices each at most USD 0.50 per million tokens. Existing HF account credits/charges applied. No paid plan or billing activation was added.

All checks used short-lived, separately token-protected Cloudflare remote previews rather than a live application route. Only the required AI bindings were inherited. Raw provider errors and credentials never left those previews. Diagnostic workflows are now manual-only; there is no scheduled monitoring or automatic fallback.

## Application change

The production HF text-model setting is pinned to the model/provider that passed generation. `GEMINI_MODEL`, Gemini credentials, HF credentials, the vision model, account exemptions and shared quotas are otherwise unchanged. No new secret or database migration is required.

Study space exposes two visible choices: **Hugging Face · text** and **Gemini · files & text**. New empty sessions initially select HF. Existing saved drafts without a provider retain Gemini, preserving their original consent and idempotency key. Users explicitly select HF to change an existing Gemini draft; this keeps the typed text but starts a new conversation. It does not forward the earlier conversation or automatically send anything.

The backend routes study to HF only when the request explicitly supplies `provider: "huggingface"`. Old clients and provider-omitted requests remain on Gemini. Consent copy names the selected provider, and HF requires an advertised server capability before the new client may send. Cross-provider follow-up references are rejected before reservation or inference. Saved results record their provider and reopen with that provider selected.

HF study supports typed/pasted text. The API can also decode an authorized UTF-8 text attachment before submission, but the initial UI exposes pasted-text use only. PDF and image study requests remain on Gemini; an HF request with those media types is rejected before provider submission, with the source kept. Timetable text/image/PDF routing is unchanged; its HF text path benefits from the corrected chat model. No successful live image or PDF extraction is asserted.

Google's known project-denial response now has a specific, fixed user-facing error instead of repeatedly directing the owner to replace a key. Only a bounded 16 KB error body is inspected, and raw upstream text is never returned or stored.

## Validation and rollout

`server/tests/ai-study-provider.test.ts` exercises authenticated HTTP routes with the isolated test database and mocked upstream generation. Coverage includes all four study modes, private history and follow-ups, legacy hashes, provider-bound idempotency, rejected cross-provider context, consent and selector validation, normal/exempt/global quotas, kill switch, and provider failures without a fallback.

`server/tests/ai-study-adapter.test.ts` covers explicit routing, PDF/image rejection, bounded history/output, timetable routing, malformed/oversized error bodies, redaction, and incomplete output rejection. CI, deployment and a signed-in production request remain separate acceptance checks; do not call a passing diagnostic workflow a successful app session.

Rollback: revert the provider UI/routes/adapter changes and the HF_CHAT_MODEL pin. Existing usage and saved-result records need not be deleted. The previous code ignores the additional status field and stored provider metadata. Gemini's external access restriction must be resolved separately.
