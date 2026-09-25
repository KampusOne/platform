import { createElement, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

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
}: {
  url: string;
  video?: boolean;
  label?: string;
}) {
  const { theme } = useAppearance();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
          src: retryMediaUrl(url, attempt),
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
