# Feed discovery, sharing and first-install introduction

The app now has a dedicated search destination with Top, Latest, People and Media tabs. Leading `@` restricts lookup to username prefixes. Ordinary People search matches names/usernames. Post filters use actual author, inclusive UTC dates, author-declared language, following/liked/replied/reposted relationships, and exclusion of replies. Older language metadata is unspecified, not inferred. People lookup intentionally omits post filters. Full-text relevance is content relevance, not a fabricated engagement score.

The Worker enforces campus/public visibility, blocks in both directions, active account/profile visibility, declared publication times and cursor binding to the viewer/campus/query/filters. Page sizes are bounded and tied results use stable pagination. Additive migration `20261001000000_discovery_search_indexes.sql` provides matching text indexes. Missing feed/safety/reply schema returns an explicit readiness state. Publishing captures an optional language and protects idempotent request reuse from changed language.

The common share sheet opens with recent eligible inbox conversations. A recipient selection requires explicit Send; a stable message UUID confirms server acknowledgement and supports an in-place retry. Internal shares are ordinary canonical link messages, never unauthorized copies of private files. Requested threads retain the existing acceptance, blocking and message-request rules. WhatsApp, Copy link and More use actual supported integrations. Copy failures leave a selectable link instead of reporting success. Post, personal profile, business profile, product, tutorial and resource actions use the sheet.

Canonical links are `https://links.kampusone.app/s/{kind}/{uuid}`. App destinations are allowlisted, and pending destinations survive sign-in/application restarts for seven days. New student onboarding returns through the entry route to honor a pending link. Unknown kinds, malformed IDs and redirect parameters are rejected. The portal has a branded website fallback and association handlers; the public landing site is unchanged. Android download appears only after a valid owned HTTPS APK URL is configured.

Three illustrated introduction pages appear before existing Create account / Sign in on a new install, with Skip, Back and Next. Completion persists across restarts/updates/sign-out. Existing stored profiles or user-selected appearance skip the introduction; historical anonymous installs without any retained marker cannot be distinguished reliably from a fresh install and may see it once. Signed-in users skip it. Reduced motion, accessible native text, scalable artwork and scrollable small-screen layout are preserved. Three new illustrations use one original student character in the approved isolated-character style. After the selected Higgsfield account's plan blocked submission, built-in image generation supplied the originals. Current assets and generation details are recorded in `docs/assets/2026-10-01-onboarding-art.md`.

## Verification

- Five database/API search integration tests: visibility, blocks, wildcard escaping, all tabs/filters, tied pagination and changed-cursor rejection.
- Five pure boundary/persistence tests: malformed share destinations, real dates, username mode, app-process restart and signing identifiers.
- Eleven updated post-link transport/pending-link tests, plus the regular 130 root tests and 10 shared-contract tests.
- Server/mobile/portal type checks; portal lint and production build; mobile production web export. Server regression results are recorded in the main handoff after the complete run.

Browser/device visual acceptance remains pending because no working browser/device runner is available in this workspace. A web build is not proof of Android/iOS linking or gesture acceptance.

## Release configuration

1. Deploy this portal on `links.kampusone.app`; association files must respond directly over public HTTPS without authentication/redirects. The link host does not expose admin/agent navigation.
2. Configure `ANDROID_RELEASE_SHA256` with the actual signed release APK certificate fingerprints (comma-separated colon-delimited SHA-256), and `APPLE_TEAM_ID` with the actual application identifier prefix. Missing/invalid values return 503 and never claim an invented identity.
3. Set `ANDROID_APK_DOWNLOAD_URL` only after publishing the verified APK. Until then the fallback explains that the new download is awaiting release.
4. Native app configuration declares the same host used by `EXPO_PUBLIC_SHARE_ORIGIN`. An origin override requires deploying both matching website handlers and native association configuration. Legacy `/post?id=` links remain app routes but the new verified host covers `/s/` links.
5. Check the signed APK's App Links on real Android devices (including older versions), app-installed and app-absent cases, sign-in preservation, WhatsApp/system share behaviour, first-install completion, and access revocation after a link was shared. Test iOS against the actual signing entitlement before claiming universal-link support.

Primary platform guidance: https://developer.android.com/training/app-links/verify-applinks and https://developer.apple.com/documentation/xcode/supporting-associated-domains .

No production migration, deployment, payment, external message or APK build ran in this phase. Publication to the public GitHub repository remains blocked by automatic approval review.
