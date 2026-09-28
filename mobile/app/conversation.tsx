import { useCallback, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
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
import { BlurTargetView } from "expo-blur";
import { MessageVoice, VoicePlayback } from "@/src/components/message-voice";
import {
  MessageActionOverlay,
  SwipeReplyMessage,
  type MessageActionTarget,
  type MessageReaction,
} from "@/src/components/message-interactions";
import { ProfileActions } from "@/src/components/profile-actions";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { SkeletonBlock } from "@/src/components/skeleton";
import { api } from "@/src/lib/api";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";

type ReactionSummary = { reaction: MessageReaction; count: number };

type Message = {
  id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  media_id: string | null;
  media_type: string | null;
  media_name: string | null;
  reply_to_message_id: string | null;
  reply_sender_id: string | null;
  reply_body: string | null;
  reply_media_id: string | null;
  reply_media_type: string | null;
  reply_media_name: string | null;
  reply_unsent_at: string | null;
  forwarded_from_message_id: string | null;
  unsent_at: string | null;
  unsent_by: string | null;
  pinned: boolean;
  reactions: ReactionSummary[];
  my_reaction: MessageReaction | null;
};
type PinnedMessage = {
  id: string;
  sender_id: string;
  body: string;
  media_id: string | null;
  media_type: string | null;
  media_name: string | null;
  unsent_at: string | null;
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
  pinnedMessage: PinnedMessage | null;
  nextCursor: string | null;
};
type ForwardThread = {
  id: string;
  display_name: string;
  profile_image_url?: string | null;
  status: string;
};
type ForwardInbox = { threads: ForwardThread[] };

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
}

function mediaLabel(type?: string | null) {
  if (type?.startsWith("image/")) return "Picture";
  if (type?.startsWith("video/")) return "Video";
  if (type?.startsWith("audio/")) return "Voice note";
  return "Document";
}

function messagePreview(message: Pick<Message, "body" | "media_id" | "media_type" | "media_name" | "unsent_at"> | PinnedMessage) {
  if (message.unsent_at) return "Message unsent";
  const body = message.body?.trim() || "";
  const fallback = message.media_id ? mediaLabel(message.media_type) : "";
  if (message.media_id && (!body || body === "Attachment" || body === fallback)) return fallback;
  return body || "Message";
}

