# Timetable import completion, Android 0.3.35 / 65

Two reported failures were traced to the active import path: a processing receipt
could outlive a dropped HTTP connection, and original-image day reads each
returned their own time headings, which were compared as JSON strings.

The tracked mobile submission negotiates an active JSON response. The Worker
sends whitespace while the existing inference job runs and finishes with one
JSON result or a classified error envelope. The existing authenticated receipt,
idempotency key, allowance reservation and draft recovery remain authoritative.
Older clients continue to receive the original HTTP response behavior. A lost
or truncated response checks the same receipt without another inference POST.
This is an active HTTP response, not a new queue or durable background job; a
disconnected invocation still has the platform's bounded waitUntil grace period.

The importer validates the layout's time headings once. Focused day reads now
return only row cell boundaries and labels; the application supplies clocks from
those shared headings. The full grid validator still rejects missing columns,
overlaps, unreadable cells, mixed levels and incomplete days before review.
All row reads share the existing full import deadline; the connection stays
active while they finish rather than prematurely cutting off a legitimate read.

Regression coverage includes slow response heartbeat and cleanup, preserved
failure details, same-key receipt recovery, invalid headings, missing cells and
merged durations. The live probe additionally checks a skewed full-table photo
against the same 19-class expected result, exercising original-image fallback.
The release workflow verifies package/version, existing signing identity,
matching deployed source, and APK hash before publication. The payment correction uses the verified-store-payment recovery migration. No hosting-plan change was made.

Live checks also found Cloudflare's daily service allowance exhausted and the
HF alternative limited. Academic imports can recover through the existing
server-only Groq and Gemini credentials under the same deadline, allowance reservation,
JSON validation and private-image flow. This fallback is limited to academic
extraction and does not forward chat history or execute assistant tools.


## Purchase confirmation and recovery

New store, tutorial, material and commission references select BACHS when the cutover is enabled. Historical Paystack references remain pinned to their original verifier and new attempts cannot reopen the old provider. The hosted return uses the associated links domain and carries the exact saved reference into the native payment screen. That screen verifies the owned server receipt, shows confirmation and continues to the purchased order. An encrypted, account-owned reference survives closing the app during checkout. No balance or redirect query is treated as payment evidence.

A bounded scheduled reconciliation checks existing purchase references before expiration maintenance. The migration accepts independently verified payments made inside the original reservation window even if confirmation arrives after automatic expiry. Released stock is locked and reacquired once; unavailable stock remains a recorded payment requiring review. An atomic vendor-cancellation marker prevents revival of a deliberate cancellation. Settlement retains append-only balanced journals. Admin transaction counts include both verified providers.

The reported live payment was independently verified and reconciled against its original saved purchase. Verification confirmed a paid order, the saved seller allocation in the pending wallet, a balanced settlement journal, zero unallocated suspense and a single stock conversion. Account and payment identifiers are omitted from this handoff. Store recovery, unavailable-stock and cancellation tests run against isolated PostgreSQL-compatible fixtures. Native checks cover secure receipt retention, account changes, continuation and storage failure.
