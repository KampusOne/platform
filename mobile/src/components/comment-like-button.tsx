import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
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

// Separate transport/cache from post likes; shared state-machine behavior gives
// comments the same optimistic updates, rollback and stale-response protection.
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

export function CommentLikeButton({ commentId, authorName, refreshToken = 0, disabled = false, onFeedback }: {
  commentId: string; authorName: string; refreshToken?: number; disabled?: boolean; onFeedback(message: string): void;
}) {
  const auth = useAuth();
  const signedIn = auth.state === "authenticated" && !!auth.user;
  const scope = signedIn ? `${auth.user!.id}:${auth.profile?.university_id ?? auth.user!.universityId ?? ""}` : "anonymous";
  const store = useMemo(() => scopedStore(scope), [scope]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(commentId, listener), [store, commentId]);
  const snapshot = useCallback(() => store.get(commentId), [store, commentId]);
  const state = useSyncExternalStore(subscribe, snapshot, () => initialLikeState);
  const { theme, styles } = useThemeStyles(createStyles);
  useFocusEffect(useCallback(() => { if (signedIn) store.load(commentId); }, [store, commentId, signedIn, refreshToken]));

  async function press() {
    if (!state.ready) { store.load(commentId); return; }
    try { await store.toggle(commentId); }
    catch (error) { onFeedback(error instanceof Error ? error.message : "Your comment like could not be saved. Please try again."); }
  }
  const busy = state.loading || state.pending;
  const blocked = !signedIn || busy || disabled;
  const subject = `comment by ${authorName}`;
  const label = !state.ready
    ? `${state.loading ? "Loading likes for" : "Retry loading likes for"} ${subject}`
    : `${state.liked ? "Unlike" : "Like"} ${subject}, ${state.count} ${state.count === 1 ? "like" : "likes"}`;
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button"
      accessibilityHint="Tap to like this comment. Tap again to remove your like."
      accessibilityState={{ selected: state.liked, busy, disabled: blocked }}
      disabled={blocked} onPress={() => { void press(); }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed, disabled && styles.disabled]}>
      <Ionicons color={state.liked ? theme.brandPressed : theme.textMuted} name={state.liked ? "heart" : "heart-outline"} size={16} />
      {state.loading ? <ActivityIndicator color={theme.textMuted} size={12} />
        : <Text style={[styles.count, state.liked && styles.active]}>{state.ready ? state.count.toLocaleString("en-NG") : "Retry"}</Text>}
    </Pressable>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  action: { alignSelf: "flex-start", alignItems: "center", flexDirection: "row", gap: 5, minHeight: 44, minWidth: 44 },
  count: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  active: { color: theme.brandPressed }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.5 },
});
