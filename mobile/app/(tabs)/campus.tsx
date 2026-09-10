import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, ProductScreen, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const categories = ["All", "Academic", "Service", "Transport", "Hostel", "Food", "Health", "Sport"] as const;
type Place = { id: string; name: string; category: string; description: string | null; latitude: string | null; longitude: string | null; accessibility_notes: string | null; image_url: string | null; verified_at: string | null };

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  ACADEMIC: "school-outline", SERVICE: "help-buoy-outline", TRANSPORT: "bus-outline",
  HOSTEL: "bed-outline", FOOD: "restaurant-outline", HEALTH: "medkit-outline", SPORT: "football-outline",
};

export default function CampusScreen() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setError(""); setPlaces((await api<{ places: Place[] }>("/v1/student/campus/places")).places); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Campus places could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const filtered = useMemo(() => places.filter((place) => {
    const needle = query.trim().toLowerCase();
    return (selected === "All" || place.category === selected.toUpperCase())
      && (!needle || `${place.name} ${place.description ?? ""}`.toLowerCase().includes(needle));
  }), [places, query, selected]);

  async function directions(place: Place) {
    if (!place.latitude || !place.longitude) return;
    const coordinates = `${place.latitude},${place.longitude}`;
    await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates)}`);
  }

  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "location", text: "Reviewed campus directory", verified: true }} showBell={false} subtitle="Buildings, services and student spots" title="Campus" unread={false} />
      <View style={styles.hero}>
        <Image source={require("@/assets/brand-scenes/campus-life.png")} style={styles.heroImage} />
        <View style={styles.heroShade} /><View style={styles.heroCopy}><Text style={styles.heroEyebrow}>FIND YOUR WAY</Text><Text style={styles.heroTitle}>Know the campus like a local.</Text></View>
      </View>
      <SearchField onChangeText={setQuery} placeholder="Find a building or service" value={query} />
      <View style={styles.filters}><FilterRow items={categories} onSelect={(item) => setSelected(item as typeof selected)} selected={selected} /></View>
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.brand} /><Text style={styles.loadingText}>Loading reviewed campus places…</Text></View> : null}
      {error ? <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.error}><Ionicons name="cloud-offline-outline" size={20} color={theme.deepBrand} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {!loading && !error && !filtered.length ? <EmptyResult body="No reviewed place matches this search. Campus editors can add it from the admin portal." title="Place not found" /> : null}
      <View style={styles.list}>
        {filtered.map((place) => (
          <View key={place.id} style={styles.card}>
            {place.image_url ? <Image source={{ uri: place.image_url }} style={styles.image} /> : <View style={styles.icon}><Ionicons name={icons[place.category] ?? "location-outline"} size={25} color={theme.brandPressed} /></View>}
            <View style={styles.copy}>
              <View style={styles.categoryRow}><Text style={styles.category}>{place.category}</Text>{place.verified_at ? <Ionicons name="checkmark-circle" size={14} color={theme.brand} /> : null}</View>
              <Text style={styles.name}>{place.name}</Text>
              <Text numberOfLines={2} style={styles.description}>{place.description ?? "Campus information will be added by a verified editor."}</Text>
              {place.accessibility_notes ? <View style={styles.access}><Ionicons name="accessibility-outline" size={14} color={theme.info} /><Text numberOfLines={2} style={styles.accessText}>{place.accessibility_notes}</Text></View> : null}
            </View>
            <Pressable accessibilityLabel={`Directions to ${place.name}`} disabled={!place.latitude || !place.longitude} onPress={() => void directions(place)} style={[styles.direction, (!place.latitude || !place.longitude) && styles.directionDisabled]}><Ionicons name="navigate" size={19} color="#FFFFFF" /></Pressable>
          </View>
        ))}
      </View>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 24, height: 190, marginBottom: 16, overflow: "hidden", position: "relative" }, heroImage: { height: "100%", width: "100%" }, heroShade: { backgroundColor: "rgba(41,35,31,.32)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }, heroCopy: { bottom: 17, left: 17, position: "absolute", right: 17 }, heroEyebrow: { color: theme.peach, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 1.1 }, heroTitle: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 24, marginTop: 5 },
  filters: { marginBottom: 17, marginTop: 12 }, loading: { alignItems: "center", gap: 9, paddingVertical: 34 }, loadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 }, error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 16, flexDirection: "row", gap: 9, marginBottom: 15, padding: 13 }, errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12 }, list: { gap: 11 },
  card: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 20, borderWidth: 1, flexDirection: "row", minHeight: 116, padding: 10, ...theme.shadow }, image: { borderRadius: 15, height: 92, width: 92 }, icon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 15, height: 72, justifyContent: "center", width: 72 }, copy: { flex: 1, marginLeft: 12 }, categoryRow: { alignItems: "center", flexDirection: "row", gap: 4 }, category: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: .6 }, name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5, marginTop: 4 }, description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 4 }, access: { alignItems: "flex-start", flexDirection: "row", gap: 4, marginTop: 5 }, accessText: { color: theme.info, flex: 1, fontFamily: theme.font.medium, fontSize: 9.5 }, direction: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 15, height: 44, justifyContent: "center", marginLeft: 7, width: 44 }, directionDisabled: { backgroundColor: theme.textSubtle, opacity: .5 },
});
