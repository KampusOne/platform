import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { VoiceDraft } from "@/src/lib/message-drafts";
import { ToolButton } from "./toolkit";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

type PlaybackSpeed = 1 | 1.5 | 2;
const SPEEDS: PlaybackSpeed[] = [1, 1.5, 2];
const WAVE_BARS = [8, 14, 22, 12, 26, 18, 10, 24, 16, 28, 13, 20, 9, 25, 17, 12, 29, 15, 21, 11, 27, 18, 9, 23, 14, 26, 12, 19];

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Waveform({
  progress = 0,
  recording = false,
}: {
  progress?: number;
  recording?: boolean;
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
            index < activeCount && { backgroundColor: theme.deepBrand, opacity: 1 },
          ]}
        />
      ))}
    </View>
  );
}

export function MessageVoice({
  disabled,
  onReady,
  onActiveChange,
  compact = false,
  initialDraft,
  onDraftChange,
}: {
  disabled: boolean;
  onReady: (id: string, name: string) => void | Promise<void>;
  onActiveChange?: (active: boolean) => void;
  compact?: boolean;
  initialDraft?: VoiceDraft | null;
  onDraftChange?: (draft: VoiceDraft | null) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 120);
  const [uri, setUri] = useState<string>(initialDraft?.uri ?? "");
  const [recordedDuration, setRecordedDuration] = useState(initialDraft?.durationMs ?? 0);
  const durationRef = useRef(0); durationRef.current = state.durationMillis;
  const draftRef = useRef(initialDraft);
  const recordingPending = useRef(false);
  const draftCallback = useRef(onDraftChange); draftCallback.current = onDraftChange;
  function publishDraft(nextUri?: string) {
    const next = nextUri ? { localId: draftRef.current?.uri === nextUri ? draftRef.current.localId : Crypto.randomUUID(), uri: nextUri, durationMs: durationRef.current } : null;
    draftRef.current = next;
    draftCallback.current?.(next);
  }
  useEffect(() => {
    if (initialDraft && !recorder.isRecording) {
      draftRef.current = initialDraft;
      setUri(initialDraft.uri); setRecordedDuration(initialDraft.durationMs);
    }
  }, [initialDraft, recorder]);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewSpeed, setPreviewSpeed] = useState<PlaybackSpeed>(1);
  const [error, setError] = useState("");
  const { theme, styles } = useThemeStyles(createStyles);
  const active = state.isRecording || Boolean(uri);

  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  useEffect(() => {
    const stop = async () => {
      if (recorder.isRecording || recordingPending.current) {
        await recorder.stop();
        recordingPending.current = false;
        setRecordedDuration(durationRef.current);
        setUri(recorder.uri ?? "");
        publishDraft(recorder.uri ?? undefined);
      }
      setPaused(false);
      await setAudioModeAsync({ allowsRecording: false });
    };
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") void stop().catch(() => undefined);
    });
    return () => {
      sub.remove();
      if (recorder.isRecording || recordingPending.current) void recorder.stop().then(() => {
        recordingPending.current = false;
        publishDraft(recorder.uri ?? undefined);
      }).catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    };
  }, [recorder]);

  useEffect(() => {
    if (state.isRecording && state.durationMillis >= 120_000) {
      void finishRecording();
    }
  }, [state.isRecording, state.durationMillis]);

  async function startRecording() {
    setBusy(true);
    setError("");
    setSettingsOpen(false);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Allow microphone access to record a voice note.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingPending.current = true;
      setPaused(false);
      setRecordedDuration(0);
      setUri(""); publishDraft();
      setPreviewSpeed(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording failed.");
    } finally {
      setBusy(false);
    }
  }

  async function finishRecording() {
    if (!recorder.isRecording && !paused) return;
    setBusy(true);
    setError("");
    try {
      await recorder.stop();
      recordingPending.current = false;
      setRecordedDuration(state.durationMillis);
      setUri(recorder.uri ?? ""); publishDraft(recorder.uri ?? undefined);
      setPaused(false);
      await setAudioModeAsync({ allowsRecording: false });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (busy) return;
    try {
      if (paused) {
        recorder.record();
        setPaused(false);
      } else {
        recorder.pause();
        setPaused(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not pause the recording.");
    }
  }

  async function cancelRecording() {
    if (busy) return;
    setError("");
    try {
      if (state.isRecording || paused || recordingPending.current) await recorder.stop();
    } catch {
      // Reset the composer even if the native recorder has already stopped.
    } finally {
      recordingPending.current = false;
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
    if (!uri) return;
    setBusy(true);
    setError("");
    try {
      let mediaId = initialDraft?.mediaId;
      if (!mediaId) {
        const body = Platform.OS === "web" ? await (await fetch(uri)).blob() : new File(uri) as unknown as Blob;
        if (body.size > 10 * 1024 * 1024) throw new Error("Record a shorter voice note.");
        mediaId = (await api<{ id: string }>("/v1/media?kind=message&name=Voice-note.m4a", {
          method: "POST", body,
          headers: { "Content-Type": Platform.OS === "web" ? body.type || "audio/webm" : "audio/mp4" },
          timeoutMs: 180_000,
        })).id;
      }
      await onReady(mediaId, "Voice note");
      setUri(""); publishDraft();
      setRecordedDuration(0);
      setSettingsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Voice note could not be sent. Your recording is kept.");
    } finally {
      setBusy(false);
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
                <Text style={styles.qualityText}>High quality audio</Text>
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
            <Pressable accessibilityRole="button" accessibilityLabel={paused ? "Resume recording" : "Pause recording"} disabled={busy} onPress={() => void togglePause()} style={styles.recordControl}>
              <Ionicons name={paused ? "play" : "pause"} size={18} color="#FFFFFF" />
            </Pressable>
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
  uri,
  compact = false,
  speed: controlledSpeed,
  onSpeedChange,
}: {
  uri: string;
  compact?: boolean;
  speed?: PlaybackSpeed;
  onSpeedChange?: (speed: PlaybackSpeed) => void;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const state = useAudioPlayerStatus(player);
  const [localSpeed, setLocalSpeed] = useState<PlaybackSpeed>(1);
  const [waveWidth, setWaveWidth] = useState(1);
  const { theme, styles } = useThemeStyles(createStyles);
  const speed = controlledSpeed ?? localSpeed;
  const duration = Math.max(0, state.duration || 0);
  const current = Math.max(0, state.currentTime || 0);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  useEffect(() => {
    player.setPlaybackRate(speed);
    player.shouldCorrectPitch = true;
  }, [player, speed]);

  const setSpeed = (value: PlaybackSpeed) => {
    if (onSpeedChange) onSpeedChange(value);
    else setLocalSpeed(value);
    player.setPlaybackRate(value);
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
  };

  const toggle = () => {
    if (state.playing) player.pause();
    else {
      if (state.didJustFinish || (duration > 0 && current >= duration - 0.05)) void player.seekTo(0);
      player.play();
    }
  };

  const seekFromX = (x: number) => {
    if (!duration || !waveWidth) return;
    const ratio = Math.max(0, Math.min(1, x / waveWidth));
    void player.seekTo(duration * ratio);
  };

  const playerUi = (
    <View style={[styles.playbackShell, compact && styles.playbackShellCompact]}>
      <Pressable accessibilityRole="button" accessibilityLabel={state.playing ? "Pause voice note" : "Play voice note"} onPress={toggle} style={styles.playButton}>
        <Ionicons name={state.playing ? "pause" : "play"} size={compact ? 17 : 19} color={theme.deepBrand} />
      </Pressable>
      <View style={styles.playbackMiddle}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Voice note playback position"
          onLayout={(event) => setWaveWidth(Math.max(1, event.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(event) => seekFromX(event.nativeEvent.locationX)}
          onResponderMove={(event) => seekFromX(event.nativeEvent.locationX)}
          style={styles.scrubber}
        >
          <Waveform progress={progress} />
        </View>
        <Text style={styles.playbackTime}>{formatDuration(state.playing || current > 0 ? current : duration)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${speed}x`} onPress={cycleSpeed} style={styles.speedButton}>
        <Text style={styles.speedText}>{speed}x</Text>
      </Pressable>
    </View>
  );

  if (compact) return playerUi;
  return <View style={styles.fullPlayback}>{playerUi}</View>;
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
