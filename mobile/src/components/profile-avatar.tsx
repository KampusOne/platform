import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

/** Use the saved public profile image; never substitute a post attachment. */
export function ProfileAvatar({ name, imageUrl, size = 36 }: {
  name: string; imageUrl?: string | null | undefined; size?: number;
}) {
  const { styles } = useThemeStyles(createStyles);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const uri = typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl) ? imageUrl : null;
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase("en-NG") || "?";
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return <View accessible accessibilityRole="image" accessibilityLabel={`${name}'s profile picture`} style={[styles.avatar, dimensions]}>
    {uri && failedUrl !== uri
      ? <Image accessible={false} accessibilityIgnoresInvertColors source={{ uri }} resizeMode="cover" onError={() => setFailedUrl(uri)} style={dimensions} />
      : <Text accessible={false} style={[styles.initials, { fontSize: size * 0.3 }]}>{initials}</Text>}
  </View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  avatar: { flexShrink: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: theme.sand },
  initials: { color: theme.deepBrand, fontFamily: theme.font.bold },
});
