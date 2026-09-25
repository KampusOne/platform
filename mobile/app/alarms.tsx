import { BrandSwitch } from "@/src/components/brand-switch";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Platform, Pressable, Text, View } from "react-native";
import {
  ToolPage,
  ToolButton,
  ToolField,
  ToolRow,
} from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { EmptyResult } from "@/src/components/product-ui";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { syncAlarms, type Alarm } from "@/src/lib/alarms";
function nextOccurrence(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number),
    date = new Date();
  date.setHours(h!, m!, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
export default function Alarms() {
  const { theme } = useAppearance();
  const toast = useToast();
  const [items, setItems] = useState<Alarm[]>([]);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([]);
  const [sound, setSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [snooze, setSnooze] = useState("5");
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoadError("");
    const r = await api<{ alarms: Alarm[] }>("/v1/learning/alarms");
    setItems(r.alarms);
    setReady(true);
    return r.alarms;
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load().catch((e) => {
        setLoadError(e instanceof Error ? e.message : "Alarms could not load.");
        setReady(true);
      });
    }, [load, toast]),
  );
  function edit(a: Alarm | null) {
    setEditing(a);
    setLabel(a?.label ?? "");
    setTime(a?.time ?? "08:00");
    setDays(a?.days ?? []);
    setSound(a?.sound !== "silent");
    setVibration(a?.vibration ?? true);
    setSnooze(String(a?.snooze_minutes ?? 5));
    setForm(true);
  }
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      await api(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const updated = await load();
      const scheduled = await syncAlarms(updated, true);
      setForm(false);
      toast(
        scheduled
          ? "Reminders updated"
          : Platform.OS === "web"
            ? "Saved. Device alerts are available in the installed Android and iOS app."
            : "Saved. Enable notifications in device settings.",
        "success",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save alarm", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Alarms">
      {Platform.OS === "web" ? <Text style={{color:theme.textMuted,fontSize:12,lineHeight:18,marginBottom:16}}>Browser reminders work while KampusOne is open. Use the Android or iOS app for reminders with the app closed.</Text> : null}
      {!ready ? <ScreenSkeleton variant="list" compact /> : null}
      {loadError ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {loadError}
          </Text>
          <ToolButton
            secondary
            label="Retry alarms"
            onPress={() =>
              void load().catch((e) =>
                setLoadError(
                  e instanceof Error ? e.message : "Alarms could not load.",
                ),
              )
            }
          />
        </>
      ) : null}
      <ToolButton
        label={form ? "Close" : "Add alarm"}
        onPress={() => (form ? setForm(false) : edit(null))}
      />
      {form ? (
        <View style={{ marginTop: 18 }}>
          <ToolField
            label="Label"
            value={label}
            maxLength={120}
            onChangeText={setLabel}
          />
          <ToolField
            label="Time (24-hour)"
            value={time}
            onChangeText={setTime}
          />
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 16 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <Pressable
                key={i}
                accessibilityRole="checkbox"
                accessibilityLabel={
                  [
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ][i]
                }
                accessibilityState={{ checked: days.includes(i) }}
                onPress={() =>
                  setDays((s) =>
                    s.includes(i) ? s.filter((v) => v !== i) : [...s, i],
                  )
                }
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: days.includes(i)
                    ? theme.deepBrand
                    : theme.surfaceMuted,
                }}
              >
                <Text
                  style={{
                    color: days.includes(i) ? "#fff" : theme.text,
                    fontFamily: theme.font.medium,
                  }}
                >
                  {d}
                </Text>
              </Pressable>
            ))}
          </View>
          {!days.length ? (
            <Text
              style={{
                color: theme.textMuted,
                fontFamily: theme.font.body,
                marginBottom: 16,
              }}
            >
              Once · next {time}
            </Text>
          ) : null}
          <ToolRow
            title="Sound"
            trailing={
              <BrandSwitch
                label="Alarm sound"
                value={sound}
                onValueChange={setSound}
              />
            }
          />
          <ToolRow
            title="Vibration"
            trailing={
              <BrandSwitch
                label="Alarm vibration"
                value={vibration}
                onValueChange={setVibration}
              />
            }
          />
          <ToolField
            label="Snooze minutes"
            value={snooze}
            onChangeText={setSnooze}
            keyboardType="number-pad"
          />
          <ToolButton
            label="Save alarm"
            disabled={busy || !label.trim()}
            onPress={() =>
              void mutate(
                "/v1/learning/alarms" + (editing ? "/" + editing.id : ""),
                editing ? "PUT" : "POST",
                {
                  label,
                  time,
                  days,
                  firesAt: days.length ? null : nextOccurrence(time),
                  enabled: editing?.enabled ?? true,
                  sound: sound ? "default" : "silent",
                  vibration,
                  snoozeMinutes: Number(snooze),
                },
              )
            }
          />
          {editing ? (
            <ToolButton
              secondary
              label="Delete alarm"
              disabled={busy}
              onPress={() =>
                void mutate("/v1/learning/alarms/" + editing.id, "DELETE")
              }
            />
          ) : null}
        </View>
      ) : null}
      {ready && !loadError && !items.length && !form ? (
        <EmptyResult title="No alarms yet" />
      ) : null}
      {items.map((a) => (
        <ToolRow
          key={a.id}
          title={a.time + " · " + a.label}
          detail={
            a.days.length
              ? a.days
                  .map(
                    (i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i],
                  )
                  .join(", ")
              : a.fires_at
                ? new Date(a.fires_at).toLocaleString()
                : "Once"
          }
          onPress={() => edit(a)}
          trailing={
            <BrandSwitch
              label={"Enable " + a.label}
              disabled={busy}
              value={a.enabled}
              onValueChange={(enabled) =>
                void mutate("/v1/learning/alarms/" + a.id, "PUT", {
                  label: a.label,
                  time: a.time,
                  days: a.days,
                  firesAt: a.days.length ? null : nextOccurrence(a.time),
                  enabled,
                  sound: a.sound,
                  vibration: a.vibration,
                  snoozeMinutes: a.snooze_minutes,
                })
              }
            />
          }
        />
      ))}
    </ToolPage>
  );
}
