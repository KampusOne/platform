import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError, clearApiCache } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { validPostId, type FeedComment, type FeedPostData, type FeedSocialStats } from "@/src/lib/feed-posts";

type Panel = "comments" | "repost" | "quote" | null;
type CommentsPage = { comments: FeedComment[]; nextCursor: string | null; comment_count: number };
type Mutation = { stats: FeedSocialStats | null; comment?: FeedComment; id?: string };
const message = (error: unknown) => error instanceof ApiError ? error.message : "Check your connection and try again. Your text is still here.";
const compactCount = (count: number) => count > 999 ? `${Math.floor(count / 100) / 10}k` : String(count);

async function socialRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  try { return await api<T>(path, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function initialStats(post: FeedPostData): FeedSocialStats {
  return { comment_count: post.comment_count ?? 0, repost_count: post.repost_count ?? 0, quote_count: post.quote_count ?? 0, reposted: post.reposted ?? false };
}

export function FeedSocialActions({ post, onFeedback }: { post: FeedPostData; onFeedback(text: string): void }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<Panel>(null);
  const [stats, setStats] = useState(() => initialStats(post));
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [quoteDraft, setQuoteDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(true);
  const alive = useRef(true);
  const writing = useRef(false);
  const readVersion = useRef(0);
  const deletedComments = useRef(new Set<string>());
  const requests = useRef<{ comments?: { body: string; id: string }; quote?: { body: string; id: string } }>({});

  useEffect(() => {
    alive.current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive.current) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { alive.current = false; readVersion.current++; subscription.remove(); };
  }, []);

  useEffect(() => {
    setStats(initialStats(post));
  }, [post.id, post.comment_count, post.repost_count, post.quote_count, post.reposted]);

  async function loadComments(cursor: string | null = null) {
    const version = ++readVersion.current;
    setLoading(true);
    setError("");
    try {
      const data = await socialRequest<CommentsPage>(`/v1/student/feed/${post.id}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!alive.current || version !== readVersion.current) return;
      setComments((current) => {
        const all = cursor ? [...current, ...data.comments] : data.comments;
        const unique = new Map(all.filter((item) => !deletedComments.current.has(item.id)).map((item) => [item.id, item]));
        return [...unique.values()];
      });
      setNextCursor(data.nextCursor);
      setStats((current) => ({ ...current, comment_count: data.comment_count }));
    } catch (caught) {
      if (alive.current && version === readVersion.current) setError(message(caught));
    } finally {
      if (alive.current && version === readVersion.current) setLoading(false);
    }
  }

  function close() {
    if (writing.current) return;
    readVersion.current++;
    setLoading(false);
    setPanel(null);
    setDeleteTarget(null);
    setError("");
  }

  function openComments() {
    setPanel("comments");
    setDeleteTarget(null);
    void loadComments();
  }

  function requestId(kind: "comments" | "quote", body: string) {
    const existing = requests.current[kind];
    if (existing?.body === body) return existing.id;
    const id = randomUUID();
    requests.current[kind] = { body, id };
    return id;
  }

  async function submit(kind: "comments" | "quote") {
    const body = (kind === "comments" ? commentDraft : quoteDraft).trim();
    if (!body || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await socialRequest<Mutation>(`/v1/student/feed/${post.id}/${kind}`, {
        method: "POST", body: JSON.stringify({ body, requestId: requestId(kind, body) }),
      });
      if ((kind === "comments" && !result.comment) || (kind === "quote" && !validPostId(result.id))) throw new Error("Unconfirmed response");
      if (!alive.current) return;
      readVersion.current++;
      setLoading(false);
      clearApiCache();
      if (result.stats) setStats(result.stats);
      delete requests.current[kind];
      if (kind === "comments") {
        const comment = result.comment!;
        setCommentDraft("");
        setComments((items) => [comment, ...items.filter((item) => item.id !== comment.id)]);
        void loadComments();
      } else {
        setQuoteDraft("");
        setPanel(null);
        onFeedback("Quote posted.");
        router.push({ pathname: "/post", params: { id: result.id! } });
      }
    } catch (caught) {
      if (alive.current) setError(message(caught));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await socialRequest<Mutation>(`/v1/student/feed/${post.id}/comments/${commentId}`, { method: "DELETE" });
      if (!alive.current) return;
      readVersion.current++;
      setLoading(false);
      deletedComments.current.add(commentId);
      setComments((items) => items.filter((item) => item.id !== commentId));
      setDeleteTarget(null);
      if (result.stats) setStats(result.stats);
      clearApiCache();
      void loadComments();
    } catch (caught) {
      if (alive.current) setError(message(caught));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function toggleRepost() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    const next = !stats.reposted;
    try {
      const result = await socialRequest<Mutation>(`/v1/student/feed/${post.id}/repost`, { method: next ? "PUT" : "DELETE" });
      if (!alive.current) return;
      if (result.stats) setStats(result.stats);
      clearApiCache();
      setPanel(null);
      onFeedback(result.stats ? (next ? "Reposted." : "Repost removed.") : "This post is no longer available. Refresh the feed.");
    } catch (caught) {
      if (alive.current) setError(message(caught));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function renderComment({ item }: { item: FeedComment }) {
    return <View style={styles.comment}>
      <View style={styles.commentHeader}>
        <Text style={styles.author}>{item.author_name}</Text>
        {item.author_verified ? <Ionicons name="checkmark-circle" color={theme.brandPressed} size={15} accessibilityLabel="Verified" /> : null}
        {item.can_delete ? <Pressable accessibilityRole="button" accessibilityLabel="Comment options" disabled={busy} onPress={() => setDeleteTarget(deleteTarget === item.id ? null : item.id)} style={styles.iconButton}><Ionicons name="ellipsis-horizontal" color={theme.textMuted} size={19} /></Pressable> : null}
      </View>
      <Text selectable style={styles.commentBody}>{item.body}</Text>
      <Text style={styles.time}>{new Date(item.created_at).toLocaleString("en-NG", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
      {deleteTarget === item.id && item.can_delete ? <View style={styles.confirm}>
        <Text style={styles.confirmText}>Delete your comment?</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setDeleteTarget(null)} style={styles.textButton}><Text style={styles.muted}>Cancel</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete comment" disabled={busy} onPress={() => void removeComment(item.id)} style={styles.textButton}><Text style={styles.deleteText}>{busy ? "Deleting…" : "Delete"}</Text></Pressable>
      </View> : null}
    </View>;
  }

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Comments, ${stats.comment_count}`} onPress={openComments} style={styles.action}>
      <Ionicons name="chatbubble-outline" color={theme.textMuted} size={20} /><Text style={styles.actionText}>{compactCount(stats.comment_count)}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`${stats.reposted ? "Undo repost or quote" : "Repost or quote"}, ${stats.repost_count} reposts, ${stats.quote_count} quotes`} accessibilityState={{ selected: stats.reposted }} onPress={() => { setError(""); setPanel("repost"); }} style={styles.action}>
      <Ionicons name="repeat-outline" color={stats.reposted ? theme.brandPressed : theme.textMuted} size={21} /><Text style={[styles.actionText, stats.reposted && styles.active]}>{compactCount(stats.repost_count)}</Text>
    </Pressable>
    <Modal visible={panel !== null} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close post actions" disabled={busy} onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }, panel === "comments" && styles.commentsSheet]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.heading}>{panel === "comments" ? "Comments" : panel === "quote" ? "Quote post" : "Repost"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" accessibilityState={{ disabled: busy }} disabled={busy} onPress={close} style={styles.iconButton}><Ionicons name="close" color={theme.text} size={24} /></Pressable>
          </View>
          {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text>{panel === "comments" ? <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => void loadComments()} style={styles.textButton}><Text style={styles.active}>Retry</Text></Pressable> : null}</View> : null}
          {panel === "comments" ? <>
            <FlatList data={comments} keyExtractor={(item) => item.id} renderItem={renderComment} keyboardShouldPersistTaps="handled" style={styles.commentList} contentContainerStyle={styles.commentContent}
              ListEmptyComponent={loading ? <View accessibilityLabel="Loading comments" style={styles.skeletons}>{[0, 1, 2].map((key) => <View key={key} style={styles.skeleton} />)}</View> : !error ? <Text style={styles.empty}>No comments yet.</Text> : null}
              ListFooterComponent={nextCursor ? <Pressable accessibilityRole="button" disabled={loading || busy} onPress={() => void loadComments(nextCursor)} style={styles.more}><Text style={styles.active}>{loading ? "Loading…" : "More comments"}</Text></Pressable> : null}
            />
            <View style={styles.composer}>
              <TextInput accessibilityLabel="Write a comment" editable={!busy} multiline maxLength={2000} placeholder="Write a comment…" placeholderTextColor={theme.textSubtle} value={commentDraft} onChangeText={setCommentDraft} style={styles.input} />
              <Pressable accessibilityRole="button" accessibilityLabel="Post comment" accessibilityState={{ disabled: busy || !commentDraft.trim() }} disabled={busy || !commentDraft.trim()} onPress={() => void submit("comments")} style={[styles.send, (busy || !commentDraft.trim()) && styles.disabled]}><Text style={styles.sendText}>{busy ? "Saving…" : "Reply"}</Text></Pressable>
            </View>
          </> : panel === "repost" ? <View style={styles.menu}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggleRepost()} style={styles.menuItem}><Ionicons name="repeat-outline" size={25} color={theme.brandPressed} /><Text style={styles.menuText}>{busy ? "Saving…" : stats.reposted ? "Undo repost" : "Repost"}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setError(""); setPanel("quote"); }} style={styles.menuItem}><Ionicons name="create-outline" size={25} color={theme.text} /><Text style={styles.menuText}>Quote post</Text><Text style={styles.muted}>{stats.quote_count || ""}</Text></Pressable>
          </View> : panel === "quote" ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quoteContent}>
            <TextInput accessibilityLabel="Your quote commentary" autoFocus editable={!busy} multiline maxLength={5000} placeholder="Add your thoughts…" placeholderTextColor={theme.textSubtle} value={quoteDraft} onChangeText={setQuoteDraft} style={[styles.input, styles.quoteInput]} />
            <View style={styles.preview}><Text style={styles.author}>{post.source_name}</Text><Text numberOfLines={5} style={styles.commentBody}>{post.body || post.summary}</Text></View>
            <View style={styles.quoteFooter}><Text style={styles.muted}>{quoteDraft.length}/5000</Text><Pressable accessibilityRole="button" accessibilityLabel="Publish quote post" accessibilityState={{ disabled: busy || !quoteDraft.trim() }} disabled={busy || !quoteDraft.trim()} onPress={() => void submit("quote")} style={[styles.send, (busy || !quoteDraft.trim()) && styles.disabled]}><Text style={styles.sendText}>{busy ? "Posting…" : "Post quote"}</Text></Pressable></View>
          </ScrollView> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  action: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44, minWidth: 44 },
  actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 },
  active: { color: theme.brandPressed, fontFamily: theme.font.semibold },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 540, maxHeight: "90%", borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: theme.canvas },
  commentsSheet: { height: "80%" },
  header: { flexDirection: "row", alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, paddingLeft: 20, paddingRight: 10, minHeight: 58 },
  heading: { flex: 1, fontFamily: theme.font.semibold, fontSize: 19, color: theme.text },
  iconButton: { alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44, marginLeft: "auto" },
  error: { marginHorizontal: 18, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  errorText: { color: theme.text, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 },
  commentList: { flex: 1 },
  commentContent: { paddingHorizontal: 20, paddingBottom: 12 },
  comment: { paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1 },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 30 },
  author: { fontFamily: theme.font.semibold, fontSize: 14, color: theme.text, flexShrink: 1 },
  commentBody: { fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, color: theme.text, paddingTop: 4 },
  time: { fontFamily: theme.font.body, fontSize: 11, color: theme.textSubtle, marginTop: 7 },
  confirm: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8, padding: 8, backgroundColor: theme.surfaceMuted, borderRadius: 10 },
  confirmText: { flex: 1, minWidth: 120, fontFamily: theme.font.medium, color: theme.text, fontSize: 12 },
  textButton: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 6 },
  deleteText: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 13 },
  muted: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 },
  composer: { flexDirection: "row", gap: 10, alignItems: "flex-end", borderTopColor: theme.border, borderTopWidth: 1, padding: 14 },
  input: { flex: 1, minHeight: 46, maxHeight: 140, borderWidth: 1, borderColor: theme.border, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 12, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20, color: theme.text, textAlignVertical: "top", backgroundColor: theme.surfaceMuted },
  send: { minHeight: 46, minWidth: 70, borderRadius: 13, paddingHorizontal: 14, justifyContent: "center", alignItems: "center", backgroundColor: theme.deepBrand },
  sendText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  disabled: { opacity: 0.45 },
  empty: { textAlign: "center", color: theme.textMuted, fontFamily: theme.font.body, paddingVertical: 35 },
  more: { minHeight: 48, justifyContent: "center", alignItems: "center" },
  skeletons: { gap: 14, paddingVertical: 24 },
  skeleton: { height: 62, backgroundColor: theme.surfaceMuted, borderRadius: 10 },
  menu: { paddingHorizontal: 20, paddingVertical: 12 },
  menuItem: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 14 },
  menuText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16, flex: 1 },
  quoteContent: { padding: 20, gap: 16 },
  quoteInput: { minHeight: 120, maxHeight: 240, flex: 0 },
  preview: { borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14 },
  quoteFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
});
