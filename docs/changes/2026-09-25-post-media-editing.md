# Post media editing — 2026-09-25

## Scope

Add pre-publish editing for student feed attachments without changing post authorization, tenant boundaries, or private-file behavior.

## Behavior

- Selecting a post image opens the KampusOne crop editor before any upload.
- Post images support Original, 1:1, 4:5 and 16:9 crop ratios plus drag, zoom, reset, Save and Cancel.
- Selecting a post video opens a duration trimmer before any upload.
- Video trim handles enforce a one-second minimum and a 90-second maximum selection.
- The selected range can be previewed before Save.
- Native Android/iOS builds create a real MP4 trim; web creates a real WebM clip when the browser supports MediaRecorder/captureStream.
- Cancel returns to the composer without uploading the selected edit.
- The composer keeps its existing local preview, retry and draft-preservation behavior.
- Attached media exposes Edit so the crop/trim can be reopened before publishing.
- Final uploads remain capped by the existing 10 MB media limit. Source videos may be up to 100 MB so a user can select a larger source and trim it down locally first.

## Architecture

- Photo editing continues through the global photo edit session/host and now accepts post photos.
- Video editing uses a parallel global video edit session/host.
- Pure trim-range helpers remain dependency-free and are covered by the media regression test.
- Native trimming uses `react-native-video-trim`; Expo Go is not a supported runtime for that native module, so Android/iOS validation must use the existing development/EAS builds.
- Web trimming stays browser-local and does not send the untrimmed source to a processing provider.
- The Worker accepts WebM only for public post media, alongside the existing MP4 path. Private upload rules are unchanged.

## Acceptance checks

- Image: choose a photo, change crop ratio, drag/zoom, Save, verify edited preview, publish, and verify feed rendering.
- Image Cancel: choose a photo, Cancel editor, verify no attachment/upload is created.
- Video: choose a clip longer than the desired segment, move both handles, preview, Save, verify only the trimmed duration is attached, publish, and play it from the feed.
- Video Cancel: Cancel the trimmer and verify no attachment/upload is created.
- Retry: simulate upload failure and verify the edited local media remains available to retry or edit again.
- Web: verify a browser-produced WebM upload and byte-range playback.
- Native: verify Android and iOS development builds after the native dependency rebuild.
