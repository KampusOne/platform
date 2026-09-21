import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { mergeById, type CommentPage, type FeedComment } from "@/src/lib/feed-social";

export function CommentThread({ postId, focusToken = 0, onUpdated }: { postId: string; focusToken?: number; onUpdated(): void }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<FeedComment | null>(null);
  const field = useRef<TextInput>(null);
  const requestId = useRef(randomUUID());
  const mutationLock = useRef(false);
  const loadingLock = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const removed = useRef(new Set<string>());

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { if (focusToken > 0) field.current?.focus(); }, [focusToken]);

  const load = useCallback(async (after: string | null = null) => {
    if (loadingLock.current || mutationLock.current) return;
    loadingLock.current = true;
    const version = ++generation.current;
    if (after) setMore(true); else setLoading(true);
    setError("");
    try {
      const page = await api<CommentPage>(`/v1/student/feed/${postId}/comments${after ? `?cursor=${encodeURIComponent(after)}` : ""}`);
      if (alive.current && version === generation.current) {
        setComments((current) => mergeById(after ? current : [], page.comments).filter((comment) => !removed.current.has(comment.id)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
        setCursor(page.nextCursor ?? null);
      }
    } catch (caught) {
      if (alive.current && version === generation.current) setError(caught instanceof Error ? caught.message : "Could not load comments. Please try again.");
    } finally {
      loadingLock.current = false;
      if (alive.current) { setLoading(false); setMore(false); }
    }
  }, [postId]);

  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));

  async function send() {
    const text = body.trim();
    if (!text || mutationLock.current) return;
    mutationLock.current = true;
    generation.current++;
    setSending(true);
    setError("");
    try {
      const result = await api<{ comment: FeedComment }>(`/v1/student/feed/${postId}/comments`, { method: "POST", body: JSON.stringify({ body: text, requestId: requestId.current }) });
      if (alive.current) {
        setComments((current) => mergeById(current, [result.comment]).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
        setBody("");
        requestId.current = randomUUID();
        onUpdated();
      }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : "Your comment was not confirmed. Your draft is still here; try again.");
    } finally {
      mutationLock.current = false;
      if (alive.current) setSending(false);
    }
  }

  async function deleteComment() {
    if (!selected || mutationLock.current) return;
    mutationLock.current = true;
    generation.current++;
    setDeleting(true);
    setError("");
    try {
      await api(`/v1/student/feed/${postId}/comments/${selected.id}`, { method: "DELETE" });
      removed.current.add(selected.id);
      if (alive.current) {
        setComments((current) => current.filter((comment) => comment.id !== selected.id));
        setSelected(null);
        onUpdated();
      }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : "Your comment could not be deleted. Please try again.");
    } finally {
      mutationLock.current = false;
      if (alive.current) setDeleting(false);
    }
  }

  return (
    <View style={styles.thread}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>Comments</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh comments" disabled={loading || sending || deleting} onPress={() => void load()} style={styles.iconButton}><Ionicons name="refresh-outline" color={theme.textMuted} size={19} /></Pressable>
      </View>
      <TextInput ref={field} accessibilityLabel="Write a comment" multiline maxLength={2000} editable={!sending && !deleting} placeholder="Add to the conversation…" placeholderTextColor={theme.textSubtle} value={body} onChangeText={(text) => { setBody(text); requestId.current = randomUUID(); }} style={styles.input} />
      <View style={styles.composerFooter}>
        <Text style={styles.small}>{body.length}/2000</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Post comment" accessibilityState={{ disabled: sending || deleting || !body.trim(), busy: sending }} disabled={sending || deleting || !body.trim()} onPress={() => void send()} style={[styles.send, (sending || deleting || !body.trim()) && styles.disabled]}>
          {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.sendText}>Comment</Text>}
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.brand} style={styles.loader} /> : null}
      {!loading && !error && !comments.length ? <Text style={styles.empty}>No comments yet. Start the conversation.</Text> : null}
      {comments.map((comment) => (
        <View key={comment.id} style={styles.comment}>
          <View style={styles.commentHeader}>
            <Text numberOfLines={1} style={styles.author}>{comment.author_name}</Text>
            {comment.author_verified ? <Ionicons name="checkmark-circle" size={13} color={theme.brand} /> : null}
            <Text style={styles.time}>{new Date(comment.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</Text>
            {comment.can_delete ? <Pressable accessibilityRole="button" accessibilityLabel="Delete your comment" disabled={sending || deleting} onPress={() => setSelected(comment)} style={styles.iconButton}><Ionicons name="ellipsis-horizontal" size={19} color={theme.textMuted} /></Pressable> : null}
          </View>
          <Text selectable style={styles.body}>{comment.body}</Text>
        </View>
      ))}
      {cursor ? <Pressable accessibilityRole="button" disabled={more || loading || sending || deleting} onPress={() => void load(cursor)} style={styles.loadMore}><Text style={styles.loadMoreText}>{more ? "Loading…" : "More comments"}</Text></Pressable> : null}
      {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.loadMore}><Text style={styles.loadMoreText}>Retry loading comments</Text></Pressable> : null}
      <Modal visible={Boolean(selected)} transparent animationType="none" onRequestClose={() => { if (!deleting) setSelected(null); }}>
        <View style={styles.overlay}><View accessibilityViewIsModal style={styles.dialog}>
          <Text style={styles.heading}>Delete your comment?</Text><Text style={styles.dialogCopy}>This removes your comment from the conversation. It cannot be undone.</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.dialogActions}><Pressable accessibilityRole="button" disabled={deleting} onPress={() => setSelected(null)} style={styles.loadMore}><Text style={styles.loadMoreText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" disabled={deleting} onPress={() => void deleteComment()} style={styles.send}><Text style={styles.sendText}>{deleting ? "Deleting…" : "Delete"}</Text></Pressable></View>
        </View></View>
      </Modal>
    </View>
  );
}
const createStyles = (theme: Theme) => StyleSheet.create({
  thread: { marginTop: 16 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 17 },
  input: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 13, minHeight: 90, maxHeight: 220, textAlignVertical: "top" },
  composerFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 12 },
  small: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
  send: { backgroundColor: theme.deepBrand, minHeight: 44, minWidth: 96, paddingHorizontal: 16, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 }, disabled: { opacity: 0.5 },
  error: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 19, marginVertical: 10 }, loader: { marginVertical: 20 },
  empty: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, paddingVertical: 22 },
  comment: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 14, paddingTop: 8 },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36 },
  author: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, flexShrink: 1 },
  time: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10, marginLeft: "auto" },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  body: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21 },
  loadMore: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  loadMoreText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { backgroundColor: theme.canvas, padding: 22, borderRadius: 16, maxWidth: 420, width: "100%", gap: 12 },
  dialogCopy: { color: theme.textMuted, fontSize: 14, lineHeight: 21, fontFamily: theme.font.body },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
});
