import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { safeCount, type SocialFeedPost } from "@/src/lib/feed-social";

export function RepostAction({ post, onFeedback, onChanged }: { post: SocialFeedPost; onFeedback(message: string): void; onChanged?: ((post: SocialFeedPost) => void) | undefined }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState({ reposted: Boolean(post.reposted), count: safeCount(post.repost_count) });
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!locked.current) setValue({ reposted: Boolean(post.reposted), count: safeCount(post.repost_count) });
  }, [post.id, post.reposted, post.repost_count]);

  async function toggle() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const next = !value.reposted;
    try {
      const result = await api<{ reposted: boolean; post?: SocialFeedPost }>(`/v1/student/feed/${post.id}/repost`, { method: next ? "PUT" : "DELETE" });
      const updated = result.post ?? { ...post, reposted: false, repost_count: Math.max(0, value.count - 1), repost_by: null };
      if (alive.current) {
        setValue({ reposted: result.reposted, count: safeCount(updated.repost_count) });
        setOpen(false);
        onChanged?.(updated);
        onFeedback(next ? (post.visibility === "PUBLIC" ? "Reposted to the shared feed." : "Reposted to this campus feed.") : "Your repost was removed.");
      }
    } catch (error) {
      if (alive.current) onFeedback(error instanceof Error ? error.message : "Could not update your repost. Please try again.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${value.count} reposts. ${value.reposted ? "Reposted" : "Repost or quote post"}`} accessibilityState={{ selected: value.reposted, disabled: busy }} disabled={busy} onPress={() => setOpen(true)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        {busy ? <ActivityIndicator size="small" color={theme.brand} /> : <Ionicons name="repeat-outline" size={19} color={value.reposted ? theme.brandPressed : theme.textMuted} />}
        <Text style={[styles.count, value.reposted && styles.active]}>{value.count}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={() => { if (!busy) setOpen(false); }}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close repost menu" disabled={busy} onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.heading}>Share this post</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggle()} style={styles.option}><Ionicons name="repeat-outline" size={22} color={theme.text} /><Text style={styles.label}>{busy ? "Updating…" : value.reposted ? "Undo repost" : "Repost"}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setOpen(false); router.push({ pathname: "/compose", params: { quote: post.id } }); }} style={styles.option}><Ionicons name="create-outline" size={22} color={theme.text} /><Text style={styles.label}>Quote post</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOpen(false)} style={styles.option}><Text style={styles.cancel}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
const createStyles = (theme: Theme) => StyleSheet.create({
  action: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, minWidth: 44 },
  count: { color: theme.textMuted, fontSize: 11, fontFamily: theme.font.medium },
  active: { color: theme.brandPressed },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,.4)", padding: 24 },
  sheet: { width: "100%", maxWidth: 420, borderRadius: 18, padding: 18, backgroundColor: theme.canvas },
  heading: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16, marginBottom: 8 },
  option: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8 },
  label: { color: theme.text, fontSize: 15, fontFamily: theme.font.medium },
  cancel: { color: theme.textMuted, fontSize: 14, fontFamily: theme.font.medium },
  pressed: { opacity: 0.7 },
});
