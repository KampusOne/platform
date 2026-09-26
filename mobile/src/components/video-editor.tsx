import { useEffect, useRef, useSyncExternalStore } from "react";
import NativeVideoTrim, {
  closeEditor,
  showEditor,
  type Spec,
} from "react-native-video-trim";
import { useAppearance } from "@/src/lib/appearance";
import {
  failVideoEdit,
  finishVideoEdit,
  getServerVideoEdit,
  getVideoEdit,
  subscribeVideoEdit,
} from "@/src/lib/video-edit-session";
import { MAX_POST_VIDEO_DURATION_MS } from "@/src/lib/video-trim-range";

function fileUri(path: string) {
  return path.startsWith("file://")
    ? path
    : path.startsWith("/")
      ? `file://${path}`
      : path;
}

/**
 * Native post-video editing uses the platform trimmer instead of a hand-built
 * slider. The native editor renders decoded frame thumbnails and owns the trim
 * handles, playback, seeking and export lifecycle.
 */
export function VideoEditorHost() {
  const request = useSyncExternalStore(
    subscribeVideoEdit,
    getVideoEdit,
    getServerVideoEdit,
  );
  const { isDark, theme } = useAppearance();
  const opened = useRef<number | null>(null);

  useEffect(() => {
    const module = NativeVideoTrim as Spec;

    const finished = module.onFinishTrimming(
      ({ outputPath, startTime, endTime, duration }) => {
        const active = getVideoEdit();
        if (!active || opened.current !== active.id) return;
        opened.current = null;
        finishVideoEdit(active.id, {
          uri: fileUri(outputPath),
          name: "post-trimmed.mp4",
          type: "video/mp4",
          durationMs:
            duration > 0 ? duration : Math.max(1_000, endTime - startTime),
        });
      },
    );

    const cancelled = module.onCancel(() => {
      const active = getVideoEdit();
      if (!active || opened.current !== active.id) return;
      opened.current = null;
      finishVideoEdit(active.id, null);
    });

    // Some platform dismissals only emit hide. Resolve a still-pending edit as
    // Cancel, but only after finish/cancel events have had a chance to clear it.
    const hidden = module.onHide(() => {
      setTimeout(() => {
        const active = getVideoEdit();
        if (!active || opened.current !== active.id) return;
        opened.current = null;
        finishVideoEdit(active.id, null);
      }, 0);
    });

    const failed = module.onError(({ message }) => {
      const active = getVideoEdit();
      if (!active || opened.current !== active.id) return;
      opened.current = null;
      try {
        closeEditor();
      } catch {
        // The native editor may already have dismissed itself.
      }
      failVideoEdit(
        active.id,
        new Error(message || "The video could not be trimmed. Try again."),
      );
    });

    return () => {
      finished.remove();
      cancelled.remove();
      hidden.remove();
      failed.remove();
      const active = getVideoEdit();
      if (active && opened.current === active.id) {
        try {
          closeEditor();
        } catch {
          // Nothing to close.
        }
        opened.current = null;
        finishVideoEdit(active.id, null);
      }
    };
  }, []);

  useEffect(() => {
    if (!request || opened.current === request.id) return;
    opened.current = request.id;

    try {
      showEditor(request.video.uri, {
        type: "video",
        outputExt: "mp4",
        maxDuration: MAX_POST_VIDEO_DURATION_MS,
        minDuration: 1_000,
        autoplay: true,
        fullScreenModalIOS: true,
        enableHapticFeedback: true,
        enableEditTools: false,
        enablePreciseTrimming: true,
        saveToPhoto: false,
        removeAudio: false,
        closeWhenFinish: true,
        enableCancelDialog: false,
        enableSaveDialog: false,
        enableCancelTrimming: true,
        enableCancelTrimmingDialog: false,
        cancelButtonText: "Cancel",
        saveButtonText: "Done",
        cancelTrimmingButtonText: "Cancel trimming",
        trimmingText: "Preparing video…",
        headerText: "Trim video",
        headerTextSize: 17,
        durationFormat: "mm:ss",
        theme: isDark ? "dark" : "light",
        headerTextColor: isDark ? "#FFFFFF" : "#171310",
        trimmerColor: theme.brand,
        handleIconColor: "#FFFFFF",
        waveformColor: isDark ? "#FFFFFF" : "#171310",
        waveformBackgroundColor: theme.surfaceMuted,
        alertOnFailToLoad: true,
        alertOnFailTitle: "Video unavailable",
        alertOnFailMessage:
          "This video could not be opened. Choose another video and try again.",
        alertOnFailCloseText: "Close",
      });
    } catch (error) {
      opened.current = null;
      failVideoEdit(
        request.id,
        error instanceof Error
          ? error
          : new Error("The video editor could not open. Try again."),
      );
    }
  }, [
    request?.id,
    request?.video.uri,
    isDark,
    theme.brand,
    theme.surfaceMuted,
  ]);

  return null;
}
