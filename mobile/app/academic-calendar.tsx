import {AcademicImportUsage} from "@/src/components/academic-import-usage";
import { BulkMenu, BulkToolbar, SelectionCheckbox, useBulkSelection } from "@/src/components/bulk-selection";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";

import { ToolField, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAppearance, type Theme } from "@/src/lib/appearance";
import { api, ApiError } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";

type Event = {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
  semester: string;
};

type EventDraft = {
  title: string;
  startsOn: string;
  endsOn: string;
  semester: string;
};

const emptyDraft = (): EventDraft => ({
  title: "",
  startsOn: "",
  endsOn: "",
  semester: "",
});

const dateLabel = (value: string) =>
  new Date(value + "T12:00:00Z").toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const dateBadge = (value: string) => {
  const date = new Date(value + "T12:00:00Z");
  return {
    day: date.toLocaleDateString("en-NG", {
      day: "2-digit",
      timeZone: "UTC",
    }),
    month: date
      .toLocaleDateString("en-NG", {
        month: "short",
        timeZone: "UTC",
      })
      .toUpperCase(),
  };
};

const isRealDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const normalizeEvents = (value: unknown): Event[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      typeof raw.title !== "string" ||
      typeof raw.starts_on !== "string"
    )
      return [];
    return [{
      id: raw.id,
      title: raw.title,
      starts_on: raw.starts_on,
      ends_on:
        typeof raw.ends_on === "string" ? raw.ends_on : raw.starts_on,
      semester: typeof raw.semester === "string" ? raw.semester : "",
    } satisfies Event];
  });
};

const sortEvents = (rows: Event[]) =>
  normalizeEvents(rows).sort(
    (left, right) =>
      String(left.starts_on).localeCompare(String(right.starts_on)) ||
      String(left.title).localeCompare(String(right.title)),
  );

const localCalendarKey = (userId?: string | null) =>
  `@kampusone/calendar/personal/${userId || "anonymous"}`;

const readLocalEvents = async (key: string): Promise<Event[]> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is Event => {
      if (!row || typeof row !== "object") return false;
      const value = row as Partial<Event>;
      return (
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.starts_on === "string" &&
        typeof value.ends_on === "string" &&
        typeof value.semester === "string"
      );
    });
  } catch {
    return [];
  }
};

