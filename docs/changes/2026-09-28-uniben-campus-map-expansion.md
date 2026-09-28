# UNIBEN Ugbowo campus map expansion — 2026-09-28

## Scope

- Reviewed all 34 user-supplied map reference images: 33 overlapping Google Maps screenshots and one older Ugbowo campus layout.
- Used the screenshots as reference material for campus-place identification and relative topology; Google raster imagery is not bundled into KampusOne.
- Expanded the bundled Ugbowo directory from 13 places to 96 student-relevant campus places covering academic buildings, halls, gates, banks, libraries, health, food, sports, transport, parking, worship and student-service landmarks.
- Cross-checked high-confidence coordinates against official University of Benin sources and OpenStreetMap-derived references.
- Exact/cross-checked points retain a verification timestamp. Screenshot-reconstructed points intentionally remain unverified so the UI does not imply survey-grade accuracy.
- Off-campus private businesses visible around the screenshot edges are not promoted into the core campus layer because they distort the campus default extent; the screenshots still informed campus-edge topology.

## Directory rollout

- Published database rows remain authoritative.
- For University of Benin, missing starter places are merged into the student directory response so a partial database migration cannot make reviewed places disappear.
- Added student-friendly search aliases such as `GTB`, `Queen Idia`, `ICTU`, `Buka`, `JHL`, and common hall names.
- Added a Neon migration that upserts the expanded Ugbowo place directory and preserves prior verification for existing records.

## Navigation and UI

- Directions use the in-app campus routing flow and no longer depend on the obsolete/missing directions resource that produced a red 404-style message.
- The route flow asks the student to choose a starting campus pin and then renders distance and estimated walking time inside the map.
- The top-right control rail is moved below the upper overlay/status area and compacted for small Android screens.
- The map surface identifies the directory as OpenStreetMap-linked campus data.

## Accuracy boundary

The current route network is an approximate campus companion route between mapped POIs. It is useful for orientation and rough walking distance, but it is not a turn-by-turn pedestrian road/footpath router. A future routing adapter can use hosted OpenStreetMap pedestrian graph data while keeping the current mobile UI and campus POI dataset.

## Verification checklist

- Server starter-directory tests cover count, IDs, coordinate bounds, key landmarks and search aliases.
- Migration uses the existing multi-tenant campus tables and University of Benin tenant lookup.
- No Vercel deployment is part of this change.
