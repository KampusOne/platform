import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, ProductScreen } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type AgendaItem = { id: string; title: string; course_code: string | null; venue: string | null; lecturer: string | null; starts_at: string; ends_at: string };
type Update = { id: string; title: string; summary: string; category: string; source_name: string; urgent: boolean; image_url: string | null };
type Home = {
  profile: { first_name: string | null; display_name: string } | null;
  today: AgendaItem[];
  updates: Update[];
  academics: { cgpa: string | number | null; total_units: string | number | null };
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TodayScreen() {
  const { profile } = useAuth();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError("");
    try { setData(await api<Home>("/v1/student/home")); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Your campus day could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const firstName = data?.profile?.first_name ?? profile?.first_name ?? "there";
  const next = data?.today[0];
  const date = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", weekday: "long" }).format(new Date());
  const initials = (profile?.display_name ?? "Kampus One").split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  return (
    <ProductScreen>
      <AppHeader initials={initials} showStreak={false} subtitle={date} title={`${greeting()}, ${firstName}`} unread={false} />
      <View style={styles.lifeCard}>
        <Image source={require("@/assets/brand-scenes/campus-life.png")} style={styles.lifeImage} />
        <View style={styles.lifeShade} />
        <View style={styles.lifeCopy}><Text style={styles.lifeEyebrow}>KAMPUSONE · {profile?.university_name ?? "YOUR CAMPUS"}</Text><Text style={styles.lifeTitle}>Everything you need for today.</Text></View>
      </View>
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.brand} /><Text style={styles.loadingText}>Loading your real campus data…</Text></View> : null}
      {error ? (
        <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load(); }} style={styles.error}>
          <Ionicons name="cloud-offline-outline" size={22} color={theme.deepBrand} />
          <View style={styles.errorCopy}><Text style={styles.errorTitle}>Couldn’t load your day</Text><Text style={styles.errorBody}>{error} Tap to retry.</Text></View>
        </Pressable>
      ) : null}
      {!loading && !error ? (
        <>
          <View style={styles.section}>
            <SectionHeading meta={`${data?.today.length ?? 0} today`} onPress={() => router.push("/timetable")} title="Your timetable" />
            {next ? (
              <Pressable onPress={() => router.push("/timetable")} style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]}>
                <View style={styles.nextTime}><Text style={styles.nextStart}>{next.starts_at}</Text><Text style={styles.nextEnd}>{next.ends_at}</Text></View>
                <View style={styles.nextCopy}><Text style={styles.nextTag}>NEXT CLASS</Text><Text style={styles.nextTitle}>{next.course_code ? `${next.course_code} · ` : ""}{next.title}</Text><Text style={styles.nextMeta}>{next.venue ?? "Venue not added"}{next.lecturer ? ` · ${next.lecturer}` : ""}</Text></View>
                <Ionicons name="arrow-forward-circle" size={30} color={theme.brand} />
              </Pressable>
            ) : <EmptyResult body="Add your class schedule once and KampusOne will build your Today view from it." title="No classes added for today" />}
            {data?.today.slice(1).map((item) => (
              <View key={item.id} style={styles.agendaRow}><Text style={styles.agendaTime}>{item.starts_at}</Text><View style={styles.agendaDot} /><View style={styles.agendaCopy}><Text style={styles.agendaTitle}>{item.course_code ?? item.title}</Text><Text style={styles.agendaMeta}>{item.venue ?? "Venue not added"}</Text></View></View>
            ))}
          </View>
          <View style={styles.actionRow}>
            <QuickAction icon="calendar-outline" label="Add class" onPress={() => router.push("/timetable")} />
            <QuickAction icon="calculator-outline" label={data?.academics.cgpa ? `CGPA ${data.academics.cgpa}` : "Add results"} onPress={() => router.push("/profile")} />
            <QuickAction icon="map-outline" label="Find a place" onPress={() => router.push("/campus")} />
          </View>
          <View style={styles.section}>
            <SectionHeading meta="Verified sources" onPress={() => router.push("/feed")} title="Campus updates" />
            {data?.updates.length ? data.updates.slice(0, 3).map((update) => (
              <Pressable key={update.id} onPress={() => router.push("/feed")} style={({ pressed }) => [styles.update, pressed && styles.pressed]}>
                {update.image_url ? <Image source={{ uri: update.image_url }} style={styles.updateImage} /> : <View style={styles.updateIcon}><Ionicons name={update.urgent ? "warning-outline" : "newspaper-outline"} size={22} color={theme.brandPressed} /></View>}
                <View style={styles.updateCopy}><Text style={styles.updateSource}>{update.source_name} · {update.category}</Text><Text numberOfLines={2} style={styles.updateTitle}>{update.title}</Text><Text numberOfLines={2} style={styles.updateBody}>{update.summary}</Text></View>
              </Pressable>
            )) : <EmptyResult body="Approved university updates will appear here as soon as your content team publishes them." title="No published updates yet" />}
          </View>
        </>
      ) : null}
    </ProductScreen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.quick, pressed && styles.pressed]}><View style={styles.quickIcon}><Ionicons name={icon} size={22} color={theme.brandPressed} /></View><Text numberOfLines={2} style={styles.quickText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  lifeCard: { borderRadius: 25, height: 190, marginBottom: 20, overflow: "hidden", position: "relative" }, lifeImage: { height: "100%", width: "100%" }, lifeShade: { backgroundColor: "rgba(41,35,31,0.34)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }, lifeCopy: { bottom: 18, left: 18, position: "absolute", right: 18 }, lifeEyebrow: { color: "#FFF8F2", fontFamily: theme.font.bold, fontSize: 9.5, letterSpacing: 1 }, lifeTitle: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 25, marginTop: 5 },
  loading: { alignItems: "center", gap: 10, paddingVertical: 32 }, loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderColor: "#F1C5B5", borderRadius: 19, borderWidth: 1, flexDirection: "row", gap: 12, padding: 15 }, errorCopy: { flex: 1 }, errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 14 }, errorBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 3 },
  section: { marginTop: 24 }, nextCard: { alignItems: "center", backgroundColor: theme.text, borderRadius: 23, flexDirection: "row", minHeight: 112, padding: 16 }, nextTime: { borderRightColor: "rgba(255,255,255,.18)", borderRightWidth: 1, paddingRight: 14 }, nextStart: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 19 }, nextEnd: { color: "#CFC5BE", fontFamily: theme.font.body, fontSize: 11, marginTop: 3 }, nextCopy: { flex: 1, paddingHorizontal: 14 }, nextTag: { color: theme.peach, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 1 }, nextTitle: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 15, marginTop: 5 }, nextMeta: { color: "#CFC5BE", fontFamily: theme.font.body, fontSize: 11, marginTop: 4 },
  agendaRow: { alignItems: "center", flexDirection: "row", minHeight: 62, paddingHorizontal: 8 }, agendaTime: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, width: 48 }, agendaDot: { backgroundColor: theme.clay, borderRadius: 4, height: 8, marginHorizontal: 9, width: 8 }, agendaCopy: { borderBottomColor: theme.border, borderBottomWidth: 1, flex: 1, paddingVertical: 12 }, agendaTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 }, agendaMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, marginTop: 3 },
  actionRow: { flexDirection: "row", gap: 9, marginTop: 24 }, quick: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flex: 1, minHeight: 105, padding: 12 }, quickIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 40, justifyContent: "center", width: 40 }, quickText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11.5, lineHeight: 16, marginTop: 9 },
  update: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 19, borderWidth: 1, flexDirection: "row", marginBottom: 10, minHeight: 105, padding: 10 }, updateImage: { borderRadius: 14, height: 82, width: 82 }, updateIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, height: 62, justifyContent: "center", width: 62 }, updateCopy: { flex: 1, marginLeft: 12 }, updateSource: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: .4 }, updateTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5, marginTop: 4 }, updateBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 3 }, pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
