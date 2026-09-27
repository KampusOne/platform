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
  compact = false,
}: {
  disabled: boolean;
  onReady: (id: string, name: string) => void;
  compact?: boolean;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [uri, setUri] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { theme, styles } = useThemeStyles(createStyles);

  useEffect(() => {
    const stop = async () => {
      if (recorder.isRecording) {
        await recorder.stop();
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
        setUri(recorder.uri ?? undefined);
        await setAudioModeAsync({ allowsRecording: false });
      } else {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error("Allow microphone access to record a voice note.");
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setUri(undefined);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recording failed.");
    } finally {
      setBusy(false);
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
      onReady(result.id, "Voice note");
      setUri(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed. Your recording is kept.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        {uri ? (
          <View style={styles.voiceDraft}>
            <VoicePlayback uri={uri} compact />
            <Text numberOfLines={1} style={styles.voiceDraftText}>Voice note</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use voice note"
              disabled={disabled || busy}
              onPress={() => void attach()}
              style={({ pressed }) => [styles.useVoice, (pressed || disabled || busy) && styles.disabled]}
            >
              <Ionicons name={busy ? "cloud-upload-outline" : "checkmark"} size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard voice note"
              disabled={busy}
              onPress={() => setUri(undefined)}
              style={({ pressed }) => [styles.smallIcon, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={19} color={theme.textMuted} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.recordingWrap}>
            {state.isRecording ? <Text accessibilityLiveRegion="polite" style={styles.recordingTime}>{Math.floor(state.durationMillis / 1000)}s</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={state.isRecording ? "Stop recording voice note" : "Record voice note"}
              disabled={disabled || busy}
              onPress={() => void record()}
              style={({ pressed }) => [styles.micButton, state.isRecording && styles.micButtonRecording, (pressed || disabled || busy) && styles.disabled]}
            >
              <Ionicons name={state.isRecording ? "stop" : "mic-outline"} size={21} color={state.isRecording ? "#FFFFFF" : theme.textMuted} />
            </Pressable>
          </View>
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
  recordingWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  recordingTime: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 11, minWidth: 24, textAlign: "right" },
  micButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  micButtonRecording: { backgroundColor: theme.deepBrand },
  voiceDraft: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, maxWidth: 190, borderRadius: 20, paddingHorizontal: 5, backgroundColor: theme.surfaceMuted },
  voiceDraftText: { flex: 1, minWidth: 58, color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
  useVoice: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  smallIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  playIcon: { backgroundColor: theme.surface },
  compactError: { position: "absolute", right: 0, bottom: 44, width: 220, color: theme.error, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, backgroundColor: theme.surface, borderRadius: 10, padding: 8 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },
});
