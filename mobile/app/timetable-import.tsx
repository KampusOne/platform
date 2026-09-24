import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api, ApiError } from "@/src/lib/api";
import { pickAndUpload } from "@/src/lib/uploads";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { syncAlarms, type Alarm } from "@/src/lib/alarms";
type Entry = { title: string; courseCode: string; venue: string; lecturer: string; dayOfWeek: number; startsAt: string; endsAt: string; reminderMinutes: number; reminderEnabled: boolean };
type Draft = { entries: Entry[]; text: string; mediaId?: string; warnings?: string[]; key?: string };
export default function ImportTimetable() {
  const { user } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [mediaId, setMediaId] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const key = useRef(randomUUID());
  const locked = useRef(false);
  const account = useRef(user?.id); account.current = user?.id;
  const muted = { fontFamily: theme.font.body, color: theme.textMuted, fontSize: 12, lineHeight: 18 };
  useEffect(() => {
    let active = true;
    setLoaded(false); setEntries([]); setText(""); setMediaId(undefined); setWarnings([]); setError(""); setBusy(false); locked.current = false; key.current = randomUUID();
    if (!user?.id) return;
    void readCache<Draft>("timetable-draft." + user.id).then(d => {
      if (!active) return;
      if (d) { setEntries(d.entries ?? []); setText(d.text ?? ""); setMediaId(d.mediaId); setWarnings(d.warnings ?? []); key.current = d.key || randomUUID(); }
    }).catch(() => undefined).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!loaded || !user?.id) return;
    const timer = setTimeout(() => { void writeCache("timetable-draft." + user.id, { entries, text, mediaId, warnings, key: key.current }).catch(() => undefined); }, 250);
    return () => clearTimeout(timer);
  }, [entries, text, mediaId, warnings, error, loaded, user?.id]);
  async function attach() {
    if (locked.current) return;
    const owner = account.current; locked.current = true; setBusy(true); setError("");
    try { const file = await pickAndUpload("resource"); if (file && owner === account.current) { setMediaId(file.id); key.current = randomUUID(); } }
    catch (e) { if (owner === account.current) setError(e instanceof Error ? e.message : "Upload failed. Your text and reviewed classes are kept."); }
    finally { if (owner === account.current) { locked.current = false; setBusy(false); } }
  }
  async function scan() {
    if (locked.current) return;
    const owner = account.current; locked.current = true; setBusy(true); setError("");
    try {
      await writeCache("timetable-draft." + owner, { entries, text, mediaId, warnings, key: key.current }).catch(() => undefined);
      const r = await api<{ entries: Entry[]; warnings?: string[]; provider?: string }>("/v1/ai", { method: "POST", signal: AbortSignal.timeout(45000), body: JSON.stringify({ mode: "timetable", prompt: text, mediaId, idempotencyKey: key.current, consent: true }) });
      if (owner !== account.current) return;
      setEntries(r.entries); setWarnings(r.warnings ?? []); setProvider(r.provider ?? "");
      toast(r.entries.length ? "Review every class before saving" : "No readable classes found. You can add them manually.");
    } catch (e) {
      if (owner !== account.current) return;
      if (e instanceof ApiError && e.details?.retryWithNewKey === true) key.current = randomUUID();
      setError(e instanceof Error ? e.message : "Could not read timetable. Retry to check the same attempt.");
    } finally { if (owner === account.current) { locked.current = false; setBusy(false); } }
  }
  function validationError() {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const [i, e] of entries.entries()) {
      if (!e.title.trim() || e.title.length > 160 || (e.courseCode?.length ?? 0) > 24 || (e.venue?.length ?? 0) > 160 || (e.lecturer?.length ?? 0) > 120 || !Number.isInteger(e.dayOfWeek) || e.dayOfWeek < 0 || e.dayOfWeek > 6 || !time.test(e.startsAt) || !time.test(e.endsAt) || e.endsAt <= e.startsAt) return `Check class ${i + 1}: add a title, a valid day and an end time after its start time.`;
    }
    return "";
  }
  async function save() {
    if (locked.current || !entries.length) return;
    const invalid = validationError(); if (invalid) { setError(invalid); return; }
    const owner = account.current; locked.current = true; setBusy(true); setError("");
    try {
      await api("/v1/learning/timetable/import", { method: "POST", body: JSON.stringify({ entries }) });
      if (owner !== account.current) return;
      // Do not let a delayed autosave restore already-imported classes.
      setLoaded(false); setEntries([]); setText(""); setMediaId(undefined); setWarnings([]);
      await writeCache("timetable-draft." + owner, { entries: [], text: "", key: randomUUID() }).catch(() => undefined);
      try { const alarms = await api<{ alarms: Alarm[] }>("/v1/learning/alarms"); await syncAlarms(alarms.alarms, true); }
      catch { if (owner === account.current) toast("Timetable saved. Check device reminders in Alarms."); }
      if (owner === account.current) { toast("Timetable and course drafts saved", "success"); router.replace("/timetable"); }
    } catch (e) { if (owner === account.current) setError(e instanceof Error ? e.message : "Could not save timetable. Your reviewed classes are kept."); }
    finally { if (owner === account.current) { locked.current = false; setBusy(false); } }
  }
  function edit(index: number, field: keyof Entry, value: string) {
    setEntries(s => s.map((e, i) => i === index ? { ...e, [field]: field === "dayOfWeek" ? Number(value) : value } : e)); setError("");
  }
  return <ToolPage title="Import timetable">
    {!loaded ? <Text style={muted}>Restoring your timetable draft…</Text> : null}
    <ToolField label="Timetable text" multiline value={text} maxLength={20000} editable={loaded && !busy} onChangeText={v => { setText(v); key.current = randomUUID(); setError(""); }} placeholder="Paste your class schedule" />
    <ToolButton secondary label={mediaId ? "Replace timetable file" : "Choose photo or PDF"} disabled={!loaded || busy} onPress={() => void attach()} />
    {mediaId ? <><Text style={muted}>File attached · maximum 8 MB for AI</Text><ToolButton secondary label="Remove timetable file" disabled={busy} onPress={() => { setMediaId(undefined); key.current = randomUUID(); }} /></> : null}
    <Text style={{ ...muted, marginVertical: 12 }}>Photos and pasted text are sent to Hugging Face. PDF files are sent to Gemini. One new extraction attempt uses one AI allowance, including provider failures. Retrying the same processing request does not use another allowance.</Text>
    <Text style={{ ...muted, marginBottom: 12 }}>Nothing is added until you review, correct and save the class list. Unreadable times are not guessed.</Text>
    {error ? <Text accessibilityRole="alert" selectable style={{ ...muted, color: theme.text, marginVertical: 12 }}>{error}</Text> : null}
    <ToolButton label={busy ? "Working…" : error ? "Retry extraction" : "Read timetable"} disabled={!loaded || busy || (!mediaId && !text.trim())} onPress={() => void scan()} />
    {provider ? <Text style={muted}>Extracted with {provider === "huggingface" ? "Hugging Face" : "Gemini"}. Check the result against your original timetable.</Text> : null}
    {warnings.map((warning, i) => <Text key={i} style={{ ...muted, marginTop: 8 }}>{warning}</Text>)}
    <ToolButton secondary label="Add a class manually" disabled={!loaded || busy || entries.length >= 40} onPress={() => setEntries(s => [...s, { title: "", courseCode: "", venue: "", lecturer: "", dayOfWeek: 1, startsAt: "08:00", endsAt: "09:00", reminderMinutes: 15, reminderEnabled: true }])} />
    {entries.map((e, i) => <View key={i} style={{ paddingVertical: 22, borderBottomWidth: 1, borderColor: theme.border }}>
      <Text style={{ fontFamily: theme.font.display, color: theme.text, fontSize: 20, marginBottom: 18 }}>Class {i + 1}</Text>
      {([["title", "Course title"], ["courseCode", "Course code"], ["venue", "Venue"], ["lecturer", "Lecturer"], ["dayOfWeek", "Day · Sun 0, Mon 1 … Sat 6"], ["startsAt", "Starts (24-hour HH:MM)"], ["endsAt", "Ends (24-hour HH:MM)"]] as const).map(([field, label]) => <ToolField key={field} label={label} editable={!busy} value={String(e[field] ?? "")} onChangeText={v => edit(i, field, v)} />)}
      <ToolButton secondary label="Remove class" disabled={busy} onPress={() => setEntries(s => s.filter((_, n) => n !== i))} />
    </View>)}
    {entries.length ? <ToolButton label="Save reviewed timetable & reminders" disabled={busy} onPress={() => void save()} /> : null}
  </ToolPage>;
}
