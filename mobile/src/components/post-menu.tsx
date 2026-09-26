import { InlineLoading } from "@/src/components/skeleton";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const [error, setError] = useState("");
  const [copyMode, setCopyMode] = useState(false);
  const afterDismiss = useRef<(() => void) | null>(null);
  const canDelete = post.can_delete === true;

  function close() {
    if (deleting) return;
    setOpen(false);
    setConfirm(false);
    setCopyMode(false);
    setError("");
  }

  function finishDismiss() {
    const action = afterDismiss.current;
    afterDismiss.current = null;
    action?.();
  }

  function share() {
    if (Platform.OS === "ios") {
      afterDismiss.current = () => onShare(post);
      close();
    } else {
      close();
      onShare(post);
    }
  }

  async function copy() {
    try {
      if (await copyPostLink(post.id)) {
        close();
        onFeedback("Post link copied.");
      } else {
        setCopyMode(true);
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
        accessibilityRole="button"
        accessibilityLabel={`More options for ${post.title}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync();
          setConfirm(false);
          setCopyMode(false);
          setError("");
          afterDismiss.current = null;
          setOpen(true);
        }}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={21} color={theme.textMuted} />
      </Pressable>

      <Modal transparent visible={open} animationType="none" onRequestClose={close} onDismiss={finishDismiss}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close post options" disabled={deleting} onPress={close} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={styles.title}>{copyMode ? "Copy post link" : confirm ? "Delete this post?" : "Post options"}</Text>

              {copyMode ? (
                <>
                  <Text style={styles.body}>Press and hold the link, or select it, then choose Copy.</Text>
                  <Text selectable style={styles.link}>{postUrl(post.id)}</Text>
                  <Pressable accessibilityRole="button" onPress={close} style={styles.row}><Text style={styles.label}>Done</Text></Pressable>
                </>
              ) : confirm ? (
                <>
                  <Text style={styles.body}>It will disappear from the feed and saved posts. You cannot undo this in the app.</Text>
                  <Pressable accessibilityRole="button" accessibilityState={{ disabled: deleting, busy: deleting }} disabled={deleting} onPress={() => void remove()} style={styles.row}>
                    {deleting ? <InlineLoading color="#B3261E" /> : <Ionicons name="trash-outline" size={21} color="#B3261E" />}
                    <Text style={[styles.label, styles.danger]}>{deleting ? "Deleting…" : "Delete post"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={deleting} onPress={close} style={styles.row}>
                    <Text style={styles.label}>Cancel</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {row("share-social-outline", "Share post", share)}
                  {row("link-outline", "Copy link", () => void copy())}
                  {row(post.bookmarked ? "bookmark" : "bookmark-outline", post.bookmarked ? "Unsave post" : "Save post", () => { close(); onBookmark(post); })}
                  {canDelete ? row("trash-outline", "Delete post", () => { setError(""); setConfirm(true); }, true) : null}
                  {row("close-outline", "Cancel", close)}
                </>
              )}

              {error ? <Text accessibilityRole="alert" style={[styles.body, styles.danger]}>{error}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
