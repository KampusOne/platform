import { InlineLoading } from "@/src/components/skeleton";
import { compactCount } from "@/src/lib/feed-time";
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

let current: { scope: string; store: PostLikeStore } | undefined;
function scopedStore(scope: string): PostLikeStore {
  if (current?.scope !== scope) {
    current?.store.dispose();
    current = { scope, store: new PostLikeStore({
      read: (ids) => request<{ likes: PostLike[] }>(`/v1/student/feed/likes?ids=${encodeURIComponent(ids.join(","))}`),
      write: (id, liked) => request<PostLike>(`/v1/student/feed/${encodeURIComponent(id)}/like`, liked ? "PUT" : "DELETE"),
    }) };
  }
  return current.store;
}

export function PostLikeButton({ postId, title, onFeedback, initialLiked, initialCount }: {
  postId: string; title: string; initialLiked?: boolean | undefined; initialCount?: number | undefined; onFeedback(message: string): void;
}) {
  const auth = useAuth();
  const signedIn = auth.state === "authenticated" && !!auth.user;
  const scope = signedIn ? `${auth.user!.id}:${auth.profile?.university_id ?? auth.user!.universityId ?? ""}` : "anonymous";
  const store = useMemo(() => scopedStore(scope), [scope]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(postId, listener), [store, postId]);
  const snapshot = useCallback(() => store.get(postId), [store, postId]);
  const storedState = useSyncExternalStore(subscribe, snapshot, () => initialLikeState);
  const seed = useMemo(() => typeof initialLiked === "boolean" && Number.isSafeInteger(initialCount) && initialCount! >= 0
    ? { id: postId, liked: initialLiked, like_count: initialCount! } : null, [postId, initialLiked, initialCount]);
  const state = storedState !== initialLikeState || !seed ? storedState : { ...initialLikeState, liked: seed.liked, count: seed.like_count, ready: true, loading: false };
  const { theme, styles } = useThemeStyles(createStyles);
  useFocusEffect(useCallback(() => {
    if (!signedIn) return;
    if (seed) store.seed(seed);
    store.loadIfMissing(postId);
  }, [store, postId, signedIn, seed]));

  const press = async () => {
    if (!state.ready) { store.load(postId); return; }
    if (seed) store.seed(seed);
    try { await store.toggle(postId); }
    catch (error) { onFeedback(error instanceof Error ? error.message : "Your like could not be saved. Please try again."); }
  };
  const busy = state.loading || state.pending;
  const label = !state.ready
    ? (state.loading ? `Loading likes for ${title}` : `Retry loading likes for ${title}`)
    : `${state.liked ? "Unlike" : "Like"} ${title}, ${state.count} ${state.count === 1 ? "like" : "likes"}`;
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button"
      accessibilityHint="Tap to like this post. Tap again to remove your like."
      accessibilityState={{ selected: state.liked, busy, disabled: !signedIn || busy }}
      disabled={!signedIn || busy} hitSlop={4} onPress={() => { void press(); }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons color={state.liked ? theme.brandPressed : theme.textMuted} name={state.liked ? "heart" : "heart-outline"} size={18} />
      {state.loading ? <InlineLoading color={theme.textMuted} size={12} />
        : <Text style={[styles.count, state.liked && styles.active]}>{state.ready ? compactCount(state.count) : "Retry"}</Text>}
    </Pressable>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  action: { alignItems: "center", flexDirection: "row", gap: 5, minHeight: 44, minWidth: 44 },
  count: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  active: { color: theme.brandPressed },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
