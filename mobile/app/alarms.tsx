import { alarmCategories, alarmCategory, type AlarmCategory } from "@/src/lib/alarm-groups";
import { AlarmSourceDialog, ClearAlarmsDialog } from "@/src/components/alarm-source-dialogs";
import { AcademicAlarmFields } from "@/src/components/academic-alarm-fields";
import * as Crypto from "expo-crypto";
import { BulkMenu, BulkToolbar, SelectionCheckbox, useBulkSelection } from "@/src/components/bulk-selection";
import { BrandSwitch } from "@/src/components/brand-switch";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { normalizeAlarms, syncAlarms, type Alarm } from "@/src/lib/alarms";
import { useAppearance, type Theme } from "@/src/lib/appearance";
import { selectionAsync } from "@/src/lib/haptics";
import { pickAndUpload } from "@/src/lib/uploads";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type AlarmSoundOption = { id: string; name: string; url: string };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function currentCampusDay(now = new Date()) {
  // Campus schedules use Africa/Lagos (UTC+1), so the default weekday should
  // match the day the alarm scheduler will use even if the device zone differs.
  return new Date(now.getTime() + 60 * 60 * 1000).getUTCDay();
}

function nextOccurrence(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(h!, m!, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function nextCampusOccurrenceOnDay(
  time: string,
  day: number,
  now = new Date(),
) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  const campusNow = new Date(now.getTime() + 60 * 60 * 1000);
  let offset = (day - campusNow.getUTCDay() + 7) % 7;
  let timestamp = Date.UTC(
    campusNow.getUTCFullYear(),
    campusNow.getUTCMonth(),
    campusNow.getUTCDate() + offset,
    hour! - 1,
    minute!,
    0,
    0,
  );
  if (timestamp <= now.getTime()) {
    offset += 7;
    timestamp = Date.UTC(
      campusNow.getUTCFullYear(),
      campusNow.getUTCMonth(),
      campusNow.getUTCDate() + offset,
      hour! - 1,
      minute!,
      0,
      0,
    );
  }
  return new Date(timestamp).toISOString();
}

function getAlarmDate(alarm: Alarm, now = new Date()) {
  if (!alarm.enabled) return null;
  if (alarm.days.length) {
    const [hour, minute] = alarm.time.split(":").map(Number);
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      candidate.setHours(hour!, minute!, 0, 0);
      if (
        alarm.days.includes(candidate.getDay()) &&
        candidate.getTime() > now.getTime()
      ) {
        return candidate;
      }
    }
  }
  if (alarm.fires_at) {
    const date = new Date(alarm.fires_at);
    if (!Number.isNaN(date.getTime()) && date.getTime() > now.getTime()) {
      return date;
    }
  }
  const fallback = nextOccurrence(alarm.time);
  return fallback ? new Date(fallback) : null;
}

function durationLabel(date: Date | null, now: Date) {
  if (!date) return "No alarm set";
  const minutes = Math.max(
    1,
    Math.ceil((date.getTime() - now.getTime()) / 60_000),
  );
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  if (days) {
    return `Alarm in ${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} ${hours === 1 ? "hour" : "hours"}` : ""}`;
  }
  if (hours) {
    return `Alarm in ${hours} ${hours === 1 ? "hour" : "hours"}${mins ? ` ${mins} ${mins === 1 ? "minute" : "minutes"}` : ""}`;
  }
  return `Alarm in ${mins} ${mins === 1 ? "minute" : "minutes"}`;
}

function repeatLabel(days: number[]) {
  if (!days.length) return "Once";
  if (days.length === 7) return "Daily";
  if ([1, 2, 3, 4, 5].every((day) => days.includes(day)) && days.length === 5)
    return "Weekdays";
  if ([0, 6].every((day) => days.includes(day)) && days.length === 2)
    return "Weekends";
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((day) => DAY_NAMES[day])
    .join(", ");
}

function displayTime(time: string): { clock: string; period: "AM" | "PM" } {
  const [hour, minute] = time.split(":").map(Number);
  const period: "AM" | "PM" = hour! >= 12 ? "PM" : "AM";
  const hour12 = hour! % 12 || 12;
  return {
    clock: `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    period,
  };
}


const WHEEL_ITEM_HEIGHT = 52;
const WHEEL_VISIBLE_ITEMS = 5;
const WHEEL_CYCLES = 9;

