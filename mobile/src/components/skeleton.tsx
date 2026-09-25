import { type ReactNode } from "react";
import { StyleSheet, View, type ColorValue, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { useThemeStyles } from "@/src/lib/appearance";

/** Static skeletons are intentional: no animation work while fetching/decoding on slower phones. */
export function SkeletonBlock({ width = "100%", height = 14, radius = 6, style }: {
  width?: DimensionValue; height?: DimensionValue; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useThemeStyles(() => ({}));
  return <View accessible={false} style={[{ backgroundColor: theme.surfaceMuted, width, height, borderRadius: radius }, style]} />;
}
function LoadingRegion({ children, label, style }: { children: ReactNode; label: string; style?: StyleProp<ViewStyle> }) {
  return <View accessibilityLabel={label} accessibilityState={{ busy: true }} style={style}>{children}</View>;
}
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return <LoadingRegion label="Loading posts" style={styles.feed}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={styles.post}>
      <SkeletonBlock width={38} height={38} radius={19} />
      <View style={styles.copy}><SkeletonBlock width="56%" /><SkeletonBlock /><SkeletonBlock width="84%" />
        {i === 0 ? <SkeletonBlock height={155} radius={12} /> : null}
        <View style={styles.actions}>{[0, 1, 2, 3, 4].map((n) => <SkeletonBlock key={n} width={26} height={10} />)}</View>
      </View>
    </View>)}
  </LoadingRegion>;
}
export function ProfileSkeleton() {
  return <LoadingRegion label="Loading profile" style={styles.profile}>
    <SkeletonBlock height={170} radius={0} />
    <View style={styles.identity}><SkeletonBlock width={76} height={76} radius={38} />
      <SkeletonBlock width="55%" height={24} /><SkeletonBlock width="34%" />
      <SkeletonBlock /><SkeletonBlock width="70%" /><ListSkeleton count={3} />
    </View>
  </LoadingRegion>;
}
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return <LoadingRegion label="Loading content" style={styles.list}>{Array.from({ length: count }, (_, i) =>
    <View key={i} style={styles.row}><SkeletonBlock width={44} height={44} radius={10} /><View style={styles.copy}><SkeletonBlock width="65%" /><SkeletonBlock width="90%" /></View></View>)}</LoadingRegion>;
}
export function ScreenSkeleton({ variant: _variant, compact: _compact }: { variant?: string; compact?: boolean } = {}) {
  const { theme } = useThemeStyles(() => ({}));
  return <LoadingRegion label="Loading page" style={[styles.screen, { backgroundColor: theme.canvas }]}>
    <SkeletonBlock width="48%" height={28} /><SkeletonBlock width="72%" />
    <SkeletonBlock height={152} radius={14} /><ListSkeleton count={4} />
  </LoadingRegion>;
}
/** Compact, non-circular progress for actions. Existing content and button labels stay visible. */
export function InlineLoading({ color, size, style }: { color?: ColorValue; size?: number | "small" | "large"; style?: StyleProp<ViewStyle> }) {
  const { theme } = useThemeStyles(() => ({}));
  return <View accessibilityLabel="Working" accessibilityState={{ busy: true }} style={[styles.inline, { width: size === "large" ? 48 : typeof size === "number" ? Math.max(size, 20) : 28, backgroundColor: color ?? theme.brand }, style]} />;
}
const styles = StyleSheet.create({
  screen: { width: "100%", maxWidth: 540, alignSelf: "center", padding: 24, paddingTop: 24, gap: 18, flex: 1 },
  feed: { width: "100%" }, post: { flexDirection: "row", gap: 9, paddingVertical: 16 }, copy: { flex: 1, gap: 10 },
  actions: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  list: { width: "100%", gap: 18, paddingVertical: 14 }, row: { flexDirection: "row", gap: 12, alignItems: "center" },
  profile: { width: "100%", maxWidth: 540, alignSelf: "center" }, identity: { padding: 20, gap: 14 },
  inline: { height: 4, borderRadius: 2, alignSelf: "center", marginVertical: 6, opacity: 0.65 },
});
