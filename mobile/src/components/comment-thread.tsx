import { InlineLoading, ListSkeleton } from "@/src/components/skeleton";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {  Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { safeCount, type CommentPage, type FeedComment } from "@/src/lib/feed-social";
import { commentsPath, deleteFromThread, mergeComments, type CommentDeletion } from "@/src/lib/comment-replies";
import { CommentLikeButton } from "./comment-like-button";
import { ProfileAvatar } from "./profile-avatar";
import { VerifiedBadge } from "./verified-badge";
import { RelativeTime } from "./relative-time";

type ThreadProps = { postId: string; refreshToken?: number; onUpdated(): void; onReply(comment: FeedComment): void };
type ListProps = ThreadProps & { parentComment?: FeedComment; depth?: number };
export function CommentThread(props: ThreadProps) { return <CommentList key={props.postId} {...props} />; }

function CommentList({ postId, refreshToken = 0, onUpdated, onReply, parentComment, depth = 0 }: ListProps) {
  const { theme, styles } = useThemeStyles(createStyles);
  const parentId = parentComment?.id ?? null;
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<FeedComment | null>(null);
  const [likesRefresh, setLikesRefresh] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const mutationLock = useRef(false);
  const inFlight = useRef<number | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
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
        setLikesRefresh((value) => value + 1);
      }
    } catch (caught) { if (alive.current && version === generation.current) setError(caught instanceof Error ? caught.message : "Could not load this conversation. Please try again."); }
    finally {
      if (inFlight.current === version) inFlight.current = null;
      if (alive.current && version === generation.current) { setLoading(false); setMore(false); }
    }
  }, [postId, parentId]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; inFlight.current = null; }; }, [load, refreshToken]));
  async function deleteComment() {
    if (!selected || mutationLock.current) return;
    const commentId = selected.id;
    mutationLock.current = true; generation.current++; inFlight.current = null;
    setLoading(false); setMore(false); setDeleting(true); setError("");
    try {
      const result = await api<CommentDeletion>(`${commentsPath(postId)}/${encodeURIComponent(commentId)}`, { method: "DELETE" });
      if (alive.current) { setComments((current) => deleteFromThread(current, commentId, result)); setSelected(null); onUpdated(); }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : "Your reply could not be deleted. Please try again."); }
    finally { mutationLock.current = false; if (alive.current) setDeleting(false); }
  }
  function toggleReplies(commentId: string) {
    setExpanded((current) => { const next = new Set(current); if (next.has(commentId)) next.delete(commentId); else next.add(commentId); return next; });
  }
  return <View style={[styles.thread, depth === 1 && styles.replies]}>
    {depth === 0 ? <View style={styles.headingRow}><Text accessibilityRole="header" style={styles.heading}>Replies</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh replies" disabled={loading || deleting} onPress={() => void load()} style={styles.iconButton}><Ionicons name="refresh-outline" color={theme.textMuted} size={17} /></Pressable></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading && comments.length === 0 ? <ListSkeleton count={3} /> : null}
    {!loading && !error && !comments.length ? <Text style={styles.empty}>{parentId ? "No replies yet." : "No replies yet. Be the first to join in."}</Text> : null}
    {comments.map((comment) => <View key={comment.id} style={styles.commentGroup}>
      <View style={styles.comment}>
        <View style={styles.avatarRail}>{!comment.is_deleted ? <ProfileAvatar name={comment.author_name} imageUrl={comment.author_image_url} size={36} /> : <View style={styles.deletedAvatar} />}{expanded.has(comment.id) ? <View style={styles.connector} /> : null}</View>
        <View style={styles.commentContent}>
          {comment.is_deleted ? <Text style={styles.deleted}>Reply deleted</Text> : <>
            <View style={styles.commentHeader}>
              <View style={styles.authorRow}><Text accessibilityLabel={`${comment.author_name}${comment.author_verified ? ", verified" : ""}`} numberOfLines={1} style={styles.author}>{comment.author_name}</Text>{comment.author_verified ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><VerifiedBadge size={13} /></View> : null}<Text style={styles.time}>·</Text><RelativeTime value={comment.created_at} style={styles.time} /></View>
              {comment.can_delete ? <Pressable accessibilityRole="button" accessibilityLabel="Delete your reply" disabled={deleting} onPress={() => setSelected(comment)} style={styles.menuButton}><Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} /></Pressable> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open replies to ${comment.author_name}`} onPress={() => toggleReplies(comment.id)} style={styles.bodyRegion}>
              {comment.body ? <Text style={styles.body}>{comment.body}</Text> : null}
              {comment.image_url ? <Image accessible accessibilityLabel="Reply attachment" source={{ uri: comment.image_url }} resizeMode="cover" style={styles.image} /> : null}
            </Pressable>
          </>}
          <View style={styles.commentActions}>
            {!comment.is_deleted ? <><CommentLikeButton commentId={comment.id} initialLiked={comment.liked} initialCount={comment.like_count} authorName={comment.author_name} refreshToken={likesRefresh} disabled={deleting} onFeedback={setError} /><Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${comment.author_name}`} disabled={deleting} onPress={() => onReply(comment)} style={styles.replyButton}><Ionicons name="chatbubble-outline" size={17} color={theme.textMuted} /><Text style={styles.replyText}>{safeCount(comment.reply_count) || ""}</Text></Pressable></> : null}
            {safeCount(comment.reply_count) > 0 || expanded.has(comment.id) ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded.has(comment.id) }} accessibilityLabel={expanded.has(comment.id) ? "Hide replies" : `View ${safeCount(comment.reply_count)} replies`} onPress={() => toggleReplies(comment.id)} style={styles.replyButton}><Text style={styles.loadMoreText}>{expanded.has(comment.id) ? "Hide replies" : `View ${safeCount(comment.reply_count)} ${safeCount(comment.reply_count) === 1 ? "reply" : "replies"}`}</Text></Pressable> : null}
          </View>
        </View>
      </View>
      {expanded.has(comment.id) ? <CommentList postId={postId} parentComment={comment} depth={depth + 1} refreshToken={refreshToken} onReply={onReply} onUpdated={onUpdated} /> : null}
    </View>)}
    {cursor ? <Pressable accessibilityRole="button" disabled={more || loading || deleting} onPress={() => void load(cursor)} style={styles.loadMore}><Text style={styles.loadMoreText}>{more ? "Loading…" : "More replies"}</Text></Pressable> : null}
    {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.loadMore}><Text style={styles.loadMoreText}>Retry loading replies</Text></Pressable> : null}
    <Modal visible={Boolean(selected)} transparent animationType="none" onRequestClose={() => { if (!deleting) setSelected(null); }}>
      <View style={styles.overlay}><View accessibilityViewIsModal style={styles.dialog}><Text style={styles.dialogTitle}>Delete your reply?</Text><Text style={styles.dialogCopy}>Your message will be removed. Other people’s replies will stay in the conversation. This cannot be undone.</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<View style={styles.dialogActions}><Pressable accessibilityRole="button" disabled={deleting} onPress={() => setSelected(null)} style={styles.loadMore}><Text style={styles.loadMoreText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" disabled={deleting} onPress={() => void deleteComment()} style={styles.deleteButton}><Text style={styles.deleteText}>{deleting ? "Deleting…" : "Delete"}</Text></Pressable></View></View></View>
    </Modal>
  </View>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  thread: { marginTop: 0 }, replies: { marginLeft: 12, paddingLeft: 10, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border }, headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }, heading: { fontFamily: theme.font.semibold, fontSize: 12, color: theme.textMuted }, iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  commentGroup: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, comment: { flexDirection: "row", gap: 9, paddingTop: 10 }, avatarRail: { width: 36, alignItems: "center" }, connector: { flex: 1, width: 1, backgroundColor: theme.border, marginTop: 5 }, deletedAvatar: { width: 36, height: 20 }, commentContent: { flex: 1, minWidth: 0 }, commentHeader: { flexDirection: "row", alignItems: "center", minHeight: 22 }, authorRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 }, author: { flexShrink: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 }, time: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5 }, menuButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginVertical: -7 },
  bodyRegion: { minHeight: 22 }, body: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 }, image: { width: "100%", aspectRatio: 1.5, borderRadius: 12, marginTop: 7 }, deleted: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, fontStyle: "italic", paddingVertical: 5 }, commentActions: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap", minHeight: 44 }, replyButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44, minWidth: 44 }, replyText: { fontFamily: theme.font.body, color: theme.textMuted, fontSize: 11 },
  loadMore: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, loadMoreText: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 11.5 }, loader: { margin: 24 }, empty: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, textAlign: "center", paddingVertical: 24 }, error: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18, paddingVertical: 10 }, overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.38)", justifyContent: "center", alignItems: "center", padding: 24 }, dialog: { width: "100%", maxWidth: 400, padding: 22, backgroundColor: theme.canvas, borderRadius: 18 }, dialogTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 18 }, dialogCopy: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, marginTop: 10 }, dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 14 }, deleteButton: { minHeight: 44, paddingHorizontal: 18, backgroundColor: theme.deepBrand, borderRadius: 12, justifyContent: "center" }, deleteText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
});