function WheelColumn({
  value,
  min,
  max,
  pad = false,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  pad?: boolean;
  label: string;
  onChange: (value: number) => void;
}) {
  const { theme, isDark } = useAppearance();
  const pickerStyles = useMemo(
    () => createPickerStyles(theme, isDark),
    [theme, isDark],
  );
  const count = max - min + 1;
  const values = useMemo(
    () =>
      Array.from(
        { length: count * WHEEL_CYCLES },
        (_, index) => min + (index % count),
      ),
    [count, min],
  );
  const middleCycle = Math.floor(WHEEL_CYCLES / 2);
  const initialIndex = useRef(middleCycle * count + (value - min)).current;
  const scrollRef = useRef<ScrollView>(null);
  const lastIndexRef = useRef(initialIndex);
  const lastValueRef = useRef(value);
  const didMountRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useEffect(() => {
    lastValueRef.current = value;
    if (!didMountRef.current) {
      didMountRef.current = true;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: initialIndex * WHEEL_ITEM_HEIGHT,
          animated: false,
        });
      });
      return;
    }
    const currentValue = values[selectedIndex];
    if (currentValue === value) return;
    const targetIndex = middleCycle * count + (value - min);
    lastIndexRef.current = targetIndex;
    setSelectedIndex(targetIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: targetIndex * WHEEL_ITEM_HEIGHT,
        animated: false,
      });
    });
  }, [count, middleCycle, min, selectedIndex, value, values]);

  const selectIndex = useCallback(
    (rawIndex: number) => {
      const index = Math.max(0, Math.min(values.length - 1, rawIndex));
      if (index === lastIndexRef.current) return;
      lastIndexRef.current = index;
      setSelectedIndex(index);
      const nextValue = values[index]!;
      if (nextValue !== lastValueRef.current) {
        lastValueRef.current = nextValue;
        void selectionAsync();
        onChange(nextValue);
      }
    },
    [onChange, values],
  );

  const settleAtOffset = useCallback(
    (offsetY: number) => {
      const index = Math.max(
        0,
        Math.min(values.length - 1, Math.round(offsetY / WHEEL_ITEM_HEIGHT)),
      );
      const targetY = index * WHEEL_ITEM_HEIGHT;
      selectIndex(index);
      if (Math.abs(offsetY - targetY) > 0.5) {
        scrollRef.current?.scrollTo({ y: targetY, animated: false });
      }
    },
    [selectIndex, values.length],
  );

  return (
    <View style={pickerStyles.column} accessibilityLabel={label + " time wheel"}>
      <Text style={pickerStyles.columnLabel}>{label}</Text>
      <ScrollView
        ref={scrollRef}
        style={pickerStyles.wheelViewport}
        contentContainerStyle={pickerStyles.wheelContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        nestedScrollEnabled
        bounces={false}
        contentOffset={{ x: 0, y: initialIndex * WHEEL_ITEM_HEIGHT }}
        scrollEventThrottle={16}
        onLayout={() => {
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              y: selectedIndex * WHEEL_ITEM_HEIGHT,
              animated: false,
            });
          });
        }}
        onScroll={(event) => {
          const index = Math.round(
            event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT,
          );
          selectIndex(index);
        }}
        onScrollEndDrag={(event) => {
          const velocityY = event.nativeEvent.velocity?.y ?? 0;
          if (Math.abs(velocityY) < 0.01) {
            settleAtOffset(event.nativeEvent.contentOffset.y);
          }
        }}
        onMomentumScrollEnd={(event) => {
          settleAtOffset(event.nativeEvent.contentOffset.y);
        }}
      >
        {values.map((item, index) => {
          const distance = Math.abs(index - selectedIndex);
          return (
            <Pressable
              key={label + "-" + index}
              accessibilityRole="button"
              accessibilityLabel={"Set " + label + " to " + item}
              accessibilityState={{ selected: index === selectedIndex }}
              onPress={() => {
                scrollRef.current?.scrollTo({
                  y: index * WHEEL_ITEM_HEIGHT,
                  animated: true,
                });
                selectIndex(index);
              }}
              style={pickerStyles.numberRow}
            >
              <Text
                style={[
                  pickerStyles.number,
                  distance === 0 && pickerStyles.numberSelected,
                  distance === 1 && pickerStyles.numberNear,
                  distance >= 2 && pickerStyles.numberFaint,
                ]}
              >
                {pad ? String(item).padStart(2, "0") : item}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PeriodColumn({
  value,
  onChange,
}: {
  value: "AM" | "PM";
  onChange: (value: "AM" | "PM") => void;
}) {
  const { theme, isDark } = useAppearance();
  const pickerStyles = useMemo(
    () => createPickerStyles(theme, isDark),
    [theme, isDark],
  );
  const values = useMemo(() => ["AM", "PM"] as const, []);
  const initialIndex = useRef(value === "PM" ? 1 : 0).current;
  const scrollRef = useRef<ScrollView>(null);
  const lastIndexRef = useRef(initialIndex);
  const lastValueRef = useRef(value);
  const didMountRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useEffect(() => {
    lastValueRef.current = value;
    if (!didMountRef.current) {
      didMountRef.current = true;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: initialIndex * WHEEL_ITEM_HEIGHT,
          animated: false,
        });
      });
      return;
    }
    const targetIndex = value === "PM" ? 1 : 0;
    if (targetIndex === selectedIndex) return;
    lastIndexRef.current = targetIndex;
    setSelectedIndex(targetIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: targetIndex * WHEEL_ITEM_HEIGHT,
        animated: false,
      });
    });
  }, [initialIndex, selectedIndex, value]);

  const selectIndex = useCallback(
    (rawIndex: number) => {
      const index = Math.max(0, Math.min(1, rawIndex));
      if (index === lastIndexRef.current) return;
      lastIndexRef.current = index;
      setSelectedIndex(index);
      const nextValue = values[index]!;
      if (nextValue !== lastValueRef.current) {
        lastValueRef.current = nextValue;
        void selectionAsync();
        onChange(nextValue);
      }
    },
    [onChange, values],
  );

  const settleAtOffset = useCallback(
    (offsetY: number) => {
      const index = Math.max(
        0,
        Math.min(values.length - 1, Math.round(offsetY / WHEEL_ITEM_HEIGHT)),
      );
      const targetY = index * WHEEL_ITEM_HEIGHT;
      selectIndex(index);
      if (Math.abs(offsetY - targetY) > 0.5) {
        scrollRef.current?.scrollTo({ y: targetY, animated: false });
      }
    },
    [selectIndex, values.length],
  );

  return (
    <View style={pickerStyles.periodColumn} accessibilityLabel="AM PM time wheel">
      <Text style={pickerStyles.columnLabel}>AM / PM</Text>
      <ScrollView
        ref={scrollRef}
        style={pickerStyles.periodWheelViewport}
        contentContainerStyle={pickerStyles.periodWheelContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        nestedScrollEnabled
        bounces={false}
        contentOffset={{ x: 0, y: initialIndex * WHEEL_ITEM_HEIGHT }}
        scrollEventThrottle={16}
        onLayout={() => {
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              y: selectedIndex * WHEEL_ITEM_HEIGHT,
              animated: false,
            });
          });
        }}
        onScroll={(event) => {
          const index = Math.round(
            event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT,
          );
          selectIndex(index);
        }}
        onScrollEndDrag={(event) => {
          const velocityY = event.nativeEvent.velocity?.y ?? 0;
          if (Math.abs(velocityY) < 0.01) {
            settleAtOffset(event.nativeEvent.contentOffset.y);
          }
        }}
        onMomentumScrollEnd={(event) => {
          settleAtOffset(event.nativeEvent.contentOffset.y);
        }}
      >
        {values.map((period, index) => {
          const selected = index === selectedIndex;
          return (
            <Pressable
              key={period}
              accessibilityRole="button"
              accessibilityLabel={"Set time period to " + period}
              accessibilityState={{ selected }}
              onPress={() => {
                scrollRef.current?.scrollTo({
                  y: index * WHEEL_ITEM_HEIGHT,
                  animated: true,
                });
                selectIndex(index);
              }}
              style={pickerStyles.numberRow}
            >
              <Text
                style={[
                  pickerStyles.periodText,
                  selected && pickerStyles.periodTextSelected,
                ]}
              >
                {period}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createPickerStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    column: { width: 92, alignItems: "center" },
    columnLabel: {
      color: isDark ? "rgba(255,255,255,0.62)" : theme.textMuted,
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
      marginBottom: 8,
    },
    wheelViewport: {
      height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS,
      width: "100%",
      overflow: "hidden",
    },
    wheelContent: {
      paddingVertical:
        (WHEEL_ITEM_HEIGHT * (WHEEL_VISIBLE_ITEMS - 1)) / 2,
    },
    numberRow: {
      height: WHEEL_ITEM_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
    },
    number: {
      color: isDark ? "rgba(255,255,255,0.18)" : "rgba(41,35,31,0.18)",
      fontFamily: "Lato_900Black",
      fontSize: 31,
      lineHeight: 38,
    },
    numberNear: {
      color: isDark ? "rgba(255,255,255,0.38)" : "rgba(41,35,31,0.42)",
      fontSize: 34,
    },
    numberSelected: {
      color: theme.text,
      fontSize: 44,
      lineHeight: 48,
    },
    numberFaint: {
      color: isDark ? "rgba(255,255,255,0.16)" : "rgba(41,35,31,0.13)",
    },
    periodColumn: {
      width: 92,
      alignItems: "center",
      justifyContent: "center",

    },
    periodWheelViewport: {
      height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS,
      width: "100%",
      overflow: "hidden",
    },
    periodWheelContent: {
      paddingVertical: (WHEEL_ITEM_HEIGHT * (WHEEL_VISIBLE_ITEMS - 1)) / 2,
    },
    periodText: {
      color: isDark ? "rgba(255,255,255,0.34)" : "rgba(41,35,31,0.38)",
      fontFamily: "Lato_900Black",
      fontSize: 29,
      lineHeight: 36,
    },
    periodTextSelected: {
      color: theme.text,
      fontSize: 36,
      lineHeight: 44,
    },
  });

export default function Alarms() {
  const { theme, isDark } = useAppearance();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const toast = useToast();
  const [expanded, setExpanded] = useState<AlarmCategory[]>(["REGULAR"]);
  const [clearGroup,setClearGroup] = useState<AlarmCategory|"ALL"|null>(null);
  const [clearError,setClearError] = useState("");
  const [importOpen,setImportOpen] = useState(false);
  const [assessment,setAssessment] = useState(false);
  const [assessmentKind,setAssessmentKind] = useState<"TEST"|"EXAM">("TEST");
  const [assessmentDate,setAssessmentDate] = useState("");
  const [assessmentEnd,setAssessmentEnd] = useState("10:00");
  const [assessmentRequest,setAssessmentRequest] = useState("");
  const [items, setItems] = useState<Alarm[]>([]);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([]);
  const [sound, setSound] = useState<Alarm["sound"]>("default");
  const [sounds, setSounds] = useState<AlarmSoundOption[]>([]);
  const [soundOpen, setSoundOpen] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [vibration, setVibration] = useState(true);
  const [snooze, setSnooze] = useState("5");
  const [form, setForm] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [oneTimeDay, setOneTimeDay] = useState(() => currentCampusDay());
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    const response = await api<{ alarms: Alarm[] }>("/v1/learning/alarms");
    const safeAlarms = normalizeAlarms(response?.alarms);
    setItems(safeAlarms);
    try {
      const soundResponse = await api<{ sounds: AlarmSoundOption[] }>("/v1/learning/alarm-sounds");
      setSounds(Array.isArray(soundResponse?.sounds) ? soundResponse.sounds.filter((item) => Boolean(item && typeof item.id === "string" && typeof item.name === "string")) : []);
    } catch {
      setSounds([]);
    }
    setReady(true);
    return safeAlarms;
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load().catch((error) => {
        setLoadError(
          error instanceof Error ? error.message : "Alarms could not load.",
        );
        setReady(true);
      });
    }, [load]),
  );

  const selection = useBulkSelection(items.map(alarm=>alarm.id), async ids=> {
    await api("/v1/learning/alarms/bulk-delete",{method:"POST",body:JSON.stringify({ids})});
    const next=await load();
    await syncAlarms(next);
  }, "alarms");
  const nextAlarm = useMemo(() => {
    return items
      .map((alarm) => ({ alarm, date: getAlarmDate(alarm, now) }))
      .filter(
        (entry): entry is { alarm: Alarm; date: Date } => Boolean(entry.date),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  }, [items, now]);

  const timeParts = displayTime(time);
  const hour24 = Number(time.split(":")[0] || 0);
  const minute = Number(time.split(":")[1] || 0);
  const hour12 = hour24 % 12 || 12;

  function setTimeFromParts(
    nextHour12: number,
    nextMinute: number,
    period: "AM" | "PM",
  ) {
    let nextHour = nextHour12 % 12;
    if (period === "PM") nextHour += 12;
    setTime(
      `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`,
    );
  }

  function edit(alarm: Alarm | null) {
    const repeating = Boolean(alarm?.days.length);
    const initialDays = repeating ? alarm!.days : [];
    const oneOffDate = alarm?.fires_at ? new Date(alarm.fires_at) : null;
    setAssessment(false);
    setAssessmentRequest(Crypto.randomUUID());
    setAssessmentDate(new Date(Date.now()+86400000+3600000).toISOString().slice(0,10));
    setAssessmentEnd("10:00");
    setEditing(alarm);
    setLabel(alarm?.label ?? "");
    setTime(alarm?.time ?? "08:00");
    setRepeat(repeating);
    setDays(initialDays);
    setOneTimeDay(
      oneOffDate && !Number.isNaN(oneOffDate.getTime())
        ? new Date(oneOffDate.getTime() + 60 * 60 * 1000).getUTCDay()
        : currentCampusDay(),
    );
    setSound(alarm?.sound ?? "default");
    setSoundOpen(false);
    setVibration(alarm?.vibration ?? true);
    setSnooze(String(alarm?.snooze_minutes ?? 5));
    setForm(true);
  }

  async function mutate(
    path: string,
    method: string,
    body?: unknown,
    closeForm = true,
  ) {
    setBusy(true);
    try {
      await api(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const updated = await load();
      const scheduled = await syncAlarms(updated, true);
      if (closeForm) setForm(false);
      toast(
        scheduled
          ? "Reminders updated"
          : Platform.OS === "web"
            ? "Saved. Device alerts are available in the installed Android and iOS app."
            : "Saved. Enable notifications and Alarms & reminders in device settings.",
        "success",
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not save alarm",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  function selectedSoundLabel() {
    if (sound === "default") return "Device default alarm";
    if (sound === "silent") return "Silent";
    const id = sound.slice(6);
    return sounds.find((item) => item.id === id)?.name ?? editing?.sound_name ?? "Uploaded sound";
  }

  async function uploadAlarmSound() {
    setSoundBusy(true);
    try {
      const uploaded = await pickAndUpload("notification-sound");
      if (!uploaded) return;
      const soundResponse = await api<{ sounds: AlarmSoundOption[] }>("/v1/learning/alarm-sounds");
      setSounds(Array.isArray(soundResponse?.sounds) ? soundResponse.sounds.filter((item) => Boolean(item && typeof item.id === "string" && typeof item.name === "string")) : []);
      setSound(`media:${uploaded.id}` as Alarm["sound"]);
      setSoundOpen(true);
      toast("Alarm sound uploaded", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not upload alarm sound", "error");
    } finally {
      setSoundBusy(false);
    }
  }

  function saveAlarm() {
    const normalizedLabel = label.trim() || (assessment?assessmentKind==="TEST"?"My test":"My exam":"Alarm");
    if(assessment){void mutate("/v1/exams/personal","POST",{requestId:assessmentRequest,kind:assessmentKind,entry:{title:normalizedLabel,courseCode:"",date:assessmentDate,startsAt:time,endsAt:assessmentEnd,venue:""}});return;}
    void mutate(
      "/v1/learning/alarms" + (editing ? "/" + editing.id : ""),
      editing ? "PUT" : "POST",
      {
        label: normalizedLabel,
        time,
        days: repeat ? days : [],
        firesAt: repeat ? null : nextCampusOccurrenceOnDay(time, oneTimeDay),
        enabled: editing?.enabled ?? true,
        sound,
        vibration,
        snoozeMinutes: Math.max(1, Math.min(30, Number(snooze) || 5)),
      },
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/explore")
            }
            style={styles.headerIcon}
          >
            <Ionicons name="arrow-back" size={23} color={theme.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Alarm</Text>
          <BulkMenu selection={selection} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <BulkToolbar selection={selection} count={items.length} />
          <View style={styles.nextAlarmBlock}>
            <Text style={styles.nextAlarmText}>
              {durationLabel(nextAlarm?.date ?? null, now)}
            </Text>
            {nextAlarm ? (
              <Text style={styles.nextAlarmDetail}>
                {displayTime(nextAlarm.alarm.time).clock} {displayTime(nextAlarm.alarm.time).period}
                {nextAlarm.alarm.label ? ` · ${nextAlarm.alarm.label}` : ""}
              </Text>
            ) : (
              <Text style={styles.nextAlarmDetail}>
                Add an alarm for classes, study sessions, or campus plans.
              </Text>
            )}
          </View>

          {Platform.OS === "web" ? (
            <Text style={styles.webNote}>
              Browser reminders work while KampusOne is open. Use the Android or iOS app for alarms with the app closed.
            </Text>
          ) : null}

          <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setImportOpen(true)} style={styles.importButton}><Ionicons name="calendar-outline" size={20} color={theme.deepBrand}/><Text style={styles.importText}>Import alarms</Text></Pressable>
          {Platform.OS==='android'?<Pressable accessibilityRole="button" onPress={()=>{void syncAlarms(items,true).then(enabled=>toast(enabled?'Alarms are enabled':'Allow alarms and notifications in device settings')).catch(error=>toast(error.message,'error'));}} style={styles.importButton}><Ionicons name="notifications-outline" size={20} color={theme.deepBrand}/><Text style={styles.importText}>Check alarm permissions</Text></Pressable>:null}
          {!ready ? <ScreenSkeleton variant="list" compact /> : null}

          {loadError ? (
            <View style={styles.errorCard}>
              <Text accessibilityRole="alert" style={styles.errorText}>
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void load().catch((error) =>
                    setLoadError(
                      error instanceof Error
                        ? error.message
                        : "Alarms could not load.",
                    ),
                  )
                }
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {ready && !loadError && !items.length ? (
            <View style={styles.emptyCard}>
              <Ionicons name="alarm-outline" size={28} color={theme.deepBrand} />
              <Text style={styles.emptyTitle}>No alarms yet</Text>
              <Text style={styles.emptyText}>
                Tap the alarm button to create your first reminder.
              </Text>
            </View>
          ) : null}

          {items.length?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setClearError("");setClearGroup("ALL");}} style={{alignSelf:"flex-end",minHeight:44,justifyContent:"center",marginBottom:12}}><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:13}}>Clear all alarms</Text></Pressable>:null}
          {alarmCategories.map(category=>{const group=items.filter(a=>alarmCategory(a)===category.id);if(!group.length)return null;const open=expanded.includes(category.id);return <View key={category.id} style={{marginBottom:18,borderWidth:1,borderColor:theme.border,borderRadius:20,backgroundColor:theme.surface,overflow:"hidden"}}>
            <View style={{flexDirection:"row",alignItems:"center",paddingHorizontal:14,gap:8}}><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={category.title+", "+group.length+" alarms"} onPress={()=>setExpanded(v=>v.includes(category.id)?v.filter(c=>c!==category.id):[...v,category.id])} style={{flex:1,minHeight:82,flexDirection:"row",gap:12,alignItems:"center"}}><View style={{padding:10,borderRadius:12,backgroundColor:theme.surfaceMuted}}><Ionicons name={category.icon} size={22} color={theme.deepBrand}/></View><View style={{flex:1,minWidth:0,gap:4}}><Text style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:15}}>{category.title} <Text style={{color:theme.textMuted,fontSize:12}}>({group.length})</Text></Text><Text numberOfLines={1} style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:11}}>{category.description}</Text></View><Ionicons name={open?"chevron-up":"chevron-down"} size={16} color={theme.textMuted}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={"Clear "+category.title} disabled={busy} onPress={()=>{setClearError("");setClearGroup(category.id);}} style={{minHeight:44,paddingHorizontal:8,justifyContent:"center"}}><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:12}}>Clear</Text></Pressable></View>
          {open?<View style={[styles.list,{padding:10,paddingTop:0}]}>
            {group.map((alarm) => {
              const shown = displayTime(alarm.time);
              return (
                <Pressable
                  key={alarm.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${alarm.exam_id?"View exam reminder":"Edit"} ${alarm.label}`}
                  onPress={() => selection.active ? selection.toggle(alarm.id) : alarm.exam_id ? router.push({pathname:"/exam-awareness",params:{alarmId:alarm.id}}) : edit(alarm)}
                  style={({ pressed }) => [
                    styles.alarmCard,
                    !alarm.enabled && styles.alarmCardDisabled,
                    pressed && styles.alarmCardPressed,
                  ]}
                >
                  <SelectionCheckbox selection={selection} id={alarm.id} />
                  <View style={styles.alarmCopy}>
                    <View style={styles.alarmTimeRow}>
                      <Text style={styles.alarmTime}>{shown.clock}</Text>
                      <Text style={styles.alarmPeriod}>{shown.period}</Text>
                    </View>
                    <Text style={styles.alarmMeta} numberOfLines={1}>
                      {repeatLabel(alarm.days)}
                      {alarm.label ? `  |  ${alarm.label}` : ""}
                    </Text>
                  </View>
                  <BrandSwitch
                    label={`Enable ${alarm.label}`}
                    disabled={busy||Boolean(alarm.exam_id)}
                    value={alarm.enabled}
                    onValueChange={(enabled) =>
                      void mutate(
                        "/v1/learning/alarms/" + alarm.id,
                        "PUT",
                        {
                          label: alarm.label,
                          time: alarm.time,
                          days: alarm.days,
                          firesAt: alarm.days.length
                            ? null
                            : nextOccurrence(alarm.time),
                          enabled,
                          sound: alarm.sound,
                          vibration: alarm.vibration,
                          snoozeMinutes: alarm.snooze_minutes,
                        },
                        false,
                      )
                    }
                  />
                </Pressable>
              );
            })}
          </View>:null}</View>;})}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add alarm"
          onPress={() => edit(null)}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        >
          <Ionicons name="alarm-outline" size={30} color="#fff" />
        </Pressable>
      </View>

      <AlarmSourceDialog visible={importOpen} onClose={()=>setImportOpen(false)} onChoose={source=>{setImportOpen(false);router.push({pathname:"/alarm-import",params:{source}});}}/>
      <ClearAlarmsDialog category={clearGroup} busy={busy} error={clearError} onClose={()=>setClearGroup(null)} onAwareness={items.find(a=>a.exam_id&&a.enabled)?()=>{const alarm=items.find(a=>a.exam_id&&a.enabled)!;setClearGroup(null);router.push({pathname:"/exam-awareness",params:{alarmId:alarm.id}});}:undefined} onConfirm={()=>{const ids=items.filter(a=>clearGroup==="ALL"||alarmCategory(a)===clearGroup).map(a=>a.id);if(!ids.length){setClearGroup(null);return;}setBusy(true);setClearError("");void api("/v1/learning/alarms/bulk-delete",{method:"POST",body:JSON.stringify({ids})}).then(async()=>{await syncAlarms(await load());setClearGroup(null);toast("Alarms cleared","success");}).catch(e=>setClearError(e.message)).finally(()=>setBusy(false));}}/>
      <Modal
        visible={form}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => !busy && setForm(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Close alarm editor"
            onPress={() => !busy && setForm(false)}
            style={styles.backdrop}
          />
          <View style={styles.sheet}>
            <SafeAreaView edges={["bottom"]} style={styles.sheetSafe}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Pressable
                  accessibilityLabel="Cancel"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => setForm(false)}
                  style={[styles.sheetHeaderButton, busy && styles.disabled]}
                >
                  <Ionicons name="close" size={30} color={theme.text} />
                </Pressable>
                <View style={styles.sheetHeaderCopy}>
                  <Text style={styles.sheetTitle}>
                    {editing ? "Edit alarm" : "Add alarm"}
                  </Text>
                  <Text style={styles.sheetSubtitle}>
                    {durationLabel(
                      getAlarmDate(
                        {
                          id: editing?.id ?? "draft",
                          label: label.trim() || "Alarm",
                          time,
                          days: repeat ? days : [],
                          enabled: true,
                          sound,
                          vibration,
                          snooze_minutes: Number(snooze) || 5,
                          fires_at: repeat
                            ? null
                            : nextCampusOccurrenceOnDay(time, oneTimeDay),
                        },
                        now,
                      ),
                      now,
                    )}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Save alarm"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={saveAlarm}
                  style={[styles.sheetHeaderButton, busy && styles.disabled]}
                >
                  <Ionicons name="checkmark" size={32} color={theme.text} />
                </Pressable>
              </View>

              <ScrollView
                nestedScrollEnabled
                contentContainerStyle={styles.sheetContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {!editing?<AcademicAlarmFields enabled={assessment} onEnabled={setAssessment} kind={assessmentKind} onKind={setAssessmentKind} date={assessmentDate} onDate={setAssessmentDate} end={assessmentEnd} onEnd={setAssessmentEnd}/>:null}
                <View style={styles.pickerWrap}>
                  <PeriodColumn
                    value={timeParts.period}
                    onChange={(period) =>
                      setTimeFromParts(hour12, minute, period)
                    }
                  />
                  <WheelColumn
                    label="H"
                    min={1}
                    max={12}
                    value={hour12}
                    pad
                    onChange={(value) =>
                      setTimeFromParts(value, minute, timeParts.period)
                    }
                  />
                  <WheelColumn
                    label="M"
                    min={0}
                    max={59}
                    value={minute}
                    pad
                    onChange={(value) =>
                      setTimeFromParts(hour12, value, timeParts.period)
                    }
                  />
                </View>

                <View style={styles.settingsCard}>
                  {!assessment?<><View style={styles.scheduleHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.settingTitle}>Day</Text>
                      <Text style={styles.scheduleHint}>
                        {repeat
                          ? "Choose every day this alarm should repeat."
                          : "Choose the day for this one-time alarm."}
                      </Text>
                    </View>
                    <View style={styles.repeatSwitch}>
                      <Text style={styles.repeatLabel}>Repeat</Text>
                      <BrandSwitch
                        label="Repeat alarm"
                        disabled={busy}
                        value={repeat}
                        onValueChange={(value) => {
                          setRepeat(value);
                          if (value && !days.length) setDays([oneTimeDay]);
                        }}
                      />
                    </View>
                  </View>

                  <View style={styles.dayPicker}>
                    {DAY_NAMES.map((day, index) => {
                      const selected = repeat
                        ? days.includes(index)
                        : oneTimeDay === index;
                      return (
                        <Pressable
                          key={DAY_LONG_NAMES[index]}
                          accessibilityRole={repeat ? "checkbox" : "radio"}
                          accessibilityLabel={DAY_LONG_NAMES[index]}
                          accessibilityState={
                            repeat ? { checked: selected } : { selected }
                          }
                          onPress={() => {
                            if (!repeat) {
                              setOneTimeDay(index);
                              return;
                            }
                            setDays((current) => {
                              if (current.includes(index)) {
                                if (current.length === 1) return current;
                                return current.filter((value) => value !== index);
                              }
                              return [...current, index];
                            });
                          }}
                          style={[
                            styles.dayButton,
                            selected && styles.dayButtonSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayText,
                              selected && styles.dayTextSelected,
                            ]}
                          >
                            {day.slice(0, 1)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  </>:null}
                  <View style={styles.settingDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: soundOpen }}
                    onPress={() => setSoundOpen((value) => !value)}
                    style={styles.settingRow}
                  >
                    <Text style={styles.settingTitle}>Sound</Text>
                    <View style={styles.settingRight}>
                      <Text style={styles.settingValue} numberOfLines={1}>{selectedSoundLabel()}</Text>
                      <Ionicons name={soundOpen ? "chevron-up" : "chevron-forward"} size={18} color={theme.textMuted} />
                    </View>
                  </Pressable>
                  {soundOpen ? (
                    <View style={styles.soundList}>
                      {[
                        { value: "default" as Alarm["sound"], label: "Device default alarm" },
                        { value: "silent" as Alarm["sound"], label: "Silent" },
                        ...sounds.map((item) => ({ value: `media:${item.id}` as Alarm["sound"], label: item.name })),
                      ].map((option) => {
                        const selected = sound === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            onPress={() => setSound(option.value)}
                            style={[styles.soundOption, selected && styles.soundOptionSelected]}
                          >
                            <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? theme.deepBrand : theme.textMuted} />
                            <Text style={styles.soundOptionText} numberOfLines={1}>{option.label}</Text>
                          </Pressable>
                        );
                      })}
                      <Pressable
                        accessibilityRole="button"
                        disabled={soundBusy || busy}
                        onPress={() => void uploadAlarmSound()}
                        style={[styles.soundUpload, (soundBusy || busy) && styles.disabled]}
                      >
                        <Ionicons name="cloud-upload-outline" size={19} color={theme.deepBrand} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.soundUploadTitle}>{soundBusy ? "Uploading…" : "Upload a sound"}</Text>
                          <Text style={styles.soundUploadDetail}>MP3 or WAV · up to 2 MB</Text>
                        </View>
                      </Pressable>
                    </View>
                  ) : null}
                  <View style={styles.settingDivider} />
                  <View style={styles.settingRow}>
                    <Text style={styles.settingTitle}>Vibrate when alarm sounds</Text>
                    <BrandSwitch
                      label="Alarm vibration"
                      value={vibration}
                      onValueChange={setVibration}
                    />
                  </View>
                  <View style={styles.settingDivider} />
                  <View style={styles.settingRow}>
                    <Text style={styles.settingTitle}>Snooze</Text>
                    <View style={styles.snoozeWrap}>
                      <TextInput
                        accessibilityLabel="Snooze minutes"
                        value={snooze}
                        onChangeText={setSnooze}
                        keyboardType="number-pad"
                        maxLength={2}
                        selectTextOnFocus
                        style={styles.snoozeInput}
                      />
                      <Text style={styles.snoozeUnit}>min</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.labelCard}>
                  <Text style={styles.labelTitle}>Label</Text>
                  <TextInput
                    accessibilityLabel="Alarm label"
                    value={label}
                    onChangeText={setLabel}
                    maxLength={120}
                    placeholder="Enter label"
                    placeholderTextColor={theme.textFaint}
                    selectionColor={theme.brand}
                    style={styles.labelInput}
                  />
                </View>

                {editing ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() =>
                      void mutate(
                        "/v1/learning/alarms/" + editing.id,
                        "DELETE",
                      )
                    }
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.error} />
                    <Text style={styles.deleteText}>Delete alarm</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.canvas },
    shell: { flex: 1, width: "100%", maxWidth: 540, alignSelf: "center" },
    header: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
    },
    headerIcon: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      flex: 1,
      fontFamily: theme.font.displayStrong,
      fontSize: 31,
      color: theme.text,
      marginLeft: 2,
    },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 20, paddingBottom: 132 },
    nextAlarmBlock: {
      minHeight: 250,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    nextAlarmText: {
      maxWidth: 400,
      textAlign: "center",
      fontFamily: theme.font.displayStrong,
      fontSize: 31,
      lineHeight: 39,
      color: theme.text,
    },
    nextAlarmDetail: {
      marginTop: 10,
      textAlign: "center",
      fontFamily: theme.font.body,
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    webNote: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 14,
      paddingHorizontal: 4,
    },
    importButton:{flexDirection:"row",alignItems:"center",gap:10,padding:14,borderRadius:14,backgroundColor:theme.surfaceMuted,marginBottom:12},
    importText:{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:13},
    list: { gap: 12 },
    alarmCard: {
      minHeight: 116,
      borderRadius: 26,
      backgroundColor: theme.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 18,
      paddingVertical: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      ...theme.shadow,
    },
    alarmCardDisabled: { opacity: 0.52 },
    alarmCardPressed: { transform: [{ scale: 0.992 }], opacity: 0.86 },
    alarmCopy: { flex: 1, minWidth: 0 },
    alarmTimeRow: { flexDirection: "row", alignItems: "flex-end", gap: 5 },
    alarmTime: {
      fontFamily: theme.font.displayStrong,
      fontSize: 42,
      letterSpacing: -1.1,
      lineHeight: 48,
      color: theme.text,
    },
    alarmPeriod: {
      fontFamily: theme.font.displayStrong,
      color: theme.text,
      fontSize: 18,
      lineHeight: 29,
      paddingBottom: 2,
    },
    alarmMeta: {
      marginTop: 4,
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.textMuted,
    },
    fab: {
      position: "absolute",
      right: 22,
      bottom: 24,
      width: 66,
      height: 66,
      borderRadius: 33,
      backgroundColor: theme.deepBrand,
      alignItems: "center",
      justifyContent: "center",
      ...theme.floatingShadow,
    },
    fabPressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
    emptyCard: {
      minHeight: 170,
      borderRadius: 24,
      backgroundColor: theme.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      marginBottom: 12,
    },
    emptyTitle: {
      marginTop: 10,
      fontFamily: theme.font.display,
      fontSize: 18,
      color: theme.text,
    },
    emptyText: {
      marginTop: 5,
      textAlign: "center",
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
    },
    errorCard: {
      borderRadius: 20,
      padding: 16,
      marginBottom: 14,
      backgroundColor: theme.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.border,
    },
    errorText: {
      color: theme.error,
      fontFamily: theme.font.body,
      lineHeight: 20,
    },
    retryButton: {
      alignSelf: "flex-start",
      marginTop: 12,
      minHeight: 42,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
    },
    retryText: {
      fontFamily: theme.font.semibold,
      color: theme.deepBrand,
      fontSize: 13,
    },
    modalRoot: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(0,0,0,0.48)",
    },
    sheet: {
      width: "100%",
      maxWidth: 540,
      maxHeight: "94%",
      alignSelf: "center",
      borderTopLeftRadius: 34,
      borderTopRightRadius: 34,
      overflow: "hidden",
      backgroundColor: theme.canvas,
    },
    sheetSafe: { maxHeight: "100%", backgroundColor: theme.canvas },
    sheetHandle: {
      width: 86,
      height: 5,
      borderRadius: 3,
      backgroundColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(41,35,31,0.18)",
      alignSelf: "center",
      marginTop: 12,
    },
    sheetHeader: {
      minHeight: 82,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
    },
    sheetHeaderButton: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    disabled: { opacity: 0.5 },
    sheetHeaderCopy: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
    sheetTitle: {
      color: theme.text,
      fontFamily: theme.font.displayStrong,
      fontSize: 24,
    },
    sheetSubtitle: {
      marginTop: 2,
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 12,
      textAlign: "center",
    },
    sheetContent: { paddingHorizontal: 20, paddingBottom: 28 },
    pickerWrap: {
      minHeight: 290,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingBottom: 12,
    },
    settingsCard: {
      borderRadius: 24,
      backgroundColor: isDark ? "#34302D" : theme.surface,
      paddingHorizontal: 18,
      overflow: "hidden",
    },
    settingRow: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    settingTitle: {
      flex: 1,
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 15,
    },
    settingRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: "55%",
    },
    settingValue: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 13,
      textAlign: "right",
    },
    settingDivider: { height: 1, backgroundColor: theme.border },
    scheduleHeader: {
      minHeight: 70,
      paddingTop: 15,
      paddingBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    scheduleHint: {
      marginTop: 3,
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 16,
    },
    repeatSwitch: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    },
    repeatLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 12,
    },
    soundList: { paddingBottom: 12, gap: 7 },
    soundOption: {
      minHeight: 48,
      borderRadius: 14,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
    },
    soundOptionSelected: { borderColor: theme.deepBrand },
    soundOptionText: { flex: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
    soundUpload: {
      minHeight: 54,
      borderRadius: 14,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.brand,
      backgroundColor: isDark ? "rgba(168,70,46,0.12)" : "rgba(168,70,46,0.08)",
    },
    soundUploadTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
    soundUploadDetail: { marginTop: 2, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 },
    dayPicker: {
      flexDirection: "row",
      gap: 6,
      paddingBottom: 15,
    },
    dayButton: {
      flex: 1,
      minWidth: 0,
      aspectRatio: 1,
      maxHeight: 42,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
    },
    dayButtonSelected: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    dayText: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    dayTextSelected: { color: "#FFFFFF" },
    snoozeWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
    snoozeInput: {
      width: 44,
      minHeight: 42,
      textAlign: "right",
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 14,
      paddingVertical: 0,
    },
    snoozeUnit: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
    },
    labelCard: {
      minHeight: 74,
      borderRadius: 22,
      backgroundColor: isDark ? "#34302D" : theme.surface,
      marginTop: 16,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    labelTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 15,
    },
    labelInput: {
      flex: 1,
      minHeight: 52,
      color: theme.text,
      fontFamily: theme.font.body,
      fontSize: 15,
      textAlign: "right",
    },
    deleteButton: {
      minHeight: 54,
      marginTop: 16,
      borderRadius: 18,
      backgroundColor: "rgba(168,70,46,0.16)",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    deleteText: {
      color: theme.error,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
  });

// Deployment touch: alarm clock redesign verified 2026-09-25.
