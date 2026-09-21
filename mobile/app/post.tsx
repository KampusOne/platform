import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { FeedPost } from "@/src/components/feed-post";
import { PostLinkDialog } from "@/src/components/post-menu";
import { api, ApiError } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { clearPendingPostLink, rememberPostLink, sharePostLink, validPostId, type FeedPostData } from "@/src/lib/feed-posts";

export default function PostScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { state, user, sessionRestoreError, retrySessionRestore } = useAuth();
  const valid = validPostId(id);
  const key = `${user?.id ?? "anonymous"}:${String(id)}`;
  const [snapshot, setSnapshot] = useState<{ key: string; post: FeedPostData } | null>(null);
  const post = snapshot?.key === key ? snapshot.post : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copyId, setCopyId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const bookmarking = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!valid || state !== "authenticated") return;
    let active = true;
    clearPendingPostLink();
    setLoading(true);
    setError("");
    setUnavailable(false);
    setOnboarding(false);
    void api<{ post: FeedPostData }>(`/v1/student/feed/${id}`)
      .then((data) => { if (active) setSnapshot({ key, post: data.post }); })
      .catch((caught) => {
        if (!active) return;
        setSnapshot(null);
        setUnavailable(caught instanceof ApiError && caught.status === 404);
        setOnboarding(caught instanceof ApiError && caught.details?.onboardingRequired === true);
        setError(caught instanceof ApiError ? caught.message : "Check your connection and try again.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, key, state, valid, retry]));

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 4500);
    return () => clearTimeout(timer);
  }, [feedback]);

  function signIn() {
    if (validPostId(id)) rememberPostLink(id);
    router.push("/(auth)/sign-in");
  }

  async function bookmark(current: FeedPostData) {
    if (bookmarking.current) return;
    bookmarking.current = true;
    const next = !current.bookmarked;
    setSnapshot((value) => value?.key === key ? { ...value, post: { ...value.post, bookmarked: next } } : value);
    try {
      await api(`/v1/student/feed/${current.id}/bookmark`, { method: next ? "PUT" : "DELETE" });
    } catch {
      setSnapshot((value) => value?.key === key ? { ...value, post: { ...value.post, bookmarked: !next } } : value);
      setFeedback("Saved posts could not be updated. Your previous state was restored.");
    } finally {
      bookmarking.current = false;
    }
  }

  async function share(current: FeedPostData) {
    try {
      const result = await sharePostLink(current);
      if (result === "copied") setFeedback("Post link copied.");
      if (result === "manual") setCopyId(current.id);
    } catch {
      setFeedback("The share menu could not open. Use Copy link in the post menu.");
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to feed" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/feed")} style={styles.back}>
          <Ionicons name="arrow-back" size={23} color={theme.text} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.heading}>Campus post</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!valid ? <View style={styles.state}><Text style={styles.title}>Post unavailable</Text><Text style={styles.body}>This post link is not valid.</Text></View>
          : state === "loading" ? <View style={styles.state}>{sessionRestoreError ? <><Text style={styles.body}>{sessionRestoreError}</Text><Pressable accessibilityRole="button" onPress={() => void retrySessionRestore()} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable></> : <ActivityIndicator color={theme.brand} />}</View>
          : state === "anonymous" ? <View style={styles.state}><Ionicons name="lock-closed-outline" size={28} color={theme.deepBrand} /><Text style={styles.title}>Sign in to view this post</Text><Text style={styles.body}>Campus posts are available to signed-in students from the same institution.</Text><Pressable accessibilityRole="button" onPress={signIn} style={styles.button}><Text style={styles.buttonText}>Continue with KampusOne</Text></Pressable></View>
          : loading ? <View style={styles.state}><ActivityIndicator color={theme.brand} /><Text style={styles.body}>Loading post…</Text></View>
          : post ? <FeedPost post={post} onBookmark={(value) => void bookmark(value)} onShare={(value) => void share(value)} onFeedback={setFeedback} onDeleted={() => { setSnapshot(null); setUnavailable(true); setError("This post was deleted."); }} />
          : <View style={styles.state}><Text style={styles.title}>{unavailable ? "Post unavailable" : "Couldn’t load this post"}</Text><Text style={styles.body}>{error}</Text>{!unavailable ? <Pressable accessibilityRole="button" onPress={() => { if (onboarding && validPostId(id)) { rememberPostLink(id); router.replace("/"); } else setRetry((value) => value + 1); }} style={styles.button}><Text style={styles.buttonText}>{onboarding ? "Complete student profile" : "Try again"}</Text></Pressable> : null}</View>}
        {feedback ? <Text accessibilityRole="alert" style={styles.notice}>{feedback}</Text> : null}
      </ScrollView>
      <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, width: "100%", maxWidth: 540, alignSelf: "center" },
  back: { minWidth: 44, minHeight: 48, justifyContent: "center", alignItems: "center" },
  heading: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 18 },
  content: { padding: 20, paddingBottom: 48, width: "100%", maxWidth: 540, alignSelf: "center" },
  state: { alignItems: "center", paddingVertical: 44, gap: 14 },
  title: { color: theme.text, fontFamily: theme.font.display, fontSize: 23, textAlign: "center" },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: { minHeight: 48, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.deepBrand, marginTop: 8 },
  buttonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  notice: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 20, padding: 14, backgroundColor: theme.surfaceMuted, borderRadius: 14, marginTop: 18 },
});
