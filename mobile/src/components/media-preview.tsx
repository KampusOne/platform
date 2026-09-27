import { useEvent } from "expo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useAppearance } from "@/src/lib/appearance";
import { SkeletonBlock } from "@/src/components/skeleton";
import { downloadPostMedia } from "@/src/lib/media-downloads";
import { useToast } from "@/src/components/toast";

const playbackSpeeds = [1, 1.25, 1.5, 2] as const;

export type MediaPlaybackMode = "unmanaged" | "feed-autoplay" | "manual-managed";

export type MediaPlaybackHandle = {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
  setViewportVisible(visible: boolean): void;
};

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
  initialAspect,
  playbackMode,
  onPlaybackHandle,
  suspended,
}: {
  url: string;
  label: string;
  watermark?: string;
  initialAspect?: number | undefined;
  playbackMode: MediaPlaybackMode;
  onPlaybackHandle?: ((handle: MediaPlaybackHandle | null) => void) | undefined;
  suspended: boolean;
}) {
  const { theme } = useAppearance();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof playbackSpeeds)[number]>(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const [aspect, setAspect] = useState(initialAspect && initialAspect > 0 ? initialAspect : 16 / 9);
  const [seekHint, setSeekHint] = useState("");
  const [isViewportVisible, setIsViewportVisible] = useState(playbackMode === "unmanaged");
  const shellRef = useRef<View>(null);
  const videoView = useRef<VideoView>(null);
  const lastTap = useRef({ side: 0, at: 0 });
  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportVisibleRef = useRef(playbackMode === "unmanaged");
  const resumeWhenVisibleRef = useRef(false);
  const manuallyPausedRef = useRef(false);
  const didApplyInitialFeedMute = useRef(false);
  const suspendedRef = useRef(suspended);

  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
    instance.playbackRate = 1;
    if (playbackMode === "feed-autoplay") instance.muted = true;
  });
  const playingEvent = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const mutedEvent = useEvent(player, "mutedChange", {
    muted: player.muted,
  });
  const statusEvent = useEvent(player, "statusChange", {
    status: player.status,
  });
  const isPlaying = playingEvent?.isPlaying ?? player.playing;
  const isMuted = mutedEvent?.muted ?? player.muted;
  const status = statusEvent?.status ?? player.status;
  const error = statusEvent?.error;
  const managed = playbackMode !== "unmanaged";

  const setViewportVisible = useCallback((visible: boolean) => {
    viewportVisibleRef.current = visible;
    setIsViewportVisible(visible);

    if (!visible || suspendedRef.current) {
      if (player.playing && !manuallyPausedRef.current) resumeWhenVisibleRef.current = true;
      player.pause();
      return;
    }

    if (playbackMode === "feed-autoplay") {
      if (!didApplyInitialFeedMute.current) {
        player.muted = true;
        didApplyInitialFeedMute.current = true;
      }
      if (!manuallyPausedRef.current) player.play();
      return;
    }

    if (resumeWhenVisibleRef.current && !manuallyPausedRef.current) {
      resumeWhenVisibleRef.current = false;
      player.play();
    }
  }, [playbackMode, player]);

  useEffect(() => {
    if (!managed || !onPlaybackHandle) return;
    const handle: MediaPlaybackHandle = {
      measureInWindow(callback) {
        const node = shellRef.current;
        if (!node) {
          callback(0, 0, 0, 0);
          return;
        }
        node.measureInWindow(callback);
      },
      setViewportVisible,
    };
    onPlaybackHandle(handle);
    return () => onPlaybackHandle(null);
  }, [managed, onPlaybackHandle, setViewportVisible]);

  useEffect(() => {
    suspendedRef.current = suspended;
    if (suspended) {
      if (player.playing && !manuallyPausedRef.current) resumeWhenVisibleRef.current = true;
      player.pause();
      return;
    }
    if (viewportVisibleRef.current && resumeWhenVisibleRef.current && !manuallyPausedRef.current) {
      resumeWhenVisibleRef.current = false;
      player.play();
    }
  }, [player, suspended]);

  useEffect(() => {
    const update = () => {
      const nextPosition = Number(player.currentTime);
      const nextDuration = Number(player.duration);
      if (Number.isFinite(nextPosition)) setPosition(Math.max(0, nextPosition));
      if (Number.isFinite(nextDuration)) setDuration(Math.max(0, nextDuration));
      const size = player.videoTrack?.size ?? player.availableVideoTracks?.[0]?.size;
      if (!initialAspect && size && size.width > 0 && size.height > 0) setAspect(size.width / size.height);
    };
    update();
    const timer = setInterval(update, 250);
    return () => { clearInterval(timer); if (seekHintTimer.current) clearTimeout(seekHintTimer.current); };
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

  function doubleTap(side: number) {
    const now = Date.now();
    if (lastTap.current.side === side && now - lastTap.current.at < 330) {
      seekBy(side * 5);
      setSeekHint(side < 0 ? "−5 seconds" : "+5 seconds");
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current);
      seekHintTimer.current = setTimeout(() => setSeekHint(""), 700);
    }
    lastTap.current = { side, at: now };
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
    <View ref={shellRef} style={[styles.videoShell, { backgroundColor: "#080808" }]}>
      <VideoView
        ref={videoView}
        accessibilityLabel={label}
        player={player}
        nativeControls={false}
        contentFit="contain"
        surfaceType="textureView"
        style={[styles.video, { aspectRatio: aspect }]}
      />

      <View style={styles.seekZones}>
        <Pressable accessible={false} onPress={(event) => { event.stopPropagation(); doubleTap(-1); }} style={{ flex: 1 }} />
        <Pressable accessible={false} onPress={(event) => { event.stopPropagation(); doubleTap(1); }} style={{ flex: 1 }} />
      </View>
      {seekHint ? <View pointerEvents="none" style={styles.seekFeedback}><Text style={styles.speedText}>{seekHint}</Text></View> : null}

      {status === "loading" ? (
        <View
          pointerEvents="none"
          accessibilityLabel="Loading video"
          accessibilityState={{ busy: true }}
          style={styles.loadingOverlay}
        >
          <View style={styles.videoSkeleton}>
            <SkeletonBlock
              width="72%"
              height={8}
              radius={4}
              style={styles.videoSkeletonLine}
            />
            <SkeletonBlock
              width="48%"
              height={8}
              radius={4}
              style={styles.videoSkeletonLine}
            />
          </View>
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
          <Pressable accessibilityLabel="Back 10 seconds" onPress={(event) => { event.stopPropagation(); seekBy(-10); }} style={styles.iconButton}>
            <Ionicons name="play-back" size={19} color="#FFFFFF" />
          </Pressable>
          <Pressable
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
            accessibilityState={{ disabled: managed && !isViewportVisible }}
            disabled={managed && !isViewportVisible}
            onPress={(event) => {
              event.stopPropagation();
              if (isPlaying) {
                manuallyPausedRef.current = true;
                resumeWhenVisibleRef.current = false;
                player.pause();
              } else {
                manuallyPausedRef.current = false;
                player.play();
              }
            }}
            style={[styles.playButton, managed && !isViewportVisible && styles.disabledControl]}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={23} color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityLabel="Forward 10 seconds" onPress={(event) => { event.stopPropagation(); seekBy(10); }} style={styles.iconButton}>
            <Ionicons name="play-forward" size={19} color="#FFFFFF" />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Video progress"
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onPress={(event) => { event.stopPropagation(); seekFromTrack(event.nativeEvent.locationX); }}
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
            <Pressable
              accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
              onPress={(event) => {
                event.stopPropagation();
                player.muted = !isMuted;
              }}
              style={styles.iconButton}
            >
              <Ionicons name={isMuted ? "volume-mute-outline" : "volume-high-outline"} size={19} color="#FFFFFF" />
            </Pressable>
            <Pressable accessibilityLabel="View video full screen" onPress={(event) => { event.stopPropagation(); void videoView.current?.enterFullscreen(); }} style={styles.iconButton}><Ionicons name="expand-outline" size={19} color="#FFFFFF" /></Pressable>
            <Pressable accessibilityLabel={`Playback speed ${speed} times`} onPress={(event) => { event.stopPropagation(); cycleSpeed(); }} style={styles.speedButton}>
              <Text style={styles.speedText}>{speed}×</Text>
            </Pressable>
            <Pressable accessibilityLabel="More video options" onPress={(event) => { event.stopPropagation(); setMenuOpen(true); }} style={styles.iconButton}>
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
            {Platform.OS === 'android' && /^https:\/\//.test(url) ? <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                void downloadPostMedia(url,true).catch(error=>toast(error.message,'error'));
              }}
              style={styles.menuRow}
            >
              <Ionicons name="download-outline" size={20} color={theme.deepBrand} />
              <View style={styles.menuCopy}>
                <Text style={[styles.menuLabel, { color: theme.text }]}>Download video</Text>
                <Text style={[styles.menuDetail, { color: theme.textMuted }]}>
                  Save to your gallery with a KampusOne watermark.
                </Text>
              </View>
            </Pressable> : null}
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
  initialAspect,
  playbackMode = "unmanaged",
  onPlaybackHandle,
  suspended = false,
}: {
  url: string;
  video?: boolean;
  label?: string;
  watermark?: string;
  initialAspect?: number | undefined;
  playbackMode?: MediaPlaybackMode;
  onPlaybackHandle?: ((handle: MediaPlaybackHandle | null) => void) | undefined;
  suspended?: boolean;
}) {
  const { theme } = useAppearance();
  const [error, setError] = useState(false);

  return (
    <View style={{ marginVertical: 10 }}>
      {video ? (
        <Video
          url={url}
          label={label}
          initialAspect={initialAspect}
          playbackMode={playbackMode}
          onPlaybackHandle={onPlaybackHandle}
          suspended={suspended}
          {...(watermark ? { watermark } : {})}
        />
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
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  video: { width: "100%" },
  seekZones: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" },
  seekFeedback: { position: "absolute", top: "30%", alignSelf: "center", padding: 12, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.65)" },
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
  videoSkeleton: {
    width: "58%",
    gap: 9,
    alignItems: "center",
  },
  videoSkeletonLine: {
    backgroundColor: "rgba(255,255,255,0.52)",
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
  disabledControl: { opacity: 0.45 },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)", padding: 14 },
  menu: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 4, maxWidth: 520, width: "100%", alignSelf: "center" },
  menuTitle: { fontSize: 16, fontWeight: "700", paddingHorizontal: 8, paddingBottom: 4 },
  menuRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 8 },
  menuCopy: { flex: 1, minWidth: 0 },
  menuLabel: { fontSize: 14, fontWeight: "600" },
  menuDetail: { fontSize: 10.5, lineHeight: 15, marginTop: 2 },
});
