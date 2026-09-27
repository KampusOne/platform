import { HashtagSuggestions } from "@/src/components/hashtag-suggestions";
import { MediaPreview } from "@/src/components/media-preview";
import { InlineLoading } from "@/src/components/skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Image, Text, View, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, Modal, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { useAuth } from "@/src/auth/auth-context";

import { QuotedPostPreview } from "@/src/components/quoted-post";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { validPostId } from "@/src/lib/feed-posts";
import type { SocialFeedPost } from "@/src/lib/feed-social";
import {
  editPostMedia,
  pickPostMedia,
  pickPostMediaBatch,
  uploadPostMedia,
  verifyPhoto,
  type PostMedia,
  type UploadedFile,
} from "@/src/lib/uploads";

type DraftMedia = {
  key: string;
  local: PostMedia;
  uploaded: UploadedFile | null;
  status: "uploading" | "ready" | "error";
  error: string;
  previewError: boolean;
};

const maxImages = 5;

export default function Compose() {
  const { theme } = useAppearance();
  const toast = useToast();
  const { user, profile } = useAuth();
  const { width } = useWindowDimensions();
  const [discard, setDiscard] = useState(false);
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const boundOwner = useRef(user?.id);
  const { quote } = useLocalSearchParams<{ quote?: string | string[] }>();
  const isQuote = quote !== undefined;
  const quoteId = validPostId(quote) ? quote : null;
  const [original, setOriginal] = useState<SocialFeedPost | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(isQuote);
  const [quoteError, setQuoteError] = useState("");
  const [body, setBody] = useState("");
  const [cursor, setCursor] = useState(0);
  const [media, setMedia] = useState<DraftMedia[]>([]);
  const mediaRef = useRef<DraftMedia[]>([]);
  mediaRef.current = media;
  const [selecting, setSelecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const pickerLock = useRef(false);
  const publishLock = useRef(false);
  const requestId = useRef(randomUUID());
  const alive = useRef(true);
  const quoteVersion = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      quoteVersion.current++;
    };
  }, []);

  const loadQuote = useCallback(async () => {
    const version = ++quoteVersion.current;
    setOriginal(null);
    if (!isQuote) {
      setQuoteLoading(false);
      return;
    }
    if (!quoteId) {
      setQuoteLoading(false);
      setQuoteError("This original post link is invalid.");
      return;
    }
    setQuoteLoading(true);
    setQuoteError("");
    try {
      const result = await api<{ post: SocialFeedPost }>(`/v1/student/feed/${quoteId}`);
      if (alive.current && version === quoteVersion.current) {
        if (!result.post.social_enabled)
          setQuoteError("Quote posts are being connected. Please try again shortly.");
        else setOriginal(result.post);
      }
    } catch (error) {
      if (alive.current && version === quoteVersion.current)
        setQuoteError(error instanceof Error ? error.message : "The original post could not be loaded.");
    } finally {
      if (alive.current && version === quoteVersion.current) setQuoteLoading(false);
    }
  }, [isQuote, quoteId]);

  useEffect(() => {
    requestId.current = randomUUID();
    void loadQuote();
  }, [loadQuote]);

  const patchMedia = useCallback((key: string, patch: Partial<DraftMedia>) => {
    if (!alive.current) return;
    setMedia((items) => items.map((item) => item.key === key ? { ...item, ...patch } : item));
  }, []);

  async function uploadOne(entry: Pick<DraftMedia, "key" | "local" | "uploaded">) {
    patchMedia(entry.key, { status: "uploading", error: "", previewError: false });
    try {
      const saved = entry.uploaded ?? await uploadPostMedia(entry.local);
      if (!alive.current) return;
      patchMedia(entry.key, { uploaded: saved });
      if (!entry.local.type.startsWith("video/")) await verifyPhoto(saved.url);
      if (alive.current) patchMedia(entry.key, { uploaded: saved, status: "ready", error: "" });
    } catch (error) {
      if (!alive.current) return;
      const message = error instanceof Error
        ? error.message
        : "Upload failed. Your media is still here; retry, edit, or remove it.";
      patchMedia(entry.key, { status: "error", error: message });
    }
  }

  async function uploadEntries(entries: DraftMedia[]) {
    for (const entry of entries) {
      if (!alive.current) return;
      await uploadOne(entry);
    }
  }

  async function attach() {
    if (pickerLock.current || selecting || publishing || editingKey) return;
    const current = mediaRef.current;
    if (current.some((item) => item.local.type.startsWith("video/"))) {
      toast("A video must be posted by itself. Remove it before adding images.", "error");
      return;
    }
    const remaining = maxImages - current.length;
    if (remaining <= 0) {
      toast("You can add up to 5 images to one post.", "error");
      return;
    }

    pickerLock.current = true;
    setSelecting(true);
    try {
      const selected = await pickPostMediaBatch(remaining);
      const valid = selected.filter((item): item is PostMedia => Boolean(item));
      if (!valid.length || !alive.current) return;
      if (valid.some((item) => item.type.startsWith("video/")) && (current.length > 0 || valid.length > 1)) {
        toast("Choose one video by itself. Multiple attachments can contain up to 5 images.", "error");
        return;
      }

      const entries: DraftMedia[] = valid.slice(0, remaining).map((local) => ({
        key: randomUUID(),
        local,
        uploaded: null,
        status: "uploading",
        error: "",
        previewError: false,
      }));
      setMedia((items) => [...items, ...entries]);
      requestId.current = randomUUID();
      void uploadEntries(entries);
    } catch (error) {
      if (alive.current)
        toast(error instanceof Error ? error.message : "Could not add this media.", "error");
    } finally {
      pickerLock.current = false;
      if (alive.current) setSelecting(false);
    }
  }

  async function attachCamera() {
    if (pickerLock.current || selecting || publishing || editingKey) return;
    const current = mediaRef.current;
    if (current.some((item) => item.local.type.startsWith("video/"))) {
      toast("A video must be posted by itself. Remove it before adding a photo.", "error");
      return;
    }
    if (current.length >= maxImages) {
      toast("You can add up to 5 images to one post.", "error");
      return;
    }

    pickerLock.current = true;
    setSelecting(true);
    try {
      const local = await pickPostMedia("camera");
      if (!local || !alive.current) return;
      const entry: DraftMedia = {
        key: randomUUID(),
        local,
        uploaded: null,
        status: "uploading",
        error: "",
        previewError: false,
      };
      setMedia((items) => [...items, entry]);
      requestId.current = randomUUID();
      void uploadEntries([entry]);
    } catch (error) {
      if (alive.current)
        toast(error instanceof Error ? error.message : "Could not add this photo.", "error");
    } finally {
      pickerLock.current = false;
      if (alive.current) setSelecting(false);
    }
  }

  async function retryUpload(key: string) {
    const entry = mediaRef.current.find((item) => item.key === key);
    if (!entry || entry.status === "uploading") return;
    await uploadOne(entry);
  }

  async function editCurrentMedia(key: string) {
    if (editingKey || selecting || publishing) return;
    const entry = mediaRef.current.find((item) => item.key === key);
    if (!entry) return;
    setEditingKey(key);
    try {
      const edited = await editPostMedia(entry.local);
      if (!edited || !alive.current) return;
      patchMedia(key, {
        local: edited,
        uploaded: null,
        status: "uploading",
        error: "",
        previewError: false,
      });
      requestId.current = randomUUID();
      setEditingKey(null);
      await uploadOne({ key, local: edited, uploaded: null });
    } catch (error) {
      if (alive.current)
        toast(error instanceof Error ? error.message : "The media could not be edited.", "error");
    } finally {
      if (alive.current) setEditingKey(null);
    }
  }

  function removeMedia(key: string) {
    if (publishing || editingKey === key) return;
    setMedia((items) => items.filter((item) => item.key !== key));
    requestId.current = randomUUID();
  }

  const uploading = media.some((item) => item.status === "uploading");
  const allMediaReady = media.every((item) => item.status === "ready" && item.uploaded && !item.previewError);
  const canPost =
    owner.current === boundOwner.current &&
    !selecting &&
    !publishing &&
    !editingKey &&
    !uploading &&
    (body.trim().length > 0 || media.length > 0) &&
    allMediaReady &&
    (!isQuote || Boolean(original && !quoteLoading));

  async function publish() {
    if (publishLock.current || !canPost) return;
    publishLock.current = true;
    setPublishing(true);
    try {
      const attachments = mediaRef.current.map((item) => ({
        mediaId: item.uploaded!.id,
        width: item.local.width,
        height: item.local.height,
      }));
      await api("/v1/student/feed", {
        method: "POST",
        body: JSON.stringify({
          body,
          ...(attachments.length ? { media: attachments } : {}),
          requestId: requestId.current,
          ...(isQuote ? { quotedPostId: quoteId } : {}),
        }),
      });
      if (alive.current) {
        toast(isQuote ? "Quote posted" : "Posted", "success");
        router.replace("/(tabs)/feed");
      }
    } catch (error) {
      if (alive.current)
        toast(error instanceof Error ? error.message : "Could not post. Your draft is still here.", "error");
    } finally {
      publishLock.current = false;
      if (alive.current) setPublishing(false);
    }
  }

  function close() {
    if (publishing || selecting || editingKey) return;
    if (body.trim() || media.length) setDiscard(true);
    else router.canGoBack() ? router.back() : router.replace("/(tabs)/feed");
  }

  const text = { fontFamily: theme.font.body, color: theme.text, fontSize: 14, lineHeight: 20 };
  const multi = media.length > 1;
  const cardWidth = multi
    ? Math.min(330, Math.max(230, width - 82))
    : Math.min(620, Math.max(230, width - 40));
  const cardHeight = multi ? Math.min(330, cardWidth * 1.04) : 270;

  if (owner.current !== boundOwner.current)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }}>
        <Text style={{ ...text, padding: 24 }}>Your account changed. Reopen the composer to start a new post.</Text>
        <Pressable onPress={() => router.replace("/(tabs)/feed")} accessibilityRole="button" style={{ padding: 24 }}>
          <Text style={text}>Back to feed</Text>
        </Pressable>
      </SafeAreaView>
    );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.canvas }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, width: "100%", maxWidth: 660, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 15, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close post composer" disabled={publishing || selecting || Boolean(editingKey)} onPress={close} style={{ padding: 10 }}>
            <Ionicons name="close" size={26} color={theme.text} />
          </Pressable>
          <Text style={{ ...text, fontFamily: theme.font.semibold }}>{isQuote ? "Quote post" : "New post"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Publish post" accessibilityState={{ disabled: !canPost }} disabled={!canPost} onPress={() => void publish()} style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: theme.deepBrand, opacity: canPost ? 1 : 0.45 }}>
            <Text style={{ ...text, fontFamily: theme.font.semibold, color: "#FFFFFF" }}>
              {uploading ? "Uploading…" : publishing ? "Posting…" : selecting ? "Adding…" : "Post"}
            </Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <ProfileAvatar name={profile?.display_name ?? "You"} imageUrl={profile?.profile_image_url} size={42} />
            <View>
              <Text style={{ ...text, fontFamily: theme.font.semibold }}>{profile?.display_name ?? "You"}</Text>
              <Text style={{ ...text, fontSize: 11, color: theme.textMuted }}>{isQuote && original?.visibility !== "PUBLIC" ? "Your campus" : "KampusOne community"}</Text>
            </View>
          </View>

          <TextInput
            accessibilityLabel={isQuote ? "Your thoughts on this post" : "Post text"}
            placeholder={isQuote ? "Add your thoughts…" : "What’s happening on campus?"}
            placeholderTextColor={theme.textMuted}
            value={body}
            editable={!publishing}
            onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
            onChangeText={(value) => {
              setBody(value);
              setCursor(value.length);
              requestId.current = randomUUID();
            }}
            multiline
            maxLength={5000}
            style={{ fontFamily: theme.font.body, color: theme.text, fontSize: 18, lineHeight: 28, minHeight: media.length ? 110 : 160, textAlignVertical: "top", padding: 0, marginBottom: 18 }}
          />

          {!publishing ? (
            <HashtagSuggestions
              text={body}
              cursor={cursor}
              onSelect={(value) => {
                setBody(value.slice(0, 5000));
                setCursor(value.length);
                requestId.current = randomUUID();
              }}
            />
          ) : null}

          {media.length ? (
            <View style={{ marginBottom: 15 }}>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={multi ? cardWidth + 10 : undefined}
                contentContainerStyle={{ gap: 10, paddingRight: multi ? 26 : 0 }}
              >
                {media.map((item, index) => (
                  <View key={item.key} style={{ width: cardWidth }}>
                    <View style={{ position: "relative", width: cardWidth, height: cardHeight, borderRadius: 15, overflow: "hidden", backgroundColor: theme.surfaceMuted }}>
                      {item.local.type.startsWith("video/") ? (
                        <MediaPreview
                          url={item.local.uri}
                          video
                          label="Selected video"
                          initialAspect={item.local.width && item.local.height ? item.local.width / item.local.height : undefined}
                        />
                      ) : (
                        <Image
                          accessibilityLabel={`Selected post image ${index + 1} of ${media.length}`}
                          source={{ uri: item.local.uri }}
                          resizeMode={multi ? "cover" : "contain"}
                          onLoad={() => patchMedia(item.key, { previewError: false })}
                          onError={() => patchMedia(item.key, { previewError: true })}
                          style={{ width: "100%", height: "100%" }}
                        />
                      )}

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove media ${index + 1}`}
                        disabled={publishing || editingKey === item.key}
                        onPress={() => removeMedia(item.key)}
                        style={{ position: "absolute", top: 8, right: 8, padding: 8, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.72)" }}
                      >
                        <Ionicons name="close" size={20} color="#FFFFFF" />
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={item.local.type.startsWith("video/") ? "Edit video trim" : `Edit image ${index + 1}`}
                        disabled={publishing || Boolean(editingKey) || item.status === "uploading"}
                        onPress={() => void editCurrentMedia(item.key)}
                        style={{ position: "absolute", top: 8, left: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.72)" }}
                      >
                        <Text style={{ ...text, color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12 }}>
                          {editingKey === item.key ? "Editing…" : "Edit"}
                        </Text>
                      </Pressable>

                      {item.status === "uploading" ? (
                        <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={{ position: "absolute", left: 10, right: 10, bottom: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, backgroundColor: "rgba(12,12,12,0.78)", flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View style={{ width: 38, alignItems: "center" }}>
                            <Ionicons name="cloud-upload-outline" size={21} color="#FFFFFF" />
                            <InlineLoading color="#FFFFFF" style={{ width: 30, marginTop: 3, marginBottom: 0 }} />
                          </View>
                          <Text style={{ ...text, color: "#FFFFFF", flex: 1, fontSize: 12 }}>
                            Uploading {media.length > 1 ? `${index + 1} of ${media.length}` : "media"}… Keep writing.
                          </Text>
                        </View>
                      ) : item.status === "ready" ? (
                        <View accessibilityLiveRegion="polite" style={{ position: "absolute", left: 10, bottom: 10, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, backgroundColor: "rgba(12,12,12,0.72)", flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                          <Text style={{ ...text, color: "#FFFFFF", fontSize: 11 }}>Ready</Text>
                        </View>
                      ) : null}
                    </View>

                    {item.previewError ? (
                      <Text accessibilityRole="alert" style={{ ...text, color: theme.error, marginTop: 8 }}>
                        This preview could not load. Remove or replace it before posting.
                      </Text>
                    ) : null}

                    {item.error ? (
                      <View style={{ marginTop: 8 }}>
                        <Text accessibilityRole="alert" style={{ ...text, color: theme.error, fontSize: 12 }}>{item.error}</Text>
                        <Pressable accessibilityRole="button" disabled={publishing || item.status === "uploading"} onPress={() => void retryUpload(item.key)} style={{ paddingVertical: 9 }}>
                          <Text style={{ ...text, color: theme.brand, fontFamily: theme.font.semibold }}>Retry upload</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))}
              </ScrollView>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                <Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>
                  {media[0]?.local.type.startsWith("video/")
                    ? "1 video"
                    : `${media.length}/${maxImages} images · swipe to preview`}
                </Text>
                {media.length < maxImages && !media.some((item) => item.local.type.startsWith("video/")) ? (
                  <Pressable accessibilityRole="button" disabled={selecting || publishing || uploading} onPress={() => void attach()} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                    <Text style={{ ...text, color: theme.brand, fontFamily: theme.font.semibold, fontSize: 12 }}>Add more</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {isQuote && quoteLoading ? <InlineLoading /> : null}
          {original ? <QuotedPostPreview post={original} /> : null}
          {quoteError ? (
            <View style={{ gap: 10 }}>
              <Text accessibilityRole="alert" style={{ ...text, color: theme.error }}>{quoteError}</Text>
              {quoteId ? (
                <Pressable accessibilityRole="button" onPress={() => void loadQuote()} disabled={publishing} style={{ paddingVertical: 10 }}>
                  <Text style={{ ...text, color: theme.brand }}>Retry original post</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add images or video" disabled={selecting || publishing || Boolean(editingKey) || uploading} onPress={() => void attach()} style={{ padding: 10, opacity: media.length >= maxImages ? 0.45 : 1 }}>
            <Ionicons name="images-outline" size={25} color={theme.brand} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" disabled={selecting || publishing || Boolean(editingKey) || uploading} onPress={() => void attachCamera()} style={{ padding: 10, opacity: media.length >= maxImages ? 0.45 : 1 }}>
            <Ionicons name="camera-outline" size={25} color={theme.brand} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text accessibilityLabel={`${body.length} of 5000 characters`} style={{ ...text, fontSize: 12, color: theme.textMuted }}>{body.length}/5000</Text>
        </View>

        <Modal visible={discard} transparent animationType="fade" onRequestClose={() => setDiscard(false)}>
          <View style={{ flex: 1, justifyContent: "center", padding: 30, backgroundColor: "rgba(0,0,0,0.4)" }}>
            <View style={{ padding: 24, gap: 18, borderRadius: 18, backgroundColor: theme.surface }}>
              <Text style={{ ...text, fontFamily: theme.font.semibold, fontSize: 19 }}>Discard this draft?</Text>
              <Text style={text}>Your text and selected media will be removed from this composer.</Text>
              <Pressable accessibilityRole="button" onPress={() => {
                setDiscard(false);
                router.canGoBack() ? router.back() : router.replace("/(tabs)/feed");
              }} style={{ padding: 10 }}>
                <Text style={{ ...text, color: theme.error }}>Discard</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setDiscard(false)} style={{ padding: 10 }}>
                <Text style={text}>Keep editing</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
