# Campus map experience, 3 October 2026

The mobile map now supports planning a walk between two campus places or map points without requiring a device location. The muted campus palette, category colours and brown route are preserved.

## User-visible changes

- One directions drawer replaces the two overlapping destination/route cards. From and To remain visible in the collapsed state. A completed route shows walking time and distance immediately; expanded content includes sourced path names, approach caveats and an available place photo.
- Either endpoint can be selected from searchable campus places or by tapping the map. Origin selection is explicit; My current location is optional. Outside-campus GPS produces an actionable instruction to choose a campus start instead of forcing routing from home. Swapping endpoints and clearing the route are available.
- Map point selection shows a short instruction with a cancel action. Search ranks exact/prefix place names above less direct matches and includes the existing aliases. Recent destinations remain campus-specific.
- Dense POIs cluster at overview zoom levels. Selected origin and destination remain visible outside the cluster. Unselected labels wait for closer zooms and use collision avoidance. Sourced path geometry remains visible if raster street tiles fail.
- The route has a pale casing and distinct A/B markers at its actual graph endpoints. Approximate requested pins remain separate; no invented entrance or connecting path is drawn. The API reports distance to the graph where an approach needs verification.
- Map, Satellite and Buildings controls are labeled. Satellite requires a configured attributed source; Buildings requires sourced height data. No elevation/DEM provider is configured, so this release does not claim actual terrain relief.
- Camera fitting reserves space for the measured top controls, device safe area, drawer and bottom navigation. Native point-selection messages validate finite, in-range coordinates. Reduced motion removes camera and drawer animation.
- The native/web bridge sends only changed payload fields after initialization. GPS updates therefore do not resend the complete campus geometry. The renderer preserves unchanged feature/POI sources and camera state.
- Sourced campus geometry is cached in bounded native-storage pages, with ordered writes and metadata published after all pages have been saved. Android can reopen a large campus map without placing the entire geometry payload in a single storage entry. Corrupt/missing pages preserve the place directory and campus information.

## Backend boundary

`POST /v1/maps/route` accepts exactly one of a destination place ID or a destination coordinate. A named origin can also include `originPlaceId`; both named endpoints resolve approved entrances within the caller's published campus and institution scope. Manual pins are routed through the same sourced pedestrian graph.

The graph still refuses disconnected paths and endpoints more than 120 metres from coverage. It respects stored foot access, closures and accessible-route exclusions. A pin does not create an edge. Network geometry contains only mapped segments; snapped access distance is reported separately. Endpoint ancestry now selects the nearest suitable ancestor rather than the most distant ancestor. Consecutive identical instruction names are collapsed while a path visited again later remains in the directions.

No migration, new provider, secret, import or fabricated campus coordinate was added. Current sourced OSM imports remain authoritative. Unverified building entrances and missing campus paths still require actual data collection/review.

## Validation

- Mobile TypeScript check passed after these changes.
- `npx vitest run src/lib/campus-routing.test.ts src/lib/campus-route-input.test.ts`: 13 tests passed. Includes disconnected/crossing networks, long-segment snapping, one-way behavior, closures/accessibility, separate actual path endpoints, repeated instructions and manual destination input validation.
- `node mobile/scripts/check-campus-map.cjs`: passed official MapLibre style validation for 19 layers plus renderer/bridge scenarios using 3,595 sourced Ugbowo map features and the 96-place existing directory. Checks clustering, selected endpoints, point events, safe padding, reduced motion, changed-field payload merging, camera stability, bounded geometry-page round trips, ordered cache writes and corrupt/missing cache recovery.
- `node --check mobile/public/maps/view.js`: passed.
- Whole-server TypeScript check passed after concurrently edited reporting code was corrected. The final whole-mobile TypeScript check also passed.
- Actual Chromium 153 rendering passed at 390×844 and 1280×800. Both screenshots were visually inspected: sourced paths/buildings, clustered POIs, the actual graph route and readable A/B labels rendered without the original overlap. Browser checks exercised real renderer zoom controls and separate origin/destination point-click messages through its parent bridge, with no runtime page errors or horizontal overflow.

Browser evidence is in the working inspection directory: `inspection/map-browser/browser-results.json`, `map-390x844.png` and `map-1280x800.png`. The browser used a local iframe parent fixture containing the existing sourced OSM data and a computed 421-metre pedestrian graph route from Medical Complex to Hall 4. It did not call the live map API, authenticate, exercise a native WebView or prove a surveyed entrance. Some external OSM raster/font requests were blocked with `ERR_EMPTY_RESPONSE`; the renderer correctly reported the raster failure and continued displaying sourced campus paths/buildings and selected labels. Provider connectivity, full iOS/Android drawer/GPS/safe-area behavior and actual route/entrance survey accuracy still need live checks. The agent-browser daemon could not start; the actual renderer check used Playwright with the installed Chromium binary. No commit or deployment was made by the map task.

## Files

- `mobile/app/(tabs)/map.tsx`
- `mobile/src/components/campus-map-drawer.tsx`
- `mobile/src/components/campus-map-surface.tsx`
- `mobile/src/lib/campus-map-cache.ts`
- `mobile/public/maps/view.js`, `view.html`
- `mobile/scripts/check-campus-map.cjs`
- `server/src/routes/maps.ts`
- `server/src/lib/campus-routing.ts`, `campus-routing.test.ts`
- `server/src/lib/campus-route-input.ts`, `campus-route-input.test.ts`

Screenshot evidence: `inspection/image_review_b.md` in the working inspection directory documents all 23 assigned images individually. The two video findings were read from `inspection/video_review.md`, including overlapping map cards, route caveats and status-bar label clipping.
