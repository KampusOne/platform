import { memo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageProps } from "react-native";
import { useThemeStyles } from "@/src/lib/appearance";
import { SkeletonBlock } from "./skeleton";

type Props = Omit<ImageProps, "source"> & { uri: string };
export const MediaImage = memo(function MediaImage({ uri, style, accessibilityLabel = "Image", onError, onLoad, ...props }: Props) {
  // Keyed inner state prevents a reused feed cell from showing a previous image's loading state.
  return <ImageFrame key={uri} uri={uri} style={style} accessibilityLabel={accessibilityLabel} onError={onError} onLoad={onLoad} {...props} />;
});
function ImageFrame({ uri, style, onError, onLoad, accessibilityLabel, ...props }: Props) {
  const { theme } = useThemeStyles(() => ({}));
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return <View style={[style, { overflow: "hidden", backgroundColor: theme.surfaceMuted }]}>
    {status === "loading" ? <View pointerEvents="none" style={StyleSheet.absoluteFill}><SkeletonBlock height="100%" radius={0} /></View> : null}
    <Image {...props} key={attempt} accessibilityLabel={accessibilityLabel} source={{ uri }} style={StyleSheet.absoluteFill}
      onLoad={(event) => { setStatus("loaded"); onLoad?.(event); }}
      onError={(event) => { setStatus("error"); onError?.(event); }} />
    {status === "error" ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading image" onPress={(event) => { event.stopPropagation(); setStatus("loading"); setAttempt((n) => n + 1); }} style={styles.retry}><Text style={{ color: theme.textMuted, fontSize: 12 }}>Image unavailable · Tap to retry</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({ retry: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 12 } });
