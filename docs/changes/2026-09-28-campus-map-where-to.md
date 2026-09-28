# Campus map “Where to?” interaction

Date: 2026-09-28

## Scope

- Replaced the map screen’s separate directory/header flow with an edge-to-edge campus map and a draggable bottom sheet.
- The collapsed state keeps the drag handle and “Where to?” search visible.
- The expanded state shows persistent recent destinations, campus suggestions, and search results.
- Campus search keeps the existing aliases introduced by the UNIBEN map expansion.
- Selecting a destination enters start-point selection; users can choose a campus place from the sheet or tap a mapped pin.
- The existing in-app route graph remains responsible for route distance and path drawing.
- Route results show comparison-only estimates for walking, bicycle, school shuttle, and private cab. There is no ride-booking flow.
- Fare display currently uses: walk free, bicycle free, school shuttle ₦250, private cab ₦1,250.

## Validation and boundary

- The feature branch is rebased on the latest main map expansion and is not deployed.
- No GitHub Actions workflow was available for the feature-branch head.
- The local execution environment could not resolve GitHub, so a full npm typecheck/device build was not run here.
- The existing locate control recenters the campus map. Live device GPS tracking was deliberately not faked; it requires adding the native location dependency, runtime permission states, and device testing before being presented as current-location tracking.
