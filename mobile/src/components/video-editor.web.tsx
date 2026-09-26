import { createElement, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { InlineLoading } from "@/src/components/skeleton";
import { useAppearance } from "@/src/lib/appearance";
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
  type VideoTrimRange,
} from "@/src/lib/video-trim-range";
import { trimPostVideo } from "@/src/lib/post-video-processing";

function waitForMedia(video: HTMLVideoElement, event: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("The video preview took too long to load."));
    }, 12_000);
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("This video could not be read."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

async function buildFilmstrip(uri: string, durationMs: number, count = 8) {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = uri;
  if (video.readyState < 1) await waitForMedia(video, "loadedmetadata");

  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 120;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Video thumbnails are unavailable in this browser.");

  const frames: string[] = [];
  const sourceDuration = Math.max(0.001, durationMs / 1000);
  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0 : index / (count - 1);
    const time = Math.min(sourceDuration - 0.03, sourceDuration * progress);
    if (Math.abs(video.currentTime - time) > 0.02) {
      video.currentTime = Math.max(0, time);
      await waitForMedia(video, "seeked");
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", 0.72));
  }

  video.removeAttribute("src");
  video.load();
  return frames;
}

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
  return <WebVideoEditor key={request.id} request={request} />;
}

function WebVideoEditor({ request }: { request: VideoEditRequest }) {
  const { theme } = useAppearance();
  const durationMs = request.video.durationMs;
  const [range, setRange] = useState<VideoTrimRange>(() =>
    initialVideoTrimRange(durationMs),
  );
  const [frames, setFrames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void buildFilmstrip(request.video.uri, durationMs)
      .then((result) => {
        if (alive.current) setFrames(result);
      })
      .catch(() => {
        if (alive.current) setFrames([]);
      });
    return () => {
      alive.current = false;
      previewRef.current?.pause();
    };
  }, [durationMs, request.video.uri]);

  function seek(milliseconds: number) {
    if (previewRef.current)
      previewRef.current.currentTime = milliseconds / 1000;
  }

  function updateFromPointer(
    side: "start" | "end",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const percent = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const milliseconds = percent * durationMs;

    setRange((previous) => {
      const next =
        side === "start"
          ? setVideoTrimStart(previous, milliseconds, durationMs)
          : setVideoTrimEnd(previous, milliseconds, durationMs);
      seek(side === "start" ? next.startMs : next.endMs);
      return next;
    });
  }

  function pointerProps(side: "start" | "end") {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        previewRef.current?.pause();
        setPreviewing(false);
        updateFromPointer(side, event);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          updateFromPointer(side, event);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
        updateFromPointer(side, event);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      },
    };
  }

  async function previewSelection() {
    const video = previewRef.current;
    if (!video || busy) return;
    if (previewing) {
      video.pause();
      video.currentTime = range.startMs / 1000;
      setPreviewing(false);
      return;
    }
    setError("");
    try {
      video.currentTime = range.startMs / 1000;
      await video.play();
      setPreviewing(true);
    } catch {
      setError("The browser blocked video playback. Tap the video once, then preview again.");
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    previewRef.current?.pause();
    setPreviewing(false);
    try {
      const edited = await trimPostVideo(request.video, range);
      if (alive.current) finishVideoEdit(request.id, edited);
    } catch (caught) {
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "This video could not be prepared. Try a different trim.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const startPercent = (range.startMs / durationMs) * 100;
  const endPercent = (range.endMs / durationMs) * 100;
  const selectedSeconds = (range.endMs - range.startMs) / 1000;

  return (
    <View
      accessibilityViewIsModal
      style={[styles.overlay, { backgroundColor: theme.canvas }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => finishVideoEdit(request.id, null)}
          style={styles.headerAction}
        >
          <Text style={{ color: theme.text, fontFamily: theme.font.body }}>
            Cancel
          </Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.text,
            fontFamily: theme.font.semibold,
            fontSize: 17,
          }}
        >
          Trim video
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void save()}
          style={styles.headerAction}
        >
          <Text
            style={{
              color: theme.deepBrand,
              fontFamily: theme.font.semibold,
              opacity: busy ? 0.45 : 1,
            }}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {createElement("video", {
          ref: (node: HTMLVideoElement | null) => {
            previewRef.current = node;
          },
          src: request.video.uri,
          controls: true,
          playsInline: true,
          preload: "metadata",
          "aria-label": "Video trim preview",
          style: {
            width: "100%",
            maxHeight: 390,
            background: "#111",
            borderRadius: 12,
          },
          onTimeUpdate: () => {
            const video = previewRef.current;
            if (
              previewing &&
              video &&
              video.currentTime * 1000 >= range.endMs - 50
            ) {
              video.pause();
              video.currentTime = range.startMs / 1000;
              setPreviewing(false);
            }
          },
          onEnded: () => setPreviewing(false),
        })}

        <View style={styles.timeRow}>
          <Text style={[styles.timeText, { color: theme.text }]}>
            {formatVideoTime(range.startMs)}
          </Text>
          <Text style={[styles.durationText, { color: theme.textMuted }]}>
            {selectedSeconds.toFixed(selectedSeconds < 10 ? 1 : 0)}s selected
          </Text>
          <Text style={[styles.timeText, { color: theme.text }]}>
            {formatVideoTime(range.endMs)}
          </Text>
        </View>

        {createElement(
          "div",
          {
            ref: (node: HTMLDivElement | null) => {
              trackRef.current = node;
            },
            "aria-label": "Video trim filmstrip",
            style: {
              position: "relative",
              width: "100%",
              height: 76,
              display: "flex",
              overflow: "hidden",
              borderRadius: 8,
              background: theme.surfaceMuted,
              userSelect: "none",
              touchAction: "none",
            },
          },
          ...(frames.length
            ? frames.map((frame, index) =>
                createElement("img", {
                  key: index,
                  src: frame,
                  alt: "",
                  draggable: false,
                  style: {
                    minWidth: 0,
                    flex: "1 1 0",
                    height: "100%",
                    objectFit: "cover",
                    pointerEvents: "none",
                  },
                }),
              )
            : [
                createElement(
                  "div",
                  {
                    key: "loading",
                    style: {
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: theme.textMuted,
                      fontFamily: theme.font.body,
                      fontSize: 13,
                    },
                  },
                  "Preparing timeline…",
                ),
              ]),
          createElement("div", {
            key: "selection",
            style: {
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
              borderTop: `3px solid ${theme.brand}`,
              borderBottom: `3px solid ${theme.brand}`,
              boxSizing: "border-box",
              pointerEvents: "none",
            },
          }),
          createElement("div", {
            key: "dim-left",
            style: {
              position: "absolute",
              inset: `0 ${100 - startPercent}% 0 0`,
              background: "rgba(0,0,0,0.45)",
              pointerEvents: "none",
            },
          }),
          createElement("div", {
            key: "dim-right",
            style: {
              position: "absolute",
              inset: `0 0 0 ${endPercent}%`,
              background: "rgba(0,0,0,0.45)",
              pointerEvents: "none",
            },
          }),
          createElement("button", {
            key: "start",
            type: "button",
            "aria-label": `Trim start ${formatVideoTime(range.startMs)}`,
            ...pointerProps("start"),
            style: {
              position: "absolute",
              left: `calc(${startPercent}% - 9px)`,
              top: 0,
              bottom: 0,
              width: 18,
              border: 0,
              borderRadius: "7px 0 0 7px",
              background: theme.brand,
              cursor: "ew-resize",
              touchAction: "none",
            },
          }),
          createElement("button", {
            key: "end",
            type: "button",
            "aria-label": `Trim end ${formatVideoTime(range.endMs)}`,
            ...pointerProps("end"),
            style: {
              position: "absolute",
              left: `calc(${endPercent}% - 9px)`,
              top: 0,
              bottom: 0,
              width: 18,
              border: 0,
              borderRadius: "0 7px 7px 0",
              background: theme.brand,
              cursor: "ew-resize",
              touchAction: "none",
            },
          }),
        )}

        <View style={styles.timelineEnds}>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>
            0:00
          </Text>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>
            {formatVideoTime(durationMs)}
          </Text>
        </View>

        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Drag either handle on the filmstrip. Clips can be up to{" "}
          {MAX_POST_VIDEO_DURATION_MS / 1000} seconds.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void previewSelection()}
          style={[
            styles.previewButton,
            { borderColor: theme.border, opacity: busy ? 0.45 : 1 },
          ]}
        >
          <Text
            style={{
              color: theme.deepBrand,
              fontFamily: theme.font.semibold,
            }}
          >
            {previewing ? "Stop preview" : "Preview selection"}
          </Text>
        </Pressable>

        {busy ? (
          <View style={styles.busyRow}>
            <InlineLoading color={theme.brand} />
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>
              Preparing video…
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
  },
  header: {
    minHeight: 60,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerAction: {
    minWidth: 68,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 18,
    gap: 12,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  timeText: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  durationText: {
    fontSize: 12,
    flex: 1,
    textAlign: "center",
  },
  timelineEnds: {
    marginTop: -6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  previewButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  busyRow: {
    minHeight: 36,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
