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
matching deployed source, and APK hash before publication. No schema migration
or hosting-plan change is required.
