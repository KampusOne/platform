import { useRef, useState } from "react";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Image, Text } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickAndUpload, type UploadedFile } from "@/src/lib/uploads";
export default function Compose() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(randomUUID());
  async function attach() {
    setBusy(true);
    try {
      const file = await pickAndUpload("post");
      if (file) setPhoto(file);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function post() {
    setBusy(true);
    try {
      await api("/v1/student/feed", {
        method: "POST",
        body: JSON.stringify({
          body,
          mediaId: photo?.id,
          requestId: requestId.current,
        }),
      });
      toast("Posted", "success");
      router.back();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not post", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="New post">
      <ToolField
        label="What’s happening?"
        value={body}
        onChangeText={(v) => {
          setBody(v);
          requestId.current = randomUUID();
        }}
        multiline
        maxLength={5000}
        style={{ minHeight: 180 }}
      />
      <Text
        style={{
          color: theme.textMuted,
          fontSize: 12,
          textAlign: "right",
          marginBottom: 18,
        }}
      >
        {body.length}/5000
      </Text>
      {photo ? (
        <Image
          source={{ uri: photo.url }}
          style={{ height: 220, borderRadius: 18, marginBottom: 16 }}
        />
      ) : null}
      <ToolButton
        secondary
        label={photo ? "Replace photo" : "Add photo"}
        disabled={busy}
        onPress={() => void attach()}
      />
      <ToolButton
        label={busy ? "Posting…" : "Post"}
        disabled={busy || body.trim().length < 4}
        onPress={() => void post()}
      />
    </ToolPage>
  );
}
