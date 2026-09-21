import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { useFocusEffect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FilterRow, SearchField } from "@/src/components/product-ui";
import { FeedPost } from "@/src/components/feed-post";
import { PostLinkDialog } from "@/src/components/post-menu";
import { ApiError, api, clearApiCache } from "@/src/lib/api";
import { sharePostLink, wasPostDeleted, type FeedPostData } from "@/src/lib/feed-posts";

const categories = ["All", "Update", "Event", "Sports", "Opportunity", "Emergency"] as const;
const emptyFeedIllustration = require("@/assets/illustrations/feed-empty-v2.png");
type FeedPage = { posts: FeedPostData[]; nextCursor?: string | null };

function FeedEmptyState({ filtered }: { filtered: boolean }) {
  const { styles } = useThemeStyles(createStyles);
  return (
    <View style={styles.emptyState}>
      <Image accessible={false} accessibilityElementsHidden accessibilityIgnoresInvertColors importantForAccessibility="no-hide-descendants" resizeMode="contain" source={emptyFeedIllustration} style={styles.emptyIllustration} />
      <Text style={styles.emptyTitle}>{filtered ? "No matching posts" : "No posts here yet"}</Text>
      {filtered ? <Text style={styles.emptyBody}>Try another search or choose a different update type.</Text> : null}
    </View>
  );
}

