import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { FavoriteButton, GlassCard, PressScale, useReducedMotionPreference } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const categories = ["All", "Academic", "Services", "Transport"] as const;

const places = [
  { id: "lt3", name: "Lecture Theatre 3", category: "Academic", note: "Engineering axis", walk: "7 min", icon: "school-outline" as const, open: "Open" },
  { id: "library", name: "John Harris Library", category: "Academic", note: "Central library", walk: "11 min", icon: "library-outline" as const, open: "Open" },
  { id: "health", name: "University Health Centre", category: "Services", note: "Emergency and routine care", walk: "14 min", icon: "medkit-outline" as const, open: "24 hours" },
  { id: "shuttle", name: "Main Gate Shuttle Stop", category: "Transport", note: "Ugbowo route", walk: "5 min", icon: "bus-outline" as const, open: "Active" },
] as const;

export default function CampusScreen() {
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [routePlace, setRoutePlace] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const routeEntry = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotionPreference();

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
    routeEntry.setValue(0);
    if (reducedMotion) {
      routeEntry.setValue(1);
      return;
    }
    Animated.spring(routeEntry, { damping: 13, mass: 0.7, stiffness: 170, toValue: 1, useNativeDriver: true }).start();
  }

  function toggleSaved(id: string) {
    setSaved((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "location", text: "UNIBEN · Campus preview" }}
        showBell={false}
        subtitle="Find it. Walk there. Arrive ready."
        title="Campus"
        unread={false}
      />
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

      {routePlace ? <InlineFeedback message={`Walking route to ${routePlace} selected.`} tone="success" /> : null}

      <GlassCard style={styles.mapCard}>
        <CampusMiniMap routeEntry={routeEntry} routeVisible={Boolean(routePlace)} />
        <View style={styles.mapTopRow}>
          <View style={styles.liveChip}><View style={styles.liveDot} /><Text style={styles.liveText}>Campus preview</Text></View>
          <PressScale accessibilityLabel="Recenter map" onPress={tap} style={styles.mapRoundButton}>
            <Ionicons name="locate" size={19} color={theme.brandPressed} />
          </PressScale>
        </View>
        <View style={styles.destinationCard}>
          <View style={styles.destinationIcon}><Ionicons name="navigate" size={20} color="#FFFFFF" /></View>
          <View style={styles.destinationCopy}>
            <Text style={styles.destinationLabel}>CLOSEST TO YOUR NEXT CLASS</Text>
            <Text style={styles.destinationTitle}>Lecture Theatre 3</Text>
            <Text style={styles.destinationMeta}>7 min walk · About 520 metres</Text>
          </View>
          <PressScale accessibilityLabel="Preview route to Lecture Theatre 3" onPress={() => chooseRoute("Lecture Theatre 3")} style={styles.goButton}>
            <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />
          </PressScale>
        </View>
      </GlassCard>

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} places`} title={selected === "All" ? "Nearby places" : selected} />
        {filtered.length ? (
          <View style={styles.list}>
            {filtered.map((place, index) => {
              const isSaved = saved.includes(place.id);
              return (
                <Pressable
                  accessibilityLabel={`Open ${place.name}`}
                  key={place.id}
                  onPress={() => chooseRoute(place.name)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={[styles.placeNumber, index === 0 && styles.placeNumberActive]}><Text style={[styles.placeNumberText, index === 0 && styles.placeNumberTextActive]}>{index + 1}</Text></View>
                  <View style={styles.placeIcon}><Ionicons name={place.icon} size={21} color={theme.brandPressed} /></View>
                  <View style={styles.placeCopy}>
                    <Text style={styles.placeName}>{place.name}</Text>
                    <Text style={styles.placeNote}>{place.note}</Text>
                    <View style={styles.placeMetaRow}>
                      <Ionicons name="walk-outline" size={14} color={theme.textSubtle} />
                      <Text style={styles.placeMeta}>{place.walk}</Text>
                      <View style={styles.metaDot} />
                      <Text style={styles.openText}>{place.open}</Text>
                    </View>
                  </View>
                  <View style={styles.rowActions}>
                    <FavoriteButton active={isSaved} label={isSaved ? "Remove saved place" : "Save place"} onPress={() => toggleSaved(place.id)} />
                    <Ionicons name="chevron-forward" size={18} color={theme.brandPressed} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Check the spelling or choose another category." title="No campus place found" />
        )}
      </View>

      <Text style={styles.disclaimer}>Walking times are preview estimates. Live routing will use reviewed campus paths and accessibility data.</Text>
    </ProductScreen>
  );
}

function CampusMiniMap({ routeEntry, routeVisible }: { routeEntry: Animated.Value; routeVisible: boolean }) {
  return (
    <View pointerEvents="none" style={styles.map}>
      <View style={styles.mapPatchOne} /><View style={styles.mapPatchTwo} /><View style={styles.mapPatchThree} />
      <View style={[styles.mapRoad, styles.mapRoadOne]} /><View style={[styles.mapRoad, styles.mapRoadTwo]} /><View style={[styles.mapRoad, styles.mapRoadThree]} />
      <View style={[styles.mapBuilding, styles.mapBuildingOne]}><Text style={styles.mapBuildingText}>LIBRARY</Text></View>
      <View style={[styles.mapBuilding, styles.mapBuildingTwo]}><Text style={styles.mapBuildingText}>LT 3</Text></View>
      <View style={[styles.mapBuilding, styles.mapBuildingThree]}><Text style={styles.mapBuildingText}>HALL B</Text></View>
      <View style={[styles.tree, styles.treeMapOne]} /><View style={[styles.tree, styles.treeMapTwo]} /><View style={[styles.tree, styles.treeMapThree]} />
      {routeVisible ? (
        <Animated.View style={[styles.routeWrap, { opacity: routeEntry, transform: [{ scale: routeEntry }] }]}>
          <View style={[styles.routeSegment, styles.routeOne]} /><View style={[styles.routeSegment, styles.routeTwo]} /><View style={[styles.routeSegment, styles.routeThree]} />
        </Animated.View>
      ) : null}
      <View style={styles.youPulse} /><View style={styles.youDot}><View style={styles.youDotCore} /></View>
      <View style={styles.pin}><Ionicons name="location" size={27} color={theme.brandPressed} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 15, marginTop: 12 },
  mapCard: { height: 320, padding: 10 },
  map: { backgroundColor: "#E9E2D7", borderRadius: 17, flex: 1, overflow: "hidden", position: "relative" },
  mapPatchOne: { backgroundColor: "#D4DFC8", borderRadius: 90, height: 160, left: -45, position: "absolute", top: -25, width: 190 },
  mapPatchTwo: { backgroundColor: "#E5D0B8", borderRadius: 100, bottom: -60, height: 170, position: "absolute", right: -27, width: 210 },
  mapPatchThree: { backgroundColor: "#CEDAC5", borderRadius: 60, height: 110, position: "absolute", right: 60, top: 52, width: 96 },
  mapRoad: { backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(178,158,143,0.35)", borderWidth: 1, position: "absolute" },
  mapRoadOne: { height: 390, left: 135, top: -70, transform: [{ rotate: "23deg" }], width: 28 },
  mapRoadTwo: { height: 28, left: -30, top: 142, transform: [{ rotate: "-9deg" }], width: 410 },
  mapRoadThree: { height: 260, right: 41, top: 24, transform: [{ rotate: "-17deg" }], width: 19 },
  mapBuilding: { alignItems: "center", backgroundColor: "#C99272", borderColor: "rgba(111,48,37,0.24)", borderRadius: 6, borderWidth: 1, justifyContent: "center", position: "absolute", ...theme.shadow },
  mapBuildingOne: { height: 47, left: 36, top: 67, transform: [{ rotate: "-5deg" }], width: 76 },
  mapBuildingTwo: { height: 55, right: 58, top: 78, transform: [{ rotate: "6deg" }], width: 71 },
  mapBuildingThree: { bottom: 40, height: 42, left: 76, transform: [{ rotate: "5deg" }], width: 66 },
  mapBuildingText: { color: "#FFF8F2", fontFamily: theme.font.bold, fontSize: 7, letterSpacing: 0.5 },
  tree: { backgroundColor: "#78926E", borderColor: "#E9E2D7", borderRadius: 11, borderWidth: 2, height: 22, position: "absolute", width: 22 },
  treeMapOne: { left: 19, top: 126 },
  treeMapTwo: { right: 28, top: 43 },
  treeMapThree: { bottom: 18, right: 130 },
  routeWrap: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  routeSegment: { backgroundColor: theme.brand, borderColor: "rgba(255,255,255,0.82)", borderRadius: 4, borderWidth: 1, height: 6, position: "absolute" },
  routeOne: { left: 145, top: 205, transform: [{ rotate: "-44deg" }], width: 62 },
  routeTwo: { left: 188, top: 165, transform: [{ rotate: "-3deg" }], width: 70 },
  routeThree: { left: 245, top: 137, transform: [{ rotate: "-58deg" }], width: 53 },
  youPulse: { backgroundColor: "rgba(52,110,138,0.18)", borderRadius: 22, bottom: 41, height: 44, left: 117, position: "absolute", width: 44 },
  youDot: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 11, bottom: 52, height: 22, justifyContent: "center", left: 128, position: "absolute", width: 22, ...theme.shadow },
  youDotCore: { backgroundColor: theme.info, borderRadius: 5, height: 10, width: 10 },
  pin: { position: "absolute", right: 76, top: 49 },
  mapTopRow: { flexDirection: "row", justifyContent: "space-between", left: 21, position: "absolute", right: 21, top: 21 },
  liveChip: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.89)", borderColor: "rgba(255,255,255,0.95)", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 7, ...theme.shadow },
  liveDot: { backgroundColor: theme.clay, borderRadius: 4, height: 8, width: 8 },
  liveText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 10.5 },
  mapRoundButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.91)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 17, borderWidth: 1, height: 36, justifyContent: "center", width: 36, ...theme.shadow },
  destinationCard: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.94)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 16, borderWidth: 1, bottom: 20, flexDirection: "row", left: 20, minHeight: 75, padding: 10, position: "absolute", right: 20, ...theme.glassShadow },
  destinationIcon: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, height: 45, justifyContent: "center", width: 45 },
  destinationCopy: { flex: 1, marginLeft: 10 },
  destinationLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 7.5, letterSpacing: 0.5 },
  destinationTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 15.5, marginTop: 2 },
  destinationMeta: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 2 },
  goButton: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  section: { marginTop: 27 },
  list: { gap: 10 },
  row: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.97)", borderRadius: 19, borderWidth: 1, flexDirection: "row", minHeight: 94, padding: 11, ...theme.shadow },
  placeNumber: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 8, height: 24, justifyContent: "center", marginRight: 8, width: 24 },
  placeNumberActive: { backgroundColor: theme.brand },
  placeNumberText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 10 },
  placeNumberTextActive: { color: "#FFFFFF" },
  placeIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.24)", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  placeCopy: { flex: 1, marginLeft: 11 },
  placeName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 },
  placeNote: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11, marginTop: 3 },
  placeMetaRow: { alignItems: "center", flexDirection: "row", marginTop: 6 },
  placeMeta: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5, marginLeft: 4 },
  metaDot: { backgroundColor: theme.border, borderRadius: 2, height: 4, marginHorizontal: 6, width: 4 },
  openText: { color: theme.statusPositive, fontFamily: theme.font.semibold, fontSize: 10.5 },
  rowActions: { alignItems: "center", alignSelf: "stretch", justifyContent: "space-between", marginLeft: 7 },
  disclaimer: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 16, marginTop: 24, textAlign: "center" },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
});
