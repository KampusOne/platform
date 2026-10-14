# Checkout, paid agent orders and image import recovery

- Checkout normalizes local Nigerian mobile numbers to +234 on both the client and Worker. Missing recipient details are checked before quote creation, with inline errors, a visible border and scrolling to the first invalid input. API validation supplies field messages and no longer promises nonexistent highlights.
- Agent store lists, direct order details, dashboard counts/activity and rider delivery reads only include PAID, ACCEPTED, READY, IN_DELIVERY and DELIVERED orders. Buyer/admin history is retained. The mobile store-order view also filters older cached responses.
- Optional pixel border detection no longer rejects supported source images. If cell isolation is unavailable, focused original-image reads assemble every selected weekday and use the existing strict coverage, level, time-header and contiguous-cell validation. Layout reads use a bounded token/time budget; all reads retain the original request reservation and deadline.
- Live release checks cover the 19 printed 100-level classes, 20 printed 200-level classes and a WebP version that exercises original-image recovery, alongside handwriting, calendar PDF and exam text.

Regression coverage includes invalid/local phone numbers, visible client/server field messages, actual PostgreSQL-backed agent list/detail/dashboard reads, selected-level cell geometry and recovery that rejects partial rows, mixed levels and contradictory headers. Android release 0.3.34 uses version code 64 and the existing signing identity. CI/live checks and source-matched release receipts remain publication requirements.

No database migration is needed. This is a read policy and validation change; finance rows, provider receipts, admin order access and quota accounting are not rewritten. Model accuracy is checked against fixture course/day/hour tuples; arbitrary unreadable documents still fail visibly without a partial import.
