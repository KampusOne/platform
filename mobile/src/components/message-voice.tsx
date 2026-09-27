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
            <VoicePlayback uri={uri} compact />
            <View style={styles.voiceDraftCopy}>
              <Text numberOfLines={1} style={styles.voiceDraftText}>Voice note</Text>
              <Text style={styles.voiceDraftMeta}>{Math.max(1, Math.round(recordedDuration / 1000))}s</Text>
            </View>
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
              <Text accessibilityLiveRegion="polite" style={styles.recordingTime}>{Math.floor(state.durationMillis / 1000)}s</Text>
              <Text style={styles.recordingLabel}>Recording voice note</Text>
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
        label={state.isRecording ? `Stop recording · ${Math.floor(state.durationMillis / 1000)}s` : "Record voice note"}
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

export function VoicePlayback({ uri, compact = false }: { uri: string; compact?: boolean }) {
  const player = useAudioPlayer(uri);
  const state = useAudioPlayerStatus(player);
  const { theme, styles } = useThemeStyles(createStyles);
  const toggle = () => {
    if (state.playing) player.pause();
    else {
      if (state.didJustFinish) void player.seekTo(0);
      player.play();
    }
  };
  if (compact) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state.playing ? "Pause audio" : "Play audio"}
        onPress={toggle}
        style={({ pressed }) => [styles.smallIcon, styles.playIcon, pressed && styles.pressed]}
      >
        <Ionicons name={state.playing ? "pause" : "play"} size={17} color={theme.deepBrand} />
      </Pressable>
    );
  }
  return <ToolButton secondary label={state.playing ? "Pause audio" : "Play audio"} onPress={toggle} />;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  compactWrap: { alignItems: "flex-end", justifyContent: "center" },
  compactWrapActive: { flex: 1, minWidth: 0, alignItems: "stretch" },
  recordingWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  recordingBar: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 22, paddingHorizontal: 5, backgroundColor: theme.surfaceMuted },
  recordingStatus: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.deepBrand },
  recordingTime: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12, minWidth: 25 },
  recordingLabel: { flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 },
  micButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  micButtonRecording: { backgroundColor: theme.deepBrand },
  voiceDraft: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 22, paddingHorizontal: 5, backgroundColor: theme.surfaceMuted },
  voiceDraftCopy: { flex: 1, minWidth: 0, gap: 1 },
  voiceDraftText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
  voiceDraftMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10 },
  actionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stopButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  sendVoice: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  useVoice: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  smallIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  playIcon: { backgroundColor: theme.surface },
  compactError: { position: "absolute", right: 0, bottom: 44, width: 220, color: theme.error, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, backgroundColor: theme.surface, borderRadius: 10, padding: 8 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },
});
