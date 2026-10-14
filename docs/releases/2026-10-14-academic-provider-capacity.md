# Academic upload capacity recovery

The final Android 0.3.36 release check found the image provider's daily
200,000-token allowance almost exhausted. A tiny text readiness call could still
succeed while a real image request was rejected. The calendar response also
omitted required dates. The earlier eight-fixture success did not certify this
later capacity state.

Academic imports now have an independent final provider adapter on the existing
hosting account, using its existing credits. No billing plan, key, credit purchase,
automatic top-up or account spending limit was changed. The relay reads the
available balance before inference and stops below $0.05. The AI kill switch,
per-user/global limits, one import reservation and total deadline remain in the
Worker. It is a bounded fallback, not unlimited image capacity.

The private Next route accepts only the trusted Worker's Ed25519 signatures,
with a distinct audience, exact body hash and 60-second expiry. Unsigned requests,
remote image URLs, caller-selected models, action tools and oversized bodies are
rejected before provider I/O. Provider credentials and rotating OIDC tokens stay
server-side. The relay returns no upstream account or diagnostic data.

The reader keeps the same full-source validators and pixel-derived physical cell
spans. The fallback can make one independent reread of an incomplete schedule,
within the original deadline. Truncation, unreadable cells and missing weekdays
still fail the whole import, keep the file and consume no successful-import
credit. The alternate provider is recorded accurately in adapter results and diagnostics.

Scanned PDF pages and Kira image attachments use the same private transcription
recovery when native vision is exhausted. Only source pixels go to this relay.
The study answer then uses the separate text pool with the original Pro history
and allowed tools intact. Unreadable or incomplete transcripts still fail instead
of becoming invented source material. Original file bytes and page limits remain
unchanged. The existing global AI switch controls this recovery without adding
a binding to the full free-plan Worker environment.

This change is backend-only and needs no database migration or native update.
Android 0.3.36 (version code 66) remains the verified signed APK for the payment,
navigation, notification and Earnings changes already shipped in PR 103.

Validation: signed relay integration, authorization boundaries, credit exhaustion,
output truncation and multi-provider recovery; existing physical-row and complete
academic import regressions; server types, portal lint/types and production build.
The live eight-fixture gateway proof and five Kira checks (including an image
question and a scanned PDF) are required before Worker activation. The final
run IDs and exact results are attached to PR 104's validation record.
