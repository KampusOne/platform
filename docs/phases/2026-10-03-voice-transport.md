# Voice message transport follow-up — 3 October 2026

## Implemented

- Native recordings use the installed Expo Audio SDK's supported AAC/M4A options: mono, 24 kHz, target 48 kbps, compared with the previous 44.1 kHz stereo / 128 kbps preset. Web retains its supported MediaRecorder format at a 48 kbps target. The encoder and device determine the final file properties.
- Preview starts a background upload. Sending shares that exact upload promise rather than uploading again. Upload results are bound to both recording URI and local recording ID, so discarded recordings finishing late cannot replace another recording's media reference.
- Successful preuploads publish `mediaId` into the durable voice draft. Restored drafts reuse that reference without rereading or reuploading their file. Updating recording metadata preserves its existing local ID, message retry ID and reply target.
- A synchronous operation guard prevents double tapping Send or overlapping recorder operations before React updates the buttons. Voice pending state locks other composer actions and scrolls the outgoing pending bubble into view immediately.
- The original voice message ID, media ID and reply target are persisted before posting. A failed or interrupted request retains them for an idempotent retry. Existing server ownership checks and message-ID conflict checks remain in force.
- On a successful or replayed POST, the conversation renders the confirmed audio message directly from that response. It no longer waits for a complete thread GET and read-receipt PUT. The existing background poll reconciles subsequent delivery and read state.
- Recorder instances and callbacks are scoped to their account/thread. A late upload or send from a previous conversation cannot change the active thread's sending/error state. Its recording callback still persists to the original thread.
- Native recorder exceptions use actionable generic copy. Known permission/size errors and safe API errors retain their useful messages; raw native diagnostic strings are not shown.

## Verification

- `cd mobile && npm run check` passed.
- `cd server && npx vitest run src/routes/ai.test.ts tests/voice-upload.test.ts tests/message-drafts.test.ts`: 3 suites, 29 tests passed.
- New pure transport tests exercise shared preupload/send promises, reversed completion order, reused recorder URIs with different recording IDs, restored uploaded references, and retry after an upload rejects. Existing durable-draft tests exercise retained voice files and their message/media retry metadata.
- `git diff --check` passed for edited files.

The existing AI route unit fixtures were also updated for the new explanation quota and import reservation. Replacing `clearAllMocks` with `resetAllMocks` prevents unconsumed one-shot mock responses leaking into the next test. Provider authentication failures still terminate without fallback.

## Device verification still required

The workspace cannot exercise an actual microphone, native permission prompts, iOS audio interruptions, background recorder stop behavior or physical-device codec output. Check those on iOS and Android, and check supported browser MediaRecorder output. Actual upload and post latency depend on the connection; these changes remove duplicate upload/reload waits and provide an immediate pending bubble, without promising instant network delivery. No credentials, production data, live provider calls, commits or deployment were used.