const mergeCalendarEvents = (serverRows: Event[], localRows: Event[]) => {
  const localById = new Map(localRows.map((row) => [row.id, row]));
  const serverIds = new Set(serverRows.map((row) => row.id));
  return sortEvents([
    ...serverRows.map((row) => localById.get(row.id) ?? row),
    ...localRows.filter((row) => !serverIds.has(row.id)),
  ]);
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    hero: {
      borderRadius: 22,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 18,
      gap: 16,
      ...theme.shadow,
    },
    heroTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
    },
    heroIcon: {
      width: 46,
      height: 46,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceTint,
      flexShrink: 0,
    },
    eyebrow: {
      fontFamily: theme.font.semibold,
      fontSize: 11,
      letterSpacing: 0.8,
      color: theme.deepBrand,
      marginBottom: 5,
    },
    heroTitle: {
      fontFamily: theme.font.displayStrong,
      fontSize: 21,
      lineHeight: 26,
      color: theme.text,
    },
    heroBody: {
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
      marginTop: 6,
    },
    heroActions: {
      gap: 10,
    },
    importButton: {
      minHeight: 52,
      borderRadius: 16,
      backgroundColor: theme.deepBrand,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    importText: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },
    addButton: {
      minHeight: 50,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
    },
    addText: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: theme.accentText,
    },
    formCard: {
      marginTop: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 16,
      ...theme.shadow,
    },
    formHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 16,
    },
    formHeaderCopy: {
      flex: 1,
      minWidth: 0,
    },
    formTitle: {
      fontFamily: theme.font.displayStrong,
      fontSize: 18,
      color: theme.text,
    },
    formBody: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
      marginTop: 5,
    },
    closeForm: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      flexShrink: 0,
    },
    formHint: {
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 17,
      color: theme.textMuted,
      marginTop: -8,
      marginBottom: 16,
    },
    formError: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      lineHeight: 18,
      color: theme.error,
      marginBottom: 12,
    },
    formActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    saveButton: {
      minHeight: 46,
      borderRadius: 14,
      paddingHorizontal: 18,
      flex: 1,
      minWidth: 140,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.deepBrand,
    },
    saveButtonText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: "#FFFFFF",
    },
    cancelButton: {
      minHeight: 46,
      borderRadius: 14,
      paddingHorizontal: 18,
      minWidth: 100,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cancelButtonText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.accentText,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 26,
      marginBottom: 12,
    },
    sectionTitle: {
      fontFamily: theme.font.display,
      fontSize: 18,
      color: theme.text,
    },
    countPill: {
      minWidth: 30,
      height: 26,
      paddingHorizontal: 9,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
    },
    countText: {
      fontFamily: theme.font.semibold,
      fontSize: 12,
      color: theme.accentText,
    },
    stateCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 20,
      paddingVertical: 26,
      alignItems: "center",
    },
    stateIcon: {
      width: 52,
      height: 52,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      marginBottom: 14,
    },
    stateTitle: {
      fontFamily: theme.font.displayStrong,
      fontSize: 17,
      color: theme.text,
      textAlign: "center",
    },
    stateBody: {
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
      textAlign: "center",
      marginTop: 6,
      maxWidth: 310,
    },
    retryButton: {
      minHeight: 44,
      borderRadius: 14,
      paddingHorizontal: 18,
      marginTop: 16,
      backgroundColor: theme.surfaceMuted,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    retryText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.accentText,
    },
    eventCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 15,
      flexDirection: "row",
      gap: 14,
      marginBottom: 10,
    },
    dateBox: {
      width: 54,
      minHeight: 58,
      borderRadius: 15,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 7,
      flexShrink: 0,
    },
    dateMonth: {
      fontFamily: theme.font.bold,
      fontSize: 10,
      letterSpacing: 0.6,
      color: theme.deepBrand,
    },
    dateDay: {
      fontFamily: theme.font.displayStrong,
      fontSize: 20,
      color: theme.text,
      marginTop: 1,
    },
    eventContent: {
      flex: 1,
      minWidth: 0,
    },
    eventTitle: {
      fontFamily: theme.font.semibold,
      fontSize: 15,
      lineHeight: 21,
      color: theme.text,
    },
    eventDate: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
      marginTop: 4,
    },
    semesterPill: {
      alignSelf: "flex-start",
      marginTop: 9,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: theme.surfaceTint,
    },
    semesterText: {
      fontFamily: theme.font.medium,
      fontSize: 11,
      color: theme.accentText,
    },
    eventActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 4,
      marginTop: 3,
    },
    eventAction: {
      alignSelf: "flex-start",
      paddingTop: 9,
      paddingBottom: 3,
      paddingRight: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    editText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      color: theme.accentText,
    },
    removeText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      color: theme.deepBrand,
    },
    confirmBox: {
      marginTop: 12,
      borderRadius: 14,
      padding: 12,
      backgroundColor: theme.surfaceMuted,
    },
    confirmText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      lineHeight: 18,
      color: theme.text,
    },
    actionError: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.error,
      marginTop: 6,
    },
    confirmActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
    smallButton: {
      minHeight: 38,
      borderRadius: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    smallDangerButton: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    smallButtonText: {
      fontFamily: theme.font.semibold,
      fontSize: 12,
      color: theme.text,
    },
    smallDangerText: {
      color: "#FFFFFF",
    },
  });

