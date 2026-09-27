import { useEffect, useState } from "react";
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
import { ToolButton } from "./toolkit";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

const WAVEFORM = [8, 16, 24, 14, 28, 18, 10, 22, 30, 16, 12, 26, 20, 9, 18, 28, 14, 24, 11, 20, 30, 16, 9, 23];

function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Waveform({
  progress,
  activeColor,
  inactiveColor,
  compact = false,
}: {
  progress: number;
  activeColor: string;
  inactiveColor: string;
  compact?: boolean;
}) {
  const activeBars = Math.round(Math.max(0, Math.min(1, progress)) * WAVEFORM.length);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[stylesStatic.waveform, compact && stylesStatic.waveformCompact]}
    >
      {WAVEFORM.map((height, index) => (
        <View
          key={index}
          style={{
            width: 3,
            height: compact ? Math.max(6, Math.round(height * 0.82)) : height,
            borderRadius: 2,
            backgroundColor: index < activeBars ? activeColor : inactiveColor,
          }}
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
}: {
  disabled: boolean;
  onReady: (id: string, name: string) => void | Promise<void>;
  onActiveChange?: (active: boolean) => void;
  compact?: boolean;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [uri, setUri] = useState<string>();
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { theme, styles } = useThemeStyles(createStyles);
  const active = state.isRecording || Boolean(uri);

  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  useEffect(() => {
    const stop = async () => {
      if (recorder.isRecording) {
        await recorder.stop();
        setRecordedDuration(state.durationMillis);
        setUri(recorder.uri ?? undefined);
      }
      await setAudioModeAsync({ allowsRecording: false });
    };
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") void stop().catch(() => undefined);
    });
    return () => {
      sub.remove();
      if (recorder.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    };
  }, [recorder]);

  useEffect(() => {
    if (state.isRecording && state.durationMillis >= 120_000) {
      void recorder.stop().then(() => {
        setRecordedDuration(state.durationMillis);
        setUri(recorder.uri ?? undefined);
        return setAudioModeAsync({ allowsRecording: false });
      }).catch(() => setError("Recording could not be saved."));
    }
  }, [state.isRecording, state.durationMillis, recorder]);

  async function record() {
    setBusy(true);
    setError("");
    try {
      if (state.isRecording) {
        await recorder.stop();
        setRecordedDuration(state.durationMillis);
        setUri(recorder.uri ?? undefined);
        await setAudioModeAsync({ allowsRecording: false });
      } else {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error("Allow microphone access to record a voice note.");
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setRecordedDuration(0);
        setUri(undefined);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRecording() {
    if (busy) return;
    setError("");
    try {
      if (state.isRecording) await recorder.stop();
    } catch {
      // Discarding should still reset the local composer even if the native recorder already stopped.
    } finally {
      setUri(undefined);
      setRecordedDuration(0);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }

  async function attach() {
    if (!uri) return;
    setBusy(true);
    setError("");
    try {
      const body = Platform.OS === "web" ? await (await fetch(uri)).blob() : new File(uri) as unknown as Blob;
      if (body.size > 10 * 1024 * 1024) throw new Error("Record a shorter voice note.");
      const result = await api<{ id: string }>("/v1/media?kind=message&name=Voice-note.m4a", {
        method: "POST",
        body,
        headers: { "Content-Type": Platform.OS === "web" ? body.type || "audio/webm" : "audio/mp4" },
      });
      await onReady(result.id, "Voice note");
      setUri(undefined);
      setRecordedDuration(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed. Your recording is kept.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <View style={[styles.compactWrap, active && styles.compactWrapActive]}>
        {uri ? (
          <View style={styles.voiceDraft}>
            <VoicePlayback uri={uri} compact stretch />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard voice note"
              disabled={busy}
              onPress={() => void cancelRecording()}
              style={({ pressed }) => [styles.actionIcon, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Ionicons name="trash-outline" size={19} color={theme.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send voice note"
              disabled={disabled || busy}
              onPress={() => void attach()}
              style={({ pressed }) => [styles.sendVoice, (pressed || disabled || busy) && styles.disabled]}
            >
              <Ionicons name={busy ? "cloud-upload-outline" : "send"} size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : state.isRecording ? (
          <View style={styles.recordingBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel voice recording"
              disabled={busy}
              onPress={() => void cancelRecording()}
              style={({ pressed }) => [styles.actionIcon, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={22} color={theme.textMuted} />
            </Pressable>
            <View style={styles.recordingStatus}>
              <View style={styles.recordingDot} />
              <Waveform compact progress={1} activeColor={theme.deepBrand} inactiveColor={theme.border} />
              <Text accessibilityLiveRegion="polite" style={styles.recordingTime}>{formatAudioTime(state.durationMillis / 1000)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop recording voice note"
              disabled={disabled || busy}
              onPress={() => void record()}
              style={({ pressed }) => [styles.stopButton, (pressed || disabled || busy) && styles.disabled]}
            >
              <Ionicons name="stop" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record voice note"
            disabled={disabled || busy}
            onPress={() => void record()}
            style={({ pressed }) => [styles.micButton, (pressed || disabled || busy) && styles.disabled]}
          >
            <Ionicons name="mic-outline" size={21} color={theme.textMuted} />
          </Pressable>
        )}
        {error ? <Text accessibilityRole="alert" style={styles.compactError}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <ToolButton
        secondary
        disabled={disabled || busy}
        label={state.isRecording ? `Stop recording · ${formatAudioTime(state.durationMillis / 1000)}` : "Record voice note"}
        onPress={() => void record()}
      />
      {uri ? (
        <>
          <VoicePlayback uri={uri} />
          <ToolButton disabled={disabled || busy} secondary label={busy ? "Uploading voice note…" : "Attach voice note"} onPress={() => void attach()} />
          <ToolButton secondary disabled={busy} label="Discard recording" onPress={() => setUri(undefined)} />
        </>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{error}</Text> : null}
    </View>
  );
}

export function VoicePlayback({
  uri,
  compact = false,
  mine = false,
  stretch = false,
}: {
  uri: string;
  compact?: boolean;
  mine?: boolean;
  stretch?: boolean;
}) {
  const player = useAudioPlayer(uri);
  const state = useAudioPlayerStatus(player);
  const { theme, styles } = useThemeStyles(createStyles);
  const duration = Math.max(0, state.duration || 0);
  const currentTime = Math.max(0, state.currentTime || 0);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const toggle = () => {
    if (state.playing) {
      player.pause();
      return;
    }
    if (state.didJustFinish || (duration > 0 && currentTime >= duration - 0.05)) {
      void player.seekTo(0);
    }
    player.play();
  };

  if (compact) {
    const activeColor = mine ? "#FFFFFF" : theme.deepBrand;
    const inactiveColor = mine ? "rgba(255,255,255,0.34)" : theme.border;
    return (
      <View
        accessibilityLabel={`Voice note ${formatAudioTime(duration)}`}
        style={[
          styles.compactPlayer,
          mine && styles.compactPlayerMine,
          stretch && styles.compactPlayerStretch,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.playing ? "Pause voice note" : "Play voice note"}
          onPress={toggle}
          style={({ pressed }) => [styles.playerPlay, mine && styles.playerPlayMine, pressed && styles.pressed]}
        >
          <Ionicons
            name={state.playing ? "pause" : "play"}
            size={17}
            color={mine ? theme.deepBrand : "#FFFFFF"}
            style={!state.playing ? { marginLeft: 2 } : undefined}
          />
        </Pressable>
        <View style={styles.playerWave}>
          <Waveform compact progress={progress} activeColor={activeColor} inactiveColor={inactiveColor} />
        </View>
        <Text style={[styles.playerTime, mine && styles.playerTimeMine]}>
          {state.playing || currentTime > 0 ? formatAudioTime(currentTime) : formatAudioTime(duration)}
        </Text>
      </View>
    );
  }
  return <ToolButton secondary label={state.playing ? "Pause audio" : "Play audio"} onPress={toggle} />;
}

const stylesStatic = StyleSheet.create({
  waveform: {
    flex: 1,
    minWidth: 0,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 1,
  },
  waveformCompact: { height: 26 },
});

const createStyles = (theme: Theme) => StyleSheet.create({
  compactWrap: { alignItems: "flex-end", justifyContent: "center" },
  compactWrapActive: { flex: 1, minWidth: 0, alignItems: "stretch" },
  recordingBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 24,
    paddingHorizontal: 5,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  recordingStatus: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.deepBrand },
  recordingTime: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11, minWidth: 32, textAlign: "right" },
  micButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  voiceDraft: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 24,
    paddingHorizontal: 5,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  actionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stopButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  sendVoice: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  compactPlayer: {
    minWidth: 218,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 7,
    borderRadius: 24,
  },
  compactPlayerMine: { backgroundColor: "rgba(255,255,255,0.08)" },
  compactPlayerStretch: { flex: 1, minWidth: 0 },
  playerPlay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.deepBrand,
  },
  playerPlayMine: { backgroundColor: "#FFFFFF" },
  playerWave: { flex: 1, minWidth: 92 },
  playerTime: { minWidth: 31, color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10, textAlign: "right" },
  playerTimeMine: { color: "rgba(255,255,255,0.82)" },
  compactError: { position: "absolute", right: 0, bottom: 50, width: 220, color: theme.error, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, backgroundColor: theme.surface, borderRadius: 10, padding: 8 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },
});
