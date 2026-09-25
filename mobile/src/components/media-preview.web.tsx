import { createElement, useState } from "react";
import { Image, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";
export function MediaPreview({
  url,
  video = false,
  label = "Attached media",
}: {
  url: string;
  video?: boolean;
  label?: string;
}) {
  const { theme } = useAppearance();
  const [error, setError] = useState("");
  return (
    <View style={{ marginVertical: 10 }}>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.error }}>
          {error}
        </Text>
      ) : video ? (
        createElement("video", {
          src: url,
          controls: true,
          preload: "metadata",
          playsInline: true,
          "aria-label": label,
          style: {
            width: "100%",
            maxHeight: 360,
            borderRadius: 16,
            background: theme.surfaceMuted,
          },
          onError: () =>
            setError("This video could not load. Reopen the post to retry."),
        })
      ) : (
        <Image
          accessibilityLabel={label}
          source={{ uri: url }}
          onError={() =>
            setError("This image could not load. Reopen the post to retry.")
          }
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
