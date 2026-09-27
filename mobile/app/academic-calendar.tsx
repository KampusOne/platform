import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import { ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAppearance, type Theme } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";

type Event = {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
  semester: string;
};

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
    removeLink: {
      alignSelf: "flex-start",
      paddingTop: 10,
      paddingBottom: 2,
      paddingRight: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
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
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const generation = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      setLoading(true);
      setError("");
      setRemoving(null);
      setBusy(false);
      setActionError("");

      void api<{ events: Event[] }>("/v1/calendar", { timeoutMs: 12_000 })
        .then((result) => {
          if (current === generation.current) setEvents(result.events);
        })
        .catch((caught) => {
          if (current !== generation.current) return;
          setError(
            caught instanceof Error
              ? caught.message
              : "Your calendar could not be loaded.",
          );
        })
        .finally(() => {
          if (current === generation.current) setLoading(false);
        });

      return () => {
        generation.current++;
      };
    }, [user?.id, retry]),
  );

  async function remove(id: string) {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    setActionError("");

    try {
      await api(`/v1/calendar/${id}`, {
        method: "DELETE",
        timeoutMs: 12_000,
      });
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

  return (
    <ToolPage title="Academic calendar">
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}>
            <Ionicons
              name="calendar-outline"
              size={24}
              color={theme.deepBrand}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>ACADEMIC YEAR</Text>
            <Text style={styles.heroTitle}>Keep important dates together.</Text>
            <Text style={styles.heroBody}>
              Import your university calendar and keep lectures, breaks and exam
              periods easy to scan.
            </Text>
          </View>
        </View>

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
      </View>

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
              <View style={styles.dateBox}>
                <Text style={styles.dateMonth}>{badge.month}</Text>
                <Text style={styles.dateDay}>{badge.day}</Text>
              </View>

              <View style={styles.eventContent}>
                <Text style={styles.eventTitle}>{event.title}</Text>
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${event.title}`}
                    onPress={() => {
                      setRemoving(event.id);
                      setActionError("");
                    }}
                    style={({ pressed }) => [
                      styles.removeLink,
                      pressed && { opacity: 0.62 },
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={14}
                      color={theme.deepBrand}
                    />
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
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
            Import your university calendar to see semester dates, breaks and
            exam periods here.
          </Text>
        </View>
      )}
    </ToolPage>
  );
}
