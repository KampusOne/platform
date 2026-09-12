import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { EmptyResult, InlineFeedback, ProductScreen } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { ApiError, api } from "@/src/lib/api";
import { recordRecentTool } from "@/src/lib/recent-tools";
import { theme } from "@/src/theme";

type AgendaItem = {
  id: string;
  title: string;
  course_code: string | null;
  venue: string | null;
  lecturer: string | null;
  starts_at: string;
  ends_at: string;
};

type Update = {
  id: string;
  title: string;
  summary: string;
  category: string;
  source_name: string;
  urgent: boolean;
  image_url: string | null;
};

type Home = {
  profile: { first_name: string | null; display_name: string } | null;
  today: AgendaItem[];
  updates: Update[];
  academics: { cgpa: string | number | null; total_units: string | number | null };
  campusClock?: { date: string; time: string; timeZone: string };
  streak_days?: number | null;
};

function greeting(hour: number) {
  if (hour < 12) return "Good morning,";
  if (hour < 17) return "Good afternoon,";
  return "Good evening,";
}

function timeInMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.POSITIVE_INFINITY;
  return Number(hours) * 60 + Number(minutes);
}

export default function TodayScreen() {
  const { profile } = useAuth();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<Home>("/v1/student/home"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your campus day could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const firstName = data?.profile?.first_name ?? profile?.first_name ?? "there";
  const now = new Date();
  const campusTime = data?.campusClock?.time;
  const nowInMinutes = campusTime ? timeInMinutes(campusTime) : now.getHours() * 60 + now.getMinutes();
  const currentHour = Math.floor(nowInMinutes / 60);
  const upcoming = (data?.today ?? []).filter((item) => timeInMinutes(item.ends_at) > nowInMinutes);
  const next = upcoming[0];
  const nextInProgress = Boolean(next && timeInMinutes(next.starts_at) <= nowInMinutes);
  const campusDate = data?.campusClock?.date ? new Date(`${data.campusClock.date}T12:00:00`) : now;
  const date = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", weekday: "long" }).format(campusDate);

  function openNotifications() {
    void Haptics.selectionAsync();
    setNotice("Notifications are not available yet. Verified campus updates remain available in Feed.");
  }

  return (
    <ProductScreen>
      <View style={styles.topRow}>
        <View style={styles.greeting}>
          <View
            accessibilityLabel={data?.streak_days == null ? "Start your streak" : `${data.streak_days} day streak`}
            accessible
            style={styles.streak}
          >
            <Ionicons color={theme.brand} name="flame-outline" size={24} />
            <Text style={styles.streakText}>{data?.streak_days == null ? "Start your streak" : `${data.streak_days} day streak`}</Text>
          </View>
          <View accessible accessibilityLabel={`${greeting(currentHour)} ${firstName}. ${date}`}>
          <Text style={styles.greetingScript}>{greeting(currentHour)}</Text>
          <Text style={styles.name}>{firstName}</Text>
          <Text style={styles.date}>{date}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Open notifications"
            accessibilityRole="button"
            onPress={openNotifications}
            style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
          >
            <Ionicons color={theme.text} name="notifications-outline" size={21} />
          </Pressable>
        </View>
      </View>

      {notice ? <InlineFeedback message={notice} /> : null}

      <View style={styles.hero}>
        <View pointerEvents="none" style={styles.heroOrb} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Everything{`\n`}you need for{`\n`}today</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/explore")}
            style={({ pressed }) => [styles.heroButton, pressed && styles.pressed]}
          >
            <Text style={styles.heroButtonText}>Explore now</Text>
            <Ionicons color="#FFFFFF" name="arrow-forward" size={17} />
          </Pressable>
        </View>
        <Image
          accessible={false}
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require("@/assets/illustrations/home-student-v2.png")}
          style={styles.heroImage}
        />
      </View>

      {loading ? (
        <View style={styles.loading} accessibilityLabel="Loading your campus day">
          <ActivityIndicator color={theme.brand} />
          <Text style={styles.loadingText}>Preparing your day…</Text>
        </View>
      ) : null}

      {error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { setLoading(true); void load(); }}
          style={({ pressed }) => [styles.error, pressed && styles.pressed]}
        >
          <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={21} />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>{data ? "Couldn’t refresh your day" : "Couldn’t load your day"}</Text>
            <Text style={styles.errorBody}>{error} Tap to retry.</Text>
          </View>
        </Pressable>
      ) : null}

      {!loading && (!error || data) ? (
        <>
          <View style={styles.section}>
            <SectionHeading
              meta={upcoming.length ? `${upcoming.length} remaining` : data?.today.length ? "Done for today" : "0 today"}
              onPress={() => router.push("/timetable")}
              title="Your timetable"
            />
            {next ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/timetable")}
                style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]}
              >
                <View style={styles.nextTime}>
                  <Text style={styles.nextStart}>{next.starts_at}</Text>
                  <Text style={styles.nextEnd}>{next.ends_at}</Text>
                </View>
                <View style={styles.nextCopy}>
                  <Text style={styles.nextTag}>{nextInProgress ? "In progress" : "Next class"}</Text>
                  <Text style={styles.nextTitle}>{next.course_code ? `${next.course_code} · ` : ""}{next.title}</Text>
                  <Text style={styles.nextMeta}>{next.venue ?? "Venue not added"}{next.lecturer ? ` · ${next.lecturer}` : ""}</Text>
                </View>
                <Ionicons color="#FFFFFF" name="chevron-forward" size={20} />
              </Pressable>
            ) : (
              <EmptyResult
                actionLabel={data?.today.length ? "Open timetable" : "Add class schedule"}
                body={data?.today.length
                  ? "You have reached the end of today’s classes. Open your timetable to plan what comes next."
                  : "Add your schedule once and KampusOne will build your Today view from it."}
                icon="calendar-outline"
                onAction={() => router.push("/timetable")}
                title={data?.today.length ? "Classes are done for today" : "No classes added for today"}
              />
            )}
            {upcoming.slice(1).map((item) => (
              <View key={item.id} style={styles.agendaRow}>
                <Text style={styles.agendaTime}>{item.starts_at}</Text>
                <View style={styles.agendaRail}><View style={styles.agendaDot} /></View>
                <View style={styles.agendaCopy}>
                  <Text style={styles.agendaTitle}>{item.course_code ?? item.title}</Text>
                  <Text style={styles.agendaMeta}>{item.venue ?? "Venue not added"}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.actionRow}>
            <QuickAction icon="document-text-outline" label={data?.academics.cgpa ? `CGPA ${data.academics.cgpa}` : "CGPA"} onPress={() => { recordRecentTool("gpa"); router.push("/gpa"); }} />
            <QuickAction icon="sparkles-outline" label="AI Study" onPress={() => router.push("/explore")} />
            <QuickAction icon="play-circle-outline" label="Tutorials" onPress={() => { recordRecentTool("tutors"); router.push("/tutorials"); }} />
            <QuickAction icon="map-outline" label="Campus Map" onPress={() => { recordRecentTool("campus"); router.push("/map"); }} />
          </View>

          {data?.updates.length ? (
            <View style={styles.section}>
              <SectionHeading meta="See all" onPress={() => router.push("/feed")} title="Campus updates" />
              {data.updates.slice(0, 3).map((update) => (
                <Pressable
                  accessibilityLabel={`Open ${update.title} in Feed`}
                  accessibilityRole="button"
                  key={update.id}
                  onPress={() => router.push("/feed")}
                  style={({ pressed }) => [styles.update, pressed && styles.pressed]}
                >
                  {update.image_url ? (
                    <Image accessible={false} source={{ uri: update.image_url }} style={styles.updateImage} />
                  ) : (
                    <View style={styles.updateIcon}><Ionicons color={theme.deepBrand} name={update.urgent ? "warning-outline" : "newspaper-outline"} size={21} /></View>
                  )}
                  <View style={styles.updateCopy}>
                    <Text style={styles.updateSource}>{update.source_name} · {update.category}</Text>
                    <Text numberOfLines={2} style={styles.updateTitle}>{update.title}</Text>
                    <Text numberOfLines={2} style={styles.updateBody}>{update.summary}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </ProductScreen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
    >
      <View style={styles.quickIcon}><Ionicons color={theme.deepBrand} name={icon} size={22} /></View>
      <Text numberOfLines={2} style={styles.quickText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", paddingTop: 5 },
  greeting: { flex: 1, paddingRight: 10 },
  streak: { alignItems: "center", flexDirection: "row", gap: 5, minHeight: 44 },
  streakText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  greetingScript: { color: theme.deepBrand, fontFamily: theme.font.calligraphy, fontSize: 26, letterSpacing: -0.7, lineHeight: 30 },
  name: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 32, letterSpacing: -0.8, lineHeight: 34 },
  date: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, marginTop: 5 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 6 },
  bell: { alignItems: "center", height: 48, justifyContent: "center", width: 44 },
  hero: { backgroundColor: "#F6E8DD", borderRadius: 26, justifyContent: "center", marginTop: 20, minHeight: 226, overflow: "hidden", padding: 20, position: "relative" },
  heroOrb: { backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 90, height: 180, position: "absolute", right: -56, top: -44, width: 180 },
  heroCopy: { paddingVertical: 5, width: "56%", zIndex: 2 },
  heroTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 27, letterSpacing: -0.6, lineHeight: 28 },
  heroButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.deepBrand, borderRadius: 15, flexDirection: "row", gap: 8, marginTop: 18, minHeight: 47, paddingHorizontal: 16 },
  heroButtonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  heroImage: { bottom: -8, height: 215, position: "absolute", right: -8, width: "56%" },
  loading: { alignItems: "center", gap: 9, paddingVertical: 34 },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
  error: { alignItems: "center", backgroundColor: "#FFF2EC", borderColor: "rgba(168,70,46,0.18)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginTop: 20, padding: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13.5 },
  errorBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  section: { marginTop: 25 },
  nextCard: { alignItems: "center", backgroundColor: theme.midnight, borderRadius: 21, flexDirection: "row", minHeight: 106, padding: 15 },
  nextTime: { borderRightColor: "rgba(255,255,255,0.16)", borderRightWidth: 1, paddingRight: 13 },
  nextStart: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 18 },
  nextEnd: { color: "#D8CEC7", fontFamily: theme.font.body, fontSize: 10.5, marginTop: 2 },
  nextCopy: { flex: 1, paddingHorizontal: 13 },
  nextTag: { color: theme.peach, fontFamily: theme.font.bold, fontSize: 10.5 },
  nextTitle: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14.5, marginTop: 5 },
  nextMeta: { color: "#D8CEC7", fontFamily: theme.font.body, fontSize: 10.5, marginTop: 4 },
  agendaRow: { alignItems: "stretch", flexDirection: "row", minHeight: 62, paddingHorizontal: 6 },
  agendaTime: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11.5, paddingTop: 17, width: 48 },
  agendaRail: { alignItems: "center", borderLeftColor: "rgba(195,93,56,0.25)", borderLeftWidth: 1, marginRight: 13, width: 10 },
  agendaDot: { backgroundColor: theme.brand, borderColor: theme.canvas, borderRadius: 5, borderWidth: 2, height: 10, left: -0.5, position: "absolute", top: 19, width: 10 },
  agendaCopy: { borderBottomColor: theme.border, borderBottomWidth: 1, flex: 1, paddingVertical: 14 },
  agendaTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  agendaMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 18 },
  quick: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.88)", borderColor: theme.border, borderRadius: 18, borderWidth: 1, flex: 1, minHeight: 104, paddingHorizontal: 5, paddingVertical: 12 },
  quickIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  quickText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 14, marginTop: 9, textAlign: "center" },
  update: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 98, paddingVertical: 10 },
  updateImage: { borderRadius: 14, height: 75, width: 75 },
  updateIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 14, height: 56, justifyContent: "center", width: 56 },
  updateCopy: { flex: 1, marginLeft: 12 },
  updateSource: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 9.5 },
  updateTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5, lineHeight: 18, marginTop: 3 },
  updateBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
