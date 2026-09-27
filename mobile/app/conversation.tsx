import { useCallback, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { MessageVoice, VoicePlayback } from "@/src/components/message-voice";
import { ProfileActions } from "@/src/components/profile-actions";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { SkeletonBlock } from "@/src/components/skeleton";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";

type Message = {
  id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  media_id: string | null;
  media_type: string | null;
  media_name: string | null;
};
type Data = {
  thread: {
    kind?: string;
    access_ends_at?: string | null;
    status: string;
    recipient_id: string;
    initiator_id: string;
  };
  profile: { user_id: string; display_name: string; profile_image_url?: string | null };
  messages: Message[];
  nextCursor: string | null;
};

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
}

function ConversationSkeleton() {
  return (
    <View accessibilityLabel="Loading conversation" accessibilityState={{ busy: true }} style={{ flex: 1, justifyContent: "flex-end", gap: 16, paddingVertical: 18 }}>
      <View style={{ alignSelf: "flex-start", width: "72%", gap: 8 }}><SkeletonBlock width="100%" height={58} radius={17} /><SkeletonBlock width={42} height={9} /></View>
      <View style={{ alignSelf: "flex-end", width: "65%", gap: 8 }}><SkeletonBlock width="100%" height={76} radius={17} /><SkeletonBlock width={54} height={9} style={{ alignSelf: "flex-end" }} /></View>
      <View style={{ alignSelf: "flex-start", width: "58%", gap: 8 }}><SkeletonBlock width="100%" height={52} radius={17} /><SkeletonBlock width={38} height={9} /></View>
    </View>
  );
}

