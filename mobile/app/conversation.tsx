import { useCallback, useEffect, useRef, useState } from "react";
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
  ScrollView,
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
import * as ImagePicker from "expo-image-picker";
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

type ForwardThread = { id: string; display_name: string; profile_image_url?: string | null; status: string };
type ForwardInbox = { threads: ForwardThread[] };

type DraftMedia = {
  localId: string;
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
  kind: "image" | "video" | "document";
};

type PendingMediaItem = DraftMedia & {
  messageId: string;
  mediaId?: string;
  sent: boolean;
};

type PendingMediaBatch = {
  id: string;
  caption: string;
  items: PendingMediaItem[];
  status: "sending" | "failed";
  error?: string | undefined;
  replyToMessageId?: string;
};

function mediaLabel(type?: string | null, name?: string | null) {
  const mime = (type ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "Picture";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Voice note";
  if (mime === "application/pdf" || name?.toLowerCase().endsWith(".pdf")) return "PDF";
  return "Document";
}

function messagePreview(message: Pick<Message, "body" | "media_id" | "media_type" | "media_name" | "unsent_at"> | PinnedMessage) {
  if (message.unsent_at) return "Message unsent";
  const body = message.body?.trim() || "";
  const fallback = message.media_id ? mediaLabel(message.media_type, message.media_name) : "";
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

function guessDocumentMime(name: string, mime?: string | null) {
  if (mime && mime !== "application/octet-stream") return mime;
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (lower.endsWith(".ods")) return "application/vnd.oasis.opendocument.spreadsheet";
  if (lower.endsWith(".odp")) return "application/vnd.oasis.opendocument.presentation";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".rtf")) return "application/rtf";
  return mime || "application/octet-stream";
}

function shouldShowBody(message: Message) {
  if (!message.body) return false;
  if (!message.media_id) return true;
  return !["Attachment", mediaLabel(message.media_type, message.media_name)].includes(message.body);
}

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

