import { FeedSkeleton, SkeletonBlock } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { useFocusEffect, useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, Image, Platform, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { FilterRow, SearchField } from "@/src/components/product-ui";
import { FeedPost } from "@/src/components/feed-post";
import type { MediaPlaybackHandle } from "@/src/components/media-preview";
import { PostLinkDialog } from "@/src/components/post-menu";
import { ApiError, api, peekApiCache } from "@/src/lib/api";
import { sharePostLink, wasPostDeleted, type FeedPostData } from "@/src/lib/feed-posts";
import { mergeById, type FeedPage, type SocialFeedPost } from "@/src/lib/feed-social";
import { recordPostView } from "@/src/lib/post-views";

const categories = ["All", "Update", "Event", "Sports", "Opportunity", "Emergency"] as const;
const emptyFeedIllustration = require("@/assets/illustrations/feed-empty-v2.png");
const floatingTabBarHeight = 72;
const videoVisibilityTolerance = 1;
function FeedEmptyState({ filtered }: { filtered: boolean }) {
  const { styles } = useThemeStyles(createStyles);
  return <View style={styles.emptyState}><Image accessible={false} resizeMode="contain" source={emptyFeedIllustration} style={styles.emptyIllustration} /><Text style={styles.emptyTitle}>{filtered ? "No matching posts" : "No posts here yet"}</Text><Text style={styles.emptyBody}>{filtered ? "Try another search or choose a different update type." : "Student posts, campus updates and conversations will appear here."}</Text></View>;
}
export default function FeedScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user, state: authState } = useAuth();
  const [posts, setPosts] = useState<SocialFeedPost[]>([]);
  const { hashtag } = useLocalSearchParams<{ hashtag?: string }>();
  const [query, setQuery] = useState(hashtag ?? "");
  useEffect(() => { if (typeof hashtag === "string") { setQuery(hashtag); setSelected("All"); } }, [hashtag]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [copyId, setCopyId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const paging = useRef(false);
  const loadedScope = useRef("");
  const pendingBookmarks = useRef(new Set<string>());
  const viewer = useRef<string | null>(null);
  const videoHandles = useRef(new Map<string, MediaPlaybackHandle>());
  const feedFocused = useRef(false);
  const appActive = useRef(AppState.currentState === "active");
  const videoEvaluationVersion = useRef(0);
  const videoEvaluationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  viewer.current = authState === "authenticated" ? user?.id ?? null : null;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 1000 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const viewerId = viewer.current;
    if (!viewerId) return;
    for (const token of viewableItems) {
      const post = token.item as SocialFeedPost;
      if (!token.isViewable || !post?.id) continue;
      void recordPostView(post.id, viewerId).then((count) => {
        if (count !== null && viewer.current === viewerId) setPosts((items) => items.map((item) => item.id === post.id ? { ...item, view_count: Math.max(item.view_count ?? 0, count) } : item));
      });
    }
  }).current;
  const applyVisibleVideo = useCallback((postId: string | null) => {
    for (const [id, handle] of videoHandles.current) {
      handle.setViewportVisible(id === postId);
    }
  }, []);

  const evaluateVideoVisibility = useCallback(() => {
    const version = ++videoEvaluationVersion.current;
    if (!feedFocused.current || !appActive.current) {
      applyVisibleVideo(null);
      return;
    }

    const entries = Array.from(videoHandles.current.entries());
    if (!entries.length) return;

    const viewportTop = insets.top;
    const viewportBottom = height - Math.max(insets.bottom, 8) - floatingTabBarHeight;
    const viewportCenter = (viewportTop + viewportBottom) / 2;
    const candidates: Array<{ id: string; distance: number }> = [];
    let remaining = entries.length;

    const finish = () => {
      remaining -= 1;
      if (remaining > 0 || version !== videoEvaluationVersion.current) return;
      const selected = candidates.sort((a, b) => a.distance - b.distance)[0]?.id ?? null;
      applyVisibleVideo(selected);
    };

    for (const [id, handle] of entries) {
      handle.measureInWindow((_x, y, _width, videoHeight) => {
        if (version !== videoEvaluationVersion.current) return;
        const bottom = y + videoHeight;
        const fullyVisible = videoHeight > 0
          && y >= viewportTop - videoVisibilityTolerance
          && bottom <= viewportBottom + videoVisibilityTolerance;
        if (fullyVisible) {
          candidates.push({ id, distance: Math.abs(y + videoHeight / 2 - viewportCenter) });
        }
        finish();
      });
    }
  }, [applyVisibleVideo, height, insets.bottom, insets.top]);

  const scheduleVideoEvaluation = useCallback(() => {
    if (videoEvaluationTimer.current) return;
    videoEvaluationTimer.current = setTimeout(() => {
      videoEvaluationTimer.current = null;
      evaluateVideoVisibility();
    }, 32);
  }, [evaluateVideoVisibility]);

  const registerVideoHandle = useCallback((postId: string, handle: MediaPlaybackHandle | null) => {
    const existing = videoHandles.current.get(postId);
    if (!handle) {
      existing?.setViewportVisible(false);
      videoHandles.current.delete(postId);
    } else {
      videoHandles.current.set(postId, handle);
    }
    videoEvaluationVersion.current += 1;
    scheduleVideoEvaluation();
  }, [scheduleVideoEvaluation]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      appActive.current = state === "active";
      if (appActive.current && feedFocused.current) scheduleVideoEvaluation();
      else {
        videoEvaluationVersion.current += 1;
        applyVisibleVideo(null);
      }
    });
    return () => subscription.remove();
  }, [applyVisibleVideo, scheduleVideoEvaluation]);

  useEffect(() => () => {
    if (videoEvaluationTimer.current) clearTimeout(videoEvaluationTimer.current);
    videoEvaluationVersion.current += 1;
    applyVisibleVideo(null);
  }, [applyVisibleVideo]);

  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const path = useMemo(() => `/v1/student/feed?q=${encodeURIComponent(search)}${selected === "All" ? "" : `&category=${selected.toUpperCase()}`}`, [search, selected]);
  const scope = `${user?.id ?? "anonymous"}:${path}`;
  const load = useCallback(async (refresh = false) => {
    const version = ++loadVersion.current;
    paging.current = false; setLoadingMore(false);
    const newScope = loadedScope.current !== scope;
    const cached = !refresh ? peekApiCache<FeedPage>(path) : undefined;
    if (newScope) {
      setPosts(cached?.posts.filter((post) => !wasPostDeleted(post.id)) ?? []);
      setCursor(cached?.nextCursor ?? null);
    }
    if (refresh) setRefreshing(true); else if (newScope) setLoading(!cached);
    setError("");
    try {
      const response = await api<FeedPage>(path, { timeoutMs: 15_000, cache: refresh ? "reload" : "default" });
      if (version === loadVersion.current) {
        const incoming = response.posts.filter((post) => !wasPostDeleted(post.id));
        // Returning from a conversation refreshes visible data without discarding loaded pages.
        setPosts((current) => newScope || refresh ? mergeById([], incoming) : mergeById(incoming, current.filter((post) => !incoming.some((fresh) => fresh.id === post.id))).filter((post) => !wasPostDeleted(post.id)));
        if (newScope || refresh) setCursor(response.nextCursor ?? null);
        loadedScope.current = scope;
      }
    } catch (caught) { if (version === loadVersion.current) setError(caught instanceof ApiError ? caught.message : "Posts could not be loaded. Check your connection."); }
    finally { if (version === loadVersion.current) { setLoading(false); setRefreshing(false); } }
  }, [path, scope]);
  useFocusEffect(useCallback(() => {
    feedFocused.current = true;
    scheduleVideoEvaluation();
    void load();
    return () => {
      feedFocused.current = false;
      loadVersion.current++;
      videoEvaluationVersion.current += 1;
      if (videoEvaluationTimer.current) {
        clearTimeout(videoEvaluationTimer.current);
        videoEvaluationTimer.current = null;
      }
      applyVisibleVideo(null);
    };
  }, [applyVisibleVideo, load, scheduleVideoEvaluation]));
  async function loadMore() {
    if (!cursor || paging.current || loading || refreshing) return;
    paging.current = true; setLoadingMore(true);
    const version = loadVersion.current;
    try {
      const response = await api<FeedPage>(`${path}&cursor=${encodeURIComponent(cursor)}`, { timeoutMs: 15_000 });
      if (version === loadVersion.current) { setPosts((items) => mergeById(items, response.posts).filter((post) => !wasPostDeleted(post.id))); setCursor(response.nextCursor ?? null); setError(""); }
    } catch (caught) { if (version === loadVersion.current) setFeedback(caught instanceof ApiError ? caught.message : "Older posts could not load. Tap Load more to retry."); }
    finally { if (version === loadVersion.current) { paging.current = false; setLoadingMore(false); } }
  }
  useEffect(() => { if (!feedback) return; const timeout = setTimeout(() => setFeedback(""), 4500); return () => clearTimeout(timeout); }, [feedback]);
  // Server owns filtering, including exact hashtag boundaries and tenant visibility.
  const filtered = posts;
  const toggleBookmark = useCallback(async (post: FeedPostData) => {
    if (pendingBookmarks.current.has(post.id)) return;
    pendingBookmarks.current.add(post.id); void Haptics.selectionAsync();
    const next = !post.bookmarked;
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: next } : item));
    try { await api(`/v1/student/feed/${post.id}/bookmark`, { method: next ? "PUT" : "DELETE" }); }
    catch { setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: !next } : item)); setFeedback("Saved posts could not be updated. Your previous state was restored."); }
    finally { pendingBookmarks.current.delete(post.id); }
  }, []);
  const sharePost = useCallback(async (post: FeedPostData) => {
    void Haptics.selectionAsync();
    try { const result = await sharePostLink(post); if (result === "copied") setFeedback("Post link copied."); if (result === "manual") setCopyId(post.id); }
    catch { setFeedback("The share menu could not open. Use Copy link in the post menu."); }
  }, []);
  const removePost = useCallback((id: string) => {
    loadVersion.current++; paging.current = false; setLoadingMore(false); setLoading(false); setRefreshing(false);
    setPosts((items) => items.filter((post) => post.id !== id).map((post) => post.quoted_post_id === id ? { ...post, quoted_post: null } : post));
  }, []);
  const changedPost = useCallback((changed: SocialFeedPost) => { setPosts((items) => items.map((post) => post.id === changed.id ? { ...post, ...changed } : post)); }, []);
  const bookmarkAction = useCallback((post: FeedPostData) => { void toggleBookmark(post); }, [toggleBookmark]);
  const shareAction = useCallback((post: FeedPostData) => { void sharePost(post); }, [sharePost]);
  const renderPost = useCallback(({ item }: { item: SocialFeedPost }) => <FeedPost post={item} onBookmark={bookmarkAction} onShare={shareAction} onDeleted={removePost} onFeedback={setFeedback} onChanged={changedPost} onVideoHandle={registerVideoHandle} videoAutoPlay />, [bookmarkAction, shareAction, removePost, changedPost, registerVideoHandle]);
  return <SafeAreaView edges={["top"]} style={styles.screen}>
    <FlatList contentContainerStyle={styles.listContent} data={filtered} initialNumToRender={6} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" keyExtractor={(post) => post.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="transparent" colors={["transparent"]} progressBackgroundColor="transparent" />} viewabilityConfig={viewabilityConfig} onViewableItemsChanged={onViewableItemsChanged}
      onLayout={scheduleVideoEvaluation} onScroll={scheduleVideoEvaluation} onScrollEndDrag={scheduleVideoEvaluation} onMomentumScrollEnd={scheduleVideoEvaluation} onContentSizeChange={scheduleVideoEvaluation} scrollEventThrottle={32}
      ListEmptyComponent={!loading && !error ? <FeedEmptyState filtered={Boolean(search) || selected !== "All"} /> : null}
      ListHeaderComponent={<><View style={{ height: 4, opacity: refreshing ? 1 : 0 }}><SkeletonBlock height={4} /></View><SearchField onChangeText={setQuery} placeholder="Search posts, sources or events" value={query} /><View style={styles.filters}><FilterRow items={categories} onSelect={(item) => setSelected(item as typeof selected)} selected={selected} /></View>{loading ? <FeedSkeleton /> : null}{error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.error}><Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={20} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}</>}
      ListFooterComponent={cursor ? <Pressable accessibilityRole="button" accessibilityLabel="Load more posts" disabled={loadingMore} onPress={() => void loadMore()} style={styles.more}>{loadingMore ? <FeedSkeleton count={1} /> : <Text style={styles.moreText}>Load more posts</Text>}</Pressable> : null}
      maxToRenderPerBatch={8} removeClippedSubviews={Platform.OS === "android"}
      renderItem={renderPost}
      showsVerticalScrollIndicator={false} style={[styles.list, { width: Math.min(width, 540) }]} windowSize={7} />
    {feedback ? <View pointerEvents="none" style={styles.feedbackRail}><View accessibilityRole="alert" style={styles.feedback}><Text style={styles.feedbackText}>{feedback}</Text></View></View> : null}
    <Pressable accessibilityLabel="Create a post" accessibilityRole="button" onPress={() => router.push("/compose")} style={({ pressed }) => [styles.composeFab, { right: Math.max(22, (width - 540) / 2 + 22) }, pressed && styles.pressed]}><Ionicons color="#FFFFFF" name="add" size={29} /></Pressable>
    <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
  </SafeAreaView>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 }, list: { alignSelf: "center" }, listContent: { paddingBottom: 118, paddingHorizontal: 12, paddingTop: 8 }, filters: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 11, paddingBottom: 11 }, loading: { alignItems: "center", gap: 9, paddingVertical: 30 }, loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 }, error: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, flexDirection: "row", gap: 11, marginTop: 18, minHeight: 72, padding: 14 }, errorText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 },
  emptyState: { alignItems: "center", minHeight: 450, paddingHorizontal: 20, paddingTop: 55 }, emptyIllustration: { height: 235, width: "100%" }, emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 24, marginTop: 18, textAlign: "center" }, emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330, textAlign: "center" }, feedbackRail: { alignItems: "center", bottom: 176, left: 18, position: "absolute", right: 18 }, feedback: { backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 14, borderWidth: 1, maxWidth: 500, padding: 13, width: "100%", ...theme.floatingShadow }, feedbackText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18 }, composeFab: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 27, bottom: 106, height: 54, justifyContent: "center", position: "absolute", width: 54, ...theme.floatingShadow }, pressed: { opacity: 0.72 }, more: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 14 }, moreText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
});
