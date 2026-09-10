import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, ProductScreen, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const categories = ["All", "Update", "Event", "Sports", "Opportunity", "Emergency"] as const;
type Post = {
  id: string; category: string; title: string; summary: string; body: string;
  image_url: string | null; urgent: boolean; sponsored: boolean; published_at: string;
  correction_note: string | null; source_name: string; source_verified: boolean; bookmarked: boolean;
};

export default function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setError(""); setPosts((await api<{ posts: Post[] }>("/v1/student/feed")).posts); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Campus updates could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => posts.filter((post) => {
    const matchesCategory = selected === "All" || post.category === selected.toUpperCase();
    const needle = query.trim().toLowerCase();
    return matchesCategory && (!needle || `${post.title} ${post.summary} ${post.body} ${post.source_name}`.toLowerCase().includes(needle));
  }), [posts, query, selected]);

  async function toggleBookmark(post: Post) {
    void Haptics.selectionAsync();
    const next = !post.bookmarked;
    setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: next } : item));
    try { await api(`/v1/student/feed/${post.id}/bookmark`, { method: next ? "PUT" : "DELETE" }); }
    catch { setPosts((items) => items.map((item) => item.id === post.id ? { ...item, bookmarked: !next } : item)); }
  }

  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "shield-checkmark", text: "Source-checked campus news", verified: true }} showBell={false} subtitle="Updates, events and opportunities" title="Campus feed" unread={false} />
      <SearchField onChangeText={setQuery} placeholder="Search updates, sources or events" value={query} />
      <View style={styles.filters}><FilterRow items={categories} onSelect={(item) => setSelected(item as typeof selected)} selected={selected} /></View>
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.brand} /><Text style={styles.loadingText}>Checking the latest verified posts…</Text></View> : null}
      {error ? <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.error}><Ionicons name="cloud-offline-outline" size={20} color={theme.deepBrand} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {!loading && !error && !filtered.length ? <EmptyResult body="Your content team has not published a matching campus update yet." title="No posts here yet" /> : null}
      <View style={styles.feed}>
        {filtered.map((post) => (
          <View key={post.id} style={styles.post}>
            <View style={styles.postHeader}>
              <View style={styles.sourceAvatar}><Text style={styles.sourceAvatarText}>{post.source_name.slice(0, 2).toUpperCase()}</Text></View>
              <View style={styles.sourceCopy}>
                <View style={styles.sourceNameRow}><Text numberOfLines={1} style={styles.sourceName}>{post.source_name}</Text>{post.source_verified ? <Ionicons name="checkmark-circle" size={15} color={theme.brand} /> : null}</View>
                <Text style={styles.postTime}>{new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(post.published_at))}</Text>
              </View>
              <View style={[styles.category, post.urgent && styles.urgent]}><Text style={[styles.categoryText, post.urgent && styles.urgentText]}>{post.urgent ? "URGENT" : post.category}</Text></View>
            </View>
            {post.image_url ? <Image accessibilityLabel={`Image for ${post.title}`} resizeMode="cover" source={{ uri: post.image_url }} style={styles.postImage} /> : null}
            <View style={styles.postBody}>
              <Text style={styles.postTitle}>{post.title}</Text>
              <Text style={styles.postSummary}>{post.summary}</Text>
              {post.body !== post.summary ? <Text style={styles.postText}>{post.body}</Text> : null}
              {post.correction_note ? <View style={styles.correction}><Ionicons name="information-circle-outline" size={16} color={theme.statusAttention} /><Text style={styles.correctionText}>Correction: {post.correction_note}</Text></View> : null}
            </View>
            <View style={styles.actions}>
              <Pressable onPress={() => void toggleBookmark(post)} style={styles.action}><Ionicons name={post.bookmarked ? "bookmark" : "bookmark-outline"} size={20} color={post.bookmarked ? theme.brand : theme.textMuted} /><Text style={[styles.actionText, post.bookmarked && styles.actionTextActive]}>{post.bookmarked ? "Saved" : "Save"}</Text></Pressable>
              <Pressable onPress={() => void Share.share({ title: post.title, message: `${post.title}\n\n${post.summary}\n\nSource: ${post.source_name}` })} style={styles.action}><Ionicons name="share-social-outline" size={20} color={theme.textMuted} /><Text style={styles.actionText}>Share</Text></Pressable>
              {post.sponsored ? <Text style={styles.sponsored}>SPONSORED</Text> : <View />}
            </View>
          </View>
        ))}
      </View>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 18, marginTop: 12 }, loading: { alignItems: "center", gap: 9, paddingVertical: 34 }, loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 16, flexDirection: "row", gap: 9, marginBottom: 15, padding: 13 }, errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12 },
  feed: { gap: 16 }, post: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 23, borderWidth: 1, overflow: "hidden", ...theme.shadow },
  postHeader: { alignItems: "center", flexDirection: "row", padding: 13 }, sourceAvatar: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 18, height: 38, justifyContent: "center", width: 38 }, sourceAvatarText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 11 }, sourceCopy: { flex: 1, marginLeft: 10 }, sourceNameRow: { alignItems: "center", flexDirection: "row", gap: 4 }, sourceName: { color: theme.text, flexShrink: 1, fontFamily: theme.font.semibold, fontSize: 12.5 }, postTime: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 2 },
  category: { backgroundColor: theme.surfaceMuted, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5 }, urgent: { backgroundColor: "#FFF0E9" }, categoryText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: .5 }, urgentText: { color: theme.statusAttention }, postImage: { aspectRatio: 1.65, width: "100%" },
  postBody: { padding: 15 }, postTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, lineHeight: 24 }, postSummary: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 19, marginTop: 7 }, postText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 19, marginTop: 8 }, correction: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 12, flexDirection: "row", gap: 7, marginTop: 11, padding: 10 }, correctionText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 15 },
  actions: { alignItems: "center", borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", gap: 22, minHeight: 52, paddingHorizontal: 15 }, action: { alignItems: "center", flexDirection: "row", gap: 6 }, actionText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 }, actionTextActive: { color: theme.brandPressed }, sponsored: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 7.5, letterSpacing: .8, marginLeft: "auto" },
});
