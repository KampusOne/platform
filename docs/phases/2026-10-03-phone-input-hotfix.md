# Agent phone input correction

The country selector and national-number input previously added the same calling code twice when Chrome autofill or a pasted number already included it. This rejected valid guardian and emergency contacts.

The shared field now accepts local, full international, formatted and `00`-prefixed numbers, stores one calling code and uses the phone keyboard. Restored normal and Exclusive drafts repair the duplicated prefix before validation. Emergency, guardian, main and WhatsApp contacts share the correction. Full pasted international numbers can update the country selector; unknown explicit country codes are retained as international numbers. Phone entry accepts formatting before normalization without truncating a valid paste.

Regression checks cover paste/autofill, leading local zero, saved duplicated prefixes, country changes, partial editing, international numbers and invalid overlong values. This is a portal-only change; no database migration or financial records change.

Verification passed: five phone regression tests, all 135 root tests, portal TypeScript/lint/production build, and a real Chromium form at 390px. The under-18 guardian step accepted local/full/formatted/00-prefixed contacts, saved all four contact fields in canonical form and advanced to review. No page errors or horizontal overflow at 390px/1280px. Browser calls used synthetic local fixtures and made no production application submission.
