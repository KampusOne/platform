import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api, ApiError } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { pickAndUpload } from "@/src/lib/uploads";

type Mode = "study" | "summary" | "notes" | "quiz";
const tabs: { mode: Mode; label: string }[] = [{ mode: "study", label: "Ask" }, { mode: "summary", label: "Summary" }, { mode: "notes", label: "Notes" }, { mode: "quiz", label: "Practice" }];
type Draft = { prompt: string; mode: Mode; mediaId?: string; fileName?: string; replyTo?: string; key: string };
type Result = { text: string; requestId: string; mode?: Mode; prompt?: string; mediaId?: string; fileName?: string };
type SavedWork = { id: string; mode: Mode; title: string; created_at: string; source_name?: string };
type Status = { enabled: boolean; historyDays: number; providers: { study: { configured: boolean; missing: string[] } }; allowance: { unlimited?: boolean; remaining: number | null; limit: number | null; resetsAt: string; globalAvailable: boolean; policy: string } };

export default function StudyAI() {
  const { mode: initial } = useLocalSearchParams<{ mode?: string }>();
  const { user } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(tabs.some(t => t.mode === initial) ? initial as Mode : "study");
  const [prompt, setPrompt] = useState("");
  const [mediaId, setMediaId] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [replyTo, setReplyTo] = useState<string>();
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>();
  const [statusError, setStatusError] = useState("");
  const [history, setHistory] = useState<SavedWork[]>([]);
  const [search, setSearch] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [deleting, setDeleting] = useState<string>();
  const key = useRef(randomUUID());
  const action = useRef(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  const textStyle = { fontFamily: theme.font.body, color: theme.text, fontSize: 14, lineHeight: 22 };
  const mutedStyle = { ...textStyle, fontSize: 12, color: theme.textMuted };

  async function loadStatus() {
    const owner = account.current;
    try { const s = await api<Status>("/v1/ai/status"); if (owner === account.current) { setStatus(s); setStatusError(""); } }
    catch { if (owner === account.current) setStatusError("Could not check AI availability. Check your connection and refresh."); }
  }
  async function loadHistory(query = "", offset = 0) {
    const owner = account.current;
    setHistoryBusy(true); setHistoryError("");
    try {
      const r = await api<{ sessions: SavedWork[]; nextOffset: number | null }>(`/v1/ai/history?q=${encodeURIComponent(query)}&offset=${offset}`);
      if (owner !== account.current) return;
      setHistory(s => offset ? [...s, ...r.sessions.filter(x => !s.some(y => y.id === x.id))] : r.sessions);
      setHistoryQuery(query); setNextOffset(r.nextOffset);
    } catch (e) { if (owner === account.current) setHistoryError(e instanceof Error ? e.message : "Saved work could not load."); }
    finally { if (owner === account.current) setHistoryBusy(false); }
  }
  useEffect(() => {
    let active = true;
    setLoaded(false); setPrompt(""); setMediaId(undefined); setFileName(undefined); setReplyTo(undefined); setAnswer(""); setQuestion(""); setHistory([]); setStatus(undefined); setBusy(false); action.current = false;
    key.current = randomUUID();
    if (!user?.id) return;
    void readCache<Draft>("ai-draft." + user.id).then(d => {
      if (!active) return;
      if (d) { setPrompt(d.prompt ?? ""); if (tabs.some(t => t.mode === d.mode)) setMode(d.mode); setMediaId(d.mediaId); setFileName(d.fileName); setReplyTo(d.replyTo); key.current = d.key || randomUUID(); }
    }).catch(() => undefined).finally(() => { if (active) setLoaded(true); });
    void loadStatus(); void loadHistory();
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!loaded || !user?.id) return;
    // Persist only the owner-scoped draft and file ID, never a signed private URL.
    const timer = setTimeout(() => { void writeCache("ai-draft." + user.id, { prompt, mode, mediaId, fileName, replyTo, key: key.current }).catch(() => undefined); }, 250);
    return () => clearTimeout(timer);
  }, [prompt, mode, mediaId, fileName, replyTo, error, loaded, user?.id]);
  function reset(nextMode = mode) {
    setMode(nextMode); setPrompt(""); setMediaId(undefined); setFileName(undefined); setReplyTo(undefined); setAnswer(""); setQuestion(""); setError(""); key.current = randomUUID();
  }
  async function attach() {
    if (action.current) return;
    const owner = account.current; action.current = true; setBusy(true); setError("");
    try { const file = await pickAndUpload("resource"); if (file && owner === account.current) { setMediaId(file.id); setFileName("Attached source"); key.current = randomUUID(); } }
    catch (e) { if (owner === account.current) setError(e instanceof Error ? e.message : "Could not attach your file."); }
    finally { if (owner === account.current) { action.current = false; setBusy(false); } }
  }
  async function send() {
    if (action.current || (!prompt.trim() && !mediaId)) return;
    const owner = account.current; action.current = true; setBusy(true); setError("");
    const draft = { prompt, mode, mediaId, fileName, replyTo, key: key.current };
    try {
      await writeCache("ai-draft." + owner, draft).catch(() => undefined);
      const r = await api<Result>("/v1/ai", { method: "POST", signal: AbortSignal.timeout(45000), body: JSON.stringify({ mode, prompt, mediaId, replyTo, idempotencyKey: draft.key, consent: true }) });
      if (owner !== account.current) return;
      setAnswer(r.text); setQuestion(prompt || fileName || "Attached study material"); setReplyTo(r.requestId); setPrompt(""); key.current = randomUUID();
      void loadHistory(); void loadStatus();
    } catch (e) {
      if (owner !== account.current) return;
      // A network timeout is ambiguous: reuse the same key to recover the result.
      // Only an explicit terminal server failure allows a new provider attempt.
      if (e instanceof ApiError && e.details?.retryWithNewKey === true) key.current = randomUUID();
      setError(e instanceof Error ? e.message : "Could not finish. Retry to check the same attempt.");
      void loadStatus();
    } finally { if (owner === account.current) { action.current = false; setBusy(false); } }
  }
  async function open(id: string) {
    if (action.current) return;
    const owner = account.current; action.current = true; setBusy(true); setError("");
    try {
      const r = await api<Result>(`/v1/ai/history/${id}`);
      if (owner !== account.current) return;
      setAnswer(r.text); setQuestion(r.prompt || r.fileName || "Saved work"); setPrompt(""); setMediaId(r.mediaId); setFileName(r.fileName); setReplyTo(r.requestId); if (r.mode && tabs.some(t => t.mode === r.mode)) setMode(r.mode); key.current = randomUUID();
    } catch (e) { if (owner === account.current) setError(e instanceof Error ? e.message : "Could not reopen this work."); }
    finally { if (owner === account.current) { action.current = false; setBusy(false); } }
  }
  async function remove(id: string) {
    if (action.current) return;
    const owner = account.current; action.current = true; setBusy(true);
    try {
      await api(`/v1/ai/history/${id}`, { method: "DELETE" });
      if (owner !== account.current) return;
      setHistory(s => s.filter(x => x.id !== id)); if (replyTo === id) reset(); setDeleting(undefined); toast("Saved answer deleted", "success");
    } catch (e) { if (owner === account.current) setError(e instanceof Error ? e.message : "Deletion failed. Your saved answer is still available."); }
    finally { if (owner === account.current) { action.current = false; setBusy(false); } }
  }
  return (
    <ToolPage title="Study space">
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 16 }}>
        {tabs.map(t => <Pressable key={t.mode} accessibilityRole="tab" accessibilityState={{ selected: mode === t.mode, disabled: busy }} disabled={busy} onPress={() => { setMode(t.mode); key.current = randomUUID(); setError(""); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: mode === t.mode ? theme.sand : theme.surface }}><Text style={{ ...textStyle, fontFamily: theme.font.medium, textAlign: "center", fontSize: 12 }}>{t.label}</Text></Pressable>)}
      </View>
      {!loaded ? <Text style={mutedStyle}>Restoring your draft…</Text> : null}
      {status ? <View style={{ marginBottom: 16 }}><Text style={mutedStyle}>{status.allowance.unlimited ? "Unlimited personal AI usage · no daily account cap" : `${status.allowance.remaining} of ${status.allowance.limit} AI attempts left · resets at ${new Date(status.allowance.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</Text>{!status.enabled ? <Text style={textStyle}>AI tools are paused. Saved work is still available.</Text> : !status.providers.study.configured ? <Text style={textStyle}>Gemini needs setup: {status.providers.study.missing.join(", ")}.</Text> : !status.allowance.globalAvailable ? <Text style={textStyle}>The shared AI allowance has been reached for today.</Text> : null}</View> : null}
      {statusError ? <><Text style={mutedStyle}>{statusError}</Text><ToolButton secondary label="Refresh availability" disabled={busy} onPress={() => void loadStatus()} /></> : null}
      {answer ? <View style={{ borderLeftWidth: 3, borderColor: theme.peach, paddingLeft: 16, marginVertical: 18 }}><Text style={{ ...mutedStyle, marginBottom: 10 }}>{question}</Text><Text selectable style={{ ...textStyle, fontSize: 15, lineHeight: 25 }}>{answer}</Text><ToolButton secondary label="Start new study" disabled={busy} onPress={() => reset()} /></View> : <Text style={{ color: theme.text, fontFamily: theme.font.display, fontSize: 24, marginVertical: 24 }}>What are we learning?</Text>}
      <ToolField label={replyTo ? "Follow-up or instructions" : mode === "study" ? "Your question" : "Study material or instructions"} value={prompt} maxLength={20000} multiline editable={loaded && !busy} placeholder="Ask about a topic, paste notes or attach a source…" onChangeText={v => { setPrompt(v); key.current = randomUUID(); setError(""); }} />
      <ToolButton secondary label={mediaId ? "Replace attachment" : "Attach PDF or image"} disabled={!loaded || busy} onPress={() => void attach()} />
      {mediaId ? <><Text style={mutedStyle}>{fileName || "Source attached"} · maximum 8 MB for AI</Text><ToolButton secondary label="Remove attachment" disabled={busy} onPress={() => { setMediaId(undefined); setFileName(undefined); key.current = randomUUID(); }} /></> : null}
      <Text style={{ ...mutedStyle, marginVertical: 12 }}>Sending shares this question, attached source and relevant recent study context with Gemini. Answers are private to your account and available here for 90 days. Review AI answers; they can be wrong.</Text>
      <Text style={{ ...mutedStyle, marginBottom: 12 }}>{status?.allowance.unlimited ? "Your account has no personal daily AI cap. Shared service and Gemini/Hugging Face limits still apply. Requests remain recorded; checking an existing attempt does not submit it again." : "A new provider attempt uses one allowance, including failed attempts. Checking an existing attempt or reopening saved work does not."}</Text>
      {error ? <Text accessibilityRole="alert" selectable style={{ ...textStyle, marginBottom: 12 }}>{error}</Text> : null}
      <ToolButton label={busy ? "Working…" : error ? "Retry request" : mode === "quiz" ? "Create practice questions" : mode === "summary" ? "Summarise" : mode === "notes" ? "Create revision notes" : "Ask"} disabled={!loaded || busy || (!prompt.trim() && !mediaId)} onPress={() => void send()} />
      <View style={{ borderTopWidth: 1, borderColor: theme.border, marginTop: 32, paddingTop: 24 }}>
        <Text style={{ color: theme.text, fontFamily: theme.font.display, fontSize: 22, marginBottom: 16 }}>Saved work</Text>
        <ToolField label="Search saved work" value={search} maxLength={120} editable={!historyBusy} onChangeText={setSearch} placeholder="Find a topic, summary or quiz" />
        <ToolButton secondary label={historyBusy ? "Loading saved work…" : "Search / refresh"} disabled={historyBusy || busy} onPress={() => void loadHistory(search)} />
        {historyError ? <Text accessibilityRole="alert" style={mutedStyle}>{historyError}</Text> : !history.length && !historyBusy ? <Text style={mutedStyle}>No saved work yet. Your completed study answers will appear here.</Text> : null}
        {history.map(item => <View key={item.id} style={{ paddingVertical: 16, borderBottomWidth: 1, borderColor: theme.border }}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void open(item.id)}><Text style={textStyle}>{item.title}</Text><Text style={mutedStyle}>{item.mode} · {new Date(item.created_at).toLocaleDateString()}{item.source_name ? ` · ${item.source_name}` : ""}</Text></Pressable>{deleting === item.id ? <><Text style={mutedStyle}>Delete this saved answer? This cannot be undone. Other answers in the study thread are kept.</Text><ToolButton secondary label="Confirm delete" disabled={busy} onPress={() => void remove(item.id)} /><ToolButton secondary label="Cancel" disabled={busy} onPress={() => setDeleting(undefined)} /></> : <ToolButton secondary label="Delete saved answer" disabled={busy} onPress={() => setDeleting(item.id)} />}</View>)}
        {nextOffset !== null ? <ToolButton secondary label="Load older work" disabled={busy || historyBusy} onPress={() => void loadHistory(historyQuery, nextOffset)} /> : null}
      </View>
    </ToolPage>
  );
}
