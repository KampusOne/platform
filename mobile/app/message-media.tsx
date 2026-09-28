import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { VideoView, useVideoPlayer } from "expo-video";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

function VideoMedia({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={stylesStatic.media} />;
}

export default function MessageMediaScreen() {
  const { mediaId, mediaIds, type, name } = useLocalSearchParams<{ mediaId: string; mediaIds?: string; type?: string; name?: string }>();
  const { theme, styles } = useThemeStyles(createStyles);
  const gallery = String(mediaIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ids = gallery.length ? gallery : mediaId ? [mediaId] : [];
  const initialIndex = Math.max(0, ids.indexOf(mediaId));
  const [index, setIndex] = useState(initialIndex);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const activeId = ids[index] || mediaId;
  const isVideo = String(type ?? "").startsWith("video/");

  async function load() {
    if (!activeId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/v1/media/${activeId}/access`, { method: "POST" });
      setUrl(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This media could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUrl("");
    void load();
  }, [activeId]);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close media viewer" onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>{name || (isVideo ? "Video" : "Picture")}</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.content}>
        {loading ? <ActivityIndicator size="large" color="#FFFFFF" /> : null}
        {!loading && error ? (
          <View style={styles.errorState}>
            <Ionicons name="alert-circle-outline" size={32} color="#FFFFFF" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !error && url ? (
          isVideo ? (
            <VideoMedia uri={url} />
          ) : (
            <Image accessibilityLabel={name || "Message picture"} source={{ uri: url }} resizeMode="contain" style={styles.media} />
          )
        ) : null}
        {ids.length > 1 ? (
          <View style={styles.galleryControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous picture"
              disabled={index === 0}
              onPress={() => setIndex((value) => Math.max(0, value - 1))}
              style={[styles.galleryButton, index === 0 && styles.galleryButtonDisabled]}
            >
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.galleryCount}>{index + 1} of {ids.length}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next picture"
              disabled={index >= ids.length - 1}
              onPress={() => setIndex((value) => Math.min(ids.length - 1, value + 1))}
              style={[styles.galleryButton, index >= ids.length - 1 && styles.galleryButtonDisabled]}
            >
              <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const stylesStatic = StyleSheet.create({
  media: { width: "100%", height: "100%" },
});

const createStyles = (_theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  headerButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: "#FFFFFF", fontFamily: _theme.font.semibold, fontSize: 14, textAlign: "center" },
  content: { flex: 1, alignItems: "center", justifyContent: "center" },
  media: { width: "100%", height: "100%" },
  errorState: { alignItems: "center", gap: 12, paddingHorizontal: 28 },
  errorText: { color: "#FFFFFF", fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { minHeight: 42, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  retryText: { color: "#111111", fontFamily: _theme.font.semibold, fontSize: 13 },
  galleryControls: { position: "absolute", left: 0, right: 0, bottom: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  galleryButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  galleryButtonDisabled: { opacity: 0.3 },
  galleryCount: { minWidth: 64, color: "#FFFFFF", fontFamily: _theme.font.semibold, fontSize: 12, textAlign: "center" },
});
