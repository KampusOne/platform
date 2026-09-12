# KampusOne mobile UI redesign v2

## Status

The reference-driven Expo implementation is complete on `codex/mobile-ui-redesign-v2`. It is ready for device-level visual QA, but it is not a production-release approval. The product, security, payment, data-integrity, and operational gates below remain authoritative.

## Design sources

- `KampusOne_UI_UX_Master_Rules_v2.txt` is the implementation rulebook.
- `Screens KampusOne .zip` is the visual source for Welcome, Sign in, Sign up, Home, Feed, Explore, Map, Profile, and Tutorials, including populated and empty variants.
- The uploaded brand guidelines and design-token package provide the official warm cream, terracotta, sand, Campus Ink, Lato, and Inter system.
- The product requirements and architecture files remain authoritative for feature behavior, API boundaries, and phased availability.

The supplied screens are flattened raster references, so their illustration vectors cannot be recovered as authentic source SVGs. Five clean, transparent production illustrations were recreated as optimized PNG assets rather than wrapping traced pixels in misleading SVG containers:

- `mobile/assets/illustrations/auth-study-v2.png`
- `mobile/assets/illustrations/feed-empty-v2.png`
- `mobile/assets/illustrations/home-student-v2.png`
- `mobile/assets/illustrations/onboarding-walk-v2.png`
- `mobile/assets/illustrations/tutorials-empty-v2.png`

## Implemented experience

### Entry and account setup

- Welcome
- Sign in
- Sign up with explicit Terms and Privacy consent
- Email verification and resend
- Password recovery
- Three-step academic onboarding with searchable selectors
- Explicit university, faculty, and department selection; the app never silently chooses tenant data
- Course skip as an explicit option when a programme is not listed
- Switch-account escape path from incomplete onboarding
- Retryable session and profile restoration states

### Primary navigation

The authenticated student shell uses exactly five primary destinations:

1. Home
2. Feed
3. Explore
4. Map
5. Profile

Child tools retain their primary-parent tab state. Pressing a parent tab while on one of its child routes returns to the parent screen.

### Student product surfaces

- Home / Today with campus-time-aware timetable status, live academic summary, quick actions, and campus updates
- Feed with search, categories, verified-source semantics, bookmarks, share, corrections, populated content, and illustrated empty states
- Explore with search, session-backed recent tools, honest availability, and routes only to implemented tools
- Real OpenStreetMap tiles with searchable campus markers, filters, zoom, recenter, directions handoff, attribution, loading, partial-failure, and offline states
- Profile with live identity, selective verification status, academic/activity/transaction modules, scoped partial-data states, and account menu
- Timetable Manager
- GPA Calculator
- Approved Tutorials and tutor discovery
- Store, cart, delivery zone, and checkout handoff
- Purchases, booking/order status, payment recovery, delivery handoff codes, disputes, and tutorial completion confirmation

Long Feed, Tutorials, Map, Store, and Purchases datasets use virtualized lists. Search and refresh failures preserve previously loaded content instead of replacing it with blank screens.

Feed remains a verified campus-information surface in this MVP. Open student posting is intentionally deferred by the current PRD and repository rules even though the broader UI rulebook describes a later social-posting model.

## Product-honesty decisions

- No KampusOne or K1 logo appears inside the mobile app, including authentication and onboarding.
- No fake streak count, verification mark, recent-tool history, notification status, class reminder, payment success, or campus location is shown.
- Tools without a working route explain their availability instead of opening the wrong feature.
- The map never disappears merely because a search has no matches.
- Tutorial completion is a server-authoritative, confirmed action available only after the booked availability window ends.
- Reminder settings are described as saved preferences until native device notifications are implemented.
- Profile totals use unknown/stale states rather than turning failed requests into factual zeroes.

## Accessibility and motion

- Deep terracotta is used for white-text actions; muted text and field borders meet the intended contrast thresholds.
- Interactive targets are at least 44 points where required.
- Form fields have programmatic labels and validation feedback.
- Sheets expose modal semantics, accessibility escape, focus management, and separate dismiss controls.
- Decorative artwork is excluded from the accessibility tree; informative feed imagery and approval semantics are exposed.
- Screen, tab, sheet, and control motion respects the platform Reduce Motion preference.

## Verification

- Mobile TypeScript: `npm run check`
- Server TypeScript: `npm run check`
- Server tests: 2 files, 9 tests
- Expo web static export: all 36 routes exported
- Repository whitespace validation: `git diff --check`
- Generated illustration dimensions and sizes inspected after optimization

Automated rendered browser screenshots could not be produced in this workspace because no browser executable is installed. Device/simulator visual regression checks across compact phones, large text, dark accessibility settings, reduced motion, keyboard interaction, and offline transitions remain part of release QA.

## Remaining production gates

1. Replace the unverified-email re-registration behavior with a mailbox-proven account-reclaim flow so a pre-created pending account cannot retain an attacker's password.
2. Make payment initialization idempotent and store immutable payment attempts so a retry cannot orphan a successful charge from an older payment tab.
3. Define GPA term updates as an atomic replacement or an explicit merge; currently omitted course rows can remain after a term is resaved.
4. Persist and atomically rotate the native refresh credential in secure device storage; the current client relies on the refresh cookie and keeps only its access token in memory.
5. Configure and verify the production payment return route, provider callbacks, and webhooks before enabling either payment feature.
6. Configure a production-capable OpenStreetMap tile provider or self-hosted service. The public OSM tile service is suitable for development, not a high-volume SLA.
7. Verify and publish the final Terms and Privacy URLs/content before accepting production registrations.
8. Implement and permission-test native class notifications before describing timetable reminder preferences as delivered alarms.
9. Run signed-device visual, accessibility, offline, API-failure, payment-provider, and app-store build verification.

Phase 2 should remain gated independently from this visual redesign and should not be enabled until its finance, identity, operational, and payment controls pass their documented checks.
