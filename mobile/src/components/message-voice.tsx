import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  createAudioPlayer,
  type RecordingOptions,
  type AudioStatus,
  type AudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { VoiceDraft } from "@/src/lib/message-drafts";
import { ToolButton } from "./toolkit";
import { api, ApiError } from "@/src/lib/api";
import { createVoiceUploadQueue } from "@/src/lib/voice-upload";
import { createVoicePlaybackSession } from "@/src/lib/voice-playback";
import { recordActivityEvent } from "@/src/lib/activity-events";
import { renderFailureFingerprint } from "@/src/lib/render-diagnostics";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

const playbackListeners = new Set<(owner: object) => void>();

type PlaybackSpeed = 1 | 1.5 | 2;
const SPEEDS: PlaybackSpeed[] = [1, 1.5, 2];
const WAVE_BARS = [8, 14, 22, 12, 26, 18, 10, 24, 16, 28, 13, 20, 9, 25, 17, 12, 29, 15, 21, 11, 27, 18, 9, 23, 14, 26, 12, 19];
// Speech remains AAC/M4A on native, at 48 kbps instead of the 128 kbps stereo preset.
// Browsers use their supported MediaRecorder codec and the same target bitrate.
const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 24_000,
  numberOfChannels: 1,
  bitRate: 48_000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, sampleRate: 24_000 },
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, sampleRate: 24_000 },
  web: { ...RecordingPresets.HIGH_QUALITY.web, bitsPerSecond: 48_000 },
};
class VoiceInputError extends Error {}
function voiceErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError || caught instanceof VoiceInputError ? caught.message : fallback;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Waveform({
  progress = 0,
  recording = false,
  light = false,
}: {
  progress?: number;
  recording?: boolean;
  light?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const activeCount = recording
    ? Math.max(2, Math.floor(((Date.now() / 180) % WAVE_BARS.length)))
    : Math.round(Math.max(0, Math.min(1, progress)) * WAVE_BARS.length);

  return (
    <View pointerEvents="none" style={styles.waveform}>
      {WAVE_BARS.map((height, index) => (
        <View
          key={index}
          style={[
            styles.waveBar,
            { height: Math.max(5, height * 0.72) },
            {backgroundColor: light ? "rgba(255,255,255,.5)" : theme.deepBrand},
            index < activeCount && { backgroundColor: light ? "#fff" : theme.deepBrand, opacity: 1 },
          ]}
        />
      ))}
    </View>
  );
}

type MessageVoiceProps = {
  disabled: boolean;
  onReady: (id: string, name: string) => void | Promise<void>;
  onActiveChange?: (active: boolean) => void;
  compact?: boolean;
  initialDraft?: VoiceDraft | null;
  onDraftChange?: (draft: VoiceDraft | null) => void;
  onSendingChange?: (sending: boolean) => void;
};

class VoiceRecorderBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordActivityEvent('feature_failed', { screen: 'conversation', feature: 'message_recording', errorCode: renderFailureFingerprint(error, info.componentStack ?? '') });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <Pressable accessibilityRole="button" accessibilityLabel="Retry microphone" onPress={this.props.onRetry} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}><Text>Retry mic</Text></Pressable>;
  }
}

/** Browsing a chat or typing must never create or release a native recorder. */
export function MessageVoice(props: MessageVoiceProps) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!requested && !props.initialDraft) return <Pressable accessibilityRole="button" accessibilityLabel="Record voice note" disabled={props.disabled} onPress={() => setRequested(true)} style={({ pressed }) => [styles.micButton, (pressed || props.disabled) && styles.disabled]}><Ionicons name="mic-outline" size={22} color={theme.textMuted} /></Pressable>;
  return <VoiceRecorderBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)}><ActiveMessageVoice {...props} startOnMount={requested && !props.initialDraft} /></VoiceRecorderBoundary>;
}

