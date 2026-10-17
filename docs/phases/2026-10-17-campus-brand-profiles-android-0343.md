# Campus brand profiles and Android 0.3.43 / build 73

Tapping a photo or name in **Top campus brands** now opens that brand's vendor, tutor or rider profile. The brand rail no longer silently filters marketplace products. Search and product-category filters remain available, and the destination profile contains the brand's listings.

The rail and business profile use the existing KampusOne verification seal only when the API explicitly returns `verified: true`. Both endpoints derive verification from the trusted agent profile's `verified_at` value; public profile metadata cannot award the badge. Older responses without a verification field show no badge. The API retains campus scope, enabled/active brand checks and blocking in both directions. No database migration or financial changes are needed.

Android 0.3.43 advances the version code to 73 and includes all tutor/vendor listing, resource and order improvements prepared for 0.3.42. It uses uniquely named APK assets and the existing signing certificate. Package, source revision, ABI, signature, deployed backend and web publication receipt checks remain required. The APK preflight also runs the marketplace navigation regressions.

Verification covers vendor/tutor/rider navigation, photo/name tap targets, explicitly verified versus unverified or legacy UI responses, PostgreSQL-backed public identity and campus/block/active checks, and full exported-app navigation on 360px and 390px phones. Final check outcomes are recorded below before delivery.
