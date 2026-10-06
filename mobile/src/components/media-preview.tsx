import {useSignedMedia} from '@/src/lib/signed-media';
import { useEvent } from "expo";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { readVideoPlaybackSession, writeVideoPlaybackSession } from "@/src/lib/video-playback-session";
import { isFeedRoutePlaybackActive, subscribeFeedRoutePlayback, isFeedMuted, setFeedMuted, subscribeFeedMute } from "@/src/lib/feed-video-playback";
import { cachedVideoSource, FAST_VIDEO_BUFFER_OPTIONS } from "@/src/lib/video-source";
import { createNativeMediaLifetime } from "@/src/lib/native-media-lifetime";

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

type VideoProps = {
  url: string;
  label: string;
  watermark?: string;
  initialAspect?: number | undefined;
  playbackMode: MediaPlaybackMode;
  onPlaybackHandle?: ((handle: MediaPlaybackHandle | null) => void) | undefined;
  suspended: boolean;
  playbackKey?: string | undefined;
  onOpen?: ((state: { position: number; muted: boolean }) => void) | undefined;
};

/** Register the viewport before creating an expensive native player/source. */
function ManagedVideo(props: VideoProps) {
  const [activated, setActivated] = useState(props.playbackMode === 'unmanaged');
  const shell = useRef<View>(null);
  const visible = useRef(props.playbackMode === 'unmanaged');
  const nativeHandle = useRef<MediaPlaybackHandle | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; nativeHandle.current = null; }; }, []);

  useEffect(() => {
    if (props.playbackMode === 'unmanaged' || !props.onPlaybackHandle) return;
    const handle: MediaPlaybackHandle = {
      measureInWindow(callback) {
        if (!mounted.current || !shell.current) { callback(0, 0, 0, 0); return; }
        shell.current.measureInWindow(callback);
      },
      setViewportVisible(value) {
        if (!mounted.current) return;
        visible.current = value;
        if (value) setActivated(true);
        nativeHandle.current?.setViewportVisible(value);
      },
    };
    props.onPlaybackHandle(handle);
    return () => props.onPlaybackHandle?.(null);
  }, [props.playbackMode, props.onPlaybackHandle]);

  const registerNativeHandle = useCallback((handle: MediaPlaybackHandle | null) => {
    nativeHandle.current = handle;
    if (mounted.current) handle?.setViewportVisible(visible.current);
  }, []);
  const aspect = props.initialAspect && Number.isFinite(props.initialAspect) && props.initialAspect > 0 ? props.initialAspect : 16 / 9;
  return <View ref={shell} collapsable={false} style={{ width: '100%' }}>
    {activated ? <Video {...props} onPlaybackHandle={props.playbackMode === 'unmanaged' ? undefined : registerNativeHandle} /> :
      <View accessibilityLabel={props.label} style={[styles.videoShell, { aspectRatio: aspect, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="videocam-outline" size={30} color="#FFFFFF" />
      </View>}
  </View>;
}

function Video({
  url,
  label,
  watermark,
  initialAspect,
  playbackMode,
  onPlaybackHandle,
  suspended,
  playbackKey,
  onOpen,
}: VideoProps) {
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
  const feedRouteActiveRef = useRef(playbackMode !== "feed-autoplay" || isFeedRoutePlaybackActive());

  const signedSource=useSignedMedia(url);
  const player = useVideoPlayer(signedSource?cachedVideoSource(signedSource):null, (instance) => {
    instance.loop = false;
    instance.playbackRate = 1;
    instance.bufferOptions = FAST_VIDEO_BUFFER_OPTIONS;
    if (playbackMode === "feed-autoplay") instance.muted = isFeedMuted();
  });
  const lifetime = useMemo(() => createNativeMediaLifetime(), [player]);
  // Expo's hook releases before subsequent passive-effect cleanups. Stop stale
  // list/viewability callbacks before they can read the released native player.
  useLayoutEffect(() => { lifetime.activate(); return () => lifetime.dispose(); }, [lifetime]);
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
    if (!lifetime.isActive()) return;
    viewportVisibleRef.current = visible;
    setIsViewportVisible(visible);

    if (!visible || suspendedRef.current || (playbackMode === "feed-autoplay" && !feedRouteActiveRef.current)) {
      if (player.playing && !manuallyPausedRef.current) resumeWhenVisibleRef.current = true;
      player.pause();
      return;
    }

    if (playbackMode === "feed-autoplay") {
      const remembered = readVideoPlaybackSession(playbackKey);
      if (remembered) {
        if (Math.abs(Number(player.currentTime) - remembered.position) > 0.35) {
          player.currentTime = remembered.position;
        }
        player.muted = isFeedMuted();
        didApplyInitialFeedMute.current = true;
      } else if (!didApplyInitialFeedMute.current) {
        player.muted = isFeedMuted();
        didApplyInitialFeedMute.current = true;
      }
      if (!manuallyPausedRef.current) player.play();
      return;
    }

    if (resumeWhenVisibleRef.current && !manuallyPausedRef.current) {
      resumeWhenVisibleRef.current = false;
      player.play();
    }
  }, [playbackKey, playbackMode, player, lifetime]);

  useEffect(() => {
    if (playbackMode !== "feed-autoplay") return;
    return subscribeFeedMute(value => { if (lifetime.isActive()) player.muted = value; });
  }, [playbackMode, player, lifetime]);

  useEffect(() => {
    if (playbackMode !== "feed-autoplay") return;
    return subscribeFeedRoutePlayback((active) => {
      if (!lifetime.isActive()) return;
      feedRouteActiveRef.current = active;
      if (!active) {
        if (player.playing && !manuallyPausedRef.current) resumeWhenVisibleRef.current = true;
        player.pause();
        return;
      }
      if (!viewportVisibleRef.current || suspendedRef.current || manuallyPausedRef.current) return;
      const remembered = readVideoPlaybackSession(playbackKey);
      if (remembered) {
        if (Math.abs(Number(player.currentTime) - remembered.position) > 0.35) {
          player.currentTime = remembered.position;
        }
        player.muted = isFeedMuted();
        didApplyInitialFeedMute.current = true;
      } else if (!didApplyInitialFeedMute.current) {
        player.muted = isFeedMuted();
        didApplyInitialFeedMute.current = true;
      }
      player.play();
    });
  }, [playbackKey, playbackMode, player, lifetime]);

  useEffect(() => {
    if (!managed || !onPlaybackHandle) return;
    const handle: MediaPlaybackHandle = {
      measureInWindow(callback) {
        if (!lifetime.isActive()) { callback(0, 0, 0, 0); return; }
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
  }, [managed, onPlaybackHandle, setViewportVisible, lifetime]);

  useEffect(() => {
    if (!lifetime.isActive()) return;
    suspendedRef.current = suspended;
    if (suspended) {
      if (player.playing && !manuallyPausedRef.current) resumeWhenVisibleRef.current = true;
      player.pause();
      return;
    }
    if (
      viewportVisibleRef.current &&
      resumeWhenVisibleRef.current &&
      !manuallyPausedRef.current &&
      (playbackMode !== "feed-autoplay" || feedRouteActiveRef.current)
    ) {
      resumeWhenVisibleRef.current = false;
      player.play();
    }
  }, [playbackMode, player, suspended, lifetime]);

  useEffect(() => {
    const update = () => {
      if (!lifetime.isActive()) return;
      const nextPosition = Number(player.currentTime);
      const nextDuration = Number(player.duration);
      if (Number.isFinite(nextPosition)) setPosition(Math.max(0, nextPosition));
      if (Number.isFinite(nextDuration)) setDuration(Math.max(0, nextDuration));
      const size = player.videoTrack?.size ?? player.availableVideoTracks?.[0]?.size;
      if (!initialAspect && size && size.width > 0 && size.height > 0) setAspect(size.width / size.height);
    };
    update();
    // Off-screen feed videos stay paused without waking React four times per second.
    const shouldPoll = !managed || (isViewportVisible && !suspended);
    const timer = shouldPoll ? setInterval(update, 500) : null;
    return () => {
      if (timer) clearInterval(timer);
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current);
    };
  }, [initialAspect, isViewportVisible, managed, player, status, suspended, lifetime]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  function seekBy(seconds: number) {
    if (!lifetime.isActive()) return;
    try {
      player.seekBy(seconds);
    } catch {
      const next = Math.max(0, Math.min(duration || Number(player.duration) || 0, position + seconds));
      player.currentTime = next;
    }
  }

  function openViewer() {
    if (!onOpen || !lifetime.isActive()) return false;
    const current = Math.max(0, Number(player.currentTime) || 0);
    writeVideoPlaybackSession(playbackKey, current, player.muted);
    if (player.playing && !manuallyPausedRef.current) resumeWhenVisibleRef.current = true;
    player.pause();
    onOpen({ position: current, muted: player.muted });
    return true;
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
    if (!lifetime.isActive()) return;
    const index = playbackSpeeds.indexOf(speed);
    const next = playbackSpeeds[(index + 1) % playbackSpeeds.length] ?? 1;
    player.playbackRate = next;
    setSpeed(next);
  }

  function seekFromTrack(locationX: number) {
    if (!lifetime.isActive() || !trackWidth || !duration) return;
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
        <Pressable accessible={false} onPress={(event) => { event.stopPropagation(); if (!openViewer()) doubleTap(-1); }} style={{ flex: 1 }} />
        <Pressable accessible={false} onPress={(event) => { event.stopPropagation(); if (!openViewer()) doubleTap(1); }} style={{ flex: 1 }} />
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
              if (!lifetime.isActive()) return;
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
                if (!lifetime.isActive()) return;
                if (playbackMode === "feed-autoplay") setFeedMuted(!isMuted);
                else player.muted = !isMuted;
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
                void downloadPostMedia(url,true,watermark).catch(error=>toast(error.message,'error'));
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
  playbackKey,
  onOpen,
}: {
  url: string;
  video?: boolean;
  label?: string;
  watermark?: string;
  initialAspect?: number | undefined;
  playbackMode?: MediaPlaybackMode;
  onPlaybackHandle?: ((handle: MediaPlaybackHandle | null) => void) | undefined;
  suspended?: boolean;
  playbackKey?: string | undefined;
  onOpen?: ((state: { position: number; muted: boolean }) => void) | undefined;
}) {
  const { theme } = useAppearance();
  const [error, setError] = useState(false);

  return (
    <View style={{ marginVertical: 10 }}>
      {video ? (
        <ManagedVideo
          url={url}
          label={label}
          initialAspect={initialAspect}
          playbackMode={playbackMode}
          onPlaybackHandle={onPlaybackHandle}
          suspended={suspended}
          playbackKey={playbackKey}
          onOpen={onOpen}
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
