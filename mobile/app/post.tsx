import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { FeedPost } from "@/src/components/feed-post";
import { CommentThread } from "@/src/components/comment-thread";
import { PostLinkDialog } from "@/src/components/post-menu";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { ReplyComposer } from "@/src/components/reply-composer";
import { api, ApiError } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { clearPendingPostLink, rememberPostLink, sharePostLink, validPostId, type FeedPostData } from "@/src/lib/feed-posts";
import { recordPostView } from "@/src/lib/post-views";
import type { FeedComment, SocialFeedPost } from "@/src/lib/feed-social";
import { pickAndUpload, type PhotoSource, type UploadedFile } from "@/src/lib/uploads";

export default function PostScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { id, comments } = useLocalSearchParams<{ id?: string | string[]; comments?: string }>();
  const { state, user, profile, sessionRestoreError, retrySessionRestore } = useAuth();
  const valid = validPostId(id);
  const key = `${user?.id ?? "anonymous"}:${String(id)}`;
  const [snapshot, setSnapshot] = useState<{ key: string; post: SocialFeedPost } | null>(null);
  const post = snapshot?.key === key ? snapshot.post : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copyId, setCopyId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [composer, setComposer] = useState<{ key: string; parent?: FeedComment; photo?: UploadedFile } | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const bookmarking = useRef(false);
  const version = useRef(0);
  const legacyComposerKey = useRef("");

  useFocusEffect(useCallback(() => {
    if (!valid || state !== "authenticated") return;
    const current = ++version.current;
    clearPendingPostLink(); setLoading(true); setError(""); setUnavailable(false); setOnboarding(false);
    void api<{ post: SocialFeedPost }>(`/v1/student/feed/${id}`)
      .then((data) => { if (current === version.current) setSnapshot({ key, post: data.post }); })
      .catch((caught) => {
        if (current !== version.current) return;
        setSnapshot(null);
        setUnavailable(caught instanceof ApiError && caught.status === 404);
        setOnboarding(caught instanceof ApiError && caught.details?.onboardingRequired === true);
        setError(caught instanceof ApiError ? caught.message : "Check your connection and try again.");
      })
      .finally(() => { if (current === version.current) setLoading(false); });
    return () => { version.current++; };
  }, [id, key, state, valid, retry]));
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(""), 4500); return () => clearTimeout(timer); }, [feedback]);
  useEffect(() => {
    if (comments === "1" && post?.social_enabled && legacyComposerKey.current !== key) { legacyComposerKey.current = key; setComposer({ key }); }
  }, [comments, key, post?.social_enabled]);
  useEffect(() => {
    if (!post?.id || !user?.id || loading) return;
    let live = true;
    void recordPostView(post.id, user.id).then((count) => {
      if (live && count !== null) setSnapshot((current) => current?.key === key ? { key, post: { ...current.post, view_count: Math.max(current.post.view_count ?? 0, count) } } : current);
    });
    return () => { live = false; };
  }, [post?.id, user?.id, loading, key]);
  const refreshPost = useCallback(() => {
    if (!valid || state !== "authenticated") return;
    const current = version.current;
    void api<{ post: SocialFeedPost }>(`/v1/student/feed/${id}`).then(({ post: fresh }) => {
      if (current === version.current) setSnapshot((value) => value?.key === key ? { key, post: fresh } : value);
    }).catch((caught) => {
      if (current !== version.current) return;
      if (caught instanceof ApiError && caught.status === 404) { setSnapshot(null); setUnavailable(true); setError("This post is no longer available."); }
      else setFeedback("Your change was saved. Counts will refresh when the connection recovers.");
    });
  }, [id, key, valid, state]);
  function updated() { refreshPost(); setRefreshToken((value) => value + 1); }
  function signIn() { if (validPostId(id)) rememberPostLink(id); router.push("/(auth)/sign-in"); }
  async function bookmark(current: FeedPostData) {
    if (bookmarking.current) return;
    bookmarking.current = true;
    const next = !current.bookmarked;
    setSnapshot((value) => value?.key === key ? { ...value, post: { ...value.post, bookmarked: next } } : value);
    try { await api(`/v1/student/feed/${current.id}/bookmark`, { method: next ? "PUT" : "DELETE" }); }
    catch { setSnapshot((value) => value?.key === key ? { ...value, post: { ...value.post, bookmarked: !next } } : value); setFeedback("Saved posts could not be updated. Your previous state was restored."); }
    finally { bookmarking.current = false; }
  }
  async function share(current: FeedPostData) {
    try { const result = await sharePostLink(current); if (result === "copied") setFeedback("Post link copied."); if (result === "manual") setCopyId(current.id); }
    catch { setFeedback("The share menu could not open. Use Copy link in the post menu."); }
  }
  async function attach(source: PhotoSource) {
    if (uploadLock.current || !post) return;
    uploadLock.current = true; setUploading(true);
    const current = version.current;
    try { const photo = await pickAndUpload("post", source); if (photo && current === version.current) setComposer({ key, photo }); }
    catch (caught) { if (current === version.current) setFeedback(caught instanceof Error ? caught.message : "The photo could not upload."); }
    finally { uploadLock.current = false; if (current === version.current) setUploading(false); }
  }
  const ownName = profile?.display_name || "You";
  const ownImage = (profile as (typeof profile & { profile_image_url?: string | null }))?.profile_image_url;
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to feed" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/feed")} style={styles.back}><Ionicons name="arrow-back" size={23} color={theme.text} /></Pressable><Text accessibilityRole="header" style={styles.heading}>Post</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} style={styles.screen}>
      {!valid ? <View style={styles.state}><Text style={styles.title}>Post unavailable</Text><Text style={styles.body}>This post link is not valid.</Text></View>
        : state === "loading" ? <View style={styles.state}>{sessionRestoreError ? <><Text style={styles.body}>{sessionRestoreError}</Text><Pressable accessibilityRole="button" onPress={() => void retrySessionRestore()} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable></> : <ActivityIndicator color={theme.brand} />}</View>
        : state === "anonymous" ? <View style={styles.state}><Ionicons name="lock-closed-outline" size={28} color={theme.deepBrand} /><Text style={styles.title}>Sign in to view this post</Text><Text style={styles.body}>Join the conversation with your KampusOne account. Campus-restricted posts keep their original audience.</Text><Pressable accessibilityRole="button" onPress={signIn} style={styles.button}><Text style={styles.buttonText}>Continue with KampusOne</Text></Pressable></View>
        : loading ? <View style={styles.state}><ActivityIndicator color={theme.brand} /><Text style={styles.body}>Loading post…</Text></View>
        : post ? <>
          <FeedPost detail post={post} onBookmark={(value) => void bookmark(value)} onShare={(value) => void share(value)} onFeedback={setFeedback} onComment={() => setComposer({ key })}
            onChanged={(fresh) => setSnapshot((value) => value?.key === key ? { key, post: fresh } : value)}
            onDeleted={() => { version.current++; setSnapshot(null); setUnavailable(true); setError("This post was deleted."); }} />
          {post.social_enabled ? <CommentThread key={`${key}:comments`} postId={post.id} refreshToken={refreshToken} onUpdated={updated} onReply={(parent) => setComposer({ key, parent })} /> : null}
        </> : <View style={styles.state}><Text style={styles.title}>{unavailable ? "Post unavailable" : "Couldn’t load this post"}</Text><Text style={styles.body}>{error}</Text>{!unavailable ? <Pressable accessibilityRole="button" onPress={() => { if (onboarding && validPostId(id)) { rememberPostLink(id); router.replace("/"); } else setRetry((value) => value + 1); }} style={styles.button}><Text style={styles.buttonText}>{onboarding ? "Complete student profile" : "Try again"}</Text></Pressable> : null}</View>}
      {feedback ? <Text accessibilityRole="alert" style={styles.notice}>{feedback}</Text> : null}
    </ScrollView>
    {post?.social_enabled && !loading && state === "authenticated" ? <View style={styles.replyDock}>
      <View style={styles.replyBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Write a reply" onPress={() => setComposer({ key })} style={styles.replyPrompt}><ProfileAvatar name={ownName} imageUrl={ownImage} size={30} /><Text style={styles.replyPlaceholder}>Post your reply</Text></Pressable>
        {uploading ? <ActivityIndicator color={theme.deepBrand} style={styles.dockIcon} /> : <><Pressable accessibilityRole="button" accessibilityLabel="Reply with a gallery image" disabled={uploading} onPress={() => void attach("library")} style={styles.dockIcon}><Ionicons name="image-outline" size={22} color={theme.deepBrand} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Reply with a camera photo" disabled={uploading} onPress={() => void attach("camera")} style={styles.dockIcon}><Ionicons name="camera-outline" size={23} color={theme.deepBrand} /></Pressable></>}
      </View>
    </View> : null}
    {composer?.key === key && post ? <ReplyComposer key={`${key}:${composer.parent?.id ?? "root"}`} post={post} parent={composer.parent} initialPhoto={composer.photo} onClose={() => setComposer(null)} onSent={() => { updated(); setFeedback("Reply posted."); }} /> : null}
    <PostLinkDialog id={copyId} onClose={() => setCopyId(null)} />
  </SafeAreaView>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas }, header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, width: "100%", maxWidth: 540, alignSelf: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, back: { minWidth: 44, minHeight: 48, justifyContent: "center", alignItems: "center" }, heading: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 18 },
  content: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 20, width: "100%", maxWidth: 540, alignSelf: "center" }, state: { alignItems: "center", paddingVertical: 44, gap: 14 }, title: { color: theme.text, fontFamily: theme.font.display, fontSize: 23, textAlign: "center" }, body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, textAlign: "center" }, button: { minHeight: 48, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.deepBrand, marginTop: 8 }, buttonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 }, notice: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 20, padding: 12, backgroundColor: theme.surfaceMuted, borderRadius: 12, marginTop: 12 },
  replyDock: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, width: "100%", maxWidth: 540, alignSelf: "center" }, replyBar: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surfaceMuted, minHeight: 48, borderRadius: 24, paddingLeft: 7, paddingRight: 3 }, replyPrompt: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }, replyPlaceholder: { fontFamily: theme.font.body, color: theme.textMuted, fontSize: 13, flexShrink: 1 }, dockIcon: { minWidth: 40, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
