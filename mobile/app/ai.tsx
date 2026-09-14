import { useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { pickAndUpload, type UploadedFile } from "@/src/lib/uploads";
export default function StudyAI() {
  const { mode: initial } = useLocalSearchParams<{ mode?: string }>();
  const { user } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [mode, setMode] = useState(
    ["summary", "quiz"].includes(initial ?? "") ? initial! : "study",
  );
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(randomUUID());
  useEffect(() => {
    void readCache<{ prompt: string }>("ai-draft." + user?.id).then((d) => {
      if (d) setPrompt(d.prompt);
    });
  }, [user?.id]);
  async function attach() {
    try {
      setBusy(true);
      const f = await pickAndUpload("resource");
      if (f) {
        setFile(f);
        key.current = randomUUID();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not attach file", "error");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    await writeCache("ai-draft." + user?.id, { prompt });
    try {
      const r = await api<{ text: string }>("/v1/ai", {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          mode,
          prompt,
          mediaId: file?.id,
          idempotencyKey: key.current,
          consent: true,
        }),
      });
      setAnswer(r.text);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not finish your request",
        "error",
      );
      key.current = randomUUID();
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Study space">
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
        {["study", "summary", "quiz"].map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => {
              setMode(m);
              key.current = randomUUID();
              setAnswer("");
            }}
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 12,
              backgroundColor: mode === m ? theme.sand : theme.surface,
            }}
          >
            <Text
              style={{
                textAlign: "center",
                fontFamily: theme.font.medium,
                color: theme.text,
              }}
            >
              {m === "study"
                ? "Ask"
                : m === "summary"
                  ? "Summarise"
                  : "Practice"}
            </Text>
          </Pressable>
        ))}
      </View>
      {answer ? (
        <View
          style={{
            borderLeftWidth: 3,
            borderColor: theme.peach,
            paddingLeft: 18,
            marginVertical: 20,
          }}
        >
          <Text
            selectable
            style={{
              fontFamily: theme.font.body,
              color: theme.text,
              lineHeight: 25,
              fontSize: 15,
            }}
          >
            {answer}
          </Text>
        </View>
      ) : (
        <View style={{ alignItems: "center", paddingVertical: 12 }}>
          <Image
            source={require("../assets/illustrations/auth-study-v2.png")}
            style={{ height: 180, width: 240 }}
            resizeMode="contain"
          />
          <Text
            style={{
              fontFamily: theme.font.display,
              fontSize: 23,
              color: theme.text,
              marginVertical: 18,
            }}
          >
            What are we learning?
          </Text>
        </View>
      )}
      <ToolField
        label={mode === "study" ? "Your question" : "Notes or instructions"}
        value={prompt}
        maxLength={20000}
        multiline
        placeholder="Start with a topic or add your notes…"
        onChangeText={(v) => {
          setPrompt(v);
          key.current = randomUUID();
        }}
      />
      <ToolButton
        secondary
        label={file ? "Replace attachment" : "Attach notes or PDF"}
        disabled={busy}
        onPress={() => void attach()}
      />
      {file ? (
        <ToolButton
          secondary
          label="Remove attachment"
          disabled={busy}
          onPress={() => {
            setFile(null);
            key.current = randomUUID();
          }}
        />
      ) : null}
      <Text
        style={{
          fontFamily: theme.font.body,
          color: theme.textMuted,
          fontSize: 11,
          lineHeight: 17,
          marginVertical: 12,
        }}
      >
        Continuing sends your question and selected file to the AI provider.
        Review the answer before using it.
      </Text>
      <ToolButton
        label={
          busy
            ? "Working…"
            : mode === "study"
              ? "Ask"
              : mode === "summary"
                ? "Summarise"
                : "Create practice questions"
        }
        disabled={busy || (!prompt.trim() && !file)}
        onPress={() => void send()}
      />
    </ToolPage>
  );
}
