import { useWebKeyboardViewport } from "@/src/lib/web-keyboard-viewport";
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { commentsPath } from "@/src/lib/comment-replies";
import { getFeedPostText } from "@/src/lib/feed-post-text";
import type { FeedComment, SocialFeedPost } from "@/src/lib/feed-social";
import { pickAndUpload, type PhotoSource, type UploadedFile } from "@/src/lib/uploads";
import { ProfileAvatar } from "./profile-avatar";
import { RelativeTime } from "./relative-time";
import { VerifiedBadge } from "./verified-badge";

type Draft = { body: string; photo: UploadedFile | null; requestId: string };
// In-memory, account-scoped drafts survive closing a composer, but never cross accounts.
const drafts = new Map<string, Draft>();
function keep(key: string, draft: Draft) {
  if (draft.body || draft.photo) drafts.set(key, draft); else drafts.delete(key);
  while (drafts.size > 30) drafts.delete(drafts.keys().next().value!);
}
export function ReplyComposer({ post, parent, initialPhoto, onClose, onSent }: {
  post: SocialFeedPost; parent?: FeedComment | null | undefined; initialPhoto?: UploadedFile | null | undefined;
  onClose(): void; onSent(comment: FeedComment): void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const keyboardViewport = useWebKeyboardViewport();
  const { user, profile } = useAuth();
  const key = `${user?.id ?? "anonymous"}:${post.id}:${parent?.id ?? "root"}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = drafts.get(key) ?? { body: "", photo: null, requestId: randomUUID() };
    return initialPhoto ? { ...saved, photo: initialPhoto, requestId: randomUUID() } : saved;
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<TextInput>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const authorName = parent?.author_name ?? post.source_name;
  const authorImage = parent ? parent.author_image_url : post.source_image_url;
  const authorVerified = parent ? parent.author_verified : post.source_verified;
  const postText = getFeedPostText(post);
  const contextBody = parent ? parent.body : [postText.title, ...postText.paragraphs].filter(Boolean).join("\n");
  const ownName = profile?.display_name || "You";
  const ownImage = (profile as (typeof profile & { profile_image_url?: string | null }))?.profile_image_url;
  const canSend = Boolean(user && (draft.body.trim() || draft.photo) && !busy && !parent?.is_deleted);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { keep(key, draft); }, [key, draft]);
  function change(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch, requestId: randomUUID() })); }
  async function attach(source: PhotoSource) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setUploading(true); setError("");
    try { const photo = await pickAndUpload("post", source); if (alive.current && photo) change({ photo }); }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : "Your photo could not upload. Your draft is still here."); }
    finally { lock.current = false; if (alive.current) { setBusy(false); setUploading(false); } }
  }
  async function send() {
    if (!canSend || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ comment: FeedComment }>(commentsPath(post.id), { method: "POST", body: JSON.stringify({ body: draft.body.trim(), requestId: draft.requestId, ...(draft.photo ? { mediaId: draft.photo.id } : {}), ...(parent ? { parentCommentId: parent.id } : {}) }) });
      if (alive.current) { drafts.delete(key); onSent(result.comment); onClose(); }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : "Your reply was not confirmed. Your draft is still here; try again."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function close() { if (!lock.current) { keep(key, draft); onClose(); } }
  return <Modal visible animationType="none" presentationStyle="fullScreen" onShow={() => field.current?.focus()} onRequestClose={close}>
    <SafeAreaView style={[styles.screen, keyboardViewport]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close reply, keep draft" disabled={busy} onPress={close} style={styles.icon}><Ionicons name="close" color={theme.text} size={26} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Post reply" accessibilityState={{ disabled: !canSend, busy: busy && !uploading }} disabled={!canSend} onPress={() => void send()} style={[styles.send, !canSend && styles.disabled]}>{busy && !uploading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.sendText}>Reply</Text>}</Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} style={styles.scroller}>
          {parent ? <Text style={styles.conversation}>In {post.source_name}’s conversation</Text> : null}
          <View style={styles.context}>
            <View style={styles.avatarRail}><ProfileAvatar name={authorName} imageUrl={authorImage} size={38} /><View style={styles.threadLine} /></View>
            <View style={styles.contextCopy}>
              <View style={styles.nameRow}><Text numberOfLines={1} style={styles.name}>{authorName}</Text>{authorVerified ? <VerifiedBadge size={13} /> : null}<Text style={styles.muted}>·</Text><RelativeTime value={parent?.created_at ?? post.published_at} style={styles.muted} /></View>
              {contextBody ? <Text style={styles.contextBody}>{contextBody}</Text> : null}
              {(parent ? parent.image_url : post.image_url) ? <Image accessible accessibilityLabel="Original attachment" source={{ uri: (parent ? parent.image_url : post.image_url)! }} style={styles.contextPhoto} resizeMode="cover" /> : null}
              <Text style={styles.replying}>Replying to <Text style={styles.replyingName}>{authorName}</Text></Text>
            </View>
          </View>
          <View style={styles.writingRow}>
            <ProfileAvatar name={ownName} imageUrl={ownImage} size={38} />
            <View style={styles.writing}>
              <TextInput ref={field} autoFocus multiline maxLength={2000} editable={!busy} accessibilityLabel={`Reply to ${authorName}`} placeholder="Post your reply" placeholderTextColor={theme.textSubtle} selectionColor={theme.deepBrand} underlineColorAndroid="transparent" value={draft.body} onChangeText={(body) => change({ body })} style={[styles.input, Platform.OS === "web" && ({ outlineWidth: 0, outlineColor: "transparent" } as TextStyle)]} />
              {draft.photo ? <View style={styles.photoWrap}><Image accessible accessibilityLabel="Your reply attachment" source={{ uri: draft.photo.url }} resizeMode="cover" style={styles.photo} /><Pressable accessibilityRole="button" accessibilityLabel="Remove photo" disabled={busy} onPress={() => change({ photo: null })} style={styles.remove}><Ionicons name="close" color="#FFFFFF" size={18} /></Pressable></View> : null}
            </View>
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {parent?.is_deleted ? <Text style={styles.error}>This reply was deleted. You can close this screen without losing your draft.</Text> : null}
        </ScrollView>
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose an image from gallery" disabled={busy} onPress={() => void attach("library")} style={styles.icon}><Ionicons name="image-outline" color={theme.deepBrand} size={24} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Take a photo with camera" disabled={busy} onPress={() => void attach("camera")} style={styles.icon}><Ionicons name="camera-outline" color={theme.deepBrand} size={25} /></Pressable>
          {uploading ? <ActivityIndicator color={theme.deepBrand} style={styles.uploading} /> : null}
          <Text accessibilityLabel={`${draft.body.length} of 2000 characters`} style={styles.counter}>{draft.body.length ? `${draft.body.length}/2000` : ""}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6, width: "100%", maxWidth: 600, alignSelf: "center" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, send: { minHeight: 38, minWidth: 76, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand, borderRadius: 20 }, sendText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 }, disabled: { opacity: 0.4 },
  scroller: { flex: 1 }, content: { flexGrow: 1, padding: 14, width: "100%", maxWidth: 600, alignSelf: "center" }, conversation: { marginLeft: 48, marginBottom: 10, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 },
  context: { flexDirection: "row", gap: 10 }, avatarRail: { width: 38, alignItems: "center" }, threadLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: theme.border, marginTop: 5, marginBottom: 4 }, contextCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 22 }, name: { flexShrink: 1, fontFamily: theme.font.semibold, fontSize: 14, color: theme.text }, muted: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }, contextBody: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 }, contextPhoto: { width: 110, height: 75, borderRadius: 10, marginTop: 8 },
  replying: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, paddingTop: 24, paddingBottom: 14 }, replyingName: { color: theme.deepBrand }, writingRow: { flexDirection: "row", gap: 10 }, writing: { flex: 1, minWidth: 0 },
  input: { backgroundColor: "transparent", borderWidth: 0, color: theme.text, fontFamily: theme.font.body, fontSize: 17, lineHeight: 25, minHeight: 110, padding: 0, paddingTop: 5, textAlignVertical: "top" },
  photoWrap: { marginTop: 10, position: "relative" }, photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: 12 }, remove: { position: "absolute", top: 8, right: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  toolbar: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, maxWidth: 600, width: "100%", alignSelf: "center" }, counter: { flex: 1, textAlign: "right", paddingRight: 10, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 }, uploading: { marginLeft: 8 }, error: { marginLeft: 48, marginTop: 12, color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 19 },
});
