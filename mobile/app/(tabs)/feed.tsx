import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FilterRow, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const categories = ["All", "Update", "Event", "Sports", "Opportunity", "Emergency"] as const;
const structuredCategories = new Set(["EVENT", "OPPORTUNITY"]);
const emptyFeedIllustration = require("@/assets/illustrations/feed-empty-v2.png");

type IconName = keyof typeof Ionicons.glyphMap;
type Post = {
  id: string;
  category: string;
  title: string;
  summary: string;
  body: string;
  image_url: string | null;
  urgent: boolean;
  sponsored: boolean;
  published_at: string;
  correction_note: string | null;
  source_name: string;
  source_verified: boolean;
  bookmarked: boolean;
};

const categoryIcons: Record<string, IconName> = {
  EMERGENCY: "warning-outline",
  EVENT: "calendar-outline",
  OPPORTUNITY: "briefcase-outline",
  SPORTS: "football-outline",
  UPDATE: "newspaper-outline",
};

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function FeedPost({
  onBookmark,
  onShare,
  post,
}: {
  onBookmark: (post: Post) => void;
  onShare: (post: Post) => void;
  post: Post;
}) {
  const category = post.category.toUpperCase();
  const structured = structuredCategories.has(category);
  const categoryLabel = post.urgent ? "Urgent" : post.category.toLowerCase();

  return (
    <View style={styles.post}>
      <View style={styles.postHeader}>
        <View accessibilityElementsHidden style={styles.sourceAvatar}>
          <Text style={styles.sourceAvatarText}>{post.source_name.slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.sourceCopy}>
          <View style={styles.sourceNameRow}>
            <Text
              accessibilityLabel={`${post.source_name}${post.source_verified ? ", verified campus source" : ""}`}
              numberOfLines={1}
              style={styles.sourceName}
            >
              {post.source_name}
            </Text>
            {post.source_verified ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.verifiedBadge}>
                <Ionicons color={theme.verificationMark} name="checkmark" size={10} />
              </View>
            ) : null}
          </View>
          <Text style={styles.postTime}>{formatPublishedAt(post.published_at)}</Text>
        </View>
        <View style={[styles.category, post.urgent && styles.urgentCategory]}>
          <Text style={[styles.categoryText, post.urgent && styles.urgentCategoryText]}>{categoryLabel}</Text>
        </View>
      </View>

      {structured ? (
        <View style={styles.structuredPanel}>
          <View style={styles.structuredIcon}>
            <Ionicons color={theme.deepBrand} name={categoryIcons[category] ?? "newspaper-outline"} size={19} />
          </View>
          <View style={styles.structuredCopy}>
            <Text style={styles.structuredEyebrow}>{category === "EVENT" ? "CAMPUS EVENT" : "CAMPUS OPPORTUNITY"}</Text>
            <Text style={styles.postTitle}>{post.title}</Text>
            <Text style={styles.postSummary}>{post.summary}</Text>
            {post.body && post.body !== post.summary ? <Text style={styles.postText}>{post.body}</Text> : null}
          </View>
        </View>
      ) : (
        <View style={styles.postBody}>
          <Text style={styles.postTitle}>{post.title}</Text>
          <Text style={styles.postSummary}>{post.summary}</Text>
          {post.body && post.body !== post.summary ? <Text style={styles.postText}>{post.body}</Text> : null}
        </View>
      )}

      {post.image_url ? (
        <Image
          accessible
          accessibilityIgnoresInvertColors
          accessibilityLabel={`Attached image for ${post.title}`}
          accessibilityRole="image"
          resizeMode="cover"
          source={{ uri: post.image_url }}
          style={styles.postImage}
        />
      ) : null}

      {post.correction_note ? (
        <View accessibilityRole="alert" style={styles.correction}>
          <Ionicons color={theme.statusAttention} name="information-circle-outline" size={17} />
          <Text style={styles.correctionText}>Correction: {post.correction_note}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={post.bookmarked ? `Remove ${post.title} from saved posts` : `Save ${post.title}`}
          accessibilityRole="button"
          accessibilityState={{ selected: post.bookmarked }}
          hitSlop={4}
          onPress={() => onBookmark(post)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Ionicons
            color={post.bookmarked ? theme.brandPressed : theme.textMuted}
            name={post.bookmarked ? "bookmark" : "bookmark-outline"}
            size={20}
          />
          <Text style={[styles.actionText, post.bookmarked && styles.actionTextActive]}>{post.bookmarked ? "Saved" : "Save"}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Share ${post.title}`}
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => onShare(post)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Ionicons color={theme.textMuted} name="share-social-outline" size={20} />
          <Text style={styles.actionText}>Share</Text>
        </Pressable>
        {post.sponsored ? <Text style={styles.sponsored}>SPONSORED</Text> : <View />}
      </View>
    </View>
  );
}

function FeedEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <View style={styles.emptyState}>
      <Image
        accessible={false}
        accessibilityElementsHidden
        accessibilityIgnoresInvertColors
        importantForAccessibility="no-hide-descendants"
        resizeMode="contain"
        source={emptyFeedIllustration}
        style={styles.emptyIllustration}
      />
      <Text style={styles.emptyTitle}>{filtered ? "No matching posts" : "No posts here yet"}</Text>
      <Text style={styles.emptyBody}>
        {filtered
          ? "Try another search or choose a different update type."
          : "Verified campus updates, events and opportunities will appear here."}
      </Text>
    </View>
  );
}

export default function FeedScreen() {
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setPosts((await api<{ posts: Post[] }>("/v1/student/feed")).posts);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Campus updates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

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

  const toggleBookmark = useCallback(async (post: Post) => {
    void Haptics.selectionAsync();
    const next = !post.bookmarked;
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: next } : item));
    try {
      await api(`/v1/student/feed/${post.id}/bookmark`, { method: next ? "PUT" : "DELETE" });
    } catch {
      setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: !next } : item));
      setFeedback("Saved posts could not be updated. Your previous state was restored.");
    }
  }, []);

  const sharePost = useCallback(async (post: Post) => {
    void Haptics.selectionAsync();
    try {
      await Share.share({
        message: `${post.title}\n\n${post.summary}\n\nSource: ${post.source_name}`,
        title: post.title,
      });
    } catch {
      setFeedback("The share menu could not open. Please try again.");
    }
  }, []);

  const explainComposeAccess = useCallback(() => {
    const message = "Posting is currently limited to approved campus publishers. Your student account remains read-only and no post was sent.";
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setFeedback(message);
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const fabRight = Math.max(22, (width - 540) / 2 + 22);
  const hasActiveFilter = Boolean(query.trim()) || selected !== "All";

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={filtered}
        initialNumToRender={6}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(post) => post.id}
        ListEmptyComponent={!loading && !error ? <FeedEmptyState filtered={hasActiveFilter} /> : null}
        ListHeaderComponent={(
          <>
            <SearchField onChangeText={setQuery} placeholder="Search updates, sources or events" value={query} />
            <View style={styles.filters}>
              <FilterRow items={categories} onSelect={(item) => setSelected(item as typeof selected)} selected={selected} />
            </View>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.brand} />
                <Text style={styles.loadingText}>Checking verified campus posts…</Text>
              </View>
            ) : null}

            {error ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => { setLoading(true); void load(); }}
                style={({ pressed }) => [styles.error, pressed && styles.pressed]}
              >
                <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={20} />
                <View style={styles.errorCopy}>
                  <Text style={styles.errorTitle}>The feed is unavailable</Text>
                  <Text style={styles.errorText}>{error} Tap to retry.</Text>
                </View>
              </Pressable>
            ) : null}
          </>
        )}
        maxToRenderPerBatch={8}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item }) => (
          <FeedPost onBookmark={(post) => void toggleBookmark(post)} onShare={(post) => void sharePost(post)} post={item} />
        )}
        showsVerticalScrollIndicator={false}
        style={[styles.list, { width: Math.min(width, 540) }]}
        windowSize={7}
      />

      {feedback ? (
        <View pointerEvents="none" style={styles.feedbackRail}>
          <View accessibilityRole="alert" style={styles.feedback}>
            <Ionicons color={theme.deepBrand} name="information-circle" size={20} />
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityHint="Explains who can publish to the campus feed"
        accessibilityLabel="Create a campus post"
        accessibilityRole="button"
        onPress={explainComposeAccess}
        style={({ pressed }) => [styles.composeFab, { right: fabRight }, pressed && styles.composeFabPressed]}
      >
        <Ionicons color="#FFFFFF" name="add" size={29} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 },
  list: { alignSelf: "center" },
  listContent: { paddingBottom: 118, paddingHorizontal: 20, paddingTop: 10 },
  filters: { borderBottomColor: theme.border, borderBottomWidth: 1, marginTop: 13, paddingBottom: 13 },
  loading: { alignItems: "center", gap: 9, paddingVertical: 54 },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 18, flexDirection: "row", gap: 11, marginTop: 18, minHeight: 72, padding: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  errorText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  post: { borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 17 },
  postHeader: { alignItems: "center", flexDirection: "row" },
  sourceAvatar: { alignItems: "center", backgroundColor: theme.sand, borderRadius: 21, height: 42, justifyContent: "center", width: 42 },
  sourceAvatarText: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11 },
  sourceCopy: { flex: 1, marginLeft: 10 },
  sourceNameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  sourceName: { color: theme.text, flexShrink: 1, fontFamily: theme.font.semibold, fontSize: 14 },
  verifiedBadge: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 8, height: 16, justifyContent: "center", width: 16 },
  postTime: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11, marginTop: 2 },
  category: { backgroundColor: theme.surfaceMuted, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  urgentCategory: { backgroundColor: "rgba(168,70,46,.12)" },
  categoryText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 10.5, textTransform: "capitalize" },
  urgentCategoryText: { color: theme.deepBrand },
  postBody: { paddingLeft: 52, paddingTop: 9 },
  postTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16, lineHeight: 21 },
  postSummary: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20, marginTop: 4 },
  postText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19, marginTop: 6 },
  structuredPanel: { backgroundColor: "rgba(241,223,200,.42)", borderColor: "rgba(168,70,46,.13)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginLeft: 52, marginTop: 11, padding: 13 },
  structuredIcon: { alignItems: "center", backgroundColor: "rgba(255,253,252,.82)", borderRadius: 14, height: 40, justifyContent: "center", width: 40 },
  structuredCopy: { flex: 1 },
  structuredEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: .8, marginBottom: 5 },
  postImage: { alignSelf: "stretch", aspectRatio: 1.7, borderRadius: 18, marginLeft: 52, marginTop: 12 },
  correction: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 12, flexDirection: "row", gap: 7, marginLeft: 52, marginTop: 10, padding: 10 },
  correctionText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 15 },
  actions: { alignItems: "center", flexDirection: "row", gap: 22, marginLeft: 52, minHeight: 46, paddingTop: 8 },
  action: { alignItems: "center", flexDirection: "row", gap: 6, minHeight: 44, minWidth: 60 },
  actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 },
  actionTextActive: { color: theme.brandPressed },
  sponsored: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: .8, marginLeft: "auto" },
  emptyState: { alignItems: "center", minHeight: 500, paddingHorizontal: 20, paddingTop: 70 },
  emptyIllustration: { height: 235, width: "100%" },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 24, marginTop: 18, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330, textAlign: "center" },
  feedbackRail: { alignItems: "center", bottom: 176, left: 18, position: "absolute", right: 18 },
  feedback: { alignItems: "flex-start", backgroundColor: theme.surfaceGlassStrong, borderColor: "rgba(168,70,46,.18)", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 9, maxWidth: 500, padding: 13, width: "100%", ...theme.floatingShadow },
  feedbackText: { color: theme.text, flex: 1, fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18 },
  composeFab: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 27, bottom: 106, height: 54, justifyContent: "center", position: "absolute", width: 54, ...theme.floatingShadow },
  composeFabPressed: { opacity: .84, transform: [{ scale: .97 }] },
  pressed: { opacity: .72, transform: [{ scale: .97 }] },
});
