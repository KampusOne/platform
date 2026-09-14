import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { syncAlarms, type Alarm } from "@/src/lib/alarms";
type Entry = {
  id: string;
  title: string;
  course_code: string;
  venue: string;
  lecturer: string;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  reminder_minutes: number;
  reminder_enabled: boolean;
};
export default function EditTimetable() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ entries: Entry[] }>("/v1/student/timetable")
      .then((r) => setEntry(r.entries.find((e) => e.id === id) ?? null))
      .catch((e) => toast(e.message, "error"));
  }, [id, toast]);
  async function save() {
    if (!entry) return;
    setBusy(true);
    try {
      await api("/v1/learning/timetable/" + id, {
        method: "PUT",
        body: JSON.stringify({
          title: entry.title,
          courseCode: entry.course_code ?? "",
          venue: entry.venue ?? "",
          lecturer: entry.lecturer ?? "",
          dayOfWeek: Number(entry.day_of_week),
          startsAt: entry.starts_at,
          endsAt: entry.ends_at,
          reminderMinutes: entry.reminder_minutes,
          reminderEnabled: entry.reminder_enabled,
        }),
      });
      try {
        await syncAlarms(
          (await api<{ alarms: Alarm[] }>("/v1/learning/alarms")).alarms,
        );
      } catch {
        /* The timetable remains saved if OS scheduling is unavailable. */
      }
      toast("Class updated", "success");
      router.back();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save class", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Edit class">
      {entry
        ? (
            [
              ["title", "Title"],
              ["course_code", "Course code"],
              ["venue", "Venue"],
              ["lecturer", "Lecturer"],
              ["day_of_week", "Day · Sun 0, Mon 1 … Sat 6"],
              ["starts_at", "Starts"],
              ["ends_at", "Ends"],
            ] as const
          ).map(([key, label]) => (
            <ToolField
              key={key}
              label={label}
              value={String(entry[key] ?? "")}
              onChangeText={(v) =>
                setEntry((e) =>
                  e
                    ? { ...e, [key]: key === "day_of_week" ? Number(v) : v }
                    : e,
                )
              }
            />
          ))
        : null}
      <ToolButton
        label="Save class"
        disabled={busy || !entry}
        onPress={() => void save()}
      />
    </ToolPage>
  );
}
