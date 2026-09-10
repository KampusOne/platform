import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, ProductScreen, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Availability = { id: string; starts_at: string; ends_at: string; capacity: number; booked_spaces: number };
type Listing = { id: string; course_code: string; title: string; description: string; format: string; price_kobo: number; capacity: number; tutor_name: string; tutor_biography: string | null; availability: Availability[] };

function naira(kobo: number) { return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100); }

export default function TutorialsScreen() {
  const [listings, setListings] = useState<Listing[]>([]); const [query, setQuery] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [selectedWindows, setSelectedWindows] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try { setError(""); setListings((await api<{ listings: Listing[] }>("/v1/student/tutorials")).listings); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Tutorials could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const filtered = useMemo(() => listings.filter((item) => `${item.course_code} ${item.title} ${item.description} ${item.tutor_name}`.toLowerCase().includes(query.trim().toLowerCase())), [listings, query]);

  async function book(listing: Listing) {
    setBusy(listing.id); setError(""); setNotice("");
    try {
      const availabilityWindowId = selectedWindows[listing.id] ?? listing.availability[0]?.id;
      if (!availabilityWindowId) throw new ApiError(409, "CONFLICT", "Choose an available tutorial time.");
      const booking = await api<{ id: string }>("/v1/student/tutorial-bookings", { method: "POST", body: JSON.stringify({ listingId: listing.id, availabilityWindowId }) });
      const payment = await api<{ authorizationUrl: string }>("/v1/payments/initialize", { method: "POST", body: JSON.stringify({ resourceType: "TUTORIAL_BOOKING", resourceId: booking.id }) });
      await Linking.openURL(payment.authorizationUrl);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "PROVIDER_UNAVAILABLE") setNotice("Your booking was saved, but secure payment is not configured yet. It remains unpaid and no money was taken.");
      else setError(caught instanceof ApiError ? caught.message : "The tutorial could not be booked.");
    } finally { setBusy(""); }
  }

  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "shield-checkmark", text: "Approved campus tutors", verified: true }} showBell={false} subtitle="Learn from students who know the course" title="Tutorials" unread={false} />
      <View style={styles.hero}><Image source={require("@/assets/brand-scenes/tutorials.png")} style={styles.heroImage} /><View style={styles.heroShade} /><View style={styles.heroCopy}><Text style={styles.heroEyebrow}>STUDY TOGETHER</Text><Text style={styles.heroTitle}>Understand it. Practise it. Own it.</Text></View></View>
      <SearchField onChangeText={setQuery} placeholder="Search a course, topic or tutor" value={query} />
      {notice ? <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={theme.statusAttention} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.brand} /><Text style={styles.loadingText}>Finding approved tutors…</Text></View> : null}
      {error ? <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.error}><Ionicons name="alert-circle-outline" size={20} color={theme.deepBrand} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {!loading && !error && !filtered.length ? <EmptyResult body="Approved tutor listings for your university will appear here. Tutors can apply from the agent portal." title="No tutorials published yet" /> : null}
      <View style={styles.list}>{filtered.map((listing, index) => <TutorialCard busy={busy === listing.id} index={index} key={listing.id} listing={listing} onBook={() => void book(listing)} onSelect={(id) => setSelectedWindows((current) => ({ ...current, [listing.id]: id }))} selectedId={selectedWindows[listing.id] ?? listing.availability[0]?.id} />)}</View>
    </ProductScreen>
  );
}

