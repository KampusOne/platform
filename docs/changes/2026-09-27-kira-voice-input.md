# Kira voice input — 2026-09-27

## Scope

Kira now exposes an in-composer voice flow on mobile and web. The idle composer keeps attachment and info controls and adds a microphone. While recording, the attachment + position becomes a cancel X and the composer shows duration, a metered waveform, stop/save and use/transcribe controls.

## Behaviour

- Recording starts only after an explicit microphone tap.
- Cancel stops and discards the local recording.
- Stop saves the local recording without sending anything.
- The arrow sends only the recording for speech-to-text. The returned transcript is inserted into the editable Kira prompt and is not automatically sent as a chat.
- Failed transcription keeps the local recording so the user can retry.
- Recordings auto-stop at 120 seconds and are capped at 8 MB.
- Android capture uses Expo's high-quality preset, metering and the speech-recognition audio source.

## Provider and safety boundary

Speech-to-text stays server-side behind the existing Hugging Face adapter and uses `HF_TRANSCRIPTION_MODEL=openai/whisper-large-v3`. `HF_TOKEN` remains a Worker secret. Audio requests are authenticated, consent-gated, MIME-checked, size-limited, rate-limited and idempotent.

Completed voice requests use `mode='transcription'` and store `transcriptionText`, so they are excluded from normal Kira history queries, which require a saved `text` result. Provider errors are sanitized and the client retains the recording on failure.

The voice capability is advertised only when the AI experience and transcription provider are configured.