export default function Calendar() {
  const { theme } = useAppearance();
  const { user } = useAuth();
  const styles = createStyles(theme);

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [formError, setFormError] = useState("");
  const generation = useRef(0);
  const createRequestId = useRef(randomUUID());
  const localEvents = useRef<Event[]>([]);
  const storageKey = localCalendarKey(user?.id);

  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      setLoading(true);
      setError("");
      setRemoving(null);
      setBusy(false);
      setActionError("");

      void Promise.all([
        api<{ events: Event[] }>("/v1/calendar", { timeoutMs: 12_000 })
          .then((result) => ({ rows: normalizeEvents(result?.events), error: "" }))
          .catch((caught) => ({
            rows: [] as Event[],
            error:
              caught instanceof Error
                ? caught.message
                : "Your calendar could not be loaded.",
          })),
        readLocalEvents(storageKey),
      ])
        .then(([server, local]) => {
          if (current !== generation.current) return;
          localEvents.current = local;
          const merged = mergeCalendarEvents(server.rows, local);
          setEvents(merged);
          if (server.error && merged.length === 0) setError(server.error);
        })
        .finally(() => {
          if (current === generation.current) setLoading(false);
        });

      return () => {
        generation.current++;
      };
    }, [user?.id, retry]),
  );

  function closeEditor() {
    if (busy) return;
    setEditing(null);
    setDraft(emptyDraft());
    setFormError("");
  }

  function openNew() {
    if (busy) return;
    createRequestId.current = randomUUID();
    setDraft(emptyDraft());
    setFormError("");
    setRemoving(null);
    setActionError("");
    setEditing("new");
  }

  function openEdit(event: Event) {
    if (busy) return;
    setDraft({
      title: event.title,
      startsOn: event.starts_on,
      endsOn: event.ends_on,
      semester: event.semester,
    });
    setFormError("");
    setRemoving(null);
    setActionError("");
    createRequestId.current=randomUUID();
    setEditing(event.id);
  }

  function changeDraft<Key extends keyof EventDraft>(
    key: Key,
    value: EventDraft[Key],
  ) {
    if (editing === "new") createRequestId.current = randomUUID();
    setDraft((current) => ({ ...current, [key]: value }));
    if (formError) setFormError("");
  }

  async function saveDate() {
    if (!editing || busy) return;

    const title = draft.title.trim();
    const startsOn = draft.startsOn.trim();
    const endsOn = draft.endsOn.trim() || startsOn;
    const semester = draft.semester.trim();

    if (!title) {
      setFormError("Add a title for this date.");
      return;
    }
    if (!isRealDate(startsOn)) {
      setFormError("Enter a real start date in YYYY-MM-DD format.");
      return;
    }
    if (!isRealDate(endsOn)) {
      setFormError("Enter a real end date in YYYY-MM-DD format.");
      return;
    }
    if (endsOn < startsOn) {
      setFormError("The end date cannot be before the start date.");
      return;
    }

    const current = generation.current;
    const event = { title, startsOn, endsOn, semester };
    setBusy(true);
    setFormError("");

    try {
      let saved: Event;
      let backedByServer = false;
      try {
        const result =
          (editing === "new" || editing.startsWith("local:"))
            ? await api<{ event: Event }>("/v1/calendar", {
                method: "POST",
                timeoutMs: 12_000,
                body: JSON.stringify({
                  requestId: createRequestId.current,
                  event,
                }),
              })
            : await api<{ event: Event }>(`/v1/calendar/${editing}`, {
                method: "PATCH",
                timeoutMs: 12_000,
                body: JSON.stringify({ event }),
              });
        saved = result.event;
        backedByServer = true;
      } catch (caught) {
        if (!(caught instanceof ApiError) || !["NETWORK_UNAVAILABLE","REQUEST_TIMEOUT"].includes(caught.code)) throw caught;
        saved = {
          id: editing === "new" ? `local:${randomUUID()}` : editing,
          title,
          starts_on: startsOn,
          ends_on: endsOn,
          semester,
        };
      }

      if (current !== generation.current) return;

      if (backedByServer) {
        const nextLocal = localEvents.current.filter(
          (row) => row.id !== saved.id && row.id !== editing,
        );
        localEvents.current = nextLocal;
        await AsyncStorage.setItem(storageKey, JSON.stringify(nextLocal));
      } else {
        const nextLocal = [
          ...localEvents.current.filter((row) => row.id !== saved.id),
          saved,
        ];
        localEvents.current = nextLocal;
        await AsyncStorage.setItem(storageKey, JSON.stringify(nextLocal));
      }

      if (current !== generation.current) return;
      setEvents((rows) =>
        sortEvents(
          editing === "new"
            ? [...rows.filter((row) => row.id !== saved.id), saved]
            : rows.map((row) => (row.id === editing ? saved : row)),
        ),
      );
      setEditing(null);
      setDraft(emptyDraft());
      setFormError("");
    } catch (caught) {
      if (current !== generation.current) return;
      setFormError(
        caught instanceof Error
          ? caught.message
          : "This date could not be saved. Try again.",
      );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    setActionError("");

    try {
      if (!id.startsWith("local:")) {
        await api(`/v1/calendar/${id}`, {
          method: "DELETE",
          timeoutMs: 12_000,
        });
      }
      const nextLocal = localEvents.current.filter((row) => row.id !== id);
      localEvents.current = nextLocal;
      await AsyncStorage.setItem(storageKey, JSON.stringify(nextLocal));
      if (current === generation.current) {
        setEvents((rows) => rows.filter((row) => row.id !== id));
        setRemoving(null);
      }
    } catch (caught) {
      if (current === generation.current) {
        setActionError(
          caught instanceof Error
            ? caught.message
            : "This event could not be removed. Try again.",
        );
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  const selection = useBulkSelection(events.map(event => event.id), async ids => {
    const remoteIds=ids.filter(id=>!id.startsWith("local:"));
    if(remoteIds.length) await api("/v1/calendar/bulk-delete",{method:"POST",body:JSON.stringify({ids:remoteIds})});
    const next=localEvents.current.filter(row=>!ids.includes(row.id));
    await AsyncStorage.setItem(storageKey,JSON.stringify(next));
    localEvents.current=next;
    setEvents(rows=>rows.filter(row=>!ids.includes(row.id)));
  }, "calendar dates");
  return (
    <ToolPage title="Academic calendar" action={<BulkMenu selection={selection} />}>
      <BulkToolbar selection={selection} count={events.length} />
      <AcademicImportUsage calendar />
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}>
            <Ionicons
              name="calendar-outline"
              size={24}
              color={theme.deepBrand}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>ACADEMIC YEAR</Text>
            <Text
              android_hyphenationFrequency="none"
              style={styles.heroTitle}
              textBreakStrategy="simple"
            >
              Keep important dates together.
            </Text>
            <Text
              android_hyphenationFrequency="none"
              style={styles.heroBody}
              textBreakStrategy="simple"
            >
              Import your university calendar, then add your own deadlines,
              events and reminders too.
            </Text>
          </View>
        </View>

        <View style={styles.heroActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import academic calendar"
            onPress={() => router.push("/timetable-import?kind=calendar")}
            style={({ pressed }) => [
              styles.importButton,
              pressed && { opacity: 0.78 },
            ]}
          >
            <Ionicons name="cloud-upload-outline" size={19} color="#FFFFFF" />
            <Text style={styles.importText}>Import academic calendar</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a date"
            disabled={busy}
            onPress={openNew}
            style={({ pressed }) => [
              styles.addButton,
              (pressed || busy) && { opacity: 0.62 },
            ]}
          >
            <Ionicons name="add-circle-outline" size={19} color={theme.accentText} />
            <Text style={styles.addText}>Add a date</Text>
          </Pressable>
        </View>
      </View>

      {editing ? (
        <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <View style={styles.formHeaderCopy}>
              <Text style={styles.formTitle}>
                {editing === "new" ? "Add personal date" : "Edit date"}
              </Text>
              <Text style={styles.formBody}>
                Add anything you want to remember. Changes here only affect your
                own calendar.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close calendar editor"
              disabled={busy}
              onPress={closeEditor}
              style={({ pressed }) => [
                styles.closeForm,
                (pressed || busy) && { opacity: 0.58 },
              ]}
            >
              <Ionicons name="close" size={21} color={theme.text} />
            </Pressable>
          </View>

          <ToolField
            label="Title"
            placeholder="e.g. Project defence"
            value={draft.title}
            maxLength={160}
            onChangeText={(value) => changeDraft("title", value)}
            editable={!busy}
            returnKeyType="next"
          />
          <ToolField
            label="Start date"
            placeholder="YYYY-MM-DD"
            value={draft.startsOn}
            maxLength={10}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={(value) => changeDraft("startsOn", value)}
            editable={!busy}
          />
          <ToolField
            label="End date"
            placeholder="Leave blank for a one-day event"
            value={draft.endsOn}
            maxLength={10}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={(value) => changeDraft("endsOn", value)}
            editable={!busy}
          />
          <Text style={styles.formHint}>
            Use YYYY-MM-DD, for example 2026-10-12.
          </Text>
          <ToolField
            label="Semester or label (optional)"
            placeholder="e.g. First semester, Personal"
            value={draft.semester}
            maxLength={80}
            onChangeText={(value) => changeDraft("semester", value)}
            editable={!busy}
          />

          {formError ? (
            <Text accessibilityRole="alert" style={styles.formError}>
              {formError}
            </Text>
          ) : null}

          <View style={styles.formActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void saveDate()}
              style={({ pressed }) => [
                styles.saveButton,
                (pressed || busy) && { opacity: 0.58 },
              ]}
            >
              <Text style={styles.saveButtonText}>
                {busy
                  ? "Saving…"
                  : editing === "new"
                    ? "Add to calendar"
                    : "Save changes"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={closeEditor}
              style={({ pressed }) => [
                styles.cancelButton,
                (pressed || busy) && { opacity: 0.58 },
              ]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your dates</Text>
        {!loading && !error && events.length ? (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{events.length}</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <ScreenSkeleton variant="list" compact />
      ) : error ? (
        <View style={styles.stateCard}>
          <View style={styles.stateIcon}>
            <Ionicons
              name="cloud-offline-outline"
              size={25}
              color={theme.deepBrand}
            />
          </View>
          <Text style={styles.stateTitle}>Calendar couldn’t load</Text>
          <Text accessibilityRole="alert" style={styles.stateBody}>
            {error.includes("connect") || error.includes("internet")
              ? error
              : "We couldn’t load your academic dates. Please try again."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetry((value) => value + 1)}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && { opacity: 0.68 },
            ]}
          >
            <Ionicons name="refresh-outline" size={17} color={theme.accentText} />
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : events.length ? (
        events.map((event) => {
          const badge = dateBadge(event.starts_on);
          return (
            <View key={event.id} style={styles.eventCard}>
              <SelectionCheckbox selection={selection} id={event.id} />
              <View style={styles.dateBox}>
                <Text style={styles.dateMonth}>{badge.month}</Text>
                <Text style={styles.dateDay}>{badge.day}</Text>
              </View>

              <View style={styles.eventContent}>
                <Text
                  android_hyphenationFrequency="none"
                  style={styles.eventTitle}
                  textBreakStrategy="simple"
                >
                  {event.title}
                </Text>
                {localEvents.current.some(row=>row.id===event.id)?<Text style={styles.eventDate}>Saved on this device · edit and save after reconnecting to sync</Text>:null}
                <Text style={styles.eventDate}>
                  {dateLabel(event.starts_on)}
                  {event.ends_on !== event.starts_on
                    ? ` – ${dateLabel(event.ends_on)}`
                    : ""}
                </Text>

                {event.semester ? (
                  <View style={styles.semesterPill}>
                    <Text style={styles.semesterText}>{event.semester}</Text>
                  </View>
                ) : null}

                {removing === event.id ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.confirmText}>Remove this date?</Text>
                    {actionError ? (
                      <Text accessibilityRole="alert" style={styles.actionError}>
                        {actionError}
                      </Text>
                    ) : null}
                    <View style={styles.confirmActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => setRemoving(null)}
                        style={({ pressed }) => [
                          styles.smallButton,
                          (pressed || busy) && { opacity: 0.58 },
                        ]}
                      >
                        <Text style={styles.smallButtonText}>Keep</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void remove(event.id)}
                        style={({ pressed }) => [
                          styles.smallButton,
                          styles.smallDangerButton,
                          (pressed || busy) && { opacity: 0.58 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.smallButtonText,
                            styles.smallDangerText,
                          ]}
                        >
                          {busy ? "Removing…" : "Remove"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.eventActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${event.title}`}
                      disabled={busy}
                      onPress={() => openEdit(event)}
                      style={({ pressed }) => [
                        styles.eventAction,
                        (pressed || busy) && { opacity: 0.62 },
                      ]}
                    >
                      <Ionicons
                        name="create-outline"
                        size={14}
                        color={theme.accentText}
                      />
                      <Text style={styles.editText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${event.title}`}
                      disabled={busy}
                      onPress={() => {
                        setRemoving(event.id);
                        setActionError("");
                        setEditing(null);
                        setFormError("");
                      }}
                      style={({ pressed }) => [
                        styles.eventAction,
                        (pressed || busy) && { opacity: 0.62 },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={14}
                        color={theme.deepBrand}
                      />
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })
      ) : (
        <View style={styles.stateCard}>
          <View style={styles.stateIcon}>
            <Ionicons
              name="calendar-clear-outline"
              size={26}
              color={theme.deepBrand}
            />
          </View>
          <Text style={styles.stateTitle}>No academic dates yet</Text>
          <Text style={styles.stateBody}>
            Import your university calendar or add a personal date to get
            started.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openNew}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && { opacity: 0.68 },
            ]}
          >
            <Ionicons name="add-outline" size={17} color={theme.accentText} />
            <Text style={styles.retryText}>Add a date</Text>
          </Pressable>
        </View>
      )}
    </ToolPage>
  );
}
