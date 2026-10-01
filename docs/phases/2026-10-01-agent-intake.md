# Progressive agent application and private identity review

Vendor, tutor and rider applications now have five steps: personal details, campus, work, evidence and review. Categories and teaching levels use choices. Original KampusOne illustrations accompany the steps. Applicants can save a draft, resume it on another signed-in session and review their entries before agreeing to the terms. Vendor school/business evidence is required; CAC registration is optional. Existing age and independent guardian-consent rules remain enforced.

The evidence step has a front-camera preview, oval guide, capture, confirmation, retake and private upload. Streams stop on leaving the page, closing the camera or hiding the tab. Unsupported/denied cameras have a portrait-upload fallback. A photograph is evidence for human review, not automated liveness, face recognition or verified NIN.

An eleven-digit NIN is encrypted with AES-256-GCM using a separate server-only 32-byte key and randomized 12-byte nonce. Authenticated data binds it to the owner, university and submission UUID. Draft JSON and public application fields contain no raw NIN or ciphertext. Submitted envelopes are append-only in `app_private.agent_identity_submissions`; an HMAC fingerprint supports identity matching without an unkeyed dictionary hash. Owner-authorized draft restoration decrypts only the owner's saved envelope. Missing encryption configuration disables submission without storing plaintext.

The final request UUID survives retries. An identical request returns the same application and queues one receipt email; changed details cannot reuse its UUID. Application/details/private submission/receipt/draft removal are atomic. Submission does not grant an agent role. Newly approved business names, descriptions and category tags populate the public profile; telephone/WhatsApp publication requires explicit opt-in.

Reviewers can inspect uploaded evidence through the existing 90-second signed access endpoint. NIN is masked by default. A scoped `agents.verify` permission, reason, bounded viewing quota and successful audit insertion are required before reveal. The browser hides a revealed value after two minutes or when the tab is hidden. Identity review must match the current submission. Both API checks and the approval database guard require that match and current owned business evidence. Self-verification and self-approval are denied. Manual identity review, telephone verification and final application approval remain distinct actions.

## Validation

All 490 server tests in 50 files and 130 root regression tests pass. Seven new crypto/database/API tests cover randomized encryption, authenticated scope/tamper rejection, missing key, private drafts, malformed fields, foreign evidence, concurrent retries and receipt deduplication, masked/scoped/audited reveal, current-NIN matching, deleted business evidence, self-approval and append-only identity storage. Server/mobile/portal type checks, server build, portal lint/production build and mobile production web export pass. The learning-resource preview's signed-access request was also corrected to POST.

## Release dependencies

- Apply additive migration `20261001010000_private_agent_identity_submissions.sql` after the public-business-profile migration. Reconcile the live ledger first.
- Configure `KYC_ENCRYPTION_KEY` as a random 64-hex-character server secret, separate from `KYC_FINGERPRINT_SECRET`. Neither belongs in the repository or client bundles. Preserve the decryption key in the secure secret store; rotation requires a reviewed re-encryption procedure for existing envelopes.
- Keep the review provider/reference and human portrait/document checks operational. A submitted number is not verified identity.
- Confirm camera permissions, retakes and file-upload recovery in a secure browser and on representative devices. Automated browser/device acceptance remains unavailable in this workspace.
- Configure and verify the email outbox worker/provider before claiming application receipt and approval emails are delivered. This phase queued synthetic test receipts only; no email was sent.

No production migration, provider verification, deployment or APK build ran. Publication to the public GitHub repository remains blocked by automatic approval review.
