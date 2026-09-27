import { createElement, useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

export type MediaPlaybackMode = "unmanaged" | "feed-autoplay" | "manual-managed";

export type MediaPlaybackHandle = {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
  setViewportVisible(visible: boolean): void;
};

function retryMediaUrl(value: string, attempt: number) {
  if (!attempt) return value;
  try {
    const url = new URL(value, "https://media.invalid");
    url.searchParams.set("retry", String(attempt));
    return url.origin === "https://media.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : url.toString();
  } catch {
    return value;
  }
}

export function MediaPreview({
  url,
  video = false,
  label = "Attached media",
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
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportVisibleRef = useRef(playbackMode === "unmanaged");
  const resumeWhenVisibleRef = useRef(false);
  const didApplyInitialFeedMute = useRef(false);

  useEffect(() => {
    if (!video || playbackMode === "unmanaged" || !onPlaybackHandle) return;
    const handle: MediaPlaybackHandle = {
      measureInWindow(callback) {
        const element = videoRef.current;
        if (!element) {
          callback(0, 0, 0, 0);
          return;
        }
        const bounds = element.getBoundingClientRect();
        callback(bounds.x, bounds.y, bounds.width, bounds.height);
      },
      setViewportVisible(visible) {
        viewportVisibleRef.current = visible;
        const element = videoRef.current;
        if (!element) return;
        if (!visible || suspended) {
          if (!element.paused) resumeWhenVisibleRef.current = true;
          element.pause();
          return;
        }
        if (playbackMode === "feed-autoplay") {
          if (!didApplyInitialFeedMute.current) {
            element.muted = true;
            didApplyInitialFeedMute.current = true;
          }
          void element.play().catch(() => undefined);
          return;
        }
        if (resumeWhenVisibleRef.current) {
          resumeWhenVisibleRef.current = false;
          void element.play().catch(() => undefined);
        }
      },
    };
    onPlaybackHandle(handle);
    return () => onPlaybackHandle(null);
  }, [onPlaybackHandle, playbackMode, suspended, video]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (suspended) {
      if (!element.paused) resumeWhenVisibleRef.current = true;
      element.pause();
    } else if (viewportVisibleRef.current && resumeWhenVisibleRef.current) {
      resumeWhenVisibleRef.current = false;
      void element.play().catch(() => undefined);
    }
  }, [suspended]);

  return (
    <View style={{ marginVertical: 10 }}>
      {error ? (
        <View
          accessibilityRole="alert"
          style={{
            minHeight: 130,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            borderRadius: 16,
            backgroundColor: theme.surfaceMuted,
            padding: 18,
          }}
        >
          <Text style={{ color: theme.error, fontFamily: theme.font.body }}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={video ? "Retry video" : "Retry image"}
            onPress={() => {
              setAttempt((value) => value + 1);
              setError("");
            }}
            style={({ pressed }) => ({
              minHeight: 40,
              justifyContent: "center",
              paddingHorizontal: 16,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: theme.text, fontFamily: theme.font.medium }}>
              {video ? "Retry video" : "Retry image"}
            </Text>
          </Pressable>
        </View>
      ) : video ? (
        createElement("video", {
          key: `${url}:${attempt}`,
          ref: videoRef,
          src: retryMediaUrl(url, attempt),
          controls: true,
          muted: playbackMode === "feed-autoplay",
          preload: "metadata",
          playsInline: true,
          "aria-label": label,
          style: {
            width: "100%",
            maxHeight: 360,
            borderRadius: 16,
            background: "#080808",
            objectFit: "contain",
          },
          onClick: (event) => event.stopPropagation(),
          onDoubleClick: (event) => {
            event.stopPropagation(); event.preventDefault();
            const video = event.currentTarget as HTMLVideoElement;
            const bounds = video.getBoundingClientRect();
            const delta = event.clientX - bounds.left < bounds.width / 2 ? -5 : 5;
            video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, video.currentTime + delta));
          },
          onError: () => setError("This video could not load."),
        })
      ) : (
        <Image
          key={`${url}:${attempt}`}
          accessibilityLabel={label}
          source={{ uri: retryMediaUrl(url, attempt) }}
          onError={() => setError("This image could not load.")}
          resizeMode="contain"
          style={{
            height: 240,
            width: "100%",
            borderRadius: 16,
            backgroundColor: theme.surfaceMuted,
          }}
        />
      )}
    </View>
  );
}
