# Kira voice input — 2026-09-27

## Scope

Kira now exposes an in-composer voice flow on mobile and web. The idle composer keeps attachment and info controls and adds a microphone. While recording, the attachment + position becomes a cancel X and the composer shows duration, a metered waveform, stop/save and use/transcribe controls.

## Behaviour

- Recording starts only after an explicit microphone tap.
- Cancel stops and discards the local recording.
- Stop ends the recording, immediately shows an animated `Transcribing…` state, then inserts the returned transcript into the editable Kira prompt without sending it.
- The arrow ends the recording, shows the same `Transcribing…` state, then automatically sends the returned text through Kira's normal chat send flow without requiring a second tap.
- Failed transcription keeps the local recording so the user can retry. After a failed stop-to-draft attempt, the stop control becomes a retry-transcription control.
- Recordings auto-stop at 120 seconds and are capped at 8 MB.
- Android capture uses Expo's high-quality preset, metering and the speech-recognition audio source.

## Provider and safety boundary

Speech-to-text stays server-side behind the existing Hugging Face adapter and uses `HF_TRANSCRIPTION_MODEL=openai/whisper-large-v3`. `HF_TOKEN` remains a Worker secret. Audio requests are authenticated, consent-gated, MIME-checked, size-limited, rate-limited and idempotent.

Completed voice requests use `mode='transcription'` and store `transcriptionText`, so they are excluded from normal Kira history queries, which require a saved `text` result. Provider errors are sanitized and the client retains the recording on failure.

The voice capability is advertised only when the AI experience and transcription provider are configured.
