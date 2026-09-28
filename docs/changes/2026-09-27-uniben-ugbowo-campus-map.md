> **Superseded on 2026-09-28:** the diagram-style coordinate layer and synthetic POI-to-POI routing described below have been replaced by the live MapLibre/OSM navigation architecture in `docs/decisions/20260928-campus-navigation.md`. This file is retained as the earlier checkpoint.\n\n# UNIBEN Ugbowo campus map checkpoint — 2026-09-27

## Goal

Make the student campus map useful for University of Benin Ugbowo Campus without making the admin dashboard a launch prerequisite.

## Delivered boundary

- University of Benin receives a tenant-safe Ugbowo starter directory when the live database has no published campus places yet.
- The starter directory includes reviewed coordinate points for Student Affairs, selected faculties, JUPEB, hostels and the campus food court.
- A Neon migration persists the same starter directory and publishes the Ugbowo campus when database promotion is approved.
- Database content takes precedence. The starter fallback disappears automatically once a published database directory is available.
- Other universities never receive the UNIBEN fallback.
- The student app renders a KampusOne-owned campus layer from mapped campus coordinates. It no longer depends on public raster tile servers for the campus screen.
- Search, category filtering, map panning, zoom/recenter, place selection and directions stay inside KampusOne.
- Directions use mapped campus places as route nodes and show an in-app guide line, distance and walking-time estimate. They do not hand the user to another map app.
- The map height adapts to smaller screens without reducing typography.
- The campus admin API accepts map style/source URL and place category/coordinates/accessibility/image fields, so the future admin UI can edit real map data.

## Current navigation boundary

KampusOne now keeps campus discovery and place-to-place direction guidance inside the app. The current route layer is a campus guide built from reviewed mapped points; it is not represented as verified turn-by-turn walkway geometry. Live GPS positioning, verified walkway/road geometry, temporary friend-location sharing and shuttle tracking remain separate capabilities and must not be presented as complete until their data and permissions are implemented.

## Data confidence

The starter is intentionally limited to coordinates that have been reviewed. Do not fabricate coordinates for a gate, lecture theatre, office or path that has not been checked. Field verification can refine entrances, building centroids and walkway geometry later through the admin workspace.

## Release / rollback

- The Worker fallback requires only the server deployment and does not require the new migration.
- The migration is additive and should be rehearsed on a Neon branch before production promotion.
- Rolling back the Worker removes only the bundled fallback behavior; persisted campus rows remain normal campus data.
- The mobile campus layer has no raster-tile environment variable or third-party map-app handoff requirement.