function MessageMedia({ message, mine }: { message: Message; mine: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { theme, styles } = useThemeStyles(createStyles);
  const isImage = Boolean(message.media_type?.startsWith("image/"));
  const isAudio = Boolean(message.media_type?.startsWith("audio/"));
  const isVideo = Boolean(message.media_type?.startsWith("video/"));
  const label = mediaLabel(message.media_type, message.media_name);

  const fetchAccess = useCallback(async () => {
    if (!message.media_id) return "";
    const result = await api<{ url: string }>(`/v1/media/${message.media_id}/access`, { method: "POST" });
    return result.url;
  }, [message.media_id]);

  useEffect(() => {
    if (!message.media_id || (!isImage && !isAudio)) return;
    let cancelled = false;
    void fetchAccess()
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchAccess, isAudio, isImage, message.media_id]);

  async function open() {
    if (!message.media_id || busy) return;
    setError("");
    if (isImage || isVideo) {
      router.push({
        pathname: "/message-media",
        params: {
          mediaId: message.media_id,
          type: message.media_type || "",
          name: message.media_name || label,
        },
      });
      return;
    }
    if (isAudio && url) return;
    setBusy(true);
    try {
      const nextUrl = await fetchAccess();
      if (isAudio) setUrl(nextUrl);
      else await Linking.openURL(nextUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label} unavailable.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.mediaWrap}>
      {isImage && url ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open picture" onPress={() => void open()} style={styles.pictureCard}>
          <Image
            accessibilityLabel={message.media_name || "Message picture"}
            source={{ uri: url }}
            resizeMode="cover"
            style={styles.messageImage}
            onError={() => {
              setUrl("");
              setError("Picture preview expired. Tap to load it again.");
            }}
          />
          <Text style={[styles.mediaCaption, mine && styles.mediaCaptionMine]}>Picture</Text>
        </Pressable>
      ) : isAudio && url ? (
        <View style={[styles.voicePlayback, mine && styles.voicePlaybackMine]}>
          <VoicePlayback uri={url} compact />
        </View>
      ) : isVideo ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open video" onPress={() => void open()} style={[styles.videoCard, mine && styles.mediaCardMine]}>
          <View style={styles.videoIcon}><Ionicons name="play" size={22} color="#FFFFFF" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.mediaTitle, mine && styles.mediaTitleMine]}>Video</Text>
            <Text numberOfLines={1} style={[styles.mediaMeta, mine && styles.mediaMetaMine]}>{message.media_name || "Video"}</Text>
          </View>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${label}`}
          disabled={busy}
          onPress={() => void open()}
          style={({ pressed }) => [styles.documentCard, mine && styles.mediaCardMine, (pressed || busy) && styles.pressed]}
        >
          <View style={[styles.documentIcon, mine && styles.documentIconMine]}>
            <Ionicons name={isImage ? "image-outline" : isAudio ? "mic-outline" : "document-text-outline"} size={20} color={mine ? "#FFFFFF" : theme.deepBrand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.mediaTitle, mine && styles.mediaTitleMine]}>{busy ? `Opening ${label}…` : message.media_name || label}</Text>
            <Text style={[styles.mediaMeta, mine && styles.mediaMetaMine]}>{label}</Text>
          </View>
        </Pressable>
      )}
      {error ? <Text accessibilityRole="alert" style={[styles.mediaError, mine && styles.mediaErrorMine]}>{error}</Text> : null}
    </View>
  );
}

function PictureGroup({
  messages,
  mine,
}: {
  messages: Message[];
  mine: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const { styles } = useThemeStyles(createStyles);
  const visible = messages.slice(0, 4);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      visible.map(async (message) => {
        if (!message.media_id) return null;
        try {
          const result = await api<{ url: string }>(`/v1/media/${message.media_id}/access`, { method: "POST" });
          return [message.id, result.url] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      cancelled = true;
    };
  }, [messages.map((message) => message.id).join("|")]);

  const open = (message: Message) => {
    if (!message.media_id) return;
    router.push({
      pathname: "/message-media",
      params: {
        mediaId: message.media_id,
        mediaIds: messages.map((entry) => entry.media_id).filter(Boolean).join(","),
        type: message.media_type || "image/jpeg",
        name: "Pictures",
      },
    });
  };

  return (
    <View style={styles.pictureGroup}>
      {visible.map((message, index) => {
        const uri = urls[message.id];
        const remaining = index === visible.length - 1 ? messages.length - visible.length : 0;
        return (
          <Pressable
            key={message.id}
            accessibilityRole="button"
            accessibilityLabel={remaining > 0 ? `Open ${messages.length} pictures` : "Open picture"}
            onPress={() => open(message)}
            style={[
              styles.pictureGroupTile,
              messages.length === 2 && styles.pictureGroupTileTwo,
            ]}
          >
            {uri ? (
              <Image source={{ uri }} resizeMode="cover" style={styles.pictureGroupImage} />
            ) : (
              <View style={styles.pictureGroupPlaceholder}>
                <Ionicons name="image-outline" size={23} color={mine ? "#FFFFFF" : "#7A7A7A"} />
              </View>
            )}
            {remaining > 0 ? (
              <View style={styles.pictureGroupMore}>
                <Text style={styles.pictureGroupMoreText}>+{remaining}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function picturesBelongTogether(previous: Message | undefined, next: Message | undefined) {
  if (!previous || !next) return false;
  if (!previous.media_type?.startsWith("image/") || !next.media_type?.startsWith("image/")) return false;
  if (previous.sender_id !== next.sender_id) return false;
  const previousTime = new Date(previous.created_at).getTime();
  const nextTime = new Date(next.created_at).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return false;
  return nextTime - previousTime >= 0 && nextTime - previousTime <= 15_000;
}

function SelectedMediaPreview({
  items,
  onRemove,
}: {
  items: DraftMedia[];
  onRemove: (localId: string) => void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  if (!items.length) return null;
  return (
    <View style={styles.selectionWrap}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionTitle}>{items.length} selected</Text>
        <Text style={styles.selectionMeta}>Maximum 10</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectionStrip}>
        {items.map((item) => (
          <View key={item.localId} style={styles.selectionItem}>
            {item.kind === "image" ? (
              <Image source={{ uri: item.uri }} resizeMode="cover" style={styles.selectionImage} />
            ) : (
              <View style={styles.selectionPlaceholder}>
                <Ionicons name={item.kind === "video" ? "videocam" : "document-text"} size={24} color={theme.deepBrand} />
                <Text numberOfLines={1} style={styles.selectionPlaceholderText}>{item.kind === "video" ? "Video" : mediaLabel(item.mimeType, item.name)}</Text>
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => onRemove(item.localId)} style={styles.selectionRemove}>
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function PendingMediaBubble({
  batch,
  onRetry,
}: {
  batch: PendingMediaBatch;
  onRetry: () => void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const sentCount = batch.items.filter((item) => item.sent).length;
  return (
    <View style={styles.pendingRow}>
      <View style={styles.pendingBubble}>
        {batch.caption ? <Text style={styles.pendingCaption}>{batch.caption}</Text> : null}
        <View style={styles.pendingGrid}>
          {batch.items.slice(0, 4).map((item, index) => (
            <View key={item.localId} style={styles.pendingTile}>
              {item.kind === "image" ? (
                <Image source={{ uri: item.uri }} resizeMode="cover" style={styles.pendingImage} />
              ) : (
                <View style={styles.pendingPlaceholder}>
                  <Ionicons name={item.kind === "video" ? "videocam" : "document-text"} size={26} color={theme.deepBrand} />
                  <Text numberOfLines={1} style={styles.pendingPlaceholderText}>{item.kind === "video" ? "Video" : mediaLabel(item.mimeType, item.name)}</Text>
                </View>
              )}
              {index === 3 && batch.items.length > 4 ? (
                <View style={styles.pendingMore}><Text style={styles.pendingMoreText}>+{batch.items.length - 4}</Text></View>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.pendingStatusRow}>
        {batch.status === "sending" ? (
          <>
            <Ionicons name="cloud-upload-outline" size={13} color={theme.textMuted} />
            <Text style={styles.pendingStatus}>Sending {Math.min(sentCount + 1, batch.items.length)} of {batch.items.length}…</Text>
          </>
        ) : (
          <>
            <Ionicons name="alert-circle-outline" size={14} color={theme.error} />
            <Text numberOfLines={1} style={styles.pendingError}>{batch.error || "Couldn’t send media."}</Text>
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryMediaButton}><Text style={styles.retryMediaText}>Retry</Text></Pressable>
          </>
        )}
      </View>
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
  const [actionBusy, setActionBusy] = useState(false);
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<DraftMedia[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMediaBatch[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [forwardThreads, setForwardThreads] = useState<ForwardThread[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardBusyId, setForwardBusyId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const pending = useRef<{ id: string; body: string; replyToMessageId?: string } | null>(null);
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

  function addSelectedMedia(items: DraftMedia[]) {
    setSelectedMedia((current) => {
      const room = Math.max(0, 10 - current.length);
      if (!room) {
        setError("You can send up to 10 pictures, videos or documents at once.");
        return current;
      }
      const next = [...current, ...items.slice(0, room)];
      if (items.length > room) setError("Only the first 10 selected items were added.");
      else setError("");
      return next;
    });
    setPickerOpen(false);
  }

  async function chooseMedia() {
    if (selectedMedia.length >= 10) {
      setError("You can send up to 10 pictures or videos at once.");
      return;
    }
    setError("");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("Allow photo access to send pictures and videos.");
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, 10 - selectedMedia.length),
        quality: 1,
      });
      if (picked.canceled) return;
      const files: DraftMedia[] = picked.assets.map((asset) => {
        const kind = asset.type === "video" ? "video" : "image";
        const mimeType = asset.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg");
        const size = asset.fileSize ?? null;
        if (size && size > (kind === "video" ? 50 : 10) * 1024 * 1024) {
          throw new Error(kind === "video" ? "Choose videos smaller than 50 MB." : "Choose pictures smaller than 10 MB.");
        }
        return {
          localId: Crypto.randomUUID(),
          uri: asset.uri,
          name: asset.fileName || `${kind}-${Date.now()}.${kind === "video" ? "mp4" : "jpg"}`,
          mimeType,
          size,
          kind,
        };
      });
      addSelectedMedia(files);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pictures or videos could not be selected.");
    }
  }

  async function chooseDocument() {
    if (selectedMedia.length >= 10) {
      setError("You can send up to 10 items at once.");
      return;
    }
    setError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/msword",
          "application/vnd.ms-excel",
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/vnd.oasis.opendocument.text",
          "application/vnd.oasis.opendocument.spreadsheet",
          "application/vnd.oasis.opendocument.presentation",
          "text/plain",
          "text/csv",
          "application/rtf",
          "text/rtf",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const files = picked.assets.map<DraftMedia>((asset) => {
        if (asset.size && asset.size > 10 * 1024 * 1024) throw new Error("Choose documents smaller than 10 MB.");
        return {
          localId: Crypto.randomUUID(),
          uri: asset.uri,
          name: asset.name,
          mimeType: guessDocumentMime(asset.name, asset.mimeType),
          size: asset.size ?? null,
          kind: "document",
        };
      });
      addSelectedMedia(files);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document could not be selected.");
    }
  }

  async function uploadMedia(item: PendingMediaItem) {
    if (item.mediaId) return item.mediaId;
    const body = Platform.OS === "web"
      ? await (await fetch(item.uri)).blob()
      : new (await import("expo-file-system")).File(item.uri) as unknown as Blob;
    const result = await api<{ id: string }>(`/v1/media?kind=message&name=${encodeURIComponent(item.name)}`, {
      method: "POST",
      body,
      headers: { "Content-Type": item.mimeType || body.type || "application/octet-stream" },
      timeoutMs: 180_000,
    });
    return result.id;
  }

  async function processMediaBatch(initialBatch: PendingMediaBatch) {
    let working: PendingMediaBatch = {
      ...initialBatch,
      status: "sending",
      error: undefined,
      items: initialBatch.items.map((item) => ({ ...item })),
    };
    setPendingMedia((current) => current.map((batch) => batch.id === working.id ? working : batch));

    try {
      // Upload the whole selected batch first while its local preview stays visible.
      // Posting the message records only after uploads are ready keeps a multi-picture
      // send visually together for both participants even on a slow campus network.
      for (let index = 0; index < working.items.length; index += 1) {
        let item = working.items[index]!;
        if (item.mediaId) continue;
        const mediaId = await uploadMedia(item);
        item = { ...item, mediaId };
        working.items[index] = item;
        setPendingMedia((current) => current.map((batch) => batch.id === working.id ? { ...working, items: [...working.items] } : batch));
      }

      for (let index = 0; index < working.items.length; index += 1) {
        const item = working.items[index]!;
        if (item.sent || !item.mediaId) continue;
        await api(`/v1/messages/threads/${id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            id: item.messageId,
            body: index === 0 ? working.caption : "",
            mediaId: item.mediaId,
            ...(index === 0 && working.replyToMessageId
              ? { replyToMessageId: working.replyToMessageId }
              : {}),
          }),
        });
        working.items[index] = { ...item, sent: true };
        setPendingMedia((current) => current.map((batch) => batch.id === working.id ? { ...working, items: [...working.items] } : batch));
      }

      await load();
      setPendingMedia((current) => current.filter((batch) => batch.id !== working.id));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Media could not be sent.";
      working = { ...working, status: "failed", error: message };
      setPendingMedia((current) => current.map((batch) => batch.id === working.id ? { ...working, items: [...working.items] } : batch));
    }
  }

  async function send() {
    const caption = draft.trim();
    if ((!caption && !selectedMedia.length) || sending) return;

    if (selectedMedia.length) {
      const batch: PendingMediaBatch = {
        id: Crypto.randomUUID(),
        caption,
        status: "sending",
        ...(replyingTo?.id ? { replyToMessageId: replyingTo.id } : {}),
        items: selectedMedia.map((item) => ({
          ...item,
          messageId: Crypto.randomUUID(),
          sent: false,
        })),
      };
      setDraft("");
      setSelectedMedia([]);
      setPickerOpen(false);
      setReplyingTo(null);
      setPendingMedia((current) => [...current, batch]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      void processMediaBatch(batch);
      return;
    }

    setSending(true);
    setError("");
    const replyToMessageId = replyingTo?.id;
    const message =
      pending.current?.body === caption &&
      pending.current?.replyToMessageId === replyToMessageId
        ? pending.current
        : {
            id: Crypto.randomUUID(),
            body: caption,
            ...(replyToMessageId ? { replyToMessageId } : {}),
          };
    pending.current = message;
    try {
      await api(`/v1/messages/threads/${id}/messages`, { method: "POST", body: JSON.stringify(message) });
      pending.current = null;
      setDraft("");
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
    Alert.alert("Unsend message?", "This removes the message for everyone in this chat.", [
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
    ]);
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
      await Share.share({
        message: [messagePreview(message), mediaUrl, "Shared from KampusOne"].filter(Boolean).join("\n"),
      });
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
  const locked = sending || actionBusy || messageActionBusy;
  const peerName = data?.profile?.display_name || "Conversation";
  const handleVoiceActive = useCallback((active: boolean) => {
    setVoiceActive(active);
    if (active) Keyboard.dismiss();
  }, []);

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
              ListEmptyComponent={pendingMedia.length ? null : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={29} color={theme.deepBrand} /></View>
                  <Text style={styles.emptyTitle}>Start the conversation</Text>
                  <Text style={styles.emptyBody}>Send a message to {peerName}. Keep it clear and respectful.</Text>
                </View>
              )}
              ListFooterComponent={pendingMedia.length ? (
                <View style={styles.pendingList}>
                  {pendingMedia.map((batch) => (
                    <PendingMediaBubble key={batch.id} batch={batch} onRetry={() => void processMediaBatch(batch)} />
                  ))}
                </View>
              ) : null}
              renderItem={({ item, index }) => {
                const mine = item.sender_id === user?.id;
                const previous = index > 0 ? data.messages[index - 1] : undefined;
                if (picturesBelongTogether(previous, item)) return null;

                const pictureGroup: Message[] = [item];
                if (item.media_type?.startsWith("image/")) {
                  for (let nextIndex = index + 1; nextIndex < data.messages.length && pictureGroup.length < 10; nextIndex += 1) {
                    const next = data.messages[nextIndex];
                    if (!next || !picturesBelongTogether(pictureGroup[pictureGroup.length - 1], next)) break;
                    pictureGroup.push(next);
                  }
                }
                const groupedPictures = pictureGroup.length > 1;
                const metaMessage = pictureGroup[pictureGroup.length - 1] || item;
                const showBody = shouldShowBody(item);
                return (
                  <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowOther]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                      {showBody ? <Text selectable style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text> : null}
                      {groupedPictures ? (
                        <PictureGroup messages={pictureGroup} mine={mine} />
                      ) : item.media_id && item.media_type ? (
                        <MessageMedia message={item} mine={mine} />
                      ) : null}
                    </View>
                    <View style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                      <Text style={styles.messageTime}>{formatMessageTime(metaMessage.created_at)}</Text>
                      {mine ? <Ionicons name={metaMessage.read_at ? "checkmark-done" : "checkmark"} size={14} color={metaMessage.read_at ? theme.deepBrand : theme.textFaint} /> : null}
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
                <Text style={styles.requestBody}>Accept to reply and share pictures, videos, voice notes and documents.</Text>
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
              <SelectedMediaPreview
                items={selectedMedia}
                onRemove={(localId) => setSelectedMedia((current) => current.filter((item) => item.localId !== localId))}
              />
              {pickerOpen && !voiceActive ? (
                <View style={styles.pickerMenu}>
                  <Pressable accessibilityRole="button" onPress={() => void chooseMedia()} style={({ pressed }) => [styles.pickerAction, pressed && styles.pressed]}>
                    <View style={styles.pickerActionIcon}><Ionicons name="images-outline" size={20} color={theme.deepBrand} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerActionTitle}>Pictures & videos</Text>
                      <Text style={styles.pickerActionMeta}>Select up to 10 and send immediately</Text>
                    </View>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => void chooseDocument()} style={({ pressed }) => [styles.pickerAction, pressed && styles.pressed]}>
                    <View style={styles.pickerActionIcon}><Ionicons name="document-text-outline" size={20} color={theme.deepBrand} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerActionTitle}>Document</Text>
                      <Text style={styles.pickerActionMeta}>PDF, Word, Excel, PowerPoint and more</Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.composerBar}>
                {!voiceActive ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={pickerOpen ? "Close media menu" : "Add picture, video or document"}
                    disabled={!canAttach || actionBusy}
                    onPress={() => setPickerOpen((value) => !value)}
                    style={({ pressed }) => [styles.plusButton, (!canAttach || actionBusy) && styles.disabled, pressed && styles.pressed]}
                  >
                    <Ionicons name={pickerOpen ? "close" : "add"} size={24} color={theme.text} />
                  </Pressable>
                ) : null}
                {!voiceActive ? (
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
                ) : null}
                {canAttach && !draft.trim() && !selectedMedia.length ? (
                  <MessageVoice
                    compact
                    disabled={locked}
                    onActiveChange={handleVoiceActive}
                    onReady={async (mediaId) => {
                      await sendVoice(mediaId);
                    }}
                  />
                ) : null}
                {!voiceActive && (!canAttach || Boolean(draft.trim()) || Boolean(selectedMedia.length)) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    disabled={sending || (!draft.trim() && !selectedMedia.length)}
                    onPress={() => void send()}
                    style={({ pressed }) => [styles.sendButton, (sending || (!draft.trim() && !selectedMedia.length)) && styles.sendDisabled, pressed && styles.pressed]}
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
  pictureGroup: { width: 230, flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  pictureGroupTile: { width: 113, height: 96, borderRadius: 10, overflow: "hidden", backgroundColor: theme.surfaceMuted, position: "relative" },
  pictureGroupTileTwo: { height: 132 },
  pictureGroupImage: { width: "100%", height: "100%" },
  pictureGroupPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(127,127,127,0.16)" },
  pictureGroupMore: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.52)" },
  pictureGroupMoreText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 22 },
  mediaWrap: { marginTop: 5, gap: 5, minWidth: 180 },
  pictureCard: { gap: 5 },
  messageImage: { width: 230, height: 180, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  mediaCaption: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10 },
  mediaCaptionMine: { color: "rgba(255,255,255,0.82)" },
  voicePlayback: { minWidth: 230, alignSelf: "stretch", backgroundColor: theme.surfaceMuted, borderRadius: 16, padding: 4 },
  voicePlaybackMine: { backgroundColor: "rgba(255,255,255,0.14)" },
  videoCard: { minHeight: 72, maxWidth: 240, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 9, backgroundColor: theme.surfaceMuted },
  videoIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand },
  documentCard: { minHeight: 58, maxWidth: 250, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 13, padding: 8, backgroundColor: theme.surfaceMuted },
  mediaCardMine: { backgroundColor: "rgba(255,255,255,0.14)" },
  documentIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  documentIconMine: { backgroundColor: "rgba(255,255,255,0.12)" },
  mediaTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12 },
  mediaTitleMine: { color: "#FFFFFF" },
  mediaMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, marginTop: 2 },
  mediaMetaMine: { color: "rgba(255,255,255,0.78)" },
  mediaError: { color: theme.error, fontFamily: theme.font.body, fontSize: 10, lineHeight: 14 },
  mediaErrorMine: { color: "#FFE5DC" },
  pendingList: { gap: 12, paddingTop: 4 },
  pendingRow: { alignSelf: "flex-end", maxWidth: "82%", alignItems: "flex-end", gap: 4 },
  pendingBubble: { minWidth: 190, maxWidth: 250, padding: 8, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: theme.deepBrand, gap: 7 },
  pendingCaption: { color: "#FFFFFF", fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 },
  pendingGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  pendingTile: { width: 108, height: 86, borderRadius: 10, overflow: "hidden", backgroundColor: theme.surfaceMuted },
  pendingImage: { width: "100%", height: "100%" },
  pendingPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5, padding: 6, backgroundColor: "#FFFFFF" },
  pendingPlaceholderText: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 10 },
  pendingMore: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.52)" },
  pendingMoreText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 22 },
  pendingStatusRow: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 250, paddingHorizontal: 3 },
  pendingStatus: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10 },
  pendingError: { flex: 1, color: theme.error, fontFamily: theme.font.body, fontSize: 10 },
  retryMediaButton: { minHeight: 28, paddingHorizontal: 8, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  retryMediaText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 10 },
  composerDock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, backgroundColor: theme.canvas, gap: 7 },
  pickerMenu: { borderRadius: 16, padding: 6, gap: 3, backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  pickerAction: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7 },
  pickerActionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted },
  pickerActionTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  pickerActionMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10, marginTop: 2 },
  selectionWrap: { gap: 6 },
  selectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  selectionTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11 },
  selectionMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10 },
  selectionStrip: { gap: 7, paddingRight: 8 },
  selectionItem: { width: 74, height: 74, borderRadius: 12, overflow: "hidden", backgroundColor: theme.surfaceMuted, position: "relative" },
  selectionImage: { width: "100%", height: "100%" },
  selectionPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, padding: 5 },
  selectionPlaceholderText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 9 },
  selectionRemove: { position: "absolute", right: 4, top: 4, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.65)" },
  composerBar: { minHeight: 50, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  plusButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceMuted, marginBottom: 3 },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 118, borderRadius: 22, paddingHorizontal: 15, paddingTop: Platform.OS === "ios" ? 12 : 10, paddingBottom: 10, color: theme.text, backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.deepBrand, marginBottom: 3 },
  sendDisabled: { backgroundColor: theme.peach, opacity: 0.72 },
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
