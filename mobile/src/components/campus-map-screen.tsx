import {
  Camera,
  GeoJSONSource,
  Layer,
  LocationManager,
  Map,
  Marker,
  UserLocation,
  useCurrentPosition,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { InlineLoading } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
  formatWalkingDistance,
  formatWalkingDuration,
  normalizeCampusBounds,
  parseCoordinate,
  pointInsideCampus,
  shouldRefreshWalkingRoute,
  type CampusPoint,
} from "@/src/lib/campus-navigation";
import { ApiError, api } from "@/src/lib/api";
import * as Haptics from "@/src/lib/haptics";
import { theme } from "@/src/theme";

const MAP_STYLE =
  process.env.EXPO_PUBLIC_CAMPUS_MAP_STYLE_URL?.trim() ||
  "https://tiles.openfreemap.org/styles/liberty";
const categories = ["ALL", "ACADEMIC", "HOSTEL", "FOOD", "TRANSPORT", "SERVICE", "HEALTH", "SPORT"] as const;
type Category = (typeof categories)[number];
type IconName = keyof typeof Ionicons.glyphMap;

type Place = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  accessibility_notes: string | null;
  image_url: string | null;
  verified_at: string | null;
};
type MappedPlace = Place & { latitudeValue: number; longitudeValue: number };
type Campus = {
  name: string;
  slug: string;
  latitude: string | number;
  longitude: string | number;
  navigation_bounds?: unknown;
};
type DirectoryResponse = {
  campus: Campus | null;
  places: Place[];
  directorySource: "DATABASE" | "STARTER" | "EMPTY";
};
type RouteStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: { type: string; modifier: string | null };
};
type WalkingRoute = {
  distance: number;
  duration: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  steps: RouteStep[];
};
type RouteResponse = { route: WalkingRoute; provider: string };

const icons: Record<string, IconName> = {
  ACADEMIC: "school",
  FOOD: "restaurant",
  HEALTH: "medkit",
  HOSTEL: "bed",
  SERVICE: "business",
  SPORT: "football",
  TRANSPORT: "bus",
};
const markerColors: Record<string, string> = {
  ACADEMIC: "#526FA8",
  FOOD: "#B95D50",
  HEALTH: "#A8462E",
  HOSTEL: "#8D5535",
  SERVICE: "#7A6A5D",
  SPORT: "#4B7B54",
  TRANSPORT: "#3F6B78",
};

