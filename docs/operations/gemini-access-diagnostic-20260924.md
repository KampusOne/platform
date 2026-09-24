# Gemini generation access diagnostic — 24 September 2026

## Observed problem

Study space still showed the generic provider-credentials/permissions error after its mobile page-width repair and the owner account's personal quota exemption. The quota label and page layout were visible in the supplied screenshot. Neither change establishes a working provider connection.

## Direct diagnostic results

The following are recorded from the actual GitHub Actions job logs, not inferred from a deployment or health check.

- Model metadata check: run `35985021786`, job `107585557152`, commit `1edbdc8e05d373dc709b697cfd27b30c465aaea0`. At `2026-09-24T10:03:55Z`, the Google model-information request returned HTTP `200`. The configured credential had the `aq_format` classification. This does not establish permission to generate content.
- Generation check: run `35985228574`, job `107586211860`, commit `88efff9367c4414a407e94b14d47418c48ba9400`. At `2026-09-24T10:06:01Z`, a real native Gemini `generateContent` request returned HTTP `403`, status `PERMISSION_DENIED`, and fixed diagnostic hint `project_access_denied`.
- The `project_access_denied` hint is returned only when Google's error message contains the text `project has been denied access`. The detailed Google reason enum was not present in the allowed set and was recorded as `UNCLASSIFIED`; no more-specific Google reason was established.
- The generation request used the configured Worker model and secret, Google's `x-goog-api-key` header, and only the fixed question `State Ohm's law in one short sentence.` Output was capped at 128 tokens. No user documents or account conversation history were submitted.
- There was no successful generated answer. A successful diagnostic workflow means the diagnostic completed, not that Gemini generation succeeded.

Job logs:
- https://github.com/KampusOne/platform/actions/runs/35985021786/job/107585557152
- https://github.com/KampusOne/platform/actions/runs/35985228574/job/107586211860

## Interpretation and next action

The observed blocker is an upstream Google project-access denial on generation. Do not mislabel this as the personal daily quota, a missing Worker binding, a confirmed invalid token, or a proven model-name error. The cause of Google's project/account restriction is not yet known. A model-metadata HTTP 200 must not be described as full inference authorization.

Google staff guidance for this exact error is to check the affected project's status and any error banners in AI Studio Projects, the Google Cloud console and the Billing page. The Google Cloud project must match the Project column of the failing key in AI Studio. Follow any displayed remediation or appeal instruction; if none explains the issue, the staff guidance directs the owner to Cloud Billing Support. This is not an instruction to enable paid billing, create replacement projects to evade a restriction, or rotate keys repeatedly.

Official provider guidance:
- https://discuss.ai.google.dev/t/your-project-has-been-denied-access-please-contact-support/168860/7
- https://discuss.ai.google.dev/t/your-project-has-been-denied-access-please-contact-support/168860/4
- https://ai.google.dev/gemini-api/docs/api-key

## Security and production changes

The diagnostic ran in a token-protected, three-minute-expiry Cloudflare remote development preview, not as a live application route. Only the named Gemini secret, model and AI-enabled bindings were inherited. The credential remained within Cloudflare. Only fixed allowlisted outcome/status labels and HTTP status numbers were returned; raw provider responses, keys and project identifiers were not logged.

No production application code, secrets, provider model, quota setting, user record, paid subscription or billing activation was changed during this investigation. The one generation diagnostic was subject to the provider's existing account rules; no claim about provider accounting for rejected calls is made.

The diagnostic workflow has now been made manual-only, with metadata mode by default. Generation requires the explicit `inference` input. There is no scheduled or automatic ongoing probe. Offline tests cover its authorization gate, expiry, bounded prompt/output, response validation and redaction.

The production `ai-provider.ts` still intentionally emits its existing generic message on upstream 401/403. This investigation did not claim to replace that user-facing error or resolve Google's restriction. After the restriction is cleared, a signed-in app request and saved-history write remain separate acceptance tests.
