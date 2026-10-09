# Current Android APK release

The direct Android build is version 0.3.21, version code 51. It builds the triggering release commit rather than the October 6 source revision that was pinned in the current-APK workflow. The build branch starts from verified main revision 4f6ebc191b16c336ccd124fbd436f2b1c0f3f533 and only changes release metadata and build verification. It does not merge unfinished feature branches or publish a production website update.

The workflow retains the configured Firebase and Expo project checks, verifies the production API and migration receipts, runs the reviewed map-routing checks, compiles bundled JavaScript for ARM64, and verifies the actual package identity, version code, architecture, target SDK and signature before saving the APK and its SHA-256 receipt.

The signing check accepts the certificate digest reported by apksigner without requiring a particular signer-label format. A failed signature remains a failed build. The current-APK workflow requires the existing 0.3.20 test signing certificate and no longer creates a replacement random key. This keeps direct test updates compatible with the previous ARM64 APK. Play Store signing and publication are separate from this direct APK request.

This release uses the completed main-branch application. Open, unmerged payment and alarm proposals are not silently activated by packaging it. Native compilation and package verification do not establish a full physical-device acceptance run or a completed real-money purchase.
