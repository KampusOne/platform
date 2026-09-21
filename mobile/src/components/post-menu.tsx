import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import * as Haptics from "@/src/lib/haptics";
import { copyPostLink, markPostDeleted, postUrl, type FeedPostData } from "@/src/lib/feed-posts";

type Props = {
  post: FeedPostData;
  onBookmark(post: FeedPostData): void;
  onShare(post: FeedPostData): void;
  onDeleted(id: string): void;
  onFeedback(message: string): void;
};

export function PostLinkDialog({ id, onClose }: { id: string | null; onClose(): void }) {
  const { styles } = useThemeStyles(createStyles);
  return (
    <Modal transparent visible={id !== null} animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close post link" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>Copy post link</Text>
          <Text style={styles.body}>Press and hold the link, or select it, then choose Copy.</Text>
          <Text selectable style={styles.link}>{id ? postUrl(id) : ""}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.row}>
            <Text style={styles.label}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function PostMenu({ post, onBookmark, onShare, onDeleted, onFeedback }: Props) {
  const { theme, styles } = useThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [copyId, setCopyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setChecking(true);
    setCanDelete(false);
    setError("");
    void api<{ post: FeedPostData }>(`/v1/student/feed/${post.id}`)
      .then(({ post: current }) => { if (active) setCanDelete(current.can_delete === true); })
      .catch((caught) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not check post options. Check your connection and try again.");
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [open, post.id, retry]);

  function close() {
    if (deleting) return;
    setOpen(false);
    setConfirm(false);
    setError("");
  }

  async function copy() {
    try {
      if (await copyPostLink(post.id)) {
        close();
        onFeedback("Post link copied.");
      } else {
        close();
        setCopyId(post.id);
      }
    } catch {
      setError("The post link could not be copied. Please try again.");
    }
  }

  async function remove() {
    if (deleting || !canDelete) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/v1/student/feed/${post.id}`, { method: "DELETE" });
      markPostDeleted(post.id);
      setOpen(false);
      setConfirm(false);
      onDeleted(post.id);
      onFeedback("Post deleted.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your post was not deleted. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  function row(icon: keyof typeof Ionicons.glyphMap, label: string, action: () => void, destructive = false) {
    return (
      <Pressable accessibilityRole="button" onPress={action} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Ionicons name={icon} size={21} color={destructive ? "#B3261E" : theme.text} />
        <Text style={[styles.label, destructive && styles.danger]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`More options for ${post.title}`}
        accessibilityState={{ expanded: open }} hitSlop={4}
        onPress={() => { void Haptics.selectionAsync(); setCanDelete(false); setChecking(true); setConfirm(false); setOpen(true); }}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={21} color={theme.textMuted} />
      </Pressable>
      <Modal transparent visible={open} animationType="none" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close post options" disabled={deleting} onPress={close} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={styles.title}>{confirm ? "Delete this post?" : "Post options"}</Text>
              {confirm ? (
                <>
                  <Text style={styles.body}>It will disappear from the feed and saved posts. You cannot undo this in the app.</Text>
                  <Pressable accessibilityRole="button" accessibilityState={{ disabled: deleting, busy: deleting }} disabled={deleting} onPress={() => void remove()} style={styles.row}>
                    {deleting ? <ActivityIndicator color="#B3261E" /> : <Ionicons name="trash-outline" size={21} color="#B3261E" />}
                    <Text style={[styles.label, styles.danger]}>{deleting ? "Deleting…" : "Delete post"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={deleting} onPress={close} style={styles.row}>
                    <Text style={styles.label}>Cancel</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {row("share-social-outline", "Share post", () => { close(); onShare(post); })}
                  {row("link-outline", "Copy link", () => void copy())}
                  {row(post.bookmarked ? "bookmark" : "bookmark-outline", post.bookmarked ? "Unsave post" : "Save post", () => { close(); onBookmark(post); })}
                  {checking ? <View style={styles.row}><ActivityIndicator color={theme.brand} /><Text style={styles.body}>Checking post permissions…</Text></View> : null}
                  {!checking && canDelete ? row("trash-outline", "Delete post", () => { setError(""); setConfirm(true); }, true) : null}
                  {error && !checking ? row("refresh-outline", "Retry post options", () => setRetry((value) => value + 1)) : null}
                  {row("close-outline", "Cancel", close)}
                </>
              )}
              {error ? <Text accessibilityRole="alert" style={[styles.body, styles.danger]}>{error}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
    </>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  trigger: { alignItems: "center", justifyContent: "center", width: 40, height: 44, marginLeft: 4 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.4)", justifyContent: "flex-end", alignItems: "center", padding: 12 },
  sheet: { backgroundColor: theme.canvas, borderRadius: 22, padding: 20, width: "100%", maxWidth: 520, maxHeight: "85%", borderColor: theme.border, borderWidth: 1 },
  title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 19, marginBottom: 10 },
  row: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 10 },
  label: { color: theme.text, fontFamily: theme.font.medium, fontSize: 15, flexShrink: 1 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  link: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 14, lineHeight: 22, paddingVertical: 18 },
  danger: { color: "#B3261E" },
  pressed: { opacity: 0.65 },
});
