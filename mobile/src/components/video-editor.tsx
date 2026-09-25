import { InlineLoading } from "@/src/components/skeleton";
import {
  finishVideoEdit,
  getServerVideoEdit,
  getVideoEdit,
  subscribeVideoEdit,
  type VideoEditRequest,
} from "@/src/lib/video-edit-session";
import {
  formatVideoTime,
  initialVideoTrimRange,
  MAX_POST_VIDEO_DURATION_MS,
  setVideoTrimEnd,
  setVideoTrimStart,
} from "@/src/lib/video-trim-range";
import { trimPostVideo } from "@/src/lib/post-video-processing";
import { useAppearance } from "@/src/lib/appearance";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VideoView, useVideoPlayer } from "expo-video";

export function VideoEditorHost() {
  const request = useSyncExternalStore(
    subscribeVideoEdit,
    getVideoEdit,
    getServerVideoEdit,
  );
  useEffect(
    () => () => {
      const pending = getVideoEdit();
      if (pending) finishVideoEdit(pending.id, null);
    },
    [],
  );
  if (!request) return null;
  return <VideoEditor key={request.id} request={request} />;
}

function VideoEditor({ request }: { request: VideoEditRequest }) {
  const { theme } = useAppearance();
  const window = useWindowDimensions();
  const durationMs = request.video.durationMs;
  const [range, setRange] = useState(() => initialVideoTrimRange(durationMs));
  const [trackWidth, setTrackWidth] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const saving = useRef(false);
  const alive = useRef(true);
  const previewingRef = useRef(false);
  const player = useVideoPlayer(request.video.uri, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.1;
  });

  const current = useRef({ range, trackWidth, busy });
  current.current = { range, trackWidth, busy };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      player.pause();
    };
  }, [player]);

  useEffect(() => {
    const subscription = player.addListener("timeUpdate", ({ currentTime }) => {
      if (
        previewingRef.current &&
        currentTime * 1000 >= current.current.range.endMs - 70
      ) {
        player.pause();
        player.currentTime = current.current.range.startMs / 1000;
        previewingRef.current = false;
        if (alive.current) setPreviewing(false);
      }
    });
    return () => subscription.remove();
  }, [player]);

  function stopPreview() {
    player.pause();
    previewingRef.current = false;
    setPreviewing(false);
  }

  function seekStart() {
    player.currentTime = current.current.range.startMs / 1000;
  }

  const startAtDrag = useRef(0);
  const endAtDrag = useRef(0);

  const startPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !current.current.busy,
        onMoveShouldSetPanResponder: () => !current.current.busy,
        onPanResponderGrant: () => {
          stopPreview();
          startAtDrag.current = current.current.range.startMs;
        },
        onPanResponderMove: (_event, gesture) => {
          const width = Math.max(1, current.current.trackWidth);
          const next = startAtDrag.current + (gesture.dx / width) * durationMs;
          setRange((value) =>
            setVideoTrimStart(value, next, durationMs),
          );
        },
        onPanResponderRelease: seekStart,
        onPanResponderTerminate: seekStart,
        onPanResponderTerminationRequest: () => false,
      }),
    [durationMs],
  );

  const endPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !current.current.busy,
        onMoveShouldSetPanResponder: () => !current.current.busy,
        onPanResponderGrant: () => {
          stopPreview();
          endAtDrag.current = current.current.range.endMs;
        },
        onPanResponderMove: (_event, gesture) => {
          const width = Math.max(1, current.current.trackWidth);
          const next = endAtDrag.current + (gesture.dx / width) * durationMs;
          setRange((value) => setVideoTrimEnd(value, next, durationMs));
        },
        onPanResponderRelease: seekStart,
        onPanResponderTerminate: seekStart,
        onPanResponderTerminationRequest: () => false,
      }),
    [durationMs],
  );

  function cancel() {
    if (saving.current) return;
    stopPreview();
    finishVideoEdit(request.id, null);
  }

  async function preview() {
    if (busy) return;
    setError("");
    try {
      if (previewingRef.current) {
        stopPreview();
        seekStart();
        return;
      }
      player.currentTime = range.startMs / 1000;
      previewingRef.current = true;
      setPreviewing(true);
      await player.play();
    } catch {
      previewingRef.current = false;
      setPreviewing(false);
      setError("This video could not be previewed. You can still adjust the trim and try again.");
    }
  }

  async function save() {
    if (saving.current) return;
    saving.current = true;
    stopPreview();
    setBusy(true);
    setError("");
    try {
      const edited = await trimPostVideo(request.video, range);
      if (alive.current) finishVideoEdit(request.id, edited);
    } catch (caught) {
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "This video could not be prepared. Adjust the trim and try again.",
        );
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const startPx = (range.startMs / durationMs) * trackWidth;
  const endPx = (range.endMs / durationMs) * trackWidth;
  const startHandleLeft = Math.max(0, Math.min(Math.max(0, trackWidth - 28), startPx - 14));
  const endHandleLeft = Math.max(0, Math.min(Math.max(0, trackWidth - 28), endPx - 14));
  const selectionSeconds = (range.endMs - range.startMs) / 1000;
  const text = { color: theme.text, fontFamily: theme.font.body };
  const previewHeight = Math.max(
    190,
    Math.min(330, window.height * 0.36),
  );

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={cancel}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: theme.canvas }]}
        accessibilityViewIsModal
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel video edit"
            disabled={busy}
            onPress={cancel}
            style={styles.headerAction}
          >
            <Text
              style={[
                text,
                { color: theme.deepBrand, opacity: busy ? 0.4 : 1 },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
          <Text accessibilityRole="header" style={[text, styles.title]}>
            Trim video
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.content}>
          <VideoView
            accessibilityLabel="Video trim preview"
            player={player}
            nativeControls
            contentFit="contain"
            style={[
              styles.video,
              {
                height: previewHeight,
                backgroundColor: theme.surfaceMuted,
              },
            ]}
          />

          <View style={styles.summary}>
            <Text style={[text, styles.rangeText]}>
              {formatVideoTime(range.startMs)} – {formatVideoTime(range.endMs)}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[text, styles.durationText, { color: theme.textMuted }]}
            >
              {selectionSeconds.toFixed(selectionSeconds < 10 ? 1 : 0)}s selected
            </Text>
          </View>

          <View
            accessibilityLabel="Video trim timeline"
            onLayout={(event) =>
              setTrackWidth(Math.max(1, event.nativeEvent.layout.width))
            }
            style={[
              styles.track,
              { backgroundColor: theme.surfaceMuted },
              Platform.OS === "web"
                ? ({ touchAction: "none" } as ViewStyle)
                : null,
            ]}
          >
            <View
              pointerEvents="none"
              style={[
                styles.selectedTrack,
                {
                  left: startPx,
                  width: Math.max(0, endPx - startPx),
                  backgroundColor: theme.brand,
                },
              ]}
            />
            <View
              {...startPan.panHandlers}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Video trim start"
              accessibilityValue={{
                text: formatVideoTime(range.startMs),
              }}
              style={[
                styles.handle,
                {
                  left: startHandleLeft,
                  backgroundColor: theme.deepBrand,
                },
              ]}
            />
            <View
              {...endPan.panHandlers}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Video trim end"
              accessibilityValue={{
                text: formatVideoTime(range.endMs),
              }}
              style={[
                styles.handle,
                {
                  left: endHandleLeft,
                  backgroundColor: theme.deepBrand,
                },
              ]}
            />
          </View>

          <View style={styles.timeEnds}>
            <Text style={[text, { color: theme.textMuted }]}>0:00</Text>
            <Text style={[text, { color: theme.textMuted }]}>
              {formatVideoTime(durationMs)}
            </Text>
          </View>

          <Text style={[text, styles.hint, { color: theme.textMuted }]}>
            Drag the left and right handles to choose the part you want to post.
            Clips can be up to {MAX_POST_VIDEO_DURATION_MS / 1000} seconds.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void preview()}
            style={({ pressed }) => [
              styles.previewButton,
              {
                borderColor: theme.border,
                opacity: busy ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[text, { color: theme.deepBrand }]}>
              {previewing ? "Stop preview" : "Preview selection"}
            </Text>
          </Pressable>

          {error ? (
            <Text
              accessibilityRole="alert"
              style={[text, styles.error, { color: theme.error }]}
            >
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save trimmed video"
            disabled={busy}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.save,
              {
                backgroundColor: theme.brand,
                opacity: busy ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {busy ? <InlineLoading color="#FFFFFF" /> : null}
            <Text style={[styles.saveText, { fontFamily: theme.font.body }]}>
              {busy ? "Preparing video…" : "Save video"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingHorizontal: 12,
  },
  headerAction: {
    minHeight: 44,
    minWidth: 64,
    justifyContent: "center",
    padding: 8,
  },
  headerSpacer: { width: 64 },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700" },
  content: { flex: 1, paddingHorizontal: 20, gap: 14 },
  video: { width: "100%", borderRadius: 14, overflow: "hidden" },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
  },
  rangeText: { fontSize: 17, fontWeight: "700" },
  durationText: { fontSize: 13 },
  track: {
    height: 52,
    borderRadius: 10,
    position: "relative",
    justifyContent: "center",
    overflow: "visible",
    marginTop: 2,
  },
  selectedTrack: {
    position: "absolute",
    top: 0,
    bottom: 0,
    opacity: 0.42,
  },
  handle: {
    position: "absolute",
    top: 5,
    width: 28,
    height: 42,
    borderRadius: 8,
  },
  timeEnds: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -6,
  },
  hint: { textAlign: "center", fontSize: 13, lineHeight: 20 },
  previewButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  error: { textAlign: "center", fontSize: 13, lineHeight: 20 },
  footer: { padding: 20 },
  save: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  saveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
