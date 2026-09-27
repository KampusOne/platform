import { useCallback, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { SkeletonBlock } from "@/src/components/skeleton";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";

type Thread = {
  id: string;
  display_name: string;
  profile_image_url?: string | null;
  last_message: string | null;
  unread_count: number;
  updated_at: string;
  status: string;
};
type Inbox = { threads: Thread[]; nextCursor: string | null };
const filters = ["All", "Unread", "Requests", "Tutor", "Vendor", "Rider"] as const;
type Filter = (typeof filters)[number];

function formatThreadTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "Now";
  if (diff < 60 * 60_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(diff / (60 * 60_000)))}h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString("en-NG", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function MessagesSkeleton() {
  return (
    <View accessibilityLabel="Loading messages" accessibilityState={{ busy: true }} style={{ gap: 20, paddingTop: 12 }}>
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <SkeletonBlock width={52} height={52} radius={26} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBlock width={index % 2 ? "48%" : "62%"} height={14} />
            <SkeletonBlock width={index % 3 ? "82%" : "68%"} height={11} />
          </View>
          <SkeletonBlock width={34} height={10} />
        </View>
      ))}
    </View>
  );
}

export default function MessagesScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const epoch = useRef(0);
  const loadingRef = useRef(false);
  const paged = useRef(false);

  const load = useCallback(async (before?: string) => {
    if (loadingRef.current) return;
    const version = epoch.current;
    loadingRef.current = true;
    if (before) setMoreBusy(true);
    try {
      const r = await api<Inbox>(`/v1/messages/inbox?filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ""}`);
      if (version !== epoch.current) return;
      setThreads((current) =>
        before
          ? [...current, ...r.threads.filter((thread) => !current.some((old) => old.id === thread.id))]
          : r.threads,
      );
      setCursor(r.nextCursor);
      setError("");
      paged.current = Boolean(before);
    } catch (caught) {
      if (version === epoch.current) {
        setError(caught instanceof Error ? caught.message : "Messages could not load.");
      }
    } finally {
      if (version === epoch.current) {
        loadingRef.current = false;
        setLoading(false);
        setMoreBusy(false);
      }
    }
  }, [filter, user?.id]);

  useFocusEffect(useCallback(() => {
    epoch.current += 1;
    loadingRef.current = false;
    paged.current = false;
    setThreads([]);
    setCursor(null);
    setLoading(true);
    setError("");
    void load();
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && !paged.current) void load();
    }, 15_000);
    return () => {
      epoch.current += 1;
      loadingRef.current = false;
      clearInterval(timer);
    };
  }, [load]));

  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-NG");
    if (!needle) return threads;
    return threads.filter((thread) =>
      `${thread.display_name} ${thread.last_message ?? ""}`.toLocaleLowerCase("en-NG").includes(needle),
    );
  }, [query, threads]);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/explore"))}
            style={styles.headerButton}
          >
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.heading}>Messages</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color={theme.textMuted} />
          <TextInput
            accessibilityLabel="Search messages"
            placeholder="Search conversations"
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={setQuery}
            selectionColor={theme.brand}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")} style={styles.clearSearch}>
              <Ionicons name="close-circle" size={19} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          style={styles.filterScroll}
        >
          {filters.map((item) => {
            const selected = item === filter;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item)}
                style={[styles.filter, selected && styles.filterSelected]}
              >
                <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{item}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {error ? (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load(); }} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? <MessagesSkeleton /> : (
          <FlatList
            data={visibleThreads}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.listContent, !visibleThreads.length && styles.emptyList]}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open conversation with ${item.display_name}`}
                onPress={() => router.push({ pathname: "/conversation", params: { id: item.id } })}
                style={({ pressed }) => [styles.thread, pressed && styles.threadPressed]}
              >
                <ProfileAvatar name={item.display_name} imageUrl={item.profile_image_url} size={52} />
                <View style={styles.threadCopy}>
                  <View style={styles.threadTopLine}>
                    <Text numberOfLines={1} style={[styles.threadName, item.unread_count > 0 && styles.threadNameUnread]}>{item.display_name}</Text>
                    <Text style={[styles.threadTime, item.unread_count > 0 && styles.threadTimeUnread]}>{formatThreadTime(item.updated_at)}</Text>
                  </View>
                  <View style={styles.threadBottomLine}>
                    <Text numberOfLines={1} style={[styles.preview, item.unread_count > 0 && styles.previewUnread]}>
                      {item.last_message || (item.status === "REQUESTED" ? "Message request" : "Start a conversation")}
                    </Text>
                    {item.unread_count > 0 ? (
                      <View accessibilityLabel={`${item.unread_count} unread messages`} style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{item.unread_count > 99 ? "99+" : item.unread_count}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={28} color={theme.deepBrand} /></View>
                <Text style={styles.emptyTitle}>{query ? "No matching conversations" : filter === "Requests" ? "No message requests" : "No conversations yet"}</Text>
                <Text style={styles.emptyBody}>{query ? "Try another name or message." : "When you start messaging people on KampusOne, your conversations will appear here."}</Text>
              </View>
            )}
            ListFooterComponent={cursor ? (
              <Pressable accessibilityRole="button" disabled={moreBusy} onPress={() => void load(cursor)} style={[styles.loadMore, moreBusy && styles.disabled]}>
                <Text style={styles.loadMoreText}>{moreBusy ? "Loading older conversations…" : "Load older conversations"}</Text>
              </Pressable>
            ) : <View style={{ height: 24 }} />}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  shell: { flex: 1, width: "100%", maxWidth: 540, alignSelf: "center", paddingHorizontal: 16 },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  heading: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 24 },
  searchBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 15, backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, marginTop: 8 },
  searchInput: { flex: 1, minHeight: 46, color: theme.text, fontFamily: theme.font.body, fontSize: 14, paddingVertical: 0 },
  clearSearch: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  filterScroll: { flexGrow: 0, marginTop: 14, marginHorizontal: -16 },
  filters: { paddingHorizontal: 16, gap: 6, paddingBottom: 10 },
  filter: { minHeight: 38, paddingHorizontal: 15, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  filterSelected: { backgroundColor: theme.deepBrand },
  filterText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  filterTextSelected: { color: "#FFFFFF", fontFamily: theme.font.semibold },
  errorCard: { marginTop: 8, backgroundColor: theme.surfaceMuted, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  errorText: { flex: 1, color: theme.error, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 },
  retryButton: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  retryText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12 },
  listContent: { paddingBottom: 28 },
  emptyList: { flexGrow: 1 },
  thread: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, paddingVertical: 12 },
  threadPressed: { opacity: 0.72 },
  threadCopy: { flex: 1, minWidth: 0, gap: 5 },
  threadTopLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  threadBottomLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  threadName: { flex: 1, color: theme.text, fontFamily: theme.font.medium, fontSize: 15 },
  threadNameUnread: { fontFamily: theme.font.bold },
  threadTime: { color: theme.textFaint, fontFamily: theme.font.body, fontSize: 11 },
  threadTimeUnread: { color: theme.deepBrand, fontFamily: theme.font.semibold },
  preview: { flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 18 },
  previewUnread: { color: theme.text, fontFamily: theme.font.medium },
  unreadBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  unreadText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 10 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30, paddingVertical: 48, gap: 10 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted, marginBottom: 4 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 17, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, textAlign: "center" },
  loadMore: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: 10 },
  loadMoreText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  disabled: { opacity: 0.5 },
});