const reportReasons = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "HATE_OR_ABUSE", label: "Hate or abuse" },
  { value: "SCAM", label: "Scam or fraud" },
  { value: "OTHER", label: "Something else" },
] as const;

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
  const kindLabel = mediaLabel(message.media_type);

  async function open() {
    if (!message.media_id || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/v1/media/${message.media_id}/access`, { method: "POST" });
      if (isImage || isAudio) setUrl(result.url);
      else await Linking.openURL(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${kindLabel} unavailable.`);
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
          <Text numberOfLines={1} style={[styles.attachmentText, mine && styles.attachmentTextMine]}>{busy ? "Opening…" : message.media_name || `Open ${kindLabel.toLowerCase()}`}</Text>
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
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const [attachment, setAttachment] = useState<{ id: string; name: string } | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [composerToolsExpanded, setComposerToolsExpanded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [forwardThreads, setForwardThreads] = useState<ForwardThread[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardBusyId, setForwardBusyId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const pending = useRef<{ id: string; body: string; mediaId?: string; replyToMessageId?: string } | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);
  const blurTargetRef = useRef<View | null>(null);
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
      setError(caught instanceof Error ? caught.message : "Media or document upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if ((!draft.trim() && !attachment) || sending) return;
    setSending(true);
    setError("");
    const replyToMessageId = replyingTo?.id;
    const message =
      pending.current?.body === draft.trim() &&
      pending.current?.mediaId === attachment?.id &&
      pending.current?.replyToMessageId === replyToMessageId
        ? pending.current
        : {
            id: Crypto.randomUUID(),
            body: draft.trim(),
            ...(attachment ? { mediaId: attachment.id } : {}),
            ...(replyToMessageId ? { replyToMessageId } : {}),
          };
    pending.current = message;
    try {
      await api(`/v1/messages/threads/${id}/messages`, { method: "POST", body: JSON.stringify(message) });
      pending.current = null;
      setDraft("");
      setAttachment(null);
      setComposerToolsExpanded(false);
      setReplyingTo(null);
      await load();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Message not sent. Your draft is kept.");
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(mediaId: string) {
    if (sending) throw new Error("Another message is still sending.");
    setSending(true);
    setError("");
    const message = {
      id: Crypto.randomUUID(),
      body: "",
      mediaId,
      ...(replyingTo?.id ? { replyToMessageId: replyingTo.id } : {}),
    };
    try {
      await api(`/v1/messages/threads/${id}/messages`, { method: "POST", body: JSON.stringify(message) });
      setReplyingTo(null);
      await load();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Voice note not sent. Your recording is kept.";
      setError(messageText);
      throw caught instanceof Error ? caught : new Error(messageText);
    } finally {
      setSending(false);
    }
  }

  function beginReply(message: Message) {
    if (message.unsent_at) return;
    setActionTarget(null);
    setReplyingTo(message);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openActions(message: Message, mine: boolean, pageY: number) {
    if (message.unsent_at) return;
    Keyboard.dismiss();
    setActionTarget({
      id: message.id,
      mine,
      body: message.body,
      mediaType: message.media_type,
      mediaName: message.media_name,
      myReaction: message.my_reaction,
      pinned: message.pinned,
      forwarded: Boolean(message.forwarded_from_message_id),
      pageY,
    });
  }

  async function reactToMessage(target: MessageActionTarget, reaction: MessageReaction | null) {
    if (messageActionBusy) return;
    setActionTarget(null);
    setMessageActionBusy(true);
    try {
      await api(`/v1/messages/threads/${id}/messages/${target.id}/reaction`, {
        method: "PUT",
        body: JSON.stringify({ reaction }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reaction could not be updated.");
    } finally {
      setMessageActionBusy(false);
    }
  }

  async function togglePin(target: MessageActionTarget) {
    if (messageActionBusy) return;
    setActionTarget(null);
    setMessageActionBusy(true);
    try {
      await api(`/v1/messages/threads/${id}/messages/${target.id}/pin`, {
        method: "PUT",
        body: JSON.stringify({ pinned: !target.pinned }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pinned message could not be updated.");
    } finally {
      setMessageActionBusy(false);
    }
  }

  function unsend(target: MessageActionTarget) {
    setActionTarget(null);
    Alert.alert(
      "Unsend message?",
      "This removes the message for everyone in this chat.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend for everyone",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (messageActionBusy) return;
              setMessageActionBusy(true);
              try {
                await api(`/v1/messages/threads/${id}/messages/${target.id}`, { method: "DELETE" });
                if (replyingTo?.id === target.id) setReplyingTo(null);
                await load();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Message could not be unsent.");
              } finally {
                setMessageActionBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  async function shareMessage(target: MessageActionTarget) {
    setActionTarget(null);
    const message = data?.messages.find((item) => item.id === target.id);
    if (!message || message.unsent_at) return;
    try {
      let mediaUrl = "";
      if (message.media_id) {
        const access = await api<{ url: string }>(`/v1/media/${message.media_id}/access`, { method: "POST" });
        mediaUrl = access.url;
      }
      const text = [messagePreview(message), mediaUrl, "Shared from KampusOne"]
        .filter(Boolean)
        .join("\n");
      await Share.share({ message: text });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Message could not be shared.");
    }
  }

  async function openForward(target: MessageActionTarget) {
    setActionTarget(null);
    const message = data?.messages.find((item) => item.id === target.id);
    if (!message || message.unsent_at) return;
    setForwardTarget(message);
    setForwardLoading(true);
    setForwardThreads([]);
    try {
      const inbox = await api<ForwardInbox>("/v1/messages/inbox?filter=All");
      setForwardThreads(inbox.threads.filter((thread) => thread.status === "ACCEPTED"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversations could not load.");
      setForwardTarget(null);
    } finally {
      setForwardLoading(false);
    }
  }

  async function forwardTo(targetThreadId: string) {
    if (!forwardTarget || forwardBusyId) return;
    setForwardBusyId(targetThreadId);
    try {
      await api(`/v1/messages/threads/${id}/messages/${forwardTarget.id}/forward`, {
        method: "POST",
        body: JSON.stringify({ targetThreadId }),
      });
      setForwardTarget(null);
      setForwardThreads([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Message could not be forwarded.");
    } finally {
      setForwardBusyId(null);
    }
  }

  function openReport(target: MessageActionTarget) {
    setActionTarget(null);
    const message = data?.messages.find((item) => item.id === target.id);
    if (message) setReportTarget(message);
  }

  async function submitReport(reason: (typeof reportReasons)[number]["value"]) {
    if (!reportTarget || reportBusy) return;
    setReportBusy(true);
    try {
      await api(`/v1/messages/threads/${id}/messages/${reportTarget.id}/report`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReportTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Report could not be submitted.");
    } finally {
      setReportBusy(false);
    }
  }

  const incoming = data?.thread.status === "REQUESTED" && data.thread.recipient_id === user?.id;
  const tutorExpired = data?.thread.kind === "TUTOR" && !data.thread.access_ends_at;
  const canSend = !tutorExpired && (data?.thread.status === "ACCEPTED" || (data?.thread.status === "REQUESTED" && !incoming && data.messages.length === 0));
  const canAttach = data?.thread.status === "ACCEPTED";
  const locked = sending || uploading || actionBusy || messageActionBusy;
  const peerName = data?.profile?.display_name || "Conversation";
  const handleVoiceActive = useCallback((active: boolean) => {
    setVoiceActive(active);
    if (active) Keyboard.dismiss();
  }, []);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <BlurTargetView ref={blurTargetRef} style={styles.screen}>
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
                  {data.pinnedMessage ? (
                    <View style={styles.pinnedBanner}>
                      <Ionicons name="pin" size={15} color={theme.deepBrand} />
                      <View style={styles.pinnedCopy}>
                        <Text style={styles.pinnedLabel}>Pinned message</Text>
                        <Text numberOfLines={1} style={styles.pinnedText}>{messagePreview(data.pinnedMessage)}</Text>
                      </View>
                    </View>
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
                if (item.unsent_at) {
                  return (
                    <View style={styles.unsentRow}>
                      <Ionicons name="arrow-undo-circle-outline" size={14} color={theme.textFaint} />
                      <Text style={styles.unsentText}>
                        {mine ? "You unsent a message." : `${peerName} unsent a message.`}
                      </Text>
                      <Text style={styles.unsentTime}>{formatMessageTime(item.created_at)}</Text>
                    </View>
                  );
                }
                const fallbackBody = item.media_id ? mediaLabel(item.media_type) : "";
                const showBody = Boolean(
                  item.body &&
                  item.body !== "Attachment" &&
                  item.body !== fallbackBody,
                );
                const replyOwner = item.reply_sender_id === user?.id ? "You" : peerName;
                const replyText = item.reply_unsent_at
                  ? "Message unsent"
                  : item.reply_body &&
                      item.reply_body !== "Attachment" &&
                      item.reply_body !== (item.reply_media_id ? mediaLabel(item.reply_media_type) : "")
                    ? item.reply_body
                    : item.reply_media_id
                      ? mediaLabel(item.reply_media_type)
                      : "Message";
                return (
                  <SwipeReplyMessage
                    mine={mine}
                    disabled={locked}
                    onReply={() => beginReply(item)}
                    onLongPress={(event) => openActions(item, mine, event.nativeEvent.pageY)}
                  >
                    <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowOther]}>
                      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                        {item.forwarded_from_message_id ? (
                          <View style={styles.forwardedLine}>
                            <Ionicons name="arrow-redo-outline" size={12} color={mine ? "rgba(255,255,255,0.75)" : theme.textMuted} />
                            <Text style={[styles.forwardedText, mine && styles.forwardedTextMine]}>Forwarded</Text>
                          </View>
                        ) : null}
                        {item.reply_to_message_id ? (
                          <View style={[styles.replyQuote, mine ? styles.replyQuoteMine : styles.replyQuoteOther]}>
                            <View style={[styles.replyAccent, mine && styles.replyAccentMine]} />
                            <View style={styles.replyQuoteCopy}>
                              <Text numberOfLines={1} style={[styles.replyAuthor, mine && styles.replyAuthorMine]}>{replyOwner}</Text>
                              <Text numberOfLines={1} style={[styles.replyText, mine && styles.replyTextMine]}>{replyText}</Text>
                            </View>
                          </View>
                        ) : null}
                        {showBody ? <Text selectable style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text> : null}
                        {item.media_id && item.media_type ? <Attachment message={item} mine={mine} /> : null}
                      </View>
                      {item.reactions?.length ? (
                        <View style={[styles.reactionSummary, mine && styles.reactionSummaryMine]}>
                          {item.reactions.slice(0, 4).map((reaction) => (
                            <View key={reaction.reaction} style={[styles.reactionChip, item.my_reaction === reaction.reaction && styles.reactionChipMine]}>
                              <Text style={styles.reactionChipEmoji}>{reaction.reaction}</Text>
                              {reaction.count > 1 ? <Text style={styles.reactionCount}>{reaction.count}</Text> : null}
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <View style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                        {item.pinned ? <Ionicons name="pin" size={11} color={theme.textFaint} /> : null}
                        <Text style={styles.messageTime}>{formatMessageTime(item.created_at)}</Text>
                        {mine ? <Ionicons name={item.read_at ? "checkmark-done" : "checkmark"} size={14} color={item.read_at ? theme.deepBrand : theme.textFaint} /> : null}
                      </View>
                    </View>
                  </SwipeReplyMessage>
                );
              }}
            />
          )}

          {incoming ? (
            <View style={styles.requestDock}>
              <View style={styles.requestCopy}>
                <Text style={styles.requestTitle}>Message request</Text>
                <Text style={styles.requestBody}>Accept to reply and share media or documents.</Text>
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
              {replyingTo ? (
                <View style={styles.replyDraft}>
                  <View style={styles.replyDraftAccent} />
                  <View style={styles.replyDraftCopy}>
                    <Text style={styles.replyDraftTitle}>Replying to {replyingTo.sender_id === user?.id ? "yourself" : peerName}</Text>
                    <Text numberOfLines={1} style={styles.replyDraftText}>{messagePreview(replyingTo)}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel reply"
                    disabled={sending}
                    onPress={() => setReplyingTo(null)}
                    style={styles.replyDraftClose}
                  >
                    <Ionicons name="close" size={19} color={theme.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              {attachment ? (
                <View style={styles.attachmentDraft}>
                  <Ionicons name="attach" size={18} color={theme.deepBrand} />
                  <Text numberOfLines={1} style={styles.attachmentDraftText}>{attachment.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove selected media or document" disabled={sending} onPress={() => setAttachment(null)} style={styles.attachmentDraftClose}>
                    <Ionicons name="close" size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.composerBar}>
                {!voiceActive ? (
                  draft.trim() && canAttach && !composerToolsExpanded ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Show media options"
                      disabled={locked}
                      onPress={() => setComposerToolsExpanded(true)}
                      style={({ pressed }) => [styles.compactComposerButton, locked && styles.disabled, pressed && styles.pressed]}
                    >
                      <Ionicons name="chevron-forward" size={25} color={theme.deepBrand} />
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add media or document"
                      disabled={!canAttach || locked}
                      onPress={() => void chooseFile()}
                      style={({ pressed }) => [styles.plusButton, (!canAttach || locked) && styles.disabled, pressed && styles.pressed]}
                    >
                      <Ionicons name={uploading ? "cloud-upload-outline" : "add"} size={24} color={theme.text} />
                    </Pressable>
                  )
                ) : null}
                {!voiceActive ? (
                  <TextInput
                    ref={inputRef}
                    accessibilityLabel="Message"
                    placeholder={canAttach ? "Type a message…" : "Send your message request…"}
                    placeholderTextColor={theme.textMuted}
                    value={draft}
                    onChangeText={(value) => {
                      setDraft(value);
                      if (!value.trim()) setComposerToolsExpanded(false);
                    }}
                    multiline
                    maxLength={5000}
                    selectionColor={theme.brand}
                    style={styles.composerInput}
                  />
                ) : null}
                {canAttach && !draft.trim() && !attachment ? (
                  <MessageVoice
                    compact
                    disabled={locked}
                    onActiveChange={handleVoiceActive}
                    onReady={async (mediaId) => {
                      await sendVoice(mediaId);
                    }}
                  />
                ) : null}
                {!voiceActive && (!canAttach || Boolean(draft.trim()) || Boolean(attachment)) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    disabled={sending || (!draft.trim() && !attachment)}
                    onPress={() => void send()}
                    style={({ pressed }) => [styles.sendButton, (sending || (!draft.trim() && !attachment)) && styles.sendDisabled, pressed && styles.pressed]}
                  >
                    <Ionicons name={sending ? "hourglass-outline" : "send"} size={19} color="#FFFFFF" />
                  </Pressable>
                ) : null}
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
      </BlurTargetView>

      <MessageActionOverlay
        target={actionTarget}
        peerName={peerName}
        blurTarget={blurTargetRef}
        busy={messageActionBusy}
        onClose={() => setActionTarget(null)}
        onReply={(target) => {
          const message = data?.messages.find((item) => item.id === target.id);
          if (message) beginReply(message);
        }}
        onReaction={(target, reaction) => void reactToMessage(target, reaction)}
        onForward={(target) => void openForward(target)}
        onShare={(target) => void shareMessage(target)}
        onPin={(target) => void togglePin(target)}
        onUnsend={unsend}
        onReport={openReport}
      />

      <Modal
        visible={Boolean(forwardTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!forwardBusyId) setForwardTarget(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close forward message"
            onPress={() => {
              if (!forwardBusyId) setForwardTarget(null);
            }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleCopy}>
                <Text style={styles.sheetTitle}>Forward message</Text>
                <Text numberOfLines={1} style={styles.sheetSubtitle}>{forwardTarget ? messagePreview(forwardTarget) : ""}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setForwardTarget(null)} style={styles.sheetClose}>
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            {forwardLoading ? (
              <View style={styles.sheetEmpty}>
                <Text style={styles.sheetEmptyText}>Loading conversations…</Text>
              </View>
            ) : (
              <FlatList
                data={forwardThreads}
                keyExtractor={(thread) => thread.id}
                style={styles.forwardList}
                ListEmptyComponent={(
                  <View style={styles.sheetEmpty}>
                    <Text style={styles.sheetEmptyText}>No accepted conversations available yet.</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(forwardBusyId)}
                    onPress={() => void forwardTo(item.id)}
                    style={({ pressed }) => [styles.forwardThread, pressed && styles.pressed]}
                  >
                    <ProfileAvatar name={item.display_name} imageUrl={item.profile_image_url} size={42} />
                    <Text numberOfLines={1} style={styles.forwardName}>{item.display_name}</Text>
                    <Text style={styles.forwardAction}>{forwardBusyId === item.id ? "Sending…" : "Send"}</Text>
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(reportTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!reportBusy) setReportTarget(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close report"
            onPress={() => {
              if (!reportBusy) setReportTarget(null);
            }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.reportSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Report message</Text>
            <Text style={styles.reportHelp}>Choose the reason that best describes the message. The other person is not told who submitted the report.</Text>
            <View style={styles.reportReasons}>
              {reportReasons.map((reason) => (
                <Pressable
                  key={reason.value}
                  accessibilityRole="button"
                  disabled={reportBusy}
                  onPress={() => void submitReport(reason.value)}
                  style={({ pressed }) => [styles.reportReason, pressed && styles.pressed]}
                >
                  <Text style={styles.reportReasonText}>{reason.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
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
  pinnedBanner: { width: "100%", minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  pinnedCopy: { flex: 1, minWidth: 0, gap: 1 },
  pinnedLabel: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 10 },
  pinnedText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
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
  unsentRow: { alignSelf: "center", maxWidth: "88%", flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingHorizontal: 10 },
  unsentText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11, fontStyle: "italic" },
  unsentTime: { color: theme.textFaint, fontFamily: theme.font.body, fontSize: 9 },
  forwardedLine: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  forwardedText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10 },
  forwardedTextMine: { color: "rgba(255,255,255,0.74)" },
  replyQuote: { minWidth: 150, maxWidth: 260, flexDirection: "row", gap: 7, borderRadius: 11, paddingVertical: 7, paddingHorizontal: 8, marginBottom: 7 },
  replyQuoteMine: { backgroundColor: "rgba(255,255,255,0.13)" },
  replyQuoteOther: { backgroundColor: theme.surfaceMuted },
  replyAccent: { width: 3, borderRadius: 2, backgroundColor: theme.deepBrand },
  replyAccentMine: { backgroundColor: "#FFFFFF" },
  replyQuoteCopy: { flex: 1, minWidth: 0, gap: 1 },
  replyAuthor: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 10 },
  replyAuthorMine: { color: "#FFFFFF" },
  replyText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
  replyTextMine: { color: "rgba(255,255,255,0.78)" },
  reactionSummary: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: -2 },
  reactionSummaryMine: { justifyContent: "flex-end" },
  reactionChip: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, borderRadius: 12, backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  reactionChipMine: { borderColor: theme.deepBrand },
  reactionChipEmoji: { fontSize: 13 },
  reactionCount: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 9 },
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
  replyDraft: { minHeight: 48, flexDirection: "row", alignItems: "stretch", gap: 8, borderRadius: 12, paddingLeft: 9, backgroundColor: theme.surfaceMuted, overflow: "hidden" },
  replyDraftAccent: { width: 3, backgroundColor: theme.deepBrand, borderRadius: 2, marginVertical: 8 },
  replyDraftCopy: { flex: 1, minWidth: 0, justifyContent: "center", gap: 1, paddingVertical: 6 },
  replyDraftTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 11 },
  replyDraftText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
  replyDraftClose: { width: 42, alignItems: "center", justifyContent: "center" },
  composerBar: { minHeight: 50, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  plusButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted, marginBottom: 3 },
  compactComposerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginBottom: 3 },
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
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.34)" },
  modalSheet: { maxHeight: "72%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 18, backgroundColor: theme.canvas },
  reportSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 24, backgroundColor: theme.canvas },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 9, marginBottom: 13, backgroundColor: theme.border },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 8 },
  sheetTitleCopy: { flex: 1, minWidth: 0, gap: 2 },
  sheetTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 18 },
  sheetSubtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 },
  sheetClose: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  sheetEmpty: { minHeight: 120, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  sheetEmptyText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, textAlign: "center" },
  forwardList: { flexGrow: 0 },
  forwardThread: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  forwardName: { flex: 1, color: theme.text, fontFamily: theme.font.medium, fontSize: 14 },
  forwardAction: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12 },
  reportHelp: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 10 },
  reportReasons: { gap: 2 },
  reportReason: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  reportReasonText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 14 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