function mapPlace(place: Place): MappedPlace | null {
  const latitude = parseCoordinate(place.latitude);
  const longitude = parseCoordinate(place.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { ...place, latitudeValue: latitude, longitudeValue: longitude };
}
function categoryLabel(value: string) {
  return value === "ALL" ? "All" : value.charAt(0) + value.slice(1).toLowerCase();
}
function nextInstruction(step?: RouteStep) {
  if (!step) return "Follow the highlighted walking route";
  const road = step.name.trim();
  const modifier = step.maneuver.modifier?.replaceAll("_", " ");
  if (road && modifier) return modifier + " onto " + road;
  if (road) return "Continue on " + road;
  return modifier || "Continue along the highlighted route";
}

export default function CampusMapScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const position = useCurrentPosition();
  const centeredCampus = useRef(false);
  const lastRouteOrigin = useRef<CampusPoint | null>(null);
  const lastRouteRequestAt = useRef(0);
  const routeRequestId = useRef(0);
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  const [permission, setPermission] = useState<"unknown" | "requesting" | "granted" | "denied">("unknown");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<WalkingRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");

  const requestLocation = useCallback(async () => {
    setPermission("requesting");
    try {
      const granted = await LocationManager.requestPermissions();
      setPermission(granted ? "granted" : "denied");
      if (granted) {
        LocationManager.setMinDisplacement(3);
        LocationManager.start();
      }
      return granted;
    } catch {
      setPermission("denied");
      return false;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    void requestLocation().then((granted) => {
      if (active && granted) {
        LocationManager.setMinDisplacement(3);
        LocationManager.start();
      }
    });
    return () => {
      active = false;
      LocationManager.stop();
    };
  }, [requestLocation]));

  useEffect(() => {
    let active = true;
    void api<DirectoryResponse>("/v1/student/campus/places", { timeoutMs: 8_000 })
      .then((value) => { if (active) setDirectory(value); })
      .catch((caught) => {
        if (!active) return;
        setDirectoryError(caught instanceof ApiError ? caught.message : "Campus places could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  const places = useMemo(
    () => directory?.places.map(mapPlace).filter((place): place is MappedPlace => Boolean(place)) ?? [],
    [directory],
  );
  const bounds = useMemo(() => normalizeCampusBounds(directory?.campus?.navigation_bounds), [directory?.campus?.navigation_bounds]);
  const campusCenter = useMemo<[number, number] | null>(() => {
    const latitude = parseCoordinate(directory?.campus?.latitude);
    const longitude = parseCoordinate(directory?.campus?.longitude);
    return latitude === null || longitude === null ? null : [longitude, latitude];
  }, [directory?.campus?.latitude, directory?.campus?.longitude]);
  const currentPoint = useMemo<CampusPoint | null>(() => {
    const latitude = position?.coords.latitude;
    const longitude = position?.coords.longitude;
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude: latitude as number, longitude: longitude as number }
      : null;
  }, [position?.coords.latitude, position?.coords.longitude]);
  const onCampus = currentPoint ? pointInsideCampus(currentPoint, bounds) : false;
  const selected = useMemo(() => places.find((place) => place.id === selectedId) ?? null, [places, selectedId]);
  const visiblePlaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return places.filter((place) => {
      if (category !== "ALL" && place.category !== category) return false;
      return !needle || (place.name + " " + (place.description ?? "")).toLowerCase().includes(needle);
    });
  }, [category, places, query]);

  useEffect(() => {
    if (!campusCenter || centeredCampus.current) return;
    centeredCampus.current = true;
    camera.current?.easeTo({ center: campusCenter, duration: 450, zoom: 15.8 });
  }, [campusCenter]);

  const stopRoute = useCallback(() => {
    routeRequestId.current += 1;
    lastRouteOrigin.current = null;
    lastRouteRequestAt.current = 0;
    setRoute(null);
    setRouteError("");
  }, []);
  const selectPlace = useCallback((place: MappedPlace) => {
    void Haptics.selectionAsync();
    setSelectedId(place.id);
    stopRoute();
    camera.current?.easeTo({ center: [place.longitudeValue, place.latitudeValue], duration: 350, zoom: 17.2 });
  }, [stopRoute]);
  const recenter = useCallback(() => {
    void Haptics.selectionAsync();
    if (currentPoint) {
      camera.current?.easeTo({ center: [currentPoint.longitude, currentPoint.latitude], duration: 420, zoom: 17.2 });
    } else if (campusCenter) {
      camera.current?.easeTo({ center: campusCenter, duration: 420, zoom: 15.8 });
    }
  }, [campusCenter, currentPoint]);

  const fetchRoute = useCallback(async (origin: CampusPoint, destination: MappedPlace, silent = false) => {
    const requestId = ++routeRequestId.current;
    if (!silent) setRouteLoading(true);
    setRouteError("");
    const path = "/v1/student/campus/route?fromLat=" + encodeURIComponent(origin.latitude) +
      "&fromLng=" + encodeURIComponent(origin.longitude) +
      "&toLat=" + encodeURIComponent(destination.latitudeValue) +
      "&toLng=" + encodeURIComponent(destination.longitudeValue);
    try {
      const response = await api<RouteResponse>(path, { timeoutMs: 9_000 });
      if (requestId !== routeRequestId.current) return;
      setRoute(response.route);
      lastRouteOrigin.current = origin;
      lastRouteRequestAt.current = Date.now();
      const coordinates = response.route.geometry.coordinates;
      if (coordinates.length > 1) {
        const lng = coordinates.map((point) => point[0]);
        const lat = coordinates.map((point) => point[1]);
        camera.current?.easeTo({
          bounds: [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)],
          duration: 500,
          padding: { top: 155, right: 48, bottom: 225, left: 48 },
        });
      }
    } catch (caught) {
      if (requestId !== routeRequestId.current) return;
      if (!silent) setRouteError(caught instanceof ApiError ? caught.message : "Walking directions are unavailable right now.");
    } finally {
      if (!silent && requestId === routeRequestId.current) setRouteLoading(false);
    }
  }, []);

  const startDirections = useCallback(async () => {
    if (!selected) return;
    void Haptics.selectionAsync();
    let allowed = permission === "granted";
    if (!allowed) allowed = await requestLocation();
    if (!allowed) return;
    if (!currentPoint) {
      setRouteError("Finding your live location. Try directions again in a moment.");
      return;
    }
    if (!pointInsideCampus(currentPoint, bounds)) {
      setRouteError("Live walking directions start when you are inside the campus boundary.");
      return;
    }
    await fetchRoute(currentPoint, selected);
  }, [bounds, currentPoint, fetchRoute, permission, requestLocation, selected]);

  useEffect(() => {
    if (!route || !selected || !currentPoint || !onCampus) return;
    if (shouldRefreshWalkingRoute(lastRouteOrigin.current, currentPoint, lastRouteRequestAt.current)) {
      void fetchRoute(currentPoint, selected, true);
    }
  }, [currentPoint, fetchRoute, onCampus, route, selected]);

  const searchOpen = query.trim().length > 0;
  const routeGeoJson = route ? ({ type: "Feature", properties: {}, geometry: route.geometry } as const) : null;
  const campusName = directory?.campus?.name ?? "Campus map";

  return (
    <View style={styles.screen}>
      <Map attribution logo={false} mapStyle={MAP_STYLE} preferredFramesPerSecond={45} scaleBar={false} style={StyleSheet.absoluteFill}>
        <Camera initialViewState={{ center: [0, 0], zoom: 1 }} maxZoom={20} minZoom={1} ref={camera} />
        {permission === "granted" ? <UserLocation accuracy animated heading /> : null}
        {routeGeoJson ? (
          <GeoJSONSource data={routeGeoJson} id="campus-walking-route">
            <Layer id="route-casing" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": "#FFF8F0", "line-opacity": 0.98, "line-width": 10 }} type="line" />
            <Layer id="route-line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": theme.deepBrand, "line-width": 6 }} type="line" />
          </GeoJSONSource>
        ) : null}
        {visiblePlaces.map((place) => (
          <Marker anchor="bottom" id={"place-" + place.id} key={place.id} lngLat={[place.longitudeValue, place.latitudeValue]} onPress={() => selectPlace(place)}>
            <View style={styles.markerWrap}>
              {selectedId === place.id ? <View style={styles.markerLabel}><Text numberOfLines={1} style={styles.markerLabelText}>{place.name}</Text></View> : null}
              <View style={[styles.marker, { backgroundColor: markerColors[place.category] ?? theme.deepBrand }, selectedId === place.id && styles.markerSelected]}>
                <Ionicons color="#FFFFFF" name={icons[place.category] ?? "location"} size={16} />
              </View>
            </View>
          </Marker>
        ))}
      </Map>

      <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topArea}>
          <View style={styles.campusRow}>
            <View style={styles.campusCopy}>
              <Text style={styles.eyebrow}>CAMPUS NAVIGATION</Text>
              <Text numberOfLines={1} style={styles.campusName}>{campusName}</Text>
            </View>
            <Pressable accessibilityLabel="Center on my location" onPress={recenter} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <Ionicons color={theme.deepBrand} name="navigate" size={21} />
            </Pressable>
          </View>
          <View style={styles.searchBar}>
            <Ionicons color={theme.deepBrand} name="search" size={21} />
            <TextInput autoCorrect={false} onChangeText={setQuery} placeholder="Where are you going?" placeholderTextColor={theme.textFaint} style={styles.searchInput} value={query} />
            {query ? <Pressable onPress={() => setQuery("")} style={styles.clearButton}><Ionicons color={theme.textMuted} name="close-circle" size={20} /></Pressable> : null}
          </View>
          <ScrollView contentContainerStyle={styles.categoryContent} horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroller}>
            {categories.map((item) => {
              const active = item === category;
              return <Pressable key={item} onPress={() => { void Haptics.selectionAsync(); setCategory(item); }} style={[styles.categoryChip, active && styles.categoryChipActive]}>
                <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{categoryLabel(item)}</Text>
              </Pressable>;
            })}
          </ScrollView>
          {searchOpen ? (
            <View style={styles.searchResults}>
              {visiblePlaces.length ? <FlatList data={visiblePlaces.slice(0, 8)} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.id} renderItem={({ item }) => (
                <Pressable onPress={() => { selectPlace(item); setQuery(""); }} style={styles.searchResultRow}>
                  <View style={[styles.resultIcon, { backgroundColor: markerColors[item.category] ?? theme.deepBrand }]}><Ionicons color="#FFFFFF" name={icons[item.category] ?? "location"} size={15} /></View>
                  <View style={styles.resultCopy}><Text numberOfLines={1} style={styles.resultName}>{item.name}</Text><Text style={styles.resultMeta}>{categoryLabel(item.category)}</Text></View>
                  <Ionicons color={theme.textMuted} name="chevron-forward" size={17} />
                </Pressable>
              )} /> : <View style={styles.noResult}><Text style={styles.noResultTitle}>No campus place found</Text><Text style={styles.noResultText}>Try another building, hostel, food spot or service.</Text></View>}
            </View>
          ) : null}
          {searchOpen ? null : permission === "requesting" ? <StatusNotice loading text="Requesting your location…" /> : null}
          {searchOpen ? null : permission === "granted" && !currentPoint ? <StatusNotice loading text="Finding your live position…" /> : null}
          {searchOpen ? null : permission === "denied" ? (
            <View style={styles.notice}>
              <View style={styles.noticeIcon}><Ionicons color={theme.deepBrand} name="location-outline" size={19} /></View>
              <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>Location is off</Text><Text style={styles.noticeText}>Turn it on to see yourself and use live walking directions.</Text></View>
              <Pressable onPress={() => void Linking.openSettings()} style={styles.noticeAction}><Text style={styles.noticeActionText}>Settings</Text></Pressable>
            </View>
          ) : null}
          {searchOpen ? null : permission === "granted" && currentPoint && bounds && !onCampus ? (
            <View style={styles.notice}>
              <View style={styles.noticeIcon}><Ionicons color={theme.deepBrand} name="navigate-circle-outline" size={20} /></View>
              <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>You’re off campus</Text><Text style={styles.noticeText}>You can still browse campus. Live walking directions start when you’re inside the campus boundary.</Text></View>
            </View>
          ) : null}
          {searchOpen ? null : directoryError ? <StatusNotice text={directoryError} /> : null}
        </View>
      </SafeAreaView>

      <Pressable accessibilityLabel="Center on my location" onPress={recenter} style={({ pressed }) => [styles.recenterButton, { bottom: Math.max(insets.bottom, 8) + 168 }, pressed && styles.pressed]}>
        <Ionicons color={currentPoint ? theme.deepBrand : theme.textMuted} name="locate" size={24} />
      </Pressable>

      {route && selected ? (
        <View style={[styles.routePanel, { bottom: Math.max(insets.bottom, 8) + 88 }]}>
          <View style={styles.routeMain}>
            <View style={styles.walkIcon}><Ionicons color="#FFFFFF" name="walk" size={22} /></View>
            <View style={styles.routeCopy}><Text numberOfLines={1} style={styles.routeDestination}>{selected.name}</Text><Text numberOfLines={1} style={styles.routeInstruction}>{nextInstruction(route.steps[0])}</Text></View>
            <Pressable onPress={stopRoute} style={styles.stopRoute}><Ionicons color={theme.deepBrand} name="close" size={20} /></Pressable>
          </View>
          <View style={styles.routeStats}><Text style={styles.routeDuration}>{formatWalkingDuration(route.duration)}</Text><View style={styles.statDivider} /><Text style={styles.routeDistance}>{formatWalkingDistance(route.distance)}</Text></View>
        </View>
      ) : selected && !searchOpen ? (
        <View style={[styles.placePanel, { bottom: Math.max(insets.bottom, 8) + 88 }]}>
          <View style={[styles.placeIcon, { backgroundColor: markerColors[selected.category] ?? theme.deepBrand }]}><Ionicons color="#FFFFFF" name={icons[selected.category] ?? "location"} size={20} /></View>
          <View style={styles.placeCopy}><Text numberOfLines={1} style={styles.placeName}>{selected.name}</Text><Text numberOfLines={1} style={styles.placeMeta}>{categoryLabel(selected.category)} · {campusName}</Text>{routeError ? <Text numberOfLines={2} style={styles.routeError}>{routeError}</Text> : null}</View>
          <Pressable accessibilityLabel={"Get walking directions to " + selected.name} disabled={routeLoading} onPress={() => void startDirections()} style={({ pressed }) => [styles.directionsButton, routeLoading && styles.disabled, pressed && styles.pressed]}>
            {routeLoading ? <InlineLoading /> : <Ionicons color="#FFFFFF" name="navigate" size={21} />}
          </Pressable>
        </View>
      ) : null}

      {!directory && !directoryError ? <View style={styles.loadingCard}><InlineLoading /><Text style={styles.loadingText}>Loading campus places…</Text></View> : null}
      <View pointerEvents="none" style={styles.credit}><Text style={styles.creditText}>© OpenStreetMap contributors</Text></View>
    </View>
  );
}

