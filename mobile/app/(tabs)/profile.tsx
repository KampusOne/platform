import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { ProductScreen } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Academic = { summary: { cgpa: string | number | null; total_units: string | number | null } | null; terms: unknown[] };
type Purchases = { tutorialBookings: unknown[]; orders: unknown[] };

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const [academics, setAcademics] = useState<Academic | null>(null); const [purchases, setPurchases] = useState<Purchases | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setError(""); const [gpa, bought] = await Promise.all([api<Academic>("/v1/student/gpa"), api<Purchases>("/v1/student/purchases")]); setAcademics(gpa); setPurchases(bought); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Account details could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const initials = (profile?.display_name ?? "Student").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <ProductScreen>
      <View style={styles.topbar}><Pressable accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={21} color={theme.text} /></Pressable><Image resizeMode="contain" source={require("@/assets/brand/kampusone-horizontal-ink.png")} style={styles.brand} /><View style={styles.back} /></View>
      <View style={styles.hero}><View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View><Text style={styles.name}>{profile?.display_name ?? "Student"}</Text><View style={styles.verified}><Ionicons name="checkmark-circle" size={16} color={theme.brand} /><Text style={styles.verifiedText}>Email verified</Text></View><Text style={styles.school}>{profile?.university_name ?? "University not selected"}</Text></View>
      {loading ? <ActivityIndicator color={theme.brand} style={styles.loading} /> : null}
      {error ? <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.error}><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      <View style={styles.metrics}>
        <Metric label="CGPA" value={academics?.summary?.cgpa ? String(academics.summary.cgpa) : "—"} />
        <Metric label="Semesters" value={String(academics?.terms.length ?? 0)} />
        <Metric label="Purchases" value={String((purchases?.orders.length ?? 0) + (purchases?.tutorialBookings.length ?? 0))} />
      </View>
      <View style={styles.menu}>
        <Menu icon="calculator-outline" title="GPA and CGPA" body="Add semester results and track your real calculation" onPress={() => router.push("/gpa")} />
        <Menu icon="calendar-outline" title="My timetable" body="Manage class times, venues and reminders" onPress={() => router.push("/timetable")} />
        <Menu icon="briefcase-outline" title="Become an agent" body="Apply as a tutor, vendor or bicycle rider" onPress={() => void Linking.openURL("https://agents.kampusone.app")} />
        <Menu icon="receipt-outline" title="Bookings and orders" body={`${purchases?.tutorialBookings.length ?? 0} tutorials · ${purchases?.orders.length ?? 0} store orders`} onPress={() => router.push("/purchases")} />
      </View>
      <Pressable onPress={() => void signOut()} style={styles.signOut}><Ionicons name="log-out-outline" size={20} color={theme.deepBrand} /><Text style={styles.signOutText}>Sign out securely</Text></Pressable>
      <Text style={styles.version}>KampusOne 0.2 · Student utility</Text>
    </ProductScreen>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Menu({ icon, title, body, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress: () => void }) { return <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}><View style={styles.menuIcon}><Ionicons name={icon} size={21} color={theme.brandPressed} /></View><View style={styles.menuCopy}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.menuBody}>{body}</Text></View><Ionicons name="chevron-forward" size={18} color={theme.textSubtle} /></Pressable>; }

const styles = StyleSheet.create({
  topbar: { alignItems: "center", flexDirection: "row", height: 58, justifyContent: "space-between" }, back: { alignItems: "center", borderRadius: 15, height: 42, justifyContent: "center", width: 42 }, brand: { height: 29, width: 138 }, hero: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 25, borderWidth: 1, padding: 22, ...theme.shadow }, avatar: { alignItems: "center", backgroundColor: theme.brand, borderColor: theme.sand, borderRadius: 38, borderWidth: 4, height: 76, justifyContent: "center", width: 76 }, avatarText: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 22 }, name: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 25, marginTop: 12 }, verified: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 4 }, verifiedText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 10.5 }, school: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, marginTop: 6 }, loading: { marginVertical: 24 }, error: { backgroundColor: "#FFF0EB", borderRadius: 14, marginTop: 14, padding: 12 }, errorText: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 11.5 },
  metrics: { backgroundColor: theme.text, borderRadius: 21, flexDirection: "row", marginTop: 15, paddingVertical: 17 }, metric: { alignItems: "center", borderRightColor: "rgba(255,255,255,.15)", borderRightWidth: 1, flex: 1 }, metricValue: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 20 }, metricLabel: { color: "#CFC5BE", fontFamily: theme.font.medium, fontSize: 9.5, marginTop: 3 }, menu: { gap: 9, marginTop: 20 }, menuRow: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 78, padding: 12 }, menuIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, height: 46, justifyContent: "center", width: 46 }, menuCopy: { flex: 1, marginLeft: 11 }, menuTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 }, menuBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 3 }, signOut: { alignItems: "center", borderColor: "#EAC8BC", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 22, minHeight: 52 }, signOutText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 12.5 }, version: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 16, textAlign: "center" }, pressed: { opacity: .78, transform: [{ scale: .99 }] },
});
