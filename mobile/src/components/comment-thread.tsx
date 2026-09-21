import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { safeCount, type CommentPage, type FeedComment } from "@/src/lib/feed-social";
import { commentsPath, deleteFromThread, mergeComments, type CommentDeletion } from "@/src/lib/comment-replies";
import { CommentLikeButton } from "@/src/components/comment-like-button";
import { ProfileAvatar } from "@/src/components/profile-avatar";

function commentedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

type ThreadProps = { postId: string; focusToken?: number; onUpdated(): void };
type ListProps = ThreadProps & { parentComment?: FeedComment; depth?: number; composerOpen?: boolean; onCancel?(): void; onCountChange?(delta: number): void };

export function CommentThread(props: ThreadProps) {
  return <CommentList key={props.postId} {...props} />;
}

function CommentList({ postId, focusToken = 0, onUpdated, parentComment, depth = 0, composerOpen = true, onCancel, onCountChange }: ListProps) {
  const { theme, styles } = useThemeStyles(createStyles);
  const parentId = parentComment?.id ?? null;
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<FeedComment | null>(null);
  const [parentDeleted, setParentDeleted] = useState(false);
  const [likesRefresh, setLikesRefresh] = useState(0);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyFocus, setReplyFocus] = useState(0);
  const field = useRef<TextInput>(null);
  const requestId = useRef(randomUUID());
  const mutationLock = useRef(false);
  const inFlight = useRef<number | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const canCompose = composerOpen && !parentComment?.is_deleted && !parentDeleted;

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { if (canCompose && focusToken > 0) field.current?.focus(); }, [focusToken, canCompose]);

  const load = useCallback(async (after: string | null = null) => {
    if (mutationLock.current || (after && inFlight.current !== null)) return;
    const version = ++generation.current;
    inFlight.current = version;
    if (after) setMore(true); else { setLoading(true); setMore(false); }
    setError("");
    try {
      const page = await api<CommentPage>(commentsPath(postId, parentId, after));
      if (alive.current && version === generation.current) {
        setComments((current) => mergeComments(after ? current : [], page.comments, parentId));
        setCursor(page.nextCursor ?? null);
        setParentDeleted(page.parentDeleted === true);
        setLikesRefresh((value) => value + 1);
      }
    } catch (caught) {
      if (alive.current && version === generation.current) setError(caught instanceof Error ? caught.message : "Could not load this conversation. Please try again.");
    } finally {
      if (inFlight.current === version) inFlight.current = null;
      if (alive.current && version === generation.current) { setLoading(false); setMore(false); }
    }
  }, [postId, parentId]);

  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; inFlight.current = null; }; }, [load]));

  function invalidateRead() {
    generation.current++;
    inFlight.current = null;
    setLoading(false);
    setMore(false);
  }

  async function send() {
    const text = body.trim();
    if (!text || !canCompose || mutationLock.current) return;
    mutationLock.current = true;
    invalidateRead();
    setSending(true);
    setError("");
    try {
      const result = await api<{ comment: FeedComment }>(commentsPath(postId), { method: "POST", body: JSON.stringify({ body: text, requestId: requestId.current, ...(parentId ? { parentCommentId: parentId } : {}) }) });
      if (alive.current) {
        const alreadyShown = comments.some((comment) => comment.id === result.comment.id);
        setComments((current) => mergeComments(current, [result.comment], parentId));
        setBody("");
        requestId.current = randomUUID();
        if (!alreadyShown) onCountChange?.(1);
        onUpdated();
      }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : "Your message was not confirmed. Your draft is still here; try again.");
    } finally {
      mutationLock.current = false;
      if (alive.current) setSending(false);
    }
  }

  async function deleteComment() {
    if (!selected || mutationLock.current) return;
    const commentId = selected.id;
    mutationLock.current = true;
    invalidateRead();
    setDeleting(true);
    setError("");
    try {
      const result = await api<CommentDeletion>(`${commentsPath(postId)}/${encodeURIComponent(commentId)}`, { method: "DELETE" });
      if (alive.current) {
        setComments((current) => deleteFromThread(current, commentId, result));
        setSelected(null);
        if (!result.retained) onCountChange?.(-1);
        onUpdated();
      }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : "Your comment could not be deleted. Please try again.");
    } finally {
      mutationLock.current = false;
      if (alive.current) setDeleting(false);
    }
  }

  function openReplies(commentId: string, compose: boolean) {
    setOpened((current) => new Set(current).add(commentId));
    setExpanded((current) => new Set(current).add(commentId));
    if (compose) { setReplyingTo(commentId); setReplyFocus((value) => value + 1); }
  }

  return (
    <View style={[styles.thread, depth === 1 && styles.replies, depth > 1 && styles.nestedReplies]}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={parentId ? styles.replyHeading : styles.heading}>{parentId ? "Replies" : "Comments"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={parentId ? "Refresh replies" : "Refresh comments"} disabled={loading || sending || deleting} onPress={() => void load()} style={styles.iconButton}><Ionicons name="refresh-outline" color={theme.textMuted} size={18} /></Pressable>
      </View>
      {canCompose ? <View>
        {parentComment ? <View style={styles.replyingRow}>
          <Text numberOfLines={1} style={styles.replyingLabel}>Replying to {parentComment.author_username ? `@${parentComment.author_username}` : parentComment.author_name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" disabled={sending} onPress={onCancel} style={styles.iconButton}><Ionicons name="close" color={theme.textMuted} size={18} /></Pressable>
        </View> : null}
        <TextInput ref={field} accessibilityLabel={parentId ? "Write a reply" : "Write a comment"} multiline maxLength={2000} editable={!sending && !deleting} placeholder={parentId ? "Write a reply…" : "Add to the conversation…"} placeholderTextColor={theme.textSubtle} value={body} onChangeText={(text) => { setBody(text); requestId.current = randomUUID(); }} style={styles.input} />
        <View style={styles.composerFooter}>
          <Text style={styles.small}>{body.length}/2000</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={parentId ? "Post reply" : "Post comment"} accessibilityState={{ disabled: sending || deleting || !body.trim(), busy: sending }} disabled={sending || deleting || !body.trim()} onPress={() => void send()} style={[styles.send, (sending || deleting || !body.trim()) && styles.disabled]}>
            {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.sendText}>{parentId ? "Reply" : "Comment"}</Text>}
          </Pressable>
        </View>
      </View> : null}
      {parentDeleted && body ? <Text style={styles.small}>The original comment was deleted. Your unsent draft is kept here.</Text> : null}
      {parentDeleted && body ? <Text selectable style={styles.body}>{body}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.brand} style={styles.loader} /> : null}
      {!loading && !error && !comments.length ? <Text style={styles.empty}>{parentId ? "No replies yet." : "No comments yet. Start the conversation."}</Text> : null}
      {comments.map((comment) => (
        <View key={comment.id} style={styles.commentGroup}>
          <View style={styles.comment}>
            {!comment.is_deleted ? <View style={styles.avatar}><ProfileAvatar name={comment.author_name} imageUrl={comment.author_image_url} /></View> : null}
            <View style={styles.commentContent}>
              {comment.is_deleted ? <Text style={styles.deleted}>Comment deleted</Text> : <>
                <View style={styles.commentHeader}>
                  <View style={styles.authorDetails}>
                    <View style={styles.authorRow}>
                      <Text accessibilityLabel={`${comment.author_name}${comment.author_verified ? ", verified" : ""}`} numberOfLines={1} style={styles.author}>{comment.author_name}</Text>
                      {comment.author_verified ? <View accessibilityElementsHidden style={styles.verifiedBadge}><Ionicons name="checkmark" size={10} color={theme.verificationMark} /></View> : null}
                    </View>
                    <Text numberOfLines={1} style={styles.time}>{comment.author_username ? `@${comment.author_username} · ` : ""}{commentedAt(comment.created_at)}</Text>
                  </View>
                  {comment.can_delete ? <Pressable accessibilityRole="button" accessibilityLabel="Delete your comment" disabled={sending || deleting} onPress={() => setSelected(comment)} style={styles.iconButton}><Ionicons name="ellipsis-horizontal" size={19} color={theme.textMuted} /></Pressable> : null}
                </View>
                <Text selectable style={styles.body}>{comment.body}</Text>
              </>}
              <View style={styles.commentActions}>
                {!comment.is_deleted ? <>
                  <CommentLikeButton commentId={comment.id} authorName={comment.author_name} refreshToken={likesRefresh} disabled={sending || deleting} onFeedback={setError} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${comment.author_name}`} disabled={sending || deleting} onPress={() => openReplies(comment.id, true)} style={styles.replyButton}><Ionicons name="return-up-back-outline" size={16} color={theme.textMuted} /><Text style={styles.replyText}>Reply</Text></Pressable>
                </> : null}
                {safeCount(comment.reply_count) > 0 || expanded.has(comment.id) ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded.has(comment.id) }} accessibilityLabel={expanded.has(comment.id) ? "Hide replies" : `View ${safeCount(comment.reply_count)} replies`} onPress={() => {
                  if (expanded.has(comment.id)) setExpanded((current) => { const next = new Set(current); next.delete(comment.id); return next; });
                  else openReplies(comment.id, false);
                }} style={styles.replyButton}><Text style={styles.loadMoreText}>{expanded.has(comment.id) ? "Hide replies" : `View ${safeCount(comment.reply_count)} ${safeCount(comment.reply_count) === 1 ? "reply" : "replies"}`}</Text></Pressable> : null}
              </View>
            </View>
          </View>
          {opened.has(comment.id) ? <View style={!expanded.has(comment.id) && styles.hidden}>
            <CommentList postId={postId} parentComment={comment} depth={depth + 1} composerOpen={replyingTo === comment.id} focusToken={replyingTo === comment.id ? replyFocus : 0} onCancel={() => setReplyingTo(null)} onUpdated={onUpdated} onCountChange={(delta) => {
              invalidateRead();
              setComments((current) => current.map((item) => item.id === comment.id ? { ...item, reply_count: Math.max(0, safeCount(item.reply_count) + delta) } : item));
            }} />
          </View> : null}
        </View>
      ))}
      {cursor ? <Pressable accessibilityRole="button" disabled={more || loading || sending || deleting} onPress={() => void load(cursor)} style={styles.loadMore}><Text style={styles.loadMoreText}>{more ? "Loading…" : parentId ? "More replies" : "More comments"}</Text></Pressable> : null}
      {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.loadMore}><Text style={styles.loadMoreText}>Retry loading {parentId ? "replies" : "comments"}</Text></Pressable> : null}
      <Modal visible={Boolean(selected)} transparent animationType="none" onRequestClose={() => { if (!deleting) setSelected(null); }}>
        <View style={styles.overlay}><View accessibilityViewIsModal style={styles.dialog}>
          <Text style={styles.heading}>Delete your {parentId ? "reply" : "comment"}?</Text><Text style={styles.dialogCopy}>Your message will be removed. Other people's replies will stay in the conversation. This cannot be undone.</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.dialogActions}><Pressable accessibilityRole="button" disabled={deleting} onPress={() => setSelected(null)} style={styles.loadMore}><Text style={styles.loadMoreText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" disabled={deleting} onPress={() => void deleteComment()} style={styles.send}><Text style={styles.sendText}>{deleting ? "Deleting…" : "Delete"}</Text></Pressable></View>
        </View></View>
      </Modal>
    </View>
  );
}
const createStyles = (theme: Theme) => StyleSheet.create({
  thread: { marginTop: 12 }, replies: { marginLeft: 14, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: theme.border }, nestedReplies: { marginTop: 4 }, hidden: { display: "none" },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 17 }, replyHeading: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 12 },
  replyingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, replyingLabel: { color: theme.brandPressed, fontFamily: theme.font.medium, fontSize: 12, flex: 1 },
  input: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20, backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 13, minHeight: 80, maxHeight: 220, textAlignVertical: "top" },
  composerFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 12 },
  small: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
  send: { backgroundColor: theme.deepBrand, minHeight: 44, minWidth: 96, paddingHorizontal: 16, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 }, disabled: { opacity: 0.5 },
  error: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 19, marginVertical: 10 }, loader: { marginVertical: 20 },
  empty: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, paddingVertical: 16 },
  commentGroup: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 2 }, comment: { flexDirection: "row", gap: 8, paddingTop: 12 },
  avatar: { paddingTop: 4 }, commentContent: { flex: 1, minWidth: 0 },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 },
  authorDetails: { flex: 1, minWidth: 0 }, authorRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  author: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, flexShrink: 1 },
  verifiedBadge: { alignItems: "center", justifyContent: "center", backgroundColor: theme.brand, width: 16, height: 16, borderRadius: 8 },
  time: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 2 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  body: { color: theme.text, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 19, marginTop: 4 }, deleted: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, fontStyle: "italic", paddingVertical: 10 },
  commentActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 10 }, replyButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 4 }, replyText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 },
  loadMore: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  loadMoreText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { backgroundColor: theme.canvas, padding: 22, borderRadius: 16, maxWidth: 420, width: "100%", gap: 12 },
  dialogCopy: { color: theme.textMuted, fontSize: 14, lineHeight: 21, fontFamily: theme.font.body },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
});
