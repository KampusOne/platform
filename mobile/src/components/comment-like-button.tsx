import { InlineLoading } from "@/src/components/skeleton";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {  Pressable, StyleSheet, Text } from "react-native";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { initialLikeState, PostLikeStore, type PostLike } from "@/src/lib/post-like-store";

async function request<T>(path: string, method = "GET"): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try { return await api<T>(path, { method, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

// A separate store keeps post IDs and comment IDs isolated, while reusing the
// tested batching, optimistic updates, rollback and stale-response protection.
let current: { scope: string; store: PostLikeStore } | undefined;
function scopedStore(scope: string): PostLikeStore {
  if (current?.scope !== scope) {
    current?.store.dispose();
    current = { scope, store: new PostLikeStore({
      read: (ids) => request<{ likes: PostLike[] }>(`/v1/student/feed/comment-likes?ids=${encodeURIComponent(ids.join(","))}`),
      write: (id, liked) => request<PostLike>(`/v1/student/feed/comments/${encodeURIComponent(id)}/like`, liked ? "PUT" : "DELETE"),
    }) };
  }
  return current.store;
}

export function CommentLikeButton({ commentId, authorName, refreshToken = 0, disabled = false, onFeedback, initialLiked, initialCount }: {
  initialLiked?: boolean | undefined; initialCount?: number | undefined; commentId: string; authorName: string; refreshToken?: number; disabled?: boolean; onFeedback(message: string): void;
}) {
  const auth = useAuth();
  const signedIn = auth.state === "authenticated" && !!auth.user;
  const scope = signedIn ? `${auth.user!.id}:${auth.profile?.university_id ?? auth.user!.universityId ?? ""}` : "anonymous";
  const store = useMemo(() => scopedStore(scope), [scope]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(commentId, listener), [store, commentId]);
  const snapshot = useCallback(() => store.get(commentId), [store, commentId]);
  const storedState = useSyncExternalStore(subscribe, snapshot, () => initialLikeState);
  const seed = useMemo(() => typeof initialLiked === "boolean" && Number.isSafeInteger(initialCount) && initialCount! >= 0
    ? { id: commentId, liked: initialLiked, like_count: initialCount! } : null, [commentId, initialLiked, initialCount]);
  const state = storedState !== initialLikeState || !seed ? storedState : { ...initialLikeState, liked: seed.liked, count: seed.like_count, ready: true, loading: false };
  const { theme, styles } = useThemeStyles(createStyles);
  useFocusEffect(useCallback(() => {
    if (!signedIn) return;
    if (seed) store.seed(seed);
    store.loadIfMissing(commentId);
  }, [store, commentId, signedIn, refreshToken, seed]));

  async function press() {
    if (!state.ready) { store.load(commentId); return; }
    if (seed) store.seed(seed);
    try { await store.toggle(commentId); }
    catch (error) { onFeedback(error instanceof Error ? error.message : "Your comment like could not be saved. Please try again."); }
  }
  const busy = state.loading || state.pending;
  const unavailable = disabled || !signedIn || busy;
  const label = !state.ready
    ? `${state.loading ? "Loading" : "Retry loading"} likes on ${authorName}'s comment`
    : `${state.liked ? "Unlike" : "Like"} ${authorName}'s comment, ${state.count} ${state.count === 1 ? "like" : "likes"}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityHint="Tap to like this comment. Tap again to remove your like."
    accessibilityState={{ selected: state.liked, busy, disabled: unavailable }}
    disabled={unavailable} onPress={() => { void press(); }}
    style={({ pressed }) => [styles.action, pressed && styles.pressed, disabled && styles.disabled]}>
    <Ionicons name={state.liked ? "heart" : "heart-outline"} color={state.liked ? theme.brandPressed : theme.textMuted} size={17} />
    {state.loading ? <InlineLoading color={theme.textMuted} size={12} />
      : <Text style={[styles.count, state.liked && styles.active]}>{state.ready ? state.count.toLocaleString("en-NG") : "Retry"}</Text>}
  </Pressable>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  action: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 44, minHeight: 44, alignSelf: "flex-start" },
  count: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  active: { color: theme.brandPressed }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.5 },
});
