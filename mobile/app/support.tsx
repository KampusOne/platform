import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ToolButton,
  ToolField,
  ToolPage,
  ToolRow,
} from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
type Request = {
  id: string;
  subject: string;
  status: string;
  reply: string | null;
};
export default function Support() {
  const params = useLocalSearchParams<{ category?: string }>();
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setRequests(
        (await api<{ requests: Request[] }>("/v1/account/support")).requests,
      );
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not load requests",
        "error",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function send() {
    setBusy(true);
    try {
      await api("/v1/account/support", {
        method: "POST",
        body: JSON.stringify({
          category: ["PRIVACY", "APPEAL"].includes(params.category ?? "")
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
