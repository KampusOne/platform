import { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickAndUpload, type UploadedFile } from "@/src/lib/uploads";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { syncAlarms, type Alarm } from "@/src/lib/alarms";
type Entry = {
  title: string;
  courseCode: string;
  venue: string;
  lecturer: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  reminderMinutes: number;
  reminderEnabled: boolean;
};
export default function ImportTimetable() {
  const { user } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void readCache<{ entries: Entry[]; text: string }>(
      "timetable-draft." + user?.id,
    ).then((d) => {
      if (d) {
        setEntries(d.entries);
        setText(d.text);
      }
      setLoaded(true);
    });
  }, [user?.id]);
  useEffect(() => {
    if (loaded)
      void writeCache("timetable-draft." + user?.id, { entries, text });
  }, [entries, text, loaded, user?.id]);
  async function attach() {
    setBusy(true);
    try {
      const f = await pickAndUpload("resource");
      if (f) setFile(f);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function scan() {
    setBusy(true);
    try {
      const r = await api<{ entries: Entry[] }>("/v1/ai", {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          mode: "timetable",
          prompt: text,
          mediaId: file?.id,
          idempotencyKey: randomUUID(),
          consent: true,
        }),
      });
      setEntries(r.entries);
      toast(
        r.entries.length
          ? "Review your classes before saving"
          : "No readable classes found",
      );
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not read timetable",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api("/v1/learning/timetable/import", {
        method: "POST",
        body: JSON.stringify({ entries }),
      });
      await writeCache("timetable-draft." + user?.id, {
        entries: [],
        text: "",
      });
      try {
        const a = await api<{ alarms: Alarm[] }>("/v1/learning/alarms");
        await syncAlarms(a.alarms, true);
      } catch {
        toast("Timetable saved. Check device reminders in Alarms.");
      }
      toast("Timetable and course drafts saved", "success");
      router.replace("/timetable");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not save timetable",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  function edit(index: number, key: keyof Entry, value: string) {
    setEntries((s) =>
      s.map((e, i) =>
        i === index
          ? { ...e, [key]: key === "dayOfWeek" ? Number(value) : value }
          : e,
      ),
    );
  }
  return (
    <ToolPage title="Import timetable">
      <ToolField
        label="Timetable text"
        multiline
        value={text}
        editable={!busy}
        onChangeText={setText}
        placeholder="Paste your class schedule"
      />
      <ToolButton
        secondary
        label={file ? "Replace timetable file" : "Choose photo or PDF"}
        disabled={busy}
        onPress={() => void attach()}
      />
      <Text
        style={{
          color: theme.textMuted,
          fontSize: 12,
          lineHeight: 18,
          marginVertical: 10,
        }}
      >
        Scanning sends your selected content to the AI provider. Nothing is
        added until you review and save.
      </Text>
      <ToolButton
        label={busy ? "Working…" : "Read timetable"}
        disabled={busy || (!file && !text.trim())}
        onPress={() => void scan()}
      />
      <ToolButton
        secondary
        label="Add a class manually"
        disabled={busy || entries.length >= 40}
        onPress={() =>
          setEntries((s) => [
            ...s,
            {
              title: "",
              courseCode: "",
              venue: "",
              lecturer: "",
              dayOfWeek: 1,
              startsAt: "08:00",
              endsAt: "09:00",
              reminderMinutes: 15,
              reminderEnabled: true,
            },
          ])
        }
      />
      {entries.map((e, i) => (
        <View
          key={i}
          style={{
            paddingVertical: 22,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text
            style={{
              fontFamily: theme.font.display,
              color: theme.text,
              fontSize: 20,
              marginBottom: 18,
            }}
          >
            Class {i + 1}
          </Text>
          {(
            [
              ["title", "Course title"],
              ["courseCode", "Course code"],
              ["venue", "Venue"],
              ["dayOfWeek", "Day · Sun 0, Mon 1 … Sat 6"],
              ["startsAt", "Starts (24-hour)"],
              ["endsAt", "Ends (24-hour)"],
            ] as const
          ).map(([key, label]) => (
            <ToolField
              key={key}
              label={label}
              editable={!busy}
              value={String(e[key] ?? "")}
              onChangeText={(v) => edit(i, key, v)}
            />
          ))}
          <ToolButton
            secondary
            label="Remove class"
            disabled={busy}
            onPress={() => setEntries((s) => s.filter((_, n) => n !== i))}
          />
        </View>
      ))}
      {entries.length ? (
        <ToolButton
          label="Save timetable & reminders"
          disabled={busy}
          onPress={() => void save()}
        />
      ) : null}
    </ToolPage>
  );
}
