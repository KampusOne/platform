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
  const { mediaId, type, name } = useLocalSearchParams<{ mediaId: string; type?: string; name?: string }>();
  const { theme, styles } = useThemeStyles(createStyles);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const isVideo = String(type ?? "").startsWith("video/");

  async function load() {
    if (!mediaId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/v1/media/${mediaId}/access`, { method: "POST" });
      setUrl(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This media could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [mediaId]);

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
  title: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "600", textAlign: "center" },
  content: { flex: 1, alignItems: "center", justifyContent: "center" },
  media: { width: "100%", height: "100%" },
  errorState: { alignItems: "center", gap: 12, paddingHorizontal: 28 },
  errorText: { color: "#FFFFFF", fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { minHeight: 42, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  retryText: { color: "#111111", fontSize: 13, fontWeight: "700" },
});
