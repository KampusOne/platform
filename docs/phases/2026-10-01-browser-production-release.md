# Vercel browser release and matching APK

The current Vercel connection can inspect deployments but cannot create them, and
the production GitHub environment has no VERCEL_TOKEN. Authorized deployments
can use Vercel's existing signed-in account without creating a persistent token.

Deploy the portal production project from the exact current main revision after
the matching Deploy Worker run succeeds. Its production domains are
agents.kampusone.app and a7f3c9e1b6d2f8a4c5e9b1d7f3a6c2e8.kampusone.app.
Deploy the mobile production project from that same revision last.

The mobile project's successful Vercel commit status starts a verification job.
It requires the successful Worker run from this repository and revision, both
trusted Vercel project statuses, current main, matching source stamps on the
three production aliases, and unauthenticated API rejection. Only then does it
issue the existing release receipt and start the matching Android build.
Other status events cannot publish an APK. Manual Android builds remain artifact
only. No new credentials, provider permissions, or product gates are introduced.

The email redesign commits b71cfbcd286d6dd245df22d4de861462aa8c9297 and
5dd6b52a39f143f2bc4700fc50907061ab64cbbd are included. Their Worker deployment
36817331129 succeeded with version 8c97161e-c20a-4f95-a45e-36a04a7d9ac1 and
516 passing server tests. The email sender migration below was verified live;
no campaign or transaction was sent during release verification.
