# Agent onboarding and Exclusive campaign — 3 October 2026

## Result

Agent applications now use a dedicated responsive intake shell with the official ink wordmark, warm app colours, Lato headings and Inter body text. Vendor, tutor and rider choices appear on the first step. Vendor and tutor reuse existing KampusOne artwork; the rider uses a dedicated warm vector illustration with a bicycle and delivery box, keeping the three choices visually consistent. The normal application retains private identity, live face capture, NIN, school/business evidence and rider evidence requirements. Uploads show the selected filename and their status; a failed upload keeps the same file for Retry and clears the previous uploading message. Camera failures explain the actual fresh-camera requirement.

Exclusive is a four-step question based business application: contact, business, service arrangements, and review. It collects business category, products/services, reason for joining, service days/hours, fulfilment options and support preferences. The flow contains no file inputs, upload requests or document identifiers. Existing invitation email binding, expiry, manual review, idempotency, age checks and verified-bank withdrawal requirement remain enforced.

Platform reviewers can open or close the Exclusive campaign. Closing it returns HTTP 404 from both invitation/submission endpoints and the Next page before the sign-in screen renders. The database function also checks the switch under a lock, preventing a concurrent submission from bypassing a disabled campaign.

## Evidence inspected

All 23 images assigned in `inspection/images_1.json` were viewed individually, with observations in `inspection/image_review_a.md`. The agent screenshots showed a low contrast wordmark, a mobile layout compressing desktop navigation and columns, raw file controls, upload status conflicting with a server error, and a submit footer covering upload help. The uploaded videos cover Kira edge lighting and campus routing; no specific illustrated onboarding reference was present in the inspected image/video set. Existing approved app illustration assets informed the first-step role choices.

## API and storage

- Public `GET /v1/trusted-vendors/availability`: `{ enabled }`, private/no-store.
- Reviewer `GET /v1/trusted-vendors/admin/campaign`: `{ enabled, updated_at }`.
- Global reviewer `PATCH /v1/trusted-vendors/admin/campaign`: `{ enabled }`; an institution-scoped reviewer cannot control the global URL.
- Exclusive submissions require typed `operations`; ordinary application submissions and drafts also persist these answers.
- Migration `20261003090000_exclusive_question_intake.sql` supersedes the former mandatory Exclusive document intake function, adds the campaign control and business answers, and keeps normal KYC and payout verification separate.
- Historical Exclusive documents remain readable by authorized reviewers; new intake never requests them.

## Validation

- Portal TypeScript and production Next build passed.
- Server TypeScript passed.
- `tests/october-intake-usage.test.ts` and `tests/agent-intake.test.ts`: 17 tests passed. They cover invitation ownership, reviewer scope, approval without documents, preserved bank requirements, unchanged request replay, expired invitations, structured answers, disable/reactivate, invalid hours and invalid or underage birth dates.
- Actual Chromium rendering uses the production Next build at 390 × 844 and 1280 × 844. Explicit local backend fixtures drive signed-out, normal draft, failed/retried uploads and Exclusive states. Screenshots and machine-readable results are in `inspection/agent_verification/`; backend data in these captures is test data.
- The browser harness completes the Exclusive form using rendered controls and checks that submission contains business operations and no document field. It checks zero horizontal overflow, zero file inputs in Exclusive, no Next error overlay, a retained upload filename and a real disabled-page HTTP 404.

## Delivery boundary

No commit or deployment was performed. Apply the migration and deploy portal/server together before the new campaign API and question-only intake are live. Local fixtures verify UI behaviour and request contents; they do not prove production email delivery, camera behaviour on physical devices or production object storage availability.