function StatusNotice({ loading = false, text }: { loading?: boolean; text: string }) {
  const { theme, styles } = useThemeStyles(createStyles);
  return <View style={styles.notice}>{loading ? <InlineLoading /> : <View style={styles.noticeIcon}><Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={18} /></View>}<Text style={[styles.noticeText, styles.noticeGrow]}>{text}</Text></View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject },
  topArea: { paddingHorizontal: 14, paddingTop: 8 },
  campusRow: { alignItems: "center", flexDirection: "row", marginBottom: 9 },
  campusCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 1.1 },
  campusName: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, marginTop: 1 },
  iconButton: { alignItems: "center", backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 18, borderWidth: 1, height: 44, justifyContent: "center", marginLeft: 10, width: 44, ...theme.floatingShadow },
  searchBar: { alignItems: "center", backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 54, paddingHorizontal: 14, ...theme.floatingShadow },
  searchInput: { color: theme.text, flex: 1, fontFamily: theme.font.medium, fontSize: 15, marginLeft: 10, minHeight: 48, paddingVertical: 0 },
  clearButton: { alignItems: "center", height: 40, justifyContent: "center", width: 36 },
  categoryScroller: { marginHorizontal: -14, marginTop: 9 },
  categoryContent: { gap: 8, paddingHorizontal: 14 },
  categoryChip: { backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 16, borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: 15 },
  categoryChipActive: { backgroundColor: theme.deepBrand, borderColor: theme.deepBrand },
  categoryText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 11.5 },
  categoryTextActive: { color: "#FFFFFF" },
  searchResults: { backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 20, borderWidth: 1, marginTop: 8, maxHeight: 342, overflow: "hidden", ...theme.floatingShadow },
  searchResultRow: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 60, paddingHorizontal: 12 },
  resultIcon: { alignItems: "center", borderRadius: 13, height: 36, justifyContent: "center", width: 36 },
  resultCopy: { flex: 1, marginLeft: 10 },
  resultName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 },
  resultMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 2 },
  noResult: { padding: 18 },
  noResultTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  noResultText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 3 },
  notice: { alignItems: "center", backgroundColor: "rgba(255,252,248,.96)", borderColor: "rgba(168,70,46,.18)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 9, minHeight: 58, paddingHorizontal: 10, paddingVertical: 8, ...theme.floatingShadow },
  noticeIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 38, justifyContent: "center", width: 38 },
  noticeCopy: { flex: 1 },
  noticeGrow: { flex: 1 },
  noticeTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  noticeText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15 },
  noticeAction: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 12, justifyContent: "center", minHeight: 38, paddingHorizontal: 11 },
  noticeActionText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 11 },
  markerWrap: { alignItems: "center" },
  marker: { alignItems: "center", borderColor: "#FFFFFF", borderRadius: 18, borderWidth: 2.5, height: 36, justifyContent: "center", width: 36, ...theme.floatingShadow },
  markerSelected: { borderColor: theme.sand, borderRadius: 21, height: 42, width: 42 },
  markerLabel: { backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 10, borderWidth: 1, marginBottom: 5, maxWidth: 180, paddingHorizontal: 9, paddingVertical: 5, ...theme.shadow },
  markerLabelText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 10.5 },
  recenterButton: { alignItems: "center", backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 24, borderWidth: 1, height: 48, justifyContent: "center", position: "absolute", right: 14, width: 48, ...theme.floatingShadow },
  placePanel: { alignItems: "center", backgroundColor: theme.surfaceGlassStrong, borderColor: theme.border, borderRadius: 22, borderWidth: 1, flexDirection: "row", left: 12, minHeight: 82, padding: 10, position: "absolute", right: 12, ...theme.floatingShadow },
  placeIcon: { alignItems: "center", borderRadius: 16, height: 48, justifyContent: "center", width: 48 },
  placeCopy: { flex: 1, marginLeft: 10 },
  placeName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5 },
  placeMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  routeError: { color: theme.error, fontFamily: theme.font.medium, fontSize: 9.5, lineHeight: 13, marginTop: 3 },
  directionsButton: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 16, height: 50, justifyContent: "center", marginLeft: 8, width: 50 },
  routePanel: { backgroundColor: theme.deepBrand, borderRadius: 24, left: 12, minHeight: 112, padding: 12, position: "absolute", right: 12, ...theme.floatingShadow },
  routeMain: { alignItems: "center", flexDirection: "row" },
  walkIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,.16)", borderRadius: 16, height: 46, justifyContent: "center", width: 46 },
  routeCopy: { flex: 1, marginLeft: 10 },
  routeDestination: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  routeInstruction: { color: "rgba(255,255,255,.78)", fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  stopRoute: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  routeStats: { alignItems: "center", flexDirection: "row", marginTop: 11, paddingHorizontal: 2 },
  routeDuration: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 20 },
  routeDistance: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  statDivider: { backgroundColor: "rgba(255,255,255,.28)", height: 20, marginHorizontal: 12, width: 1 },
  loadingCard: { alignItems: "center", alignSelf: "center", backgroundColor: theme.surfaceGlassStrong, borderRadius: 18, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10, position: "absolute", top: "48%", ...theme.floatingShadow },
  loadingText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11 },
  credit: { bottom: 88, left: 12, position: "absolute" },
  creditText: { color: "rgba(41,35,31,.68)", fontFamily: theme.font.medium, fontSize: 8.5 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
});
