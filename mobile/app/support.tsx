import { useEffect, useState } from "react";
import { Text } from 'react-native';
import { useLocalSearchParams } from "expo-router";
import {
  ToolButton,
  ToolField,
  ToolPage,
  ToolRow,
} from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { supportRequests, type SupportRequest } from '@/src/lib/support-requests';
import { useAppearance } from '@/src/lib/appearance';
export default function Support() {
  const params = useLocalSearchParams<{ category?: string }>();
  const toast = useToast();
  const { theme } = useAppearance();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  async function load(signal?: AbortSignal) {
    try {
      const payload = await api<unknown>("/v1/account/support", signal ? { signal } : {});
      if (signal?.aborted) return;
      setRequests(supportRequests(payload));
      setLoadError('');
    } catch (e) {
      if (signal?.aborted) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load requests');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);
  async function send() {
    setBusy(true);
    try {
      await api("/v1/account/support", {
        method: "POST",
        body: JSON.stringify({
          category: [
            "ACCOUNT",
            "ORDER",
            "TUTORIAL",
            "DELIVERY",
            "PAYMENT",
            "SAFETY",
            "CONTENT",
            "APPEAL",
            "PRIVACY",
          ].includes(params.category ?? "")
            ? params.category
            : "ACCOUNT",
          subject,
          body,
        }),
      });
      setSubject("");
      setBody("");
      await load();
      toast("Request sent", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not send request", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Help & support">
      <ToolField
        label="Subject"
        maxLength={160}
        value={subject}
        onChangeText={setSubject}
      />
      <ToolField
        label="How can we help?"
        maxLength={4000}
        value={body}
        onChangeText={setBody}
        multiline
      />
      <ToolButton
        label={busy ? "Sending…" : "Send request"}
        disabled={busy || subject.trim().length < 3 || body.trim().length < 5}
        onPress={() => void send()}
      />
      {loadError ? <>
        <Text accessibilityRole="alert" style={{ color: theme.error, marginTop: 18 }}>{loadError}</Text>
        <ToolButton label="Reload my requests" secondary onPress={() => void load()} />
      </> : null}
      {requests.map((r) => (
        <ToolRow
          key={r.id}
          title={r.subject}
          detail={r.reply ?? r.status.replaceAll("_", " ").toLowerCase()}
        />
      ))}
    </ToolPage>
  );
}
