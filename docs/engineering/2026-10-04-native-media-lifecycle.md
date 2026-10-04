# Native media recovery-screen investigation

The repeated screen recovery has a reproducible native-object lifetime failure.
The baseline is `690fc6b283d05b759060220df7c5ca4997c0daae`.

Expo SDK 57's `useVideoPlayer` uses `useReleasingSharedObject`, which registers a
passive cleanup that releases the native player. The app registers its own
passive cleanups later. In a virtualized feed cell, player release therefore
precedes `onPlaybackHandle(null)`. That callback used to call the old handle's
`setViewportVisible(false)`, read `player.playing`, and call `player.pause()` on
the released object. The full-screen viewer had the same issue in source,
timer and navigation-focus cleanup. Android raises a plain `Error` with
`Cannot use shared object that was already released`, previously classified as
`UI_ERROR_UNKNOWN`. A cleanup exception can reach the navigator boundary while
the user is navigating to an unrelated destination.

The regression harness executes the real transpiled components with a native
proxy that throws on all reads/writes after release, and with layout cleanup
before passive cleanup. Against the baseline, both feed and full-screen tests
fail with that exact native error. With the lifetime fixes they pass with zero
accesses after release, including queued viewability, route, timer and app-state
callbacks. Active playback exceptions remain observable; the error boundary is
retained.

Each player now has a separate lifetime invalidated in layout cleanup before
Expo releases it. Full-screen cleanup saves the last JavaScript playback
snapshot. Feed handle removal does only bookkeeping. Managed feed videos expose
a measurable placeholder before creating their native player; visibility
activates the source while preserving its aspect ratio and playback controls.
Recorder and audio playback no longer initialize native objects merely because
the student opens a chat or Kira. Chat voice notes render their final waveform
immediately, and obtain private URLs/players only when Play is pressed.

Native message uploading had a separate memory hazard: Expo `File.slice()` calls
`bytesSync()` on the whole file before slicing. Reading each 5 MB part of a large
video therefore repeatedly allocated the whole video. Uploads now use bounded
`FileHandle.readBytes()` and close the handle in `finally`, retaining retry and
resume behavior.

Render diagnostics distinguish released native objects, missing native modules
and invalid native text children, and include a component fingerprint. Uploaded
events/logs contain neither raw exception text nor stack paths/private media
URLs.

Validation:

```sh
node --test tests/native-media-teardown.test.mjs tests/render-diagnostics.test.mjs
NATIVE_MEDIA_SOURCE_REF=690fc6b283d05b759060220df7c5ca4997c0daae node --test tests/native-media-teardown.test.mjs
```

The baseline command deliberately fails the two teardown regressions and skips
the lazy-wrapper test, since that wrapper was introduced after the baseline. Additional
voice-playback and message-upload regressions live under `server/tests`.
The harness verifies JavaScript/native lifetime contracts. It does not substitute
for installing the release APK and exercising real Android media codecs,
microphone permissions, background interruption and scrolling.
