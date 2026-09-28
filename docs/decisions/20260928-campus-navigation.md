# Campus navigation architecture — 2026-09-28

## Decision

KampusOne campus navigation is an in-app geographic map, not a diagram and not a Google Maps handoff.

The mobile app uses MapLibre Native with an OpenStreetMap-compatible basemap style. Campus POIs remain tenant-owned KampusOne data from `/v1/student/campus/places`. Device location is requested in-app and rendered as the student's live position.

Walking directions are requested through the KampusOne Worker at `/v1/student/campus/route`. The Worker owns the routing-provider adapter, timeout, campus-distance guards, kill switch, and provider failure handling. The current pilot adapter consumes an OSM-backed pedestrian OSRM service and can later be replaced by a self-hosted router without changing the mobile contract.

## UNIBEN pilot data

UNIBEN Ugbowo is tenant one. The supplied campus screenshots, Google screenshots, and scanned campus maps are validation/reference material only. They are used to verify names, POI placement, and missing data; they are not rasterized into the product and are not the primary map source.

The initial UNIBEN `navigation_bounds` values are a navigation geofence for enabling live campus directions. They are not a legal property boundary and must remain replaceable by future admin-managed campus geometry.

## UX behavior

- The map is full-screen with floating KampusOne search, category filters, POI markers, and bottom route/place sheets.
- The app requests foreground location permission on the Map tab.
- Location denied: browsing remains available and the user gets a Settings action.
- Location granted but outside the configured campus geofence: browsing/search remain available, but walking directions are disabled with a clear off-campus notice.
- On campus: the student's position is shown and selecting a mapped POI can start a real pedestrian route.
- Route response contains GeoJSON line geometry, distance, duration, and turn-step metadata.
- Active routes are refreshed only after at least 12 seconds and about 30 metres of movement to avoid wasteful network churn.
- No Google Maps deep link or external navigation handoff is part of this flow.
- Web keeps a searchable campus-directory fallback; native GPS navigation is Android/iOS.

## Performance and failure states

- Native map rendering is capped below maximum refresh rate for mid-range Android devices.
- POI directory reads continue to use existing mobile cache policy.
- Routing has a 8 second Worker-side provider timeout and a 12 second mobile request deadline.
- Routing is kill-switchable with `CAMPUS_ROUTING_ENABLED`.
- Provider failure leaves the campus map usable and returns a user-readable navigation-unavailable state.
- The public pilot routing service must be replaced or self-hosted before traffic exceeds fair-use expectations. A server-side per-user rate limit must be added before a high-volume rollout; the current pilot also paces active reroutes on-device.

## Verification required before release

- Mobile TypeScript check.
- Server TypeScript/tests/build.
- Web export (must not import native MapLibre through the web-specific screen).
- Android native prebuild/build.
- Physical-device location permission test.
- On-campus live-location and off-campus geofence test.
- Walking-route spot checks against known UNIBEN roads/footpaths and the supplied reference screenshots.
