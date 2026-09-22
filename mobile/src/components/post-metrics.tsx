import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { compactCount } from "@/src/lib/feed-time";
import { safeCount, type SocialFeedPost } from "@/src/lib/feed-social";

export function PostMetrics({ post, detail = false }: { post: SocialFeedPost; detail?: boolean }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [open, setOpen] = useState(false);
  const available = typeof post.view_count === "number" && Number.isFinite(post.view_count);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={available ? `${post.view_count} views. Open post activity` : "Open post activity. View count unavailable"} onPress={() => setOpen(true)} style={styles.action}>
      <Ionicons name="stats-chart-outline" size={18} color={theme.textMuted} />
      <Text style={styles.count}>{available ? compactCount(post.view_count) : "—"}{detail ? " Views" : ""}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close post activity" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Post activity</Text><Pressable accessibilityRole="button" accessibilityLabel="Close post activity" onPress={() => setOpen(false)} style={styles.close}><Ionicons name="close" size={23} color={theme.text} /></Pressable></View>
          <View style={styles.row}><Text style={styles.label}>Views</Text><Text style={styles.value}>{available ? safeCount(post.view_count).toLocaleString("en-NG") : "Not available yet"}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Replies</Text><Text style={styles.value}>{safeCount(post.comment_count).toLocaleString("en-NG")}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Reposts</Text><Text style={styles.value}>{safeCount(post.repost_count).toLocaleString("en-NG")}</Text></View>
          <Text style={styles.note}>Views count signed-in accounts that saw this post in the feed or opened it. Each account is counted once. Counts start when view tracking is enabled; earlier views are not estimated.</Text>
        </View>
      </View>
    </Modal>
  </>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  action: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 }, count: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.38)", justifyContent: "flex-end", alignItems: "center" }, sheet: { backgroundColor: theme.canvas, width: "100%", maxWidth: 600, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 36 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }, title: { fontFamily: theme.font.semibold, color: theme.text, fontSize: 19 }, close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, label: { fontFamily: theme.font.body, color: theme.textMuted, fontSize: 14 }, value: { fontFamily: theme.font.semibold, color: theme.text, fontSize: 14 }, note: { marginTop: 18, fontFamily: theme.font.body, color: theme.textMuted, fontSize: 12, lineHeight: 18 },
});