function ActiveMessageVoice({
  disabled,
  onReady,
  onActiveChange,
  compact = false,
  initialDraft,
  onDraftChange,
  onSendingChange,
  startOnMount,
}: MessageVoiceProps & { startOnMount: boolean }) {
  const mounted = useRef(true);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const [state, setRecorderState] = useState({ isRecording: false, durationMillis: 0 });
  const [uri, setUri] = useState<string>(initialDraft?.uri ?? "");
  const [recordedDuration, setRecordedDuration] = useState(initialDraft?.durationMs ?? 0);
  const durationRef = useRef(0); durationRef.current = state.durationMillis;
  const draftRef = useRef(initialDraft);
  const recordingPending = useRef(false);
  const operationPending = useRef(false);
  const draftCallback = useRef(onDraftChange); draftCallback.current = onDraftChange;
  function publishDraft(nextUri?: string) {
    const existing = draftRef.current?.uri === nextUri ? draftRef.current : null;
    const next = nextUri ? { ...existing, localId: existing?.localId ?? Crypto.randomUUID(), uri: nextUri, durationMs: durationRef.current || existing?.durationMs || 0 } : null;
    draftRef.current = next;
    draftCallback.current?.(next);
  }
  useEffect(() => {
    if (initialDraft && !recordingPending.current) {
      draftRef.current = initialDraft;
      setUri(initialDraft.uri); setRecordedDuration(initialDraft.durationMs);
    }
  }, [initialDraft]);
  useEffect(() => { if (startOnMount) void startRecording(); }, []);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewSpeed, setPreviewSpeed] = useState<PlaybackSpeed>(1);
  const [error, setError] = useState("");
  const { theme, styles } = useThemeStyles(createStyles);
  const active = state.isRecording || paused || recordingPending.current || Boolean(uri);

  const uploadQueue = useRef(createVoiceUploadQueue(async (localUri: string) => {
      const source=Platform.OS==='web'?await(await fetch(localUri)).blob():new File(localUri);
      if(!source.size||source.size>10*1024*1024)throw new VoiceInputError('Record a shorter voice note.');
      const bytes=Platform.OS==='web'?source as Blob:await source.arrayBuffer();
      const name = Platform.OS === 'web' ? 'Voice-note.webm' : 'Voice-note.m4a';
      const result=await api<{id:string}>(`/v1/media?kind=message&name=${name}`,{method:'POST',body:bytes,headers:{'Content-Type':Platform.OS==='web'?(source as Blob).type||'audio/webm':'audio/mp4'},timeoutMs:60000});
      return result.id;
  }));
  async function uploadVoice(recording: VoiceDraft): Promise<string> {
    const mediaId = await uploadQueue.current.upload(recording);
    const current = draftRef.current;
    if (current?.uri === recording.uri && current.localId === recording.localId && current.mediaId !== mediaId) {
      const next = { ...current, mediaId };
      draftRef.current = next;
      draftCallback.current?.(next);
    }
    return mediaId;
  }

  // Upload while the student previews the recording, then sending only posts its reference.
  useEffect(() => {
    const recording = draftRef.current;
    if (uri && recording?.uri === uri && !recording.mediaId) void uploadVoice(recording).catch(() => undefined);
  }, [uri]);

  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", status => {
      if (status !== "active" && recordingPending.current) void finishRecording();
    });
    return () => {
      mounted.current = false;
      sub.remove();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (!recorder) return;
      // Stop before releasing. Late controls are blocked by mounted/ref checks.
      void (async () => {
        try {
          if (recordingPending.current) {
            await recorder.stop();
            const savedUri = recorder.uri;
            if (savedUri) publishDraft(savedUri);
          }
        } catch { /* The microphone may already have been interrupted by the OS. */ }
        finally {
          try { recorder.release(); } catch { /* Already released. */ }
        }
      })();
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!state.isRecording) return;
    const timer = setInterval(() => {
      const recorder = recorderRef.current;
      if (!mounted.current || !recorder) return;
      try { setRecorderState(recorder.getStatus()); }
      catch {
        recordingPending.current = false;
        setRecorderState(current => ({ ...current, isRecording: false }));
        setError("Recording was interrupted. Try recording again.");
      }
    }, 250);
    return () => clearInterval(timer);
  }, [state.isRecording]);

  useEffect(() => {
    if (state.isRecording && state.durationMillis >= 120_000) {
      void finishRecording();
    }
  }, [state.isRecording, state.durationMillis]);

  async function startRecording() {
    if (!mounted.current || operationPending.current || disabled) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    setSettingsOpen(false);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!mounted.current) return;
      if (!permission.granted) throw new VoiceInputError("Allow microphone access to record a voice note.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!mounted.current) return;
      let recorder = recorderRef.current;
      if (!recorder) {
        const { android, ios, web, ...common } = VOICE_RECORDING_OPTIONS;
        recorder = new AudioModule.AudioRecorder({ ...common, ...(Platform.OS === 'android' ? android : Platform.OS === 'ios' ? ios : web) });
        recorderRef.current = recorder;
      }
      await recorder.prepareToRecordAsync();
      if (!mounted.current) return;
      recorder.record();
      recordingPending.current = true;
      setRecorderState(recorder.getStatus());
      setPaused(false);
      setRecordedDuration(0);
      setUri(""); publishDraft();
      setPreviewSpeed(1);
    } catch (caught) {
      setError(voiceErrorMessage(caught, "Recording could not start. Check microphone access and try again."));
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }

  async function finishRecording() {
    const recorder = recorderRef.current;
    if (!mounted.current || !recorder || operationPending.current || !recordingPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    try {
      await recorder.stop();
      if (!mounted.current) return;
      recordingPending.current = false;
      setRecorderState(current => ({ ...current, isRecording: false }));
      setRecordedDuration(durationRef.current);
      setUri(recorder.uri ?? ""); publishDraft(recorder.uri ?? undefined);
      setPaused(false);
      await setAudioModeAsync({ allowsRecording: false });
    } catch (caught) {
      setError(voiceErrorMessage(caught, "Recording could not be saved. Try recording again."));
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }

  async function togglePause() {
    const recorder = recorderRef.current;
    if (!mounted.current || !recorder || busy) return;
    try {
      if (paused) {
        recorder.record();
        setPaused(false);
      } else {
        recorder.pause();
        setPaused(true);
      }
      setRecorderState(recorder.getStatus());
    } catch (caught) {
      setError(voiceErrorMessage(caught, "Could not pause the recording. Try again."));
    }
  }

  async function cancelRecording() {
    const recorder = recorderRef.current;
    if (!mounted.current || busy) return;
    setError("");
    try {
      if (recorder && recordingPending.current) await recorder.stop();
    } catch {
      // Reset the composer even if the native recorder has already stopped.
    } finally {
      recordingPending.current = false;
      if (!mounted.current) return;
      setRecorderState(current => ({ ...current, isRecording: false }));
      setUri(""); publishDraft();
      setRecordedDuration(0);
      setPaused(false);
      setSettingsOpen(false);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }

  async function rerecord() {
    await cancelRecording();
    await startRecording();
  }

  async function attach() {
    const recording = draftRef.current;
    if (operationPending.current || disabled || !uri || recording?.uri !== uri) return;
    operationPending.current = true;
    setBusy(true);
    onSendingChange?.(true);
    setError("");
    try {
      const mediaId = await uploadVoice(recording);
      await onReady(mediaId, "Voice note");
      setUri(""); publishDraft();
      setRecordedDuration(0);
      setSettingsOpen(false);
    } catch (caught) {
      setError(voiceErrorMessage(caught, "Voice note could not be sent. Your recording is kept. Try again."));
    } finally {
      operationPending.current = false;
      setBusy(false);
      onSendingChange?.(false);
    }
  }

  if (compact) {
    if (!active) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record voice note"
          disabled={disabled || busy}
          onPress={() => void startRecording()}
          style={({ pressed }) => [styles.micButton, (pressed || disabled || busy) && styles.disabled]}
        >
          <Ionicons name="mic-outline" size={22} color={theme.textMuted} />
        </Pressable>
      );
    }

    return (
      <View style={styles.compactWrapActive}>
        {settingsOpen && uri ? (
          <View style={styles.settingsSheet}>
            <View style={styles.settingsHeader}>
              <View>
                <Text style={styles.settingsTitle}>Voice note settings</Text>
                <Text style={styles.settingsSubtitle}>Preview and playback controls</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close voice note settings" onPress={() => setSettingsOpen(false)} style={styles.actionIcon}>
                <Ionicons name="close" size={19} color={theme.text} />
              </Pressable>
            </View>
            <Text style={styles.settingsLabel}>Playback speed</Text>
            <View style={styles.speedOptions}>
              {SPEEDS.map((speed) => (
                <Pressable
                  key={speed}
                  accessibilityRole="button"
                  accessibilityState={{ selected: previewSpeed === speed }}
                  onPress={() => setPreviewSpeed(speed)}
                  style={[styles.speedOption, previewSpeed === speed && styles.speedOptionSelected]}
                >
                  <Text style={[styles.speedOptionText, previewSpeed === speed && styles.speedOptionTextSelected]}>{speed}x</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.qualityRow}>
              <View style={styles.qualityIcon}><Ionicons name="sparkles-outline" size={16} color={theme.deepBrand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qualityTitle}>Recording quality</Text>
                <Text style={styles.qualityText}>Clear speech · smaller upload</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color={theme.deepBrand} />
            </View>
          </View>
        ) : null}

        {uri ? (
          <View style={styles.voiceDraft}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voice note settings"
              onPress={() => setSettingsOpen((value) => !value)}
              style={styles.settingsButton}
            >
              <Ionicons name="settings-outline" size={18} color="#FFFFFF" />
            </Pressable>
            <View style={styles.voicePreview}>
              <VoicePlayback uri={uri} compact speed={previewSpeed} onSpeedChange={setPreviewSpeed} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard voice note"
              disabled={busy}
              onPress={() => void cancelRecording()}
              style={({ pressed }) => [styles.actionIcon, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Ionicons name="trash-outline" size={20} color={theme.error} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record voice note again"
              disabled={busy}
              onPress={() => void rerecord()}
              style={({ pressed }) => [styles.actionIcon, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Ionicons name="refresh" size={21} color={theme.deepBrand} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send voice note"
              disabled={disabled || busy}
              onPress={() => void attach()}
              style={({ pressed }) => [styles.sendVoice, (pressed || disabled || busy) && styles.disabled]}
            >
              <Ionicons name={busy ? "cloud-upload-outline" : "send"} size={19} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.recordingBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Discard recording" disabled={busy} onPress={() => void cancelRecording()} style={styles.actionIcon}>
              <Ionicons name="trash-outline" size={20} color={theme.error} />
            </Pressable>
            <View style={styles.recordingStatus}>
              <Waveform recording={!paused} />
              <Text accessibilityLiveRegion="polite" style={styles.recordingTime}>{formatDuration(state.durationMillis / 1000)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop recording" disabled={busy} onPress={() => void finishRecording()} style={styles.stopButton}>
              <Ionicons name="stop" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
        {error ? <Text accessibilityRole="alert" style={styles.compactError}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {!active ? <ToolButton secondary disabled={disabled || busy} label="Record voice note" onPress={() => void startRecording()} /> : null}
      {state.isRecording || paused ? (
        <View style={styles.recordingBar}>
          <View style={styles.recordingStatus}><Waveform recording={!paused} /><Text style={styles.recordingTime}>{formatDuration(state.durationMillis / 1000)}</Text></View>
          <Pressable onPress={() => void togglePause()} style={styles.recordControl}><Ionicons name={paused ? "play" : "pause"} size={18} color="#FFFFFF" /></Pressable>
          <Pressable onPress={() => void finishRecording()} style={styles.stopButton}><Ionicons name="stop" size={17} color="#FFFFFF" /></Pressable>
        </View>
      ) : null}
      {uri ? (
        <>
          <VoicePlayback uri={uri} speed={previewSpeed} onSpeedChange={setPreviewSpeed} />
          <ToolButton disabled={disabled || busy} secondary label={busy ? "Sending voice note…" : "Send voice note"} onPress={() => void attach()} />
          <ToolButton secondary disabled={busy} label="Discard recording" onPress={() => void cancelRecording()} />
        </>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{error}</Text> : null}
    </View>
  );
}

export function VoicePlayback({
  uri = "",
  loadUri,
  compact = false,
  speed: controlledSpeed,
  onSpeedChange,
  mine = false,
  onLongPress,
}: {
  uri?: string;
  loadUri?: () => Promise<string>;
  compact?: boolean;
  speed?: PlaybackSpeed;
  onSpeedChange?: (speed: PlaybackSpeed) => void;
  mine?: boolean;
  onLongPress?: (event: GestureResponderEvent) => void;
}) {
  const [state, setState] = useState<Partial<AudioStatus>>({});
  const identity = useRef({}).current;
  const [wantPlay, setWantPlay] = useState(false);
  const [playError, setPlayError] = useState("");
  const scrubHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubStart = useRef(0);
  const scrubHeld = useRef(false);
  const [localSpeed, setLocalSpeed] = useState<PlaybackSpeed>(1);
  const [waveWidth, setWaveWidth] = useState(1);
  const { theme, styles } = useThemeStyles(createStyles);
  const speed = controlledSpeed ?? localSpeed;
  const duration = Math.max(0, state.duration || 0);
  const current = Math.max(0, state.currentTime || 0);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const sessionRef = useRef<ReturnType<typeof createVoicePlaybackSession> | null>(null);

  useEffect(() => {
    const session = createVoicePlaybackSession({
      createPlayer: source => createAudioPlayer(source, { updateInterval: 250 }),
      prepareAudio: () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }),
      onStatus: setState,
      onLoading: setWantPlay,
      onError: message => {
        setPlayError(message);
        if (message) recordActivityEvent('feature_failed', { screen: 'conversation', feature: 'voice_playback', errorCode: 'VOICE_PLAYBACK_FAILED' });
      },
    });
    sessionRef.current = session;
    const stop = (owner: object) => { if (owner !== identity) session.stop(); };
    playbackListeners.add(stop);
    const app = AppState.addEventListener("change", status => { if (status !== "active") session.stop(); });
    return () => {
      if (scrubHold.current) clearTimeout(scrubHold.current);
      playbackListeners.delete(stop);
      app.remove();
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [identity, uri, loadUri]);

  useEffect(() => { sessionRef.current?.setSpeed(speed); }, [speed, uri, loadUri]);

  const setSpeed = (value: PlaybackSpeed) => {
    if (onSpeedChange) onSpeedChange(value);
    else setLocalSpeed(value);
    sessionRef.current?.setSpeed(value);
  };
  const cycleSpeed = () => setSpeed(speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1);
  const toggle = () => {
    playbackListeners.forEach(listener => listener(identity));
    void sessionRef.current?.toggle(() => loadUri ? loadUri() : uri);
  };
  const seekFromX = (x: number) => {
    if (!duration || !waveWidth) return;
    const ratio = Math.max(0, Math.min(1, x / waveWidth));
    void sessionRef.current?.seek(duration * ratio);
  };

  const playerUi = (
    <View style={[styles.playbackShell, compact && styles.playbackShellCompact]}>
      <Pressable accessibilityRole="button" accessibilityLabel={wantPlay || state.isBuffering ? "Loading voice note" : state.playing ? "Pause voice note" : "Play voice note"} onLongPress={onLongPress} delayLongPress={350} onPress={toggle} style={styles.playButton}>
        <Ionicons name={wantPlay || state.isBuffering ? "hourglass-outline" : state.playing ? "pause" : "play"} size={compact ? 17 : 19} color={theme.deepBrand} />
      </Pressable>
      <View style={styles.playbackMiddle}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Voice note playback position"
          onLayout={(event) => setWaveWidth(Math.max(1, event.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(event) => {scrubStart.current=event.nativeEvent.locationX;scrubHeld.current=false;const snapshot={...event,nativeEvent:{...event.nativeEvent}};scrubHold.current=setTimeout(()=>{scrubHeld.current=true;onLongPress?.(snapshot);},350);}}
          onResponderMove={(event) => {if(Math.abs(event.nativeEvent.locationX-scrubStart.current)>6){if(scrubHold.current)clearTimeout(scrubHold.current);if(!scrubHeld.current)seekFromX(event.nativeEvent.locationX);}}}
          onResponderRelease={(event)=>{if(scrubHold.current)clearTimeout(scrubHold.current);if(!scrubHeld.current)seekFromX(event.nativeEvent.locationX);}}
          onResponderTerminate={()=>{if(scrubHold.current)clearTimeout(scrubHold.current);}}
          style={styles.scrubber}
        >
          <Waveform progress={progress} light={mine} />
        </View>
        <Text style={[styles.playbackTime, mine && {color:"#fff"}]}>{wantPlay || state.isBuffering ? "Loading…" : formatDuration(state.playing || current > 0 ? current : duration)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${speed}x`} onPress={cycleSpeed} onLongPress={onLongPress} delayLongPress={350} style={styles.speedButton}>
        <Text style={styles.speedText}>{speed}x</Text>
      </Pressable>
    </View>
  );

  if (compact) return <View>{playerUi}{playError ? <Text accessibilityRole="alert" style={[styles.compactError, mine && {color:"#fff",backgroundColor:"transparent"}]}>{playError}</Text> : null}</View>;
  return <View style={styles.fullPlayback}>{playerUi}{playError ? <Text accessibilityRole="alert" style={styles.compactError}>{playError}</Text> : null}</View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  compactWrapActive: { flex: 1, minWidth: 0, alignItems: "stretch", position: "relative" },
  micButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  recordingBar: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 5, paddingVertical: 5, backgroundColor: theme.surfaceMuted },
  recordingStatus: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  recordingTime: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, minWidth: 34, textAlign: "right" },
  recordControl: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  stopButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  voiceDraft: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 5, paddingVertical: 5, backgroundColor: theme.surfaceMuted },
  voicePreview: { flex: 1, minWidth: 0 },
  settingsButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  actionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sendVoice: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  settingsSheet: { position: "absolute", left: 0, right: 0, bottom: 66, zIndex: 20, borderRadius: 18, padding: 14, gap: 11, backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  settingsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  settingsTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  settingsSubtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, marginTop: 2 },
  settingsLabel: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
  speedOptions: { flexDirection: "row", gap: 6 },
  speedOption: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: theme.surfaceMuted },
  speedOptionSelected: { backgroundColor: theme.deepBrand },
  speedOptionText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 12 },
  speedOptionTextSelected: { color: "#FFFFFF" },
  qualityRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 2 },
  qualityIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  qualityTitle: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
  qualityText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, marginTop: 1 },
  playbackShell: { minWidth: 220, minHeight: 50, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 18, paddingHorizontal: 6, paddingVertical: 5, backgroundColor: theme.surfaceMuted },
  playbackShellCompact: { minWidth: 0, width: "100%", backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: 0 },
  fullPlayback: { alignSelf: "stretch" },
  playButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  playbackMiddle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  scrubber: { flex: 1, minWidth: 72, minHeight: 34, justifyContent: "center" },
  waveform: { height: 32, flexDirection: "row", alignItems: "center", gap: 2, overflow: "hidden" },
  waveBar: { width: 2.4, maxHeight: 28, borderRadius: 2, backgroundColor: theme.textFaint, opacity: 0.6 },
  playbackTime: { minWidth: 30, color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10, textAlign: "right" },
  speedButton: { minWidth: 34, height: 30, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  speedText: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 10 },
  compactError: { marginTop: 5, color: theme.error, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, backgroundColor: theme.surface, borderRadius: 10, padding: 8 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },
});
