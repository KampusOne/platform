# 17 October campus release — work record

Requested deliverable: a newly built Android APK containing the complete requested app, Worker and admin changes. Prepare the investor/law-firm business overview after the APK is ready. The source branch is `codex/oct17-campus-release`, based on `5533074`.

Implementation and acceptance checklist (unchecked items are not complete):

- [ ] Cold start offline restores the previous account's encrypted profile, timetable, feed and eligible content. Disconnection never proves auth expiry; explicit server revocation still clears the account. Writes require connectivity. Reconnect restores live reads.
- [ ] Home slider pauses and shows an offline illustration; it resumes on connection.
- [ ] All payment entry points use the shared in-app Bachs WebView. Closing/callback only triggers server verification; success routes to receipt/tracking. No client assertion grants entitlement.
- [ ] Cart remains on pending, cancelled or failed payment, and only purchased quantities clear after a verified receipt, once.
- [ ] Opportunity upload dropdown and subtype feed filtering: internship, scholarship, grant, student loan, sponsorship, skill acquisition, fellowship, competition, other.
- [ ] Delivery range ₦500–₦1,500 using distance, quantity, actual/volumetric weight; one pair costs less than ten on the same route.
- [ ] Multiple vendors in a cart, one combined payment; per-vendor accounting and stock reservation; admin coordinates multi-vendor readiness, riders see all pickup stops and quantities.
- [ ] Only pickup/rider fulfilment; vendors can save multiple pickup points; multi-vendor defaults Engineering, June 12, Anatomy back gate, Main gate, and the user's named final back gate (verify exact campus name from source before labeling).
- [ ] Admin order detail lists items, quantities, vendors and phone/WhatsApp links; ready/dispatch and campus-delivery actions work.
- [ ] Available/pending agent earnings and ledger release follow actual completed delivery; no withdrawal of pending money. Minimum vendor/tutor/other withdrawal ₦5,000, rider ₦2,000, enforced both server and database policy.
- [ ] Per-role suspension: permanent hides role dashboard/actions, temporary retains read-only view with reason/end date and blocks mutations/payouts. Other roles and student account remain available; expiry restores role.
- [ ] Vendor/rider DM contact warning, server-side phone/account detection, removal and 3-day chat pause; tutor conversations exempt. Paid order contact permissions stay separate from DM content moderation.
- [ ] Alarms collapsed initially. All reply gestures swipe left. Rider dashboard duplicate/circled sections removed; useful actions live in top menu.
- [ ] Tutor files (including VIDEO), optional covers, subjects/course filters, free/paid materials, whole-playlist upload, original chronological feed with wide videos/document rail, tutor search and optional booking fees.
- [ ] Purchased/free learning files open in-app with no download controls, saved learning on profile, playlist entitlements enforced for every private part.
- [ ] Scanned PDF rendering/OCR and valid text extraction; per-page retries cache results and reuse one import allowance. Unreadable/refusal results cannot be labeled success. Local Android document previews use safe sharing/file access.
- [ ] Responsive crop gestures/corners; title/description stay editable during image/media upload.
- [ ] Product gallery pagination dots, half-star reviews throughout API/storage/UI, useful order timeline and improved preview cards.
- [ ] Community profile/cover layout; foreground notification popup; cart notice expires after five seconds and supports swipe dismissal.
- [ ] Admin operations/disputes and featured brands load independently and expose authorized working actions.
- [ ] Public blog cards use actual cover and published articles provide crawlable body/metadata/canonical/JSON-LD/sitemap.
- [ ] Server and client checks, regressions, migration rehearsal/acceptance and production build pass.
- [ ] Reviewed migration installed, required Worker/web deployed from release commit, installable signed APK built and inspected, same signing identity as prior APK, download delivered.

No deployment, migration installation or APK completion is implied by source changes. Record actual checks and receipts below as they finish.