function Attachment({ message, mine }: { message: Message; mine: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { theme, styles } = useThemeStyles(createStyles);
  const isImage = message.media_type?.startsWith("image/");
  const isAudio = message.media_type?.startsWith("audio/");
  const isVideo = message.media_type?.startsWith("video/");

  async function open() {
    if (!message.media_id || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/v1/media/${message.media_id}/access`, { method: "POST" });
      if (isImage || isAudio) setUrl(result.url);
      else await Linking.openURL(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attachment unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.attachmentWrap}>
      {url && isImage ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open image" onPress={() => void open()}>
          <Image
            accessibilityLabel={message.media_name || "Message image"}
            source={{ uri: url }}
            resizeMode="cover"
            style={styles.messageImage}
            onError={() => {
              setUrl("");
              setError("Image link expired. Tap to load it again.");
            }}
          />
        </Pressable>
      ) : url && isAudio ? (
        <View style={[styles.audioPlayback, mine && styles.audioPlaybackMine]}><VoicePlayback uri={url} compact /></View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void open()}
          style={({ pressed }) => [styles.attachmentButton, mine && styles.attachmentButtonMine, (pressed || busy) && styles.pressed]}
        >
          <Ionicons name={isImage ? "image-outline" : isVideo ? "videocam-outline" : isAudio ? "mic-outline" : "document-outline"} size={19} color={mine ? "#FFFFFF" : theme.deepBrand} />
          <Text numberOfLines={1} style={[styles.attachmentText, mine && styles.attachmentTextMine]}>{busy ? "Opening…" : message.media_name || "Open attachment"}</Text>
        </Pressable>
      )}
      {error ? <Text accessibilityRole="alert" style={[styles.attachmentError, mine && styles.attachmentErrorMine]}>{error}</Text> : null}
    </View>
  );
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { theme, styles } = useThemeStyles(createStyles);
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [attachment, setAttachment] = useState<{ id: string; name: string } | null>(null);
  const pending = useRef<{ id: string; body: string; mediaId?: string } | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const initialScrollDone = useRef(false);

  const load = useCallback(async (before?: string) => {
    if (!id) return;
    try {
      const result = await api<Data>(`/v1/messages/threads/${id}${before ? `?before=${before}` : ""}`);
      setData((previous) => {
        const all = new Map((previous?.messages ?? []).map((message) => [message.id, message]));
        for (const message of result.messages) all.set(message.id, message);
        return {
          ...result,
          nextCursor: before || !previous ? result.nextCursor : previous.nextCursor,
          messages: [...all.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
        };
      });
      setError("");
      await api(`/v1/messages/threads/${id}/read`, { method: "PUT" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversation could not load.");
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    initialScrollDone.current = false;
    void load();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]));

  async function accept(value: boolean) {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await api(`/v1/messages/threads/${id}/accept`, { method: "PUT", body: JSON.stringify({ accept: value }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update request.");
    } finally {
      setActionBusy(false);
    }
  }

  async function chooseFile() {
    if (uploading) return;
    setUploading(true);
    setError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp4", "audio/wav", "video/mp4", "video/webm"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const file = picked.assets[0];
      if (!file) return;
      if (!file.size || file.size > 50 * 1024 * 1024) throw new Error("Choose a file smaller than 50 MB; images and PDFs must be smaller than 10 MB.");
      const body = Platform.OS === "web" ? await (await fetch(file.uri)).blob() : new (await import("expo-file-system")).File(file.uri) as unknown as Blob;
      const result = await api<{ id: string }>(`/v1/media?kind=message&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body,
        headers: { "Content-Type": file.mimeType || body.type || "application/octet-stream" },
        timeoutMs: 180_000,
      });
      setAttachment({ id: result.id, name: file.name });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attachment upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if ((!draft.trim() && !attachment) || sending) return;
    setSending(true);
    setError("");
    const message = pending.current?.body === draft.trim() && pending.current?.mediaId === attachment?.id
      ? pending.current
      : { id: Crypto.randomUUID(), body: draft.trim(), ...(attachment ? { mediaId: attachment.id } : {}) };
    pending.current = message;
    try {
      await api(`/v1/messages/threads/${id}/messages`, { method: "POST", body: JSON.stringify(message) });
      pending.current = null;
      setDraft("");
      setAttachment(null);
      await load();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Message not sent. Your draft is kept.");
    } finally {
      setSending(false);
    }
  }

  const incoming = data?.thread.status === "REQUESTED" && data.thread.recipient_id === user?.id;
  const tutorExpired = data?.thread.kind === "TUTOR" && !data.thread.access_ends_at;
  const canSend = !tutorExpired && (data?.thread.status === "ACCEPTED" || (data?.thread.status === "REQUESTED" && !incoming && data.messages.length === 0));
  const canAttach = data?.thread.status === "ACCEPTED";
  const locked = sending || uploading || actionBusy;
  const peerName = data?.profile?.display_name || "Conversation";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        <View style={styles.shell}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/messages"))}
              style={styles.headerButton}
            >
              <Ionicons name="chevron-back" size={27} color={theme.text} />
            </Pressable>
            <ProfileAvatar name={peerName} imageUrl={data?.profile?.profile_image_url} size={40} />
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={styles.headerName}>{peerName}</Text>
              <Text numberOfLines={1} style={styles.headerStatus}>
                {incoming ? "Message request" : data?.thread.status === "ACCEPTED" ? "KampusOne message" : "Conversation"}
              </Text>
            </View>
            {data?.profile ? (
              <ProfileActions userId={data.profile.user_id} name={data.profile.display_name} onChanged={() => void load()} />
            ) : <View style={styles.headerButton} />}
          </View>

          {error ? (
            <View style={styles.errorBar}>
              <Text accessibilityRole="alert" numberOfLines={2} style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.errorAction}>
                <Ionicons name="refresh" size={18} color={theme.deepBrand} />
              </Pressable>
            </View>
          ) : null}

          {!data ? <ConversationSkeleton /> : (
            <FlatList
              ref={listRef}
              data={data.messages}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.messages, !data.messages.length && styles.messagesEmpty]}
              onContentSizeChange={() => {
                if (!initialScrollDone.current && data.messages.length) {
                  initialScrollDone.current = true;
                  listRef.current?.scrollToEnd({ animated: false });
                }
              }}
              ListHeaderComponent={(
                <View style={styles.topNotices}>
                  {data.nextCursor ? (
                    <Pressable accessibilityRole="button" disabled={locked} onPress={() => void load(data.nextCursor!)} style={({ pressed }) => [styles.earlierButton, pressed && styles.pressed]}>
                      <Ionicons name="time-outline" size={16} color={theme.deepBrand} />
                      <Text style={styles.earlierText}>Load earlier messages</Text>
                    </Pressable>
                  ) : null}
                  {data.thread.kind === "TUTOR" ? (
                    <View style={styles.noticeCard}>
                      <Ionicons name="school-outline" size={18} color={theme.deepBrand} />
                      <Text style={styles.noticeText}>{data.thread.access_ends_at ? `Tutor access ends ${new Date(data.thread.access_ends_at).toLocaleString()}` : "This tutoring session has expired. Past messages stay visible."}</Text>
                    </View>
                  ) : null}
                </View>
              )}
              ListEmptyComponent={(
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={29} color={theme.deepBrand} /></View>
                  <Text style={styles.emptyTitle}>Start the conversation</Text>
                  <Text style={styles.emptyBody}>Send a message to {peerName}. Keep it clear and respectful.</Text>
                </View>
              )}
              renderItem={({ item }) => {
                const mine = item.sender_id === user?.id;
                const showBody = item.body && !(item.body === "Attachment" && item.media_id);
                return (
                  <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowOther]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                      {showBody ? <Text selectable style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text> : null}
                      {item.media_id && item.media_type ? <Attachment message={item} mine={mine} /> : null}
                    </View>
                    <View style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                      <Text style={styles.messageTime}>{formatMessageTime(item.created_at)}</Text>
                      {mine ? <Ionicons name={item.read_at ? "checkmark-done" : "checkmark"} size={14} color={item.read_at ? theme.deepBrand : theme.textFaint} /> : null}
                    </View>
                  </View>
                );
              }}
            />
          )}

          {incoming ? (
            <View style={styles.requestDock}>
              <View style={styles.requestCopy}>
                <Text style={styles.requestTitle}>Message request</Text>
                <Text style={styles.requestBody}>Accept to reply and share attachments.</Text>
              </View>
              <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" disabled={actionBusy} onPress={() => void accept(false)} style={({ pressed }) => [styles.declineButton, (pressed || actionBusy) && styles.disabled]}>
                  <Text style={styles.declineText}>Decline</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={actionBusy} onPress={() => void accept(true)} style={({ pressed }) => [styles.acceptButton, (pressed || actionBusy) && styles.disabled]}>
                  <Text style={styles.acceptText}>{actionBusy ? "Working…" : "Accept"}</Text>
                </Pressable>
              </View>
            </View>
          ) : canSend ? (
            <View style={styles.composerDock}>
              {attachment ? (
                <View style={styles.attachmentDraft}>
                  <Ionicons name="attach" size={18} color={theme.deepBrand} />
                  <Text numberOfLines={1} style={styles.attachmentDraftText}>{attachment.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove attachment" disabled={sending} onPress={() => setAttachment(null)} style={styles.attachmentDraftClose}>
                    <Ionicons name="close" size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.composerBar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Attach file"
                  disabled={!canAttach || locked}
                  onPress={() => void chooseFile()}
                  style={({ pressed }) => [styles.plusButton, (!canAttach || locked) && styles.disabled, pressed && styles.pressed]}
                >
                  <Ionicons name={uploading ? "cloud-upload-outline" : "add"} size={24} color={theme.text} />
                </Pressable>
                <TextInput
                  accessibilityLabel="Message"
                  placeholder={canAttach ? "Type a message…" : "Send your message request…"}
                  placeholderTextColor={theme.textMuted}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={5000}
                  selectionColor={theme.brand}
                  style={styles.composerInput}
                />
                {canAttach ? <MessageVoice compact disabled={locked} onReady={(mediaId, name) => setAttachment({ id: mediaId, name })} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  disabled={sending || (!draft.trim() && !attachment)}
                  onPress={() => void send()}
                  style={({ pressed }) => [styles.sendButton, (sending || (!draft.trim() && !attachment)) && styles.sendDisabled, pressed && styles.pressed]}
                >
                  <Ionicons name={sending ? "hourglass-outline" : "send"} size={19} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>
          ) : data ? (
            <View style={styles.closedDock}>
              <Ionicons name={tutorExpired ? "time-outline" : "lock-closed-outline"} size={18} color={theme.textMuted} />
              <Text style={styles.closedText}>{tutorExpired ? "Past messages remain available. Renew tutoring access to send new messages." : data.thread.status === "DECLINED" ? "This message request was declined." : "Your message request is waiting for acceptance."}</Text>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  shell: { flex: 1, width: "100%", maxWidth: 540, alignSelf: "center" },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, backgroundColor: theme.canvas },
  headerButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  headerName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  headerStatus: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
  errorBar: { marginHorizontal: 12, marginTop: 8, minHeight: 44, borderRadius: 12, paddingLeft: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.surfaceMuted },
  errorText: { flex: 1, color: theme.error, fontFamily: theme.font.body, fontSize: 12, lineHeight: 17 },
  errorAction: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  messages: { paddingHorizontal: 12, paddingVertical: 16, gap: 12 },
  messagesEmpty: { flexGrow: 1 },
  topNotices: { gap: 10, alignItems: "center", marginBottom: 4 },
  earlierButton: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 19, backgroundColor: theme.surfaceMuted },
  earlierText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12 },
  noticeCard: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  noticeText: { flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, paddingVertical: 54, gap: 10 },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  emptyTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 17 },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, textAlign: "center" },
  messageRow: { maxWidth: "82%", gap: 4 },
  messageRowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageRowOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, minHeight: 38 },
  bubbleMine: { backgroundColor: theme.deepBrand, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: theme.surface, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  messageText: { color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 },
  messageTextMine: { color: "#FFFFFF" },
  messageMeta: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 3 },
  messageMetaMine: { justifyContent: "flex-end" },
  messageTime: { color: theme.textFaint, fontFamily: theme.font.body, fontSize: 10 },
  attachmentWrap: { marginTop: 6, gap: 5 },
  attachmentButton: { minHeight: 40, maxWidth: 230, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 10, backgroundColor: theme.surfaceMuted },
  attachmentButtonMine: { backgroundColor: "rgba(255,255,255,0.14)" },
  attachmentText: { flex: 1, color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 12 },
  attachmentTextMine: { color: "#FFFFFF" },
  attachmentError: { color: theme.error, fontFamily: theme.font.body, fontSize: 10, lineHeight: 14 },
  attachmentErrorMine: { color: "#FFE5DC" },
  messageImage: { width: 230, height: 180, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  audioPlayback: { alignSelf: "flex-start", backgroundColor: theme.surfaceMuted, borderRadius: 18, padding: 4 },
  audioPlaybackMine: { backgroundColor: "rgba(255,255,255,0.14)" },
  composerDock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, backgroundColor: theme.canvas, gap: 7 },
  composerBar: { minHeight: 50, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  plusButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted, marginBottom: 3 },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 118, borderRadius: 22, paddingHorizontal: 15, paddingTop: Platform.OS === "ios" ? 12 : 10, paddingBottom: 10, color: theme.text, backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand, marginBottom: 3 },
  sendDisabled: { backgroundColor: theme.peach, opacity: 0.72 },
  attachmentDraft: { minHeight: 38, maxWidth: "100%", alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 11, paddingRight: 4, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  attachmentDraftText: { maxWidth: 260, color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
  attachmentDraftClose: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  requestDock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, backgroundColor: theme.canvas, gap: 10 },
  requestCopy: { gap: 2 },
  requestTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  requestBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 },
  requestActions: { flexDirection: "row", gap: 8 },
  declineButton: { flex: 1, minHeight: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  declineText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  acceptButton: { flex: 1, minHeight: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  acceptText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  closedDock: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, backgroundColor: theme.canvas },
  closedText: { flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
