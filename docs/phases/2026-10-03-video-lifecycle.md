# Full-screen video loading race — 3 October 2026

The browser review found a rejected `HTMLMediaElement.play()` promise when a newer load interrupted playback. Inspection of the installed Expo SDK showed that its web `replaceAsync()` calls `replace()`, which calls `video.load()` and `video.play()` without retaining the promise. Its public `play()` also returns void.

The video screen now initializes web players with their source rather than invoking this implicit replacement autoplay. Native retains `replaceAsync()`. A shared lifecycle gate rejects focus, foreground and manual playback requests until the current source replacement has completed and its player reports `readyToPlay`. Stale replacements and screen cleanup invalidate the generation. Browser playback additionally checks the actual element's readiness and handles that specific element's play promise, including cancellation after pause/replacement and the browser's user-gesture requirement. There is no global rejection listener or suppression.

Remembered seeking waits for readiness. Loading controls cannot start playback, while Pause still works during buffering. Background/focus transitions pause without discarding the student's existing playback intent. The web view uses inline playback, and its preload view exposes the same ref as the full view.

`cd mobile && npm run check` passed. `npx vitest run tests/video-playback-lifecycle.test.ts` passed all 8 tests: no play before replacement resolves, late source completion, blurred/background/paused/loading/error states, and invalidation on cleanup. The bounded `npm run export:web` script (two Metro workers) passed. No SDK dependency code was edited.

## Compiled browser playback and layout verification

The original uploaded recording contains HEVC/H.265 (`hvc1`) video and AAC audio. In this Linux Chromium build, `canPlayType` rejects HEVC. The element reported `readyState=4` and played its audio track, but `videoWidth=0`, `videoHeight=0` and an entirely transparent sampled video frame. A black stage with a valid duration therefore came from the test browser's missing video codec, rather than a failed Play control. HEVC decoding on native iOS/Android depends on the OS/device and was not exercised here; this browser result does not establish native capability or failure. No production media was transcoded or altered.

As a control, the same footage was transcoded to H.264/AAC in a temporary fixture. Before the layout correction, its DOM video element used its intrinsic 540×1200 dimensions, cropping the footage in the 390px viewport. Both video surfaces now use a raw, explicit absolute-position style with width and height set to 100%. This avoids the installed Expo web style mapper's treatment of a registered absolute-fill style.

The actual final compiled web bundle was verified against the H.264 control:

- Video element and containing stage both measured **390×629px**, at x=0/y=62, with `object-fit: contain`.
- Decoder dimensions were 540×1200, `readyState=4`, and no media error. Clicking Play changed the control to Pause, advanced time from 0 to approximately 0.98 seconds, and changed sampled opaque frame pixels. Clicking Pause stopped playback at approximately 1.07 seconds.
- Replies were absent initially. Clicking Comments opened the sheet; timed header positions moved from approximately y=1071 to y=352 to y=227, confirming the upward slide. Closing Replies removed the sheet again.
- The clean fixture run recorded zero browser page errors and zero console errors. Background home, alarm-policy, alarm-sound and purchase-review endpoints were supplied as local fixtures; no production calls were made.

Evidence is in `inspection/mobile_verification/video-play-h264-final.json`, `video-play-h264-final.png` and `video-play-h264-final-comments.png`; reproduction uses the temporary `inspection/video-play-check.cjs` harness based on root's existing compiled-web fixture harness. Physical-device source replacement, codec output, microphone/OS interruption and safe-area behavior remain device checks.
