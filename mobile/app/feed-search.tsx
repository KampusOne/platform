import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { FeedPost } from "@/src/components/feed-post";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import {
  SearchField,
  useReducedMotionPreference,
} from "@/src/components/product-ui";
import { FeedSkeleton, InlineLoading } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { VerifiedBadge } from "@/src/components/verified-badge";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
  activities,
  discoveryPath,
  emptySearchFilters,
  languages,
  mergeSearchResults,
  searchFilterError,
  searchTabs,
  type SearchFilters,
  type SearchPage,
  type SearchResult,
  type SearchTab,
} from "@/src/lib/discovery";
import { sharePostLink, type FeedPostData } from "@/src/lib/feed-posts";

export default function FeedSearch() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const { state, user } = useAuth(),
    { theme, styles } = useThemeStyles(createStyles),
    toast = useToast(),
    reduced = useReducedMotionPreference();
  const [query, setQuery] = useState(
      typeof q === "string" ? q.slice(0, 200) : "",
    ),
    [term, setTerm] = useState(query),
    [tab, setTab] = useState<SearchTab>("TOP");
  const [filters, setFilters] = useState<SearchFilters>(emptySearchFilters),
    [draft, setDraft] = useState(filters),
    [filterOpen, setFilterOpen] = useState(false),
    [filterError, setFilterError] = useState("");
  const [rows, setRows] = useState<SearchResult[]>([]),
    [loadedScope, setLoadedScope] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(true),
    [retry, setRetry] = useState(0),
    [recents, setRecents] = useState<string[]>([]);
  const generation = useRef(0),
    paging = useRef(false),
    bookmarkLocks = useRef(new Set<string>()),
    recentRef = useRef<string[]>([]);
  const effectiveTab = query.trim().startsWith("@") ? "PEOPLE" : tab;
  const path = discoveryPath(term, effectiveTab, filters),
    scope = `${user?.id}:${user?.universityId}:${path}`,
    active = useRef(scope);
  active.current = scope;
  const recentKey = `k1.search.recents.v1.${user?.id ?? "anonymous"}`;
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let live = true;
    recentRef.current = [];
    setRecents([]);
    if (user)
      void AsyncStorage.getItem(recentKey)
        .then((raw) => {
          if (!live || !raw) return;
          try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const safe = parsed
                .filter(
                  (s): s is string => typeof s === "string" && s.length <= 200,
                )
                .slice(0, 8);
              recentRef.current = safe;
              setRecents(safe);
            }
          } catch {
            /* Ignore an incomplete local history. */
          }
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [recentKey, user?.id]);
  function remember() {
    const value = query.trim();
    if (!user || !value) return;
    const next = [value, ...recentRef.current.filter((r) => r !== value)].slice(
      0,
      8,
    );
    recentRef.current = next;
    setRecents(next);
    void AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(
      () => undefined,
    );
  }
  useEffect(() => {
    const version = ++generation.current,
      controller = new AbortController();
    paging.current = false;
    setMore(false);
    setError("");
    setCursor(null);
    if (!user || !term || query.trim() !== term) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void api<SearchPage>(path, {
      signal: controller.signal,
      cache: "no-store",
      timeoutMs: 15000,
    })
      .then((page) => {
        if (
          controller.signal.aborted ||
          generation.current !== version ||
          active.current !== scope
        )
          return;
        setRows(page.results);
        setCursor(page.nextCursor);
        setReady(page.ready);
        setLoadedScope(scope);
      })
      .catch((e) => {
        if (!controller.signal.aborted && generation.current === version) {
          setRows([]);
          setLoadedScope(scope);
          setError(
            e instanceof Error
              ? e.message
              : "Search could not load. Check your connection and retry.",
          );
        }
      })
      .finally(() => {
        if (generation.current === version) setLoading(false);
      });
    return () => controller.abort();
  }, [path, scope, retry, term, query, user?.id]);
  const visible = loadedScope === scope && query.trim() === term ? rows : [];
  async function next() {
    if (!cursor || loading || paging.current || query.trim() !== term) return;
    paging.current = true;
    setMore(true);
    const version = generation.current;
    try {
      const page = await api<SearchPage>(
        discoveryPath(term, effectiveTab, filters, cursor),
        { cache: "no-store", timeoutMs: 15000 },
      );
      if (version === generation.current && active.current === scope) {
        setRows((old) => mergeSearchResults(old, page.results));
        setCursor(page.nextCursor);
        setError("");
      }
    } catch (e) {
      if (version === generation.current)
        toast(
          e instanceof Error ? e.message : "Could not load more results.",
          "error",
        );
    } finally {
      if (version === generation.current) {
        paging.current = false;
        setMore(false);
      }
    }
  }
  const bookmark = useCallback(
    async (post: FeedPostData) => {
      if (bookmarkLocks.current.has(post.id)) return;
      bookmarkLocks.current.add(post.id);
      const currentScope = active.current;
      try {
        await api(`/v1/student/feed/${post.id}/bookmark`, {
          method: post.bookmarked ? "DELETE" : "PUT",
        });
        if (active.current === currentScope)
          setRows((old) =>
            old.map((r) =>
              r.kind === "POST" && r.id === post.id
                ? { ...r, post: { ...r.post, bookmarked: !post.bookmarked } }
                : r,
            ),
          );
      } catch (e) {
        toast(
          e instanceof Error ? e.message : "Could not update saved posts.",
          "error",
        );
      } finally {
        bookmarkLocks.current.delete(post.id);
      }
    },
    [toast],
  );
  const render = ({ item }: { item: SearchResult }) => {
    if (item.kind === "POST")
      return (
        <FeedPost
          post={item.post}
          onBookmark={(p) => void bookmark(p)}
          onShare={(p) =>
            void sharePostLink(p).catch(() =>
              toast("Could not open sharing.", "error"),
            )
          }
          onDeleted={(id) => setRows((old) => old.filter((r) => r.id !== id))}
          onFeedback={toast}
          onChanged={(post) =>
            setRows((old) =>
              old.map((r) =>
                r.kind === "POST" && r.id === post.id ? { ...r, post } : r,
              ),
            )
          }
        />
      );
    if (item.kind === "PERSON")
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${item.name}'s profile`}
          onPress={() =>
            router.push({
              pathname: "/student-profile",
              params: { id: item.id },
            })
          }
          style={styles.result}
        >
          <ProfileAvatar size={48} name={item.name} imageUrl={item.avatarUrl} />
          <View style={styles.resultCopy}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{item.name}</Text>
              {item.verified ? <VerifiedBadge size={14} /> : null}
            </View>
            <Text style={styles.muted}>
              @{item.username ?? "student"}
              {item.followed ? " · Following" : ""}
            </Text>
            {item.bio ? (
              <Text numberOfLines={2} style={styles.body}>
                {item.bio}
              </Text>
            ) : null}
            {item.university ? (
              <Text numberOfLines={1} style={styles.muted}>
                {item.university}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" color={theme.textMuted} size={18} />
        </Pressable>
      );
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open reply by ${item.name}`}
        onPress={() =>
          router.push({
            pathname: "/post",
            params: { id: item.postId, reply: item.id },
          })
        }
        style={styles.result}
      >
        <ProfileAvatar size={38} name={item.name} imageUrl={item.avatarUrl} />
        <View style={styles.resultCopy}>
          <Text style={styles.name}>
            {item.name} <Text style={styles.muted}>@{item.username}</Text>
          </Text>
          <Text style={styles.muted}>Reply in {item.parentTitle}</Text>
          <Text style={styles.body}>{item.body}</Text>
        </View>
      </Pressable>
    );
  };
  const filterCount = Object.keys(filters).filter(
    (key) =>
      filters[key as keyof SearchFilters] !==
      emptySearchFilters[key as keyof SearchFilters],
  ).length;
  if (state === "anonymous") return <Redirect href="/(auth)/welcome" />;
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/feed")
            }
            style={styles.icon}
          >
            <Ionicons name="arrow-back" color={theme.text} size={23} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SearchField
              autoFocus
              value={query}
              onChangeText={(value) => setQuery(value.slice(0, 200))}
              placeholder="Search posts or @username"
              onSubmitEditing={() => {
                remember();
                setTerm(query.trim());
              }}
              onFilterPress={
                effectiveTab === "PEOPLE"
                  ? undefined
                  : () => {
                      setDraft(filters);
                      setFilterError("");
                      setFilterOpen(true);
                      Keyboard.dismiss();
                    }
              }
            />
          </View>
        </View>
        <View style={styles.tabs}>
          {searchTabs.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{
                selected: effectiveTab === value,
                disabled: query.trim().startsWith("@") && value !== "PEOPLE",
              }}
              disabled={query.trim().startsWith("@") && value !== "PEOPLE"}
              onPress={() => {
                setTab(value);
                remember();
              }}
              style={[styles.tab, effectiveTab === value && styles.activeTab]}
            >
              <Text
                style={[
                  styles.tabText,
                  effectiveTab === value && { color: theme.brand },
                ]}
              >
                {value[0] + value.slice(1).toLowerCase()}
              </Text>
            </Pressable>
          ))}
        </View>
        {effectiveTab !== "PEOPLE" && filterCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDraft(filters);
              setFilterOpen(true);
            }}
            style={styles.applied}
          >
            <Ionicons name="options-outline" size={15} color={theme.brand} />
            <Text style={styles.muted}>
              {filterCount} active {filterCount === 1 ? "filter" : "filters"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all search filters"
              onPress={() => setFilters(emptySearchFilters)}
              style={styles.clear}
            >
              <Text style={styles.link}>Clear</Text>
            </Pressable>
          </Pressable>
        ) : null}
        <FlatList
          data={visible}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          renderItem={render}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            loading ? (
              <FeedSkeleton count={2} />
            ) : error ? (
              <View style={styles.empty}>
                <Text accessibilityRole="alert" style={styles.body}>
                  {error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetry((n) => n + 1)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Retry search</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading && !error ? (
              <View style={styles.empty}>
                <Ionicons
                  name={!term ? "search-outline" : "file-tray-outline"}
                  color={theme.brand}
                  size={32}
                />
                <Text style={styles.heading}>
                  {!term
                    ? "Find your campus conversation"
                    : !ready
                      ? "Search is being connected"
                      : "No results yet"}
                </Text>
                <Text style={styles.muted}>
                  {!term
                    ? "Search a word, a name, or use @ for usernames."
                    : !ready
                      ? "Try again shortly."
                      : "Try another word or adjust your filters."}
                </Text>
                {!term && recents.length ? (
                  <View style={{ alignSelf: "stretch", marginTop: 24 }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name}>Recent searches</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          recentRef.current = [];
                          setRecents([]);
                          void AsyncStorage.removeItem(recentKey).catch(
                            () => undefined,
                          );
                        }}
                        style={styles.clear}
                      >
                        <Text style={styles.link}>Clear</Text>
                      </Pressable>
                    </View>
                    {recents.map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        onPress={() => setQuery(value)}
                        style={styles.recent}
                      >
                        <Ionicons
                          name="time-outline"
                          size={18}
                          color={theme.textMuted}
                        />
                        <Text style={styles.body}>{value}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null
          }
          ListFooterComponent={
            cursor && !loading && !error ? (
              <Pressable
                accessibilityRole="button"
                disabled={more}
                onPress={() => void next()}
                style={styles.more}
              >
                {more ? (
                <InlineLoading color={theme.brand} />
                ) : (
                  <Text style={styles.link}>Load more results</Text>
                )}
              </Pressable>
            ) : null
          }
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={5}
        />
      </View>
      <Modal
        transparent
        animationType={reduced ? "none" : "slide"}
        visible={filterOpen}
        onRequestClose={() => setFilterOpen(false)}
      >
        <View style={styles.scrim}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search filters"
            onPress={() => setFilterOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.heading}>Search filters</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                onPress={() => setFilterOpen(false)}
                style={styles.icon}
              >
                <Ionicons name="close" size={23} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.form}
            >
              <Text style={styles.muted}>
                These filters apply to posts and replies. Language follows the
                author’s selection; older posts may be unspecified.
              </Text>
              {(["from", "since", "until"] as const).map((key) => (
                <View key={key}>
                  <Text style={styles.label}>
                    {key === "from"
                      ? "From username"
                      : key === "since"
                        ? "From date (UTC)"
                        : "Through date (UTC)"}
                  </Text>
                  <TextInput
                    accessibilityLabel={
                      key === "from"
                        ? "From username"
                        : `${key} date YYYY-MM-DD`
                    }
                    autoCapitalize="none"
                    maxLength={key === "from" ? 41 : 10}
                    placeholder={key === "from" ? "@username" : "YYYY-MM-DD"}
                    placeholderTextColor={theme.textMuted}
                    value={draft[key]}
                    onChangeText={(value) =>
                      setDraft((old) => ({ ...old, [key]: value }))
                    }
                    style={styles.input}
                  />
                </View>
              ))}
              <Text style={styles.label}>Language</Text>
              <View style={styles.choices}>
                {languages.map(([key, label]) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: draft.language === key }}
                    key={key}
                    onPress={() =>
                      setDraft((old) => ({ ...old, language: key }))
                    }
                    style={[
                      styles.choice,
                      draft.language === key && styles.chosen,
                    ]}
                  >
                    <Text
                      style={[
                        styles.body,
                        draft.language === key && { color: theme.brand },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>Your activity</Text>
              {activities.map(([key, label]) => (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: draft.activity === key }}
                  onPress={() => setDraft((old) => ({ ...old, activity: key }))}
                  style={styles.activity}
                >
                  <Ionicons
                    name={
                      draft.activity === key
                        ? "radio-button-on"
                        : "radio-button-off"
                    }
                    color={
                      draft.activity === key ? theme.brand : theme.textMuted
                    }
                    size={22}
                  />
                  <Text style={styles.body}>{label}</Text>
                </Pressable>
              ))}
              <View style={styles.activity}>
                <Text style={[styles.body, { flex: 1 }]}>Exclude replies</Text>
                <Switch
                  accessibilityLabel="Exclude replies"
                  value={draft.excludeReplies}
                  onValueChange={(value) =>
                    setDraft((old) => ({ ...old, excludeReplies: value }))
                  }
                  trackColor={{ true: theme.deepBrand }}
                />
              </View>
              {filterError ? (
                <Text accessibilityRole="alert" style={{ color: theme.error }}>
                  {filterError}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.sheetFooter}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDraft(emptySearchFilters);
                  setFilterError("");
                }}
                style={styles.clear}
              >
                <Text style={styles.link}>Reset</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const invalid = searchFilterError(draft);
                  if (invalid) {
                    setFilterError(invalid);
                    return;
                  }
                  setFilters(draft);
                  setFilterOpen(false);
                  remember();
                }}
                style={[styles.button, { flex: 1 }]}
              >
                <Text style={styles.buttonText}>Apply filters</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { backgroundColor: theme.canvas, flex: 1 },
    page: { alignSelf: "center", width: "100%", maxWidth: 620, flex: 1 },
    header: { flexDirection: "row", alignItems: "center", padding: 10, gap: 5 },
    icon: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    tabs: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    tab: {
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    activeTab: { borderBottomColor: theme.brand },
    tabText: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    list: { paddingHorizontal: 15, paddingBottom: 35 },
    result: {
      flexDirection: "row",
      gap: 11,
      paddingVertical: 18,
      borderBottomColor: theme.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    resultCopy: { flex: 1, gap: 4 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    name: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: theme.text,
      flexShrink: 1,
    },
    body: {
      fontFamily: theme.font.body,
      fontSize: 14,
      lineHeight: 21,
      color: theme.text,
    },
    muted: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 19,
      color: theme.textMuted,
    },
    link: { fontFamily: theme.font.semibold, fontSize: 13, color: theme.brand },
    clear: { padding: 12, marginLeft: "auto", minHeight: 44 },
    applied: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 16,
      backgroundColor: theme.surfaceMuted,
    },
    heading: {
      fontFamily: theme.font.display,
      fontSize: 23,
      color: theme.text,
      marginVertical: 8,
    },
    empty: {
      alignItems: "center",
      paddingVertical: 45,
      paddingHorizontal: 18,
      gap: 8,
    },
    recent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      minHeight: 52,
    },
    button: {
      backgroundColor: theme.deepBrand,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 50,
      paddingHorizontal: 20,
      marginTop: 10,
    },
    buttonText: {
      color: "white",
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    more: { minHeight: 54, alignItems: "center", justifyContent: "center" },
    scrim: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,.45)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: theme.canvas,
      maxHeight: "90%",
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    form: { paddingHorizontal: 22, paddingBottom: 10 },
    label: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
      marginTop: 17,
      marginBottom: 9,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 11,
      minHeight: 48,
      paddingHorizontal: 12,
      fontFamily: theme.font.body,
      color: theme.text,
      backgroundColor: theme.surface,
    },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      padding: 10,
      borderRadius: 10,
      borderColor: theme.border,
      borderWidth: 1,
    },
    chosen: { backgroundColor: theme.surfaceTint, borderColor: theme.brand },
    activity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
    },
    sheetFooter: {
      flexDirection: "row",
      gap: 15,
      alignItems: "center",
      padding: 16,
    },
  });
