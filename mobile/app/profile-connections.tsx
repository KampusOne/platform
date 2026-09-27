import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProfileAvatar } from "@/src/components/profile-avatar";
import { VerifiedBadge } from "@/src/components/visual-system";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";

type ConnectionKind = "followers" | "following";
type ConnectionPerson = {
  user_id: string;
  display_name: string;
  username: string | null;
  profile_image_url: string | null;
  current_level: number | null;
  university_name: string | null;
  department_name: string | null;
  verified: boolean;
};
type ConnectionPage = {
  people: ConnectionPerson[];
  nextCursor?: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProfileConnectionsScreen() {
  const { id, tab, name } = useLocalSearchParams<{ id?: string; tab?: string; name?: string }>();
  const { theme, styles } = useThemeStyles(createStyles);
  const target = typeof id === "string" && uuidPattern.test(id) ? id : "";
  const requestedTab: ConnectionKind = tab === "following" ? "following" : "followers";
  const [active, setActive] = useState<ConnectionKind>(requestedTab);
  const [people, setPeople] = useState<ConnectionPerson[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const paging = useRef(false);

  useEffect(() => {
    setActive(requestedTab);
  }, [requestedTab]);

  const load = useCallback(async (refresh = false) => {
    const version = ++requestVersion.current;
    paging.current = false;
    setLoadingMore(false);
    setError("");
    if (!target) {
      setPeople([]);
      setCursor(null);
      setLoading(false);
      setRefreshing(false);
      setError("This profile link is not valid.");
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const page = await api<ConnectionPage>(`/v1/people/${target}/${active}`, {
        cache: refresh ? "reload" : "default",
        timeoutMs: 15_000,
      });
      if (version !== requestVersion.current) return;
      setPeople(page.people);
      setCursor(page.nextCursor ?? null);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setError(caught instanceof Error ? caught.message : "This list could not be loaded.");
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [active, target]);

  useEffect(() => {
    setPeople([]);
    setCursor(null);
    setError("");
    setLoading(true);
  }, [active, target]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestVersion.current++;
        paging.current = false;
      };
    }, [load]),
  );

  async function loadMore() {
    if (!cursor || paging.current || loading || loadingMore || !target) return;
    paging.current = true;
    setLoadingMore(true);
    const version = requestVersion.current;
    try {
      const page = await api<ConnectionPage>(
        `/v1/people/${target}/${active}?cursor=${encodeURIComponent(cursor)}`,
        { timeoutMs: 15_000 },
      );
      if (version !== requestVersion.current) return;
      setPeople((current) => [
        ...current,
        ...page.people.filter((person) => !current.some((item) => item.user_id === person.user_id)),
      ]);
      setCursor(page.nextCursor ?? null);
    } catch (caught) {
      if (version === requestVersion.current)
        setError(caught instanceof Error ? caught.message : "More people could not be loaded.");
    } finally {
      paging.current = false;
      if (version === requestVersion.current) setLoadingMore(false);
    }
  }

  function changeTab(next: ConnectionKind) {
    if (next === active) return;
    setActive(next);
  }

  const ownerName = typeof name === "string" ? name.trim() : "";

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Connections</Text>
          {ownerName ? <Text numberOfLines={1} style={styles.subtitle}>{ownerName}</Text> : null}
        </View>
      </View>

      <View accessibilityRole="tablist" style={styles.tabs}>
        {(["followers", "following"] as ConnectionKind[]).map((value) => {
          const selected = active === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => changeTab(value)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <Text style={[styles.tabText, selected && styles.tabTextActive]}>
                {value === "followers" ? "Followers" : "Following"}
              </Text>
              <View style={[styles.tabLine, selected && styles.tabLineActive]} />
            </Pressable>
          );
        })}
      </View>

      {loading && people.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.brand} size="small" />
          <Text style={styles.helper}>Loading {active}…</Text>
        </View>
      ) : error && people.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={30} color={theme.textMuted} />
          <Text accessibilityRole="alert" style={styles.emptyTitle}>Couldn’t load {active}</Text>
          <Text style={styles.helper}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load(true)}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={[styles.list, people.length === 0 && styles.emptyList]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={theme.brand}
              onRefresh={() => void load(true)}
            />
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.35}
          renderItem={({ item }) => {
            const detail = [
              item.department_name,
              item.current_level ? `${item.current_level} level` : null,
            ].filter(Boolean).join(" · ");
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.display_name}'s profile`}
                onPress={() => router.push({ pathname: "/student-profile", params: { id: item.user_id } })}
                style={({ pressed }) => [styles.personRow, pressed && styles.rowPressed]}
              >
                <ProfileAvatar
                  name={item.display_name}
                  imageUrl={item.profile_image_url}
                  size={50}
                />
                <View style={styles.personCopy}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={styles.personName}>{item.display_name}</Text>
                    {item.verified ? <VerifiedBadge size={14} /> : null}
                  </View>
                  {item.username ? <Text numberOfLines={1} style={styles.username}>@{item.username}</Text> : null}
                  {detail ? <Text numberOfLines={1} style={styles.detail}>{detail}</Text> : null}
                  {!detail && item.university_name ? <Text numberOfLines={1} style={styles.detail}>{item.university_name}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="people-outline" size={32} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>
                {active === "followers" ? "No followers yet" : "Not following anyone yet"}
              </Text>
              <Text style={styles.helper}>
                {active === "followers"
                  ? "People who follow this profile will appear here."
                  : "People this profile follows will appear here."}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footerLoader} color={theme.brand} size="small" /> :
            error && people.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => void loadMore()} style={styles.inlineError}>
                <Text style={styles.inlineErrorText}>{error} Tap to retry.</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: theme.canvas,
    },
    header: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 18,
      gap: 10,
    },
    backButton: {
      width: 42,
      height: 42,
      alignItems: "center",
      justifyContent: "center",
    },
    headerCopy: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.displayStrong,
      fontSize: 24,
    },
    subtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      marginTop: 1,
    },
    tabs: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      paddingHorizontal: 18,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      paddingTop: 12,
    },
    tabText: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 14,
      paddingBottom: 12,
    },
    tabTextActive: {
      color: theme.accentText,
    },
    tabLine: {
      width: "100%",
      height: 2,
      backgroundColor: "transparent",
    },
    tabLineActive: {
      backgroundColor: theme.brand,
    },
    list: {
      paddingHorizontal: 18,
      paddingBottom: 32,
    },
    emptyList: {
      flexGrow: 1,
    },
    personRow: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      paddingVertical: 13,
    },
    rowPressed: {
      backgroundColor: theme.surfaceMuted,
    },
    personCopy: {
      flex: 1,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    personName: {
      flexShrink: 1,
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 15,
    },
    username: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
      marginTop: 2,
    },
    detail: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      marginTop: 4,
    },
    center: {
      flex: 1,
      minHeight: 260,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 34,
      gap: 9,
    },
    emptyTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 16,
      textAlign: "center",
    },
    helper: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    retryButton: {
      marginTop: 8,
      minHeight: 42,
      justifyContent: "center",
      paddingHorizontal: 18,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      backgroundColor: theme.surface,
    },
    retryText: {
      color: theme.accentText,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    footerLoader: {
      marginVertical: 18,
    },
    inlineError: {
      paddingVertical: 16,
      alignItems: "center",
    },
    inlineErrorText: {
      color: theme.error,
      fontFamily: theme.font.body,
      fontSize: 12,
      textAlign: "center",
    },
    pressed: {
      opacity: 0.6,
    },
  });
