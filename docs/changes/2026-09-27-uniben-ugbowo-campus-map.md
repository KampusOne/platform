# UNIBEN Ugbowo campus map checkpoint — 2026-09-27

## Goal

Make the student campus map useful for University of Benin Ugbowo Campus without making the admin dashboard a launch prerequisite.

## Delivered boundary

- The student map continues to use the lightweight OpenStreetMap raster renderer already in the Expo app.
- University of Benin receives a tenant-safe Ugbowo starter directory when the live database has no published campus places yet.
- The starter directory includes reviewed coordinate points for Student Affairs, selected faculties, JUPEB, hostels and the campus food court.
- A Neon migration persists the same starter directory and publishes the Ugbowo campus when database promotion is approved.
- Database content takes precedence. The starter fallback disappears automatically once a published database directory is available.
- Other universities never receive the UNIBEN fallback.
- Search, category filtering, markers, zoom/recenter and Google Maps directions remain available.
- The map height now adapts to smaller screens without reducing typography.
- Raster tiles can be switched with `EXPO_PUBLIC_MAP_TILE_URL_TEMPLATE` without changing application code.
- The campus admin API now accepts map style/source URL and place category/coordinates/accessibility/image fields, so the future admin UI can edit real map data.

## Current navigation boundary

KampusOne renders the campus and its POIs in-app. The Directions action hands the destination coordinates to Google Maps, which can navigate from the user's current location. In-app live GPS tracking, turn-by-turn routing, friend-location sharing and shuttle tracking are separate later phases and are not represented as complete here.

## Data confidence

The starter is intentionally limited to coordinates that could be checked against public UNIBEN pages or current OpenStreetMap-derived place data. Do not fabricate coordinates for a gate, lecture theatre, office or path that has not been checked. Field verification can refine entrances and building centroids later through the admin workspace.

## Release / rollback

- The Worker fallback requires only the server deployment and does not require the new migration.
- The migration is additive and should be rehearsed on a Neon branch before production promotion.
- Rolling back the Worker removes only the bundled fallback behavior; persisted campus rows remain normal campus data.
- The mobile tile-template variable is optional. With no value, the existing OpenStreetMap tile endpoint remains the default.
