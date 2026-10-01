# Admin workspace and measured reporting

The admin overview now uses the preferred white-panel layout with KampusOne terracotta accents, readable tables and responsive navigation. Account activity comes from recorded events, and finance panels appear only to staff with the relevant permission and campus grant. Financial graphs use actual ledger lines; zero revenue does not render a decorative nonzero bar. Scope changes discard stale responses.

## Individual staff logins

A platform administrator can create a staff account with an email, name, password, permissions, university scope and recorded reason. The browser reviews the details before submission and preserves a request UUID across uncertain retries. A keyed request digest, database advisory lock, password hash, account/profile creation, access grant and audit record provide one atomic provision. Reusing an email never overwrites an existing account or its password. Staff accounts sign in with the existing email/password flow; no email is sent automatically. The browser shows the chosen login briefly and clears it on tab hiding or after two minutes.

Custom grants remain server-enforced. Staff cannot grant themselves broader access or inspect the global staff list. Revoking a custom grant overrides legacy roles. Existing accounts can still be assigned scoped access; staff creation and the new UI require the admin extension migration. An obscure hostname changes routing, not authorization.

## Records, exports and private operations

- User and operational lists export all matching authorized pages, up to 10,000 records, rather than the visible page. Larger results require narrowing the search. Export purpose, filters and count are audited. CSV cells are quoted, escaped and protected from formula interpretation.
- A user's export contains a defined account/profile projection and only the operational datasets separately authorized for that staff member and university. Passwords, credentials, raw NIN, private identity evidence and conversations are excluded.
- The blocklist workspace shows current and scheduled restrictions, actor/reason/dates and a link to the existing profile review/revocation control. Expired and revoked restrictions are excluded.
- Private documents have a collection, title, description and university scope. Upload registration is tied to an owned private media object and can be retried without sending the file again. Reading requires current document permission and scope, even for the creator. Signed links expire after 90 seconds; archive and permission revocation are checked again on access. Archive preserves the file and audit record.
- The existing support, application review, notification-sound catalogue and broadcast controls remain in navigation and keep their own permissions. This phase does not send a campaign, approval email or push notification.

## Recorded activity and GA4

First-party reports show real account counts, daily bars, screen events, university totals, observed return rate, reported Android/iOS/web platforms, safe action tokens and 25/50/75/90 percent scroll milestones. Historical platform values remain unclassified. One account can appear on several platforms, so platform totals are not additive. Only instrumented actions are counted; no private entered text, message bodies, addresses or document content enters these reports. Missing database tables return a readiness state without fabricated zero totals.

GA4 reports are a separate source with its own definitions, property time zone, retrieval time, platform/screen/event breakdown, daily graph, CSV, row-limit and thresholding disclosure. Missing aggregate measurements stay unreported. The adapter uses a server-only service-account key, an analytics read-only OAuth scope, fixed provider endpoints, request timeouts, strict response validation, quotas, short-lived token caching and five-minute report caching with concurrent-request deduplication. A provider failure returns a sanitized unavailable state. Campus-scoped staff cannot retrieve a whole-platform property report.

Release setup:

1. Enable the Google Analytics Data API for the service-account project and give that service account read-only access to the intended GA4 property.
2. Set `GA4_PROPERTY_ID` to the property's numeric ID and store `GA4_SERVICE_ACCOUNT_JSON` as a Worker secret. The measurement ID and Measurement Protocol secret do not provide reporting access.
3. Start with built-in GA4 stream platforms and screen dimensions. Register event-scoped `app_platform`, `screen` and `action` custom dimensions before setting `GA4_CUSTOM_DIMENSIONS_READY=true`; allow GA4's processing delay. Missing historical dimensions are not retroactively invented.
4. Verify actual browser/native event collection, consent/preferences and returned measurements before setting `GA4_REPORTING_ENABLED=true`. Both reporting switches are false in checked-in production/staging configuration. First-party collection and existing GA4 ingestion remain independent.

Primary API references: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport · https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema · https://developers.google.com/identity/protocols/oauth2/service-account

## Reviewed publishing accounts

Newsletter authority now belongs to an immutable account ID with an approved campus/global scope and daily limit, rather than an editable display name. Policy changes use optimistic concurrency and an audit record. Scoped staff cannot create or edit a global policy or a foreign-campus policy. A per-publisher database lock reserves the daily quota exactly once per post; granting authority cannot broadcast older posts. Ordinary explicit subscriptions continue when a broadcast quota is exhausted.

Recipients are filtered by campus/public audience, active accounts, restrictions, blocks and notification preferences. Delivery rechecks the current policy, post, recipient and preferences. Deduplication also spans ordinary and managed notification prefixes, so a policy change does not send the same post twice. No managed publisher or staff grant is seeded by SQL.

## Verification and release state

All **506 server tests in 53 files**, 130 root tests, 11 sharing-link tests and the earlier 10 shared-contract tests pass. Server/mobile/portal type checks, server build, portal lint/production build (28 generated static pages) and mobile production web export (89 routes) pass. Six new API/database tests cover staff creation/login/retry, tenant isolation, private media and revocation, recorded platform/scroll measurements, scoped exports and schema readiness. Five GA4 adapter tests cover signed assertions, concurrent/cache behaviour, custom-dimension gating, malformed provider data, rejection sanitization and missing thresholded totals. The publisher integration tests cover ID-based authority, quota, campus filtering, duplicates and revocation. Two migration tests verify exact manifest hashes, ordered application of all twelve new versions, validated constraints, private ACLs and absence of seeded authority.

The full regression caught and corrected a missing SQL delimiter in the legacy unclassified-platform projection. The added missing-schema test uses a separate environment object so its temporary negative-readiness cache cannot contaminate subsequent tests.

Additive migration: `20261001020000_admin_workspace_extensions.sql`. It requires the existing operations/staff, event, media and notification schema. No earlier migration was modified. The live production database still lacks some prerequisites; see the reconciliation and release handoff. No production write, actual GA4 reporting credential, campaign, provider payment, deployment or APK build was performed.

Browser/device visual acceptance remains pending: this environment has no working local browser/device runner. Compilation and synthetic provider tests do not certify native gestures, camera behaviour, signed app links or live provider connectivity.
