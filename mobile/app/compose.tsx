import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { QuotedPostPreview } from "@/src/components/quoted-post";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { validPostId } from "@/src/lib/feed-posts";
import type { SocialFeedPost } from "@/src/lib/feed-social";
import { pickPhoto, uploadPreparedPhoto, verifyPhoto, type PreparedPhoto, type UploadedFile } from "@/src/lib/uploads";

export default function Compose() {
  const { theme } = useAppearance();
  const toast = useToast();
  const { quote } = useLocalSearchParams<{ quote?: string | string[] }>();
  const isQuote = quote !== undefined;
  const quoteId = validPostId(quote) ? quote : null;
  const [original, setOriginal] = useState<SocialFeedPost | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(isQuote);
  const [quoteError, setQuoteError] = useState("");
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<UploadedFile | null>(null);
  const [draftPhoto, setDraftPhoto] = useState<PreparedPhoto | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lock = useRef(false);
  const requestId = useRef(randomUUID());
  const alive = useRef(true);
  const quoteVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; quoteVersion.current++; }; }, []);

  const loadQuote = useCallback(async () => {
    const version = ++quoteVersion.current;
    setOriginal(null);
    if (!isQuote) { setQuoteLoading(false); return; }
    if (!quoteId) { setQuoteLoading(false); setQuoteError("This original post link is invalid."); return; }
    setQuoteLoading(true); setQuoteError("");
    try {
      const result = await api<{ post: SocialFeedPost }>(`/v1/student/feed/${quoteId}`);
      if (alive.current && version === quoteVersion.current) {
        if (!result.post.social_enabled) setQuoteError("Quote posts are being connected. Please try again shortly.");
        else setOriginal(result.post);
      }
    } catch (error) {
      if (alive.current && version === quoteVersion.current) setQuoteError(error instanceof Error ? error.message : "The original post could not be loaded.");
    } finally { if (alive.current && version === quoteVersion.current) setQuoteLoading(false); }
  }, [isQuote, quoteId]);
  useEffect(() => { requestId.current = randomUUID(); void loadQuote(); }, [loadQuote]);

  async function transfer(local: PreparedPhoto, existing: UploadedFile | null = null) {
    setPhotoError(""); setPhotoReady(false);
    // Retain a successful upload on a failed delivery check: Retry checks its
    // existing URL instead of uploading duplicate files to the bucket.
    const saved = existing ?? await uploadPreparedPhoto("post", local);
    if (!alive.current) return;
    setPhoto(saved);
    await verifyPhoto(saved.url);
    if (alive.current) setPhotoReady(true);
  }
  async function attach(retry = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setUploading(true);
    try {
      const local = retry ? draftPhoto : await pickPhoto("post");
      if (!local || !alive.current) return;
      if (!retry) {
        setDraftPhoto(local); setPhoto(null); setPhotoReady(false); setPreviewError(false);
        requestId.current = randomUUID();
      }
      await transfer(local, retry ? photo : null);
    } catch (error) {
      if (alive.current) {
        const message = error instanceof Error ? error.message : "Upload failed. Your photo is still here; retry or replace it.";
        setPhotoError(message); toast(message, "error");
      }
    } finally {
      lock.current = false;
      if (alive.current) { setBusy(false); setUploading(false); }
    }
  }
  const canPost = !busy && Array.from(body.trim()).length >= 4 && (!draftPhoto || (photoReady && !previewError)) && (!isQuote || Boolean(original && !quoteLoading));
  async function publish() {
    if (lock.current || !canPost) return;
    lock.current = true; setBusy(true);
    try {
      await api("/v1/student/feed", { method: "POST", body: JSON.stringify({ body, mediaId: photo?.id, requestId: requestId.current, ...(isQuote ? { quotedPostId: quoteId } : {}) }) });
      if (alive.current) { toast(isQuote ? "Quote posted" : "Posted", "success"); router.replace("/(tabs)/feed"); }
    } catch (error) {
      if (alive.current) toast(error instanceof Error ? error.message : "Could not post. Your draft is still here.", "error");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return (
    <ToolPage title={isQuote ? "Quote post" : "New post"}>
      <ToolField label={isQuote ? "Add your thoughts" : "What’s happening?"} value={body} editable={!busy} onChangeText={(value) => { setBody(value); requestId.current = randomUUID(); }} multiline maxLength={5000} style={{ minHeight: 150 }} />
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, textAlign: "right", marginBottom: 14 }}>{body.length}/5000 · At least 4 characters</Text>
      {draftPhoto ? <View style={{ width: "100%", marginBottom: 14 }}>
        <Image accessibilityLabel="Selected post photo" source={{ uri: draftPhoto.uri }} resizeMode="contain"
          onLoad={() => setPreviewError(false)} onError={() => setPreviewError(true)}
          style={{ width: "100%", height: 220, borderRadius: 14 }} />
        {uploading ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}><ActivityIndicator color={theme.brand} /><Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>Uploading and checking photo…</Text></View> : null}
        {previewError ? <Text accessibilityRole="alert" style={{ color: theme.deepBrand, marginTop: 8 }}>This preview could not load. Replace the photo or remove it before posting.</Text> : null}
        {photoReady && !previewError ? <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, marginTop: 8 }}>Photo ready</Text> : null}
      </View> : null}
      {photoError ? <Text accessibilityRole="alert" style={{ color: theme.deepBrand, fontFamily: theme.font.body, marginBottom: 12 }}>{photoError}</Text> : null}
      {photoError && draftPhoto ? <ToolButton secondary label={photo ? "Retry photo check" : "Retry upload"} disabled={busy} onPress={() => void attach(true)} /> : null}
      {isQuote && quoteLoading ? <ActivityIndicator color={theme.brand} /> : null}
      {isQuote && original ? <QuotedPostPreview post={original} /> : null}
      {quoteError ? <><Text accessibilityRole="alert" style={{ color: theme.deepBrand, fontFamily: theme.font.body, marginVertical: 12 }}>{quoteError}</Text>{quoteId ? <ToolButton secondary label="Retry original post" disabled={busy} onPress={() => void loadQuote()} /> : null}</> : null}
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, marginVertical: 16 }}>{isQuote && original?.visibility !== "PUBLIC" ? "This quote keeps the original post’s campus-only audience." : "Visible to everyone signed in to KampusOne."}</Text>
      <ToolButton secondary label={uploading ? "Preparing photo…" : draftPhoto ? "Replace photo" : "Add photo"} disabled={busy} onPress={() => void attach()} />
      {draftPhoto ? <ToolButton secondary label="Remove photo" disabled={busy} onPress={() => { setPhoto(null); setDraftPhoto(null); setPhotoReady(false); setPhotoError(""); setPreviewError(false); requestId.current = randomUUID(); }} /> : null}
      <ToolButton label={busy && !uploading ? "Posting…" : isQuote ? "Post quote" : "Post"} disabled={!canPost} onPress={() => void publish()} />
    </ToolPage>
  );
}
