import { useEvent } from "expo";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useAppearance } from "@/src/lib/appearance";

const playbackSpeeds = [1, 1.25, 1.5, 2] as const;

function formatClock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Video({
  url,
  label,
  watermark,
}: {
  url: string;
  label: string;
  watermark?: string;
}) {
  const { theme } = useAppearance();
  const [menuOpen, setMenuOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof playbackSpeeds)[number]>(1);
  const [trackWidth, setTrackWidth] = useState(0);

  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
    instance.playbackRate = 1;
  });
  const playingEvent = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const statusEvent = useEvent(player, "statusChange", {
    status: player.status,
  });
  const isPlaying = playingEvent?.isPlaying ?? player.playing;
  const status = statusEvent?.status ?? player.status;
  const error = statusEvent?.error;

  useEffect(() => {
    const update = () => {
      const nextPosition = Number(player.currentTime);
      const nextDuration = Number(player.duration);
      if (Number.isFinite(nextPosition)) setPosition(Math.max(0, nextPosition));
      if (Number.isFinite(nextDuration)) setDuration(Math.max(0, nextDuration));
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [player]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const watermarkCorner = Math.floor(position / 6) % 4;
  const watermarkStyle = useMemo(
    () => [
      styles.watermark,
      watermarkCorner === 0 && styles.watermarkTopLeft,
      watermarkCorner === 1 && styles.watermarkTopRight,
      watermarkCorner === 2 && styles.watermarkBottomRight,
      watermarkCorner === 3 && styles.watermarkBottomLeft,
    ],
    [watermarkCorner],
  );

  function seekBy(seconds: number) {
    try {
      player.seekBy(seconds);
    } catch {
      const next = Math.max(0, Math.min(duration || Number(player.duration) || 0, position + seconds));
      player.currentTime = next;
    }
  }

  function cycleSpeed() {
    const index = playbackSpeeds.indexOf(speed);
    const next = playbackSpeeds[(index + 1) % playbackSpeeds.length] ?? 1;
    player.playbackRate = next;
    setSpeed(next);
  }

  function seekFromTrack(locationX: number) {
    if (!trackWidth || !duration) return;
    player.currentTime = Math.max(0, Math.min(duration, (locationX / trackWidth) * duration));
  }

  return (
    <View style={[styles.videoShell, { backgroundColor: theme.surfaceMuted }]}>
      <VideoView
        accessibilityLabel={label}
        player={player}
        nativeControls={false}
        contentFit="contain"
        surfaceType="textureView"
        style={styles.video}
      />

      {status === "loading" ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}

      {status === "error" ? (
        <View style={styles.errorOverlay}>
          <Ionicons name="alert-circle-outline" size={28} color="#FFFFFF" />
          <Text style={styles.errorText}>
            {error?.message || "This video could not load."}
          </Text>
        </View>
      ) : null}

      {watermark ? (
        <View pointerEvents="none" style={watermarkStyle}>
          <Text style={styles.watermarkText}>K1 · {watermark}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <Pressable accessibilityLabel="Back 10 seconds" onPress={() => seekBy(-10)} style={styles.iconButton}>
            <Ionicons name="play-back" size={19} color="#FFFFFF" />
          </Pressable>
          <Pressable
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
            onPress={() => (isPlaying ? player.pause() : player.play())}
            style={styles.playButton}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={23} color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityLabel="Forward 10 seconds" onPress={() => seekBy(10)} style={styles.iconButton}>
            <Ionicons name="play-forward" size={19} color="#FFFFFF" />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Video progress"
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onPress={(event) => seekFromTrack(event.nativeEvent.locationX)}
          style={styles.progressTouch}
        >
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </Pressable>

        <View style={styles.bottomRow}>
          <Text style={styles.timeText}>
            {formatClock(position)} / {formatClock(duration)}
          </Text>
          <View style={styles.bottomActions}>
            <Pressable accessibilityLabel={`Playback speed ${speed} times`} onPress={cycleSpeed} style={styles.speedButton}>
              <Text style={styles.speedText}>{speed}×</Text>
            </Pressable>
            <Pressable accessibilityLabel="More video options" onPress={() => setMenuOpen(true)} style={styles.iconButton}>
              <Ionicons name="ellipsis-horizontal" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close video options" onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={[styles.menu, { backgroundColor: theme.canvas, borderColor: theme.border }]}>
            <Text style={[styles.menuTitle, { color: theme.text }]}>Video</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                void Linking.openURL(url);
              }}
              style={styles.menuRow}
            >
              <Ionicons name="download-outline" size={20} color={theme.deepBrand} />
              <View style={styles.menuCopy}>
                <Text style={[styles.menuLabel, { color: theme.text }]}>Open video file</Text>
                <Text style={[styles.menuDetail, { color: theme.textMuted }]}>
                  Save it from your device viewer. Branded export is kept separate so we never fake a watermark.
                </Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setMenuOpen(false)} style={styles.menuRow}>
              <Ionicons name="close-outline" size={20} color={theme.textMuted} />
              <Text style={[styles.menuLabel, { color: theme.text }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function MediaPreview({
  url,
  video = false,
  label = "Attached media",
  watermark,
}: {
  url: string;
  video?: boolean;
  label?: string;
  watermark?: string;
}) {
  const { theme } = useAppearance();
  const [error, setError] = useState(false);

  return (
    <View style={{ marginVertical: 10 }}>
      {video ? (
        <Video url={url} label={label} {...(watermark ? { watermark } : {})} />
      ) : error ? (
        <Text style={{ color: theme.error }}>This image could not load.</Text>
      ) : (
        <Image
          accessibilityLabel={label}
          source={{ uri: url }}
          onError={() => setError(true)}
          resizeMode="contain"
          style={{ height: 240, width: "100%", borderRadius: 12 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  videoShell: {
    minHeight: 240,
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  video: { height: 260, width: "100%" },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  errorOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: "rgba(24,20,18,0.78)",
  },
  errorText: { color: "#FFFFFF", fontSize: 12, textAlign: "center", lineHeight: 17 },
  watermark: {
    position: "absolute",
    backgroundColor: "rgba(20,16,14,0.48)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  watermarkTopLeft: { left: 10, top: 10 },
  watermarkTopRight: { right: 10, top: 10 },
  watermarkBottomRight: { right: 10, bottom: 92 },
  watermarkBottomLeft: { left: 10, bottom: 92 },
  watermarkText: { color: "rgba(255,255,255,0.9)", fontSize: 9, fontWeight: "700" },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 7,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "rgba(20,16,14,0.62)",
  },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  iconButton: { minWidth: 38, minHeight: 36, alignItems: "center", justifyContent: "center" },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  progressTouch: { minHeight: 18, justifyContent: "center" },
  progressTrack: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.26)" },
  progressFill: { height: "100%", backgroundColor: "#FFFFFF" },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bottomActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontWeight: "600" },
  speedButton: { minHeight: 34, minWidth: 42, alignItems: "center", justifyContent: "center" },
  speedText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)", padding: 14 },
  menu: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 4, maxWidth: 520, width: "100%", alignSelf: "center" },
  menuTitle: { fontSize: 16, fontWeight: "700", paddingHorizontal: 8, paddingBottom: 4 },
  menuRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 8 },
  menuCopy: { flex: 1, minWidth: 0 },
  menuLabel: { fontSize: 14, fontWeight: "600" },
  menuDetail: { fontSize: 10.5, lineHeight: 15, marginTop: 2 },
});