export default function FeedScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<FeedPostData[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [copyId, setCopyId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const moreVersion = useRef(0);
  const moreBusy = useRef(false);
  const pendingBookmarks = useRef(new Set<string>());

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    moreVersion.current++;
    moreBusy.current = false;
    setLoadingMore(false);
    try {
      setError("");
      const response = await api<FeedPage>("/v1/student/feed");
      if (version === loadVersion.current) {
        setPosts(response.posts.filter((post) => !wasPostDeleted(post.id)));
        setNextCursor(response.nextCursor ?? null);
      }
    } catch (caught) {
      if (version === loadVersion.current) setError(caught instanceof ApiError ? caught.message : "Posts could not be loaded. Check your connection and try again.");
    } finally {
      if (version === loadVersion.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { loadVersion.current++; moreVersion.current++; moreBusy.current = false; };
  }, [load]));

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(""), 4500);
    return () => clearTimeout(timeout);
  }, [feedback]);

  const filtered = useMemo(() => posts.filter((post) => {
    const matchesCategory = selected === "All" || post.category.toUpperCase() === selected.toUpperCase();
    const needle = query.trim().toLowerCase();
    return matchesCategory && (!needle || `${post.title} ${post.summary} ${post.body} ${post.source_name}`.toLowerCase().includes(needle));
  }), [posts, query, selected]);

  async function loadMore() {
    if (!nextCursor || moreBusy.current || loading || refreshing) return;
    moreBusy.current = true;
    const version = ++moreVersion.current;
    const feedVersion = loadVersion.current;
    setLoadingMore(true);
    try {
      const response = await api<FeedPage>(`/v1/student/feed?cursor=${encodeURIComponent(nextCursor)}`);
      if (version !== moreVersion.current || feedVersion !== loadVersion.current) return;
      setPosts((current) => {
        const merged = new Map(current.map((post) => [post.id, post]));
        for (const post of response.posts) if (!wasPostDeleted(post.id) && !merged.has(post.id)) merged.set(post.id, post);
        return [...merged.values()].filter((post) => !wasPostDeleted(post.id));
      });
      setNextCursor(response.nextCursor ?? null);
    } catch (caught) {
      if (version === moreVersion.current && feedVersion === loadVersion.current) setFeedback(caught instanceof ApiError ? caught.message : "More posts could not be loaded. Try again.");
    } finally {
      if (version === moreVersion.current) { moreBusy.current = false; setLoadingMore(false); }
    }
  }

  function refresh() {
    clearApiCache();
    setRefreshing(true);
    void load();
  }

  const toggleBookmark = useCallback(async (post: FeedPostData) => {
    if (pendingBookmarks.current.has(post.id)) return;
    pendingBookmarks.current.add(post.id);
    void Haptics.selectionAsync();
    const next = !post.bookmarked;
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: next } : item));
    try {
      await api(`/v1/student/feed/${post.id}/bookmark`, { method: next ? "PUT" : "DELETE" });
    } catch {
      setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: !next } : item));
      setFeedback("Saved posts could not be updated. Your previous state was restored.");
    } finally {
      pendingBookmarks.current.delete(post.id);
    }
  }, []);

  const sharePost = useCallback(async (post: FeedPostData) => {
    void Haptics.selectionAsync();
    try {
      const result = await sharePostLink(post);
      if (result === "copied") setFeedback("Post link copied.");
      if (result === "manual") setCopyId(post.id);
    } catch {
      setFeedback("The share menu could not open. Use Copy link in the post menu.");
    }
  }, []);

  const removePost = useCallback((id: string) => {
    setPosts((items) => items.filter((post) => post.id !== id));
  }, []);
  const fabRight = Math.max(22, (width - 540) / 2 + 22);
  const hasActiveFilter = Boolean(query.trim()) || selected !== "All";

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.listContent} data={filtered} initialNumToRender={6}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" keyExtractor={(post) => post.id}
        refreshing={refreshing} onRefresh={refresh}
        ListEmptyComponent={!loading && !error ? <FeedEmptyState filtered={hasActiveFilter} /> : null}
        ListHeaderComponent={
          <>
            <SearchField onChangeText={setQuery} placeholder="Search updates, sources or events" value={query} />
            <View style={styles.filters}><FilterRow items={categories} onSelect={(item) => setSelected(item as typeof selected)} selected={selected} /></View>
            {loading ? <View accessibilityLabel="Loading posts" style={styles.loading}>{[0, 1, 2].map((key) => <View key={key} style={styles.skeletonPost} />)}</View> : null}
            {error ? (
              <Pressable accessibilityRole="button" onPress={() => { clearApiCache(); setLoading(true); void load(); }} style={({ pressed }) => [styles.error, pressed && styles.pressed]}>
                <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={20} />
                <View style={styles.errorCopy}><Text style={styles.errorTitle}>The feed is unavailable</Text><Text style={styles.errorText}>{error} Tap to retry.</Text></View>
              </Pressable>
            ) : null}
          </>
        }
        ListFooterComponent={nextCursor ? <Pressable accessibilityRole="button" disabled={loadingMore || refreshing} onPress={() => void loadMore()} style={styles.more}><Text style={styles.moreText}>{loadingMore ? "Loading…" : "More posts"}</Text></Pressable> : null}
        maxToRenderPerBatch={8} removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item }) => <FeedPost post={item} onBookmark={(post) => void toggleBookmark(post)} onShare={(post) => void sharePost(post)} onDeleted={removePost} onFeedback={setFeedback} />}
        showsVerticalScrollIndicator={false} style={[styles.list, { width: Math.min(width, 540) }]} windowSize={7}
      />
      {feedback ? <View pointerEvents="none" style={styles.feedbackRail}><View accessibilityRole="alert" style={styles.feedback}><Ionicons color={theme.deepBrand} name="information-circle" size={20} /><Text style={styles.feedbackText}>{feedback}</Text></View></View> : null}
      <Pressable accessibilityHint="Write a public student post for KampusOne" accessibilityLabel="Create a post" accessibilityRole="button" onPress={() => router.push("/compose")} style={({ pressed }) => [styles.composeFab, { right: fabRight }, pressed && styles.composeFabPressed]}>
        <Ionicons color="#FFFFFF" name="add" size={29} />
      </Pressable>
      <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 },
  list: { alignSelf: "center" },
  listContent: { paddingBottom: 118, paddingHorizontal: 20, paddingTop: 10 },
  filters: { borderBottomColor: theme.border, borderBottomWidth: 1, marginTop: 13, paddingBottom: 13 },
  loading: { gap: 16, paddingVertical: 24 },
  skeletonPost: { height: 130, borderRadius: 14, backgroundColor: theme.surfaceMuted },
  more: { minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 12 },
  moreText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 14 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 18, flexDirection: "row", gap: 11, marginTop: 18, minHeight: 72, padding: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  errorText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  emptyState: { alignItems: "center", minHeight: 500, paddingHorizontal: 20, paddingTop: 70 },
  emptyIllustration: { height: 235, width: "100%" },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 24, marginTop: 18, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330, textAlign: "center" },
  feedbackRail: { alignItems: "center", bottom: 176, left: 18, position: "absolute", right: 18 },
  feedback: { alignItems: "flex-start", backgroundColor: theme.surfaceGlassStrong, borderColor: "rgba(168,70,46,.18)", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 9, maxWidth: 500, padding: 13, width: "100%", ...theme.floatingShadow },
  feedbackText: { color: theme.text, flex: 1, fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18 },
  composeFab: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 27, bottom: 106, height: 54, justifyContent: "center", position: "absolute", width: 54, ...theme.floatingShadow },
  composeFabPressed: { opacity: 0.84, transform: [{ scale: 0.97 }] },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
