import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { theme } from "@/src/theme";

const categories = ["All", "Academic", "Services", "Transport"] as const;

const places = [
  { id: "lt3", name: "Lecture Theatre 3", category: "Academic", note: "Main campus · Engineering", walk: "7 min", icon: "school-outline", open: "Open" },
  { id: "library", name: "John Harris Library", category: "Academic", note: "Central library", walk: "11 min", icon: "library-outline", open: "Open" },
  { id: "health", name: "University Health Centre", category: "Services", note: "Emergency and routine care", walk: "14 min", icon: "medkit-outline", open: "24 hours" },
  { id: "shuttle", name: "Main Gate Shuttle Stop", category: "Transport", note: "Ugbowo route", walk: "5 min", icon: "bus-outline", open: "Active" },
] as const;

export default function CampusScreen() {
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [routePlace, setRoutePlace] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return places.filter((place) => {
      const categoryMatch = selected === "All" || place.category === selected;
      const searchMatch = !needle || `${place.name} ${place.note} ${place.category}`.toLowerCase().includes(needle);
      return categoryMatch && searchMatch;
    });
  }, [query, selected]);

  function tap() {
    void Haptics.selectionAsync();
  }

  function chooseRoute(name: string) {
    tap();
    setRoutePlace(name);
  }

  function toggleSaved(id: string) {
    tap();
    setSaved((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  }

  return (
    <ProductScreen>
      <AppHeader title="Campus" subtitle="University of Benin · Preview map" showBell={false} unread={false} />
      <SearchField onChangeText={setQuery} placeholder="Find a building or service" value={query} />
      <View style={styles.filters}>
        <FilterRow
          items={categories}
          onSelect={(item) => {
            tap();
            setSelected(item as (typeof categories)[number]);
          }}
          selected={selected}
        />
      </View>

      {routePlace ? <InlineFeedback message={`Sample walking route to ${routePlace} is selected.`} tone="success" /> : null}

      <View style={styles.featured}>
        <View style={styles.featuredTop}>
          <View style={styles.featuredIcon}><Ionicons name="navigate" size={24} color="#FFFFFF" /></View>
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredLabel}>Closest to your next class</Text>
            <Text style={styles.featuredTitle}>Lecture Theatre 3</Text>
            <Text style={styles.featuredMeta}>About 7 minutes on foot · Sample location</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => chooseRoute("Lecture Theatre 3")}
          style={({ pressed }) => [styles.routeButton, pressed && styles.pressed]}
        >
          <Text style={styles.routeButtonText}>Preview directions</Text>
          <Ionicons name="arrow-forward" size={18} color={theme.brandPressed} />
        </Pressable>
      </View>

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} places`} title={selected === "All" ? "Nearby places" : selected} />
        {filtered.length ? (
          <View style={styles.list}>
            {filtered.map((place) => {
              const isSaved = saved.includes(place.id);
              return (
                <View style={styles.row} key={place.id}>
                  <View style={styles.placeIcon}><Ionicons name={place.icon} size={22} color={theme.brand} /></View>
                  <View style={styles.placeCopy}>
                    <Text style={styles.placeName}>{place.name}</Text>
                    <Text style={styles.placeNote}>{place.note}</Text>
                    <View style={styles.placeMetaRow}>
                      <Ionicons name="walk-outline" size={15} color={theme.textSubtle} />
                      <Text style={styles.placeMeta}>{place.walk}</Text>
                      <View style={styles.metaDot} />
                      <Text style={styles.openText}>{place.open}</Text>
                    </View>
                  </View>
                  <View style={styles.rowActions}>
                    <Pressable accessibilityLabel={isSaved ? "Unsave place" : "Save place"} hitSlop={8} onPress={() => toggleSaved(place.id)} style={({ pressed }) => pressed && styles.faded}>
                      <Ionicons name={isSaved ? "bookmark" : "bookmark-outline"} size={20} color={isSaved ? theme.brand : theme.textSubtle} />
                    </Pressable>
                    <Pressable accessibilityLabel={`Preview route to ${place.name}`} hitSlop={8} onPress={() => chooseRoute(place.name)} style={({ pressed }) => pressed && styles.faded}>
                      <Ionicons name="arrow-forward-circle-outline" size={22} color={theme.brand} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Check the spelling or choose another category." title="No campus place found" />
        )}
      </View>

      <Text style={styles.disclaimer}>Locations and walking times are samples. Live routing will only use reviewed campus data.</Text>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 17, marginTop: 12 },
  featured: { backgroundColor: theme.brandPressed, borderRadius: 22, marginTop: 16, overflow: "hidden", padding: 18, ...theme.shadow },
  featuredTop: { alignItems: "center", flexDirection: "row", gap: 13 },
  featuredIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.22)", borderRadius: 16, borderWidth: 1, height: 52, justifyContent: "center", width: 52 },
  featuredCopy: { flex: 1 },
  featuredLabel: { color: "#F3C7B4", fontFamily: theme.font.semibold, fontSize: 11.5, letterSpacing: 0.35, textTransform: "uppercase" },
  featuredTitle: { color: "#FFFFFF", fontFamily: theme.font.display, fontSize: 21, marginTop: 4 },
  featuredMeta: { color: "#EEDDD5", fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  routeButton: { alignItems: "center", backgroundColor: theme.canvas, borderRadius: 13, flexDirection: "row", justifyContent: "space-between", marginTop: 16, minHeight: 46, paddingHorizontal: 14 },
  routeButtonText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5 },
  section: { marginTop: 27 },
  list: { gap: 10 },
  row: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 88, padding: 14 },
  placeIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  placeCopy: { flex: 1, marginLeft: 12 },
  placeName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5 },
  placeNote: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12, marginTop: 3 },
  placeMetaRow: { alignItems: "center", flexDirection: "row", marginTop: 7 },
  placeMeta: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5, marginLeft: 4 },
  metaDot: { backgroundColor: theme.border, borderRadius: 2, height: 4, marginHorizontal: 7, width: 4 },
  openText: { color: theme.success, fontFamily: theme.font.semibold, fontSize: 11.5 },
  rowActions: { alignItems: "center", gap: 13, marginLeft: 8 },
  disclaimer: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 26, textAlign: "center" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  faded: { opacity: 0.55 },
});
