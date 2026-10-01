# Production release and Android testing handoff

Source c1256d552a5643b0d1d5979ed17d4e870d91e1be is deployed to the Worker,
agent/admin portal, and mobile web project. It includes the approved platform
implementation and both October 1 email design commits. Main remained on this
revision throughout APK publication.

## Completed checks

- All 51 registered migrations succeeded, including the George email persona
  migration. Its live source blob matches the committed SQL. Historical baseline
  files were not replayed or falsely registered as new migrations.
- Worker run 36819819015 succeeded with version
  a6aabb0e-c9cd-4a36-8a00-113e665e2e16 and 516 passing server tests.
  Readiness returned 200 with database, signing, OTP, and email checks ready.
- Portal deployment dpl_EkY4ssTYQeCohNqnaeWXBzSDVofu and mobile deployment
  dpl_DaFU6wdzFZzZomkKsXKssktv61Ti reached production READY. The agent,
  anonymous admin, and mobile source stamps match the Worker revision.
- Verification run 36820314742 passed the production alias checks and confirmed
  unauthenticated API requests return 401. Portal type checks, lint, production
  builds, 126 root regression tests, and the six release guard tests passed.
- agents.kampusone.app, the anonymous admin hostname, and links.kampusone.app
  have valid Vercel production configuration. A shared-profile URL returned the
  app-opening and website fallback links. The public landing site was unchanged.
- Android run 36820342030 succeeded. Gradle reported BUILD SUCCESSFUL in
  23m 37s. The public apk-latest release targets this exact source revision.
  Downloaded APK bytes match GitHub's SHA-256 digest. The archive contains
  AndroidManifest.xml, classes.dex, native libraries, and the 4,294,384-byte
  assets/index.android.bundle; it does not require a Metro development server.

APK: https://github.com/KampusOne/platform/releases/download/apk-latest/KampusOne-Android.apk

SHA-256: b615c3bb8271e5a0596581d5466c77cadf598cd14898448f8661641e4fcbee09

## Device and provider acceptance

This is the existing pipeline's sideload testing build. Production signing and
automatic verified App Links still need the production certificate. Manual app
opening and the web fallback are available. Validate camera permissions, local
alarms, draft recovery, gestures, and app-link behavior on an installed device.

Payment, payout, and paid AI subscription gates remain in place pending provider
acceptance. No financial transaction, email campaign, or staff privilege grant
was initiated during deployment verification. The email code and migration are
deployed; an actual recipient delivery test is a separate acceptance check.

Machine-readable provider/source evidence is in
docs/release-proof/production-release.json and verified-web-release.json.
This handoff is stored on a release evidence branch so recording the outcome
does not advance main or restart the verified deployment/APK chain.