function TutorialCard({ listing, index, selectedId, busy, onSelect, onBook }: { listing: Listing; index: number; selectedId: string | undefined; busy: boolean; onSelect(id: string): void; onBook(): void }) {
  const selected = listing.availability.find((window) => window.id === selectedId) ?? listing.availability[0];
  const formatWindow = (window: Availability) => new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(window.starts_at));
  return <View style={styles.card}>
    <View style={styles.cardTop}><View style={[styles.courseTile, index % 2 ? styles.courseTileAlt : null]}><Text style={styles.courseCode}>{listing.course_code}</Text><Ionicons name="school-outline" size={24} color="#FFFFFF" /></View><View style={styles.cardCopy}><View style={styles.format}><Text style={styles.formatText}>{listing.format.replace("_", " ")}</Text></View><Text style={styles.title}>{listing.title}</Text><Text numberOfLines={3} style={styles.description}>{listing.description}</Text></View></View>
    <View style={styles.tutorRow}><View style={styles.avatar}><Text style={styles.avatarText}>{listing.tutor_name.slice(0, 2).toUpperCase()}</Text></View><View style={styles.tutorCopy}><Text style={styles.tutorName}>{listing.tutor_name}</Text><Text numberOfLines={1} style={styles.tutorBio}>{listing.tutor_biography ?? "Approved KampusOne tutor"}</Text></View><Ionicons name="checkmark-circle" size={18} color={theme.brand} /></View>
    <Text style={styles.timeLabel}>CHOOSE A BOOKABLE TIME</Text><View style={styles.windows}>{listing.availability.map((window) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected?.id === window.id }} key={window.id} onPress={() => onSelect(window.id)} style={[styles.window, selected?.id === window.id && styles.windowSelected]}><Text style={[styles.windowText, selected?.id === window.id && styles.windowTextSelected]}>{formatWindow(window)}</Text></Pressable>)}</View>
    <View style={styles.footer}><View><Text style={styles.price}>{naira(Number(listing.price_kobo))}</Text><Text style={styles.spaces}>{selected ? Math.max(0, selected.capacity - selected.booked_spaces) : 0} spaces at this time</Text></View><Pressable disabled={busy || !selected} onPress={onBook} style={[styles.book, (busy || !selected) && styles.disabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.bookText}>Book tutorial</Text><Ionicons name="arrow-forward" size={17} color="#FFFFFF" /></>}</Pressable></View>
  </View>;
}

const styles = StyleSheet.create({
  hero: { borderRadius: 25, height: 205, marginBottom: 16, overflow: "hidden", position: "relative" }, heroImage: { height: "100%", width: "100%" }, heroShade: { backgroundColor: "rgba(41,35,31,.35)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }, heroCopy: { bottom: 17, left: 17, position: "absolute", right: 17 }, heroEyebrow: { color: theme.peach, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 1.1 }, heroTitle: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 24, marginTop: 5 },
  notice: { alignItems: "flex-start", backgroundColor: "#FFF7E9", borderRadius: 15, flexDirection: "row", gap: 8, marginTop: 13, padding: 13 }, noticeText: { color: theme.statusAttention, flex: 1, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17 }, loading: { alignItems: "center", gap: 9, paddingVertical: 34 }, loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 }, error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 16, flexDirection: "row", gap: 9, marginTop: 14, padding: 13 }, errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12 }, list: { gap: 14, marginTop: 17 },
  card: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 23, borderWidth: 1, overflow: "hidden", padding: 13, ...theme.shadow }, cardTop: { flexDirection: "row" }, courseTile: { backgroundColor: theme.brand, borderRadius: 17, height: 112, justifyContent: "space-between", padding: 13, width: 105 }, courseTileAlt: { backgroundColor: theme.text }, courseCode: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 18 }, cardCopy: { flex: 1, marginLeft: 13 }, format: { alignSelf: "flex-start", backgroundColor: theme.surfaceMuted, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 }, formatText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 7.5, letterSpacing: .6 }, title: { color: theme.text, fontFamily: theme.font.display, fontSize: 18, lineHeight: 22, marginTop: 6 }, description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 4 },
  tutorRow: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", marginTop: 13, paddingBottom: 12 }, avatar: { alignItems: "center", backgroundColor: theme.sand, borderRadius: 15, height: 34, justifyContent: "center", width: 34 }, avatarText: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 9 }, tutorCopy: { flex: 1, marginLeft: 9 }, tutorName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11.5 }, tutorBio: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 2 }, footer: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingTop: 12 }, price: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 18 }, spaces: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 2 }, book: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 14, flexDirection: "row", gap: 7, height: 46, justifyContent: "center", paddingHorizontal: 15 }, bookText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 11.5 }, disabled: { opacity: .55 },
  timeLabel: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: .75, marginTop: 12 }, windows: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 7 }, window: { backgroundColor: theme.surfaceMuted, borderColor: theme.border, borderRadius: 10, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 }, windowSelected: { backgroundColor: theme.brand, borderColor: theme.brand }, windowText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 8.5 }, windowTextSelected: { color: "#FFFFFF" },
});
