# Campus map “Where to?” interaction

Date: 2026-09-28

## Scope

- Replaced the map screen’s separate directory/header flow with an edge-to-edge campus map and a draggable bottom sheet.
- The collapsed state keeps the drag handle and “Where to?” search visible.
- The expanded state shows persistent recent destinations, campus suggestions, and search results.
- Campus search keeps the existing aliases introduced by the UNIBEN map expansion.
- Selecting a destination enters start-point selection; users can choose a campus place from the sheet, tap a mapped pin, or use their live device location.
- Foreground device location uses the native Expo location module, runtime permission handling, a live blue map marker, and continuous foreground position updates while the campus map is open.
- The locate control requests permission when required and recenters the map on the user’s live position.
- The existing in-app route graph remains responsible for route distance and path drawing. When the live position is within the mapped campus area it is attached as a temporary route origin and the route recalculates as the device position changes.
- Route results show comparison-only estimates for walking, bicycle, school shuttle, and private cab. There is no ride-booking flow.
- Fare display currently uses: walk free, bicycle free, school shuttle ₦250, private cab ₦1,250.
- Background location tracking is intentionally not requested; navigation location is foreground-only.

## Validation and boundary

- Pull request #57 was merged into main.
- The mobile CI job passed dependency installation, TypeScript checks, the mobile regression test, and web export with the location dependency included.
- Android Expo prebuild passed with the foreground location permission and native location plugin generated successfully.
- The Android release APK workflow is the final native packaging check.
- The unrelated server operations-access test suite currently has existing assertion failures; no server files were changed by this campus-map implementation.
