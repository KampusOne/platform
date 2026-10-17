# PDF recovery and address-only rider checkout

Rider checkout collects the recipient's address without requiring a destination map point or a manually selected delivery zone. The Worker resolves active coverage from the saved store's campus and retains the reviewed quote, recipient snapshot, in-app payment and order idempotency checks. A landmark remains optional for a measured road-route quote. Missing seller addresses produce an actionable error without silently changing the buyer's selected fulfilment mode.

Address-only quotes use the existing campus base/load tariff: at least ₦500, with the existing quantity, weight, volume and multiple-pickup adjustments and ₦1,500 cap. They are labelled `CAMPUS_ADDRESS`; their stored `routeMetres: 0` is an unmeasured sentinel required by the existing fare snapshot schema. It is never shown as a measured distance or drawn as a customer route. Measured landmark quotes keep their existing network distance tariff. Typed addresses are not geocoded, and riders confirm the exact entrance. Existing cash receipts and settlement paths retain their historical rules; new quotes and orders require the `IN_APP` method for both items and rider fare, using the existing provider checkout for authorization.

Vendor product creation, edits and publication require a saved pickup address and map location. Creation checks the requirement in the insert as well as before accepting the request, and no longer manufactures an empty storefront. Mobile and vendor portal photo/product controls show the requirement before uploading. Tutors remain independent. Product removal and historical purchase records remain available. Catalogue pickup readiness uses the saved address and does not expire with a two-minute live GPS session.

The PDF viewer now exposes and uses byte-range metadata, streams download progress, and ends stalled loading with a retry state. Both document opening and individual page loading have 15-second inactivity/work deadlines. The HTML bootstrap has a connection fallback, and native startup has its own watchdog. Updated access links reach an already open native/web viewer, with a load-event handshake covering a cached frame's early ready message. Rendering still uses bounded canvases and releases distant pages.

Pinch zoom uses absolute finger separation from the gesture start, batches updates through animation frames, and anchors the document under the moving midpoint. Two-finger movement pans without multiplying zoom deltas. Raster rerendering waits for the gesture to finish. Single-finger vertical scrolling, double tap, zoom controls and page jumps remain available.

No migration or new application dependency is required. The existing storefront pickup foreign key, private file authorization, immutable quote/ledger functions and tenant boundaries remain in use. The main rollout needs the Worker and web export plus a new Android build for the native host and checkout changes; this phase record does not establish a published release.

Validation:

- Full backend suite: 1,173 tests in 139 files passed. Final focused commerce, seller, directory and CORS suite: 82 tests passed.
- App regressions: 422 passed. Shared contract checks: 10 passed.
- Mobile, Worker and portal type checks; portal lint and production build; mobile production web export; Worker production dry run passed.
- Phone-sized browser scenarios cover address-only and landmark rider quotes, in-app totals, 24/30-item pagination, cart continuity, resource/order actions, both reader themes, full-height/device-density PDF rendering, real touch pinch/swipe, page controls and video playback.
- The isolated reader scenario renders a 1 MB PDF while its initial full response remains pending, verifies range requests, finger-centred pinch and two-finger pan, vertical swipe, and a stalled source's retry state.
- React review: account-keyed vendor checks cancel on unmount, mutation errors retain drafts, upload controls stay locked until saved server data is ready, tutor publishing remains separate, refreshed file links update the existing host, and touch movement avoids repeated bitmap rendering.

The browser fixtures intercept both direct Worker and `/api` proxy paths and restore an onboarded synthetic home session before tab navigation. No production profile, order, provider payment or private source document is changed by these checks.
