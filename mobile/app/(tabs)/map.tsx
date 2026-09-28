import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CampusMapSurface } from "@/src/components/campus-map-surface";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { ApiError, api } from "@/src/lib/api";
import * as Haptics from "@/src/lib/haptics";
import {
  campusCenter,
  categoryIcon,
  categoryLabel,
  distanceMetres,
  formatDistance,
  formatDuration,
  isInsideCampus,
  mapCampusPlace,
  shouldRefreshWalkingRoute,
  type CampusDirectoryResponse,
  type CampusLocation,
  type CampusWalkingRoute,
  type LngLat,
  type MappedCampusPlace,
} from "@/src/lib/campus-map";

const categories = [
  "ALL",
  "ACADEMIC",
  "HOSTEL",
  "FOOD",
  "SERVICE",
  "TRANSPORT",
  "HEALTH",
  "SPORT",
] as const;

function searchText(place: MappedCampusPlace) {
  return `${place.name} ${place.description ?? ""} ${place.category}`.toLowerCase();
}

function routeZoom(distance: number) {
  if (distance > 1_700) return 14.6;
  if (distance > 900) return 15.2;
  if (distance > 450) return 16;
  return 17;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

export default function CampusMapScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const [directory, setDirectory] = useState<CampusDirectoryResponse>({
    campus: null,
    places: [],
    directorySource: "EMPTY",
  });
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [permissionStatus, setPermissionStatus] = useState<
    "checking" | "granted" | "denied" | "services-off" | "unavailable"
  >("checking");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [userLocation, setUserLocation] = useState<CampusLocation | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [focusCoordinate, setFocusCoordinate] = useState<LngLat | null>(null);
  const [focusZoom, setFocusZoom] = useState(15.3);
  const [focusToken, setFocusToken] = useState(0);

  const [route, setRoute] = useState<CampusWalkingRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeDestinationId, setRouteDestinationId] = useState<string | null>(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const routeRequestRef = useRef(0);
  const routeOriginRef = useRef<LngLat | null>(null);
  const routeAtRef = useRef(0);
  const promptedRef = useRef(false);

  const mappedPlaces = useMemo(
    () =>
      directory.places
        .map(mapCampusPlace)
        .filter((place): place is MappedCampusPlace => Boolean(place)),
    [directory.places],
  );

  const selectedPlace = useMemo(
    () => mappedPlaces.find((place) => place.id === selectedId) ?? null,
    [mappedPlaces, selectedId],
  );

  const routeDestination = useMemo(
    () => mappedPlaces.find((place) => place.id === routeDestinationId) ?? null,
    [mappedPlaces, routeDestinationId],
  );

  const insideCampus = useMemo(
    () => isInsideCampus(userLocation, directory.campus),
    [directory.campus, userLocation],
  );

  const filteredPlaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return mappedPlaces.filter((place) => {
      if (category !== "ALL" && place.category.toUpperCase() !== category)
        return false;
      if (needle && !searchText(place).includes(needle)) return false;
      return true;
    });
  }, [category, mappedPlaces, query]);

  const resultPlaces = useMemo(() => {
    if (!query.trim() && category === "ALL") return [];
    return filteredPlaces.slice(0, 5);
  }, [category, filteredPlaces, query]);

  const loadDirectory = useCallback(async () => {
    setDirectoryError("");
    try {
      const response = await api<CampusDirectoryResponse>(
        "/v1/student/campus/places",
        { timeoutMs: 10_000 },
      );
      setDirectory(response);
    } catch (error) {
      setDirectoryError(errorMessage(error));
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDirectory();
    }, [loadDirectory]),
  );

  const requestLocation = useCallback(async (forcePrompt = false) => {
    if (Platform.OS === "web") {
      setPermissionStatus("unavailable");
      return;
    }
    setPermissionStatus("checking");
    try {
      const services = await Location.hasServicesEnabledAsync();
      if (!services) {
        setPermissionStatus("services-off");
        return;
      }

      let permission = await Location.getForegroundPermissionsAsync();
      const shouldAsk =
        permission.status === Location.PermissionStatus.UNDETERMINED ||
        (forcePrompt &&
          permission.status !== Location.PermissionStatus.GRANTED &&
          permission.canAskAgain);

      if (shouldAsk) {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      setCanAskAgain(permission.canAskAgain);
      setPermissionStatus(
        permission.status === Location.PermissionStatus.GRANTED
          ? "granted"
          : "denied",
      );
    } catch {
      setPermissionStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    void requestLocation(false);
  }, [requestLocation]);

  useEffect(() => {
    if (permissionStatus !== "granted" || Platform.OS === "web") return;
    let active = true;
    let subscription: Location.LocationSubscription | null = null;

    void (async () => {
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 60_000,
        requiredAccuracy: 150,
      }).catch(() => null);
      if (active && cached) {
        setUserLocation({
          latitude: cached.coords.latitude,
          longitude: cached.coords.longitude,
          accuracy: cached.coords.accuracy,
        });
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 3,
          timeInterval: 2_500,
        },
        (location) => {
          if (!active) return;
          setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
          });
        },
      );
    })().catch(() => {
      if (active) setPermissionStatus("unavailable");
    });

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [permissionStatus]);

  useEffect(() => {
    if (!directory.campus || focusCoordinate) return;
    setFocusCoordinate(campusCenter(directory.campus));
    setFocusZoom(15.3);
    setFocusToken((value) => value + 1);
  }, [directory.campus, focusCoordinate]);

  const focus = useCallback((coordinate: LngLat, zoom: number) => {
    setFocusCoordinate(coordinate);
    setFocusZoom(zoom);
    setFocusToken((value) => value + 1);
  }, []);

  const recenter = useCallback(() => {
    void Haptics.selectionAsync();
    if (userLocation && insideCampus) {
      focus([userLocation.longitude, userLocation.latitude], navigationActive ? 17.5 : 16.5);
      return;
    }
    focus(campusCenter(directory.campus), 15.3);
  }, [directory.campus, focus, insideCampus, navigationActive, userLocation]);

  const selectPlace = useCallback(
    (id: string) => {
      void Haptics.selectionAsync();
      const place = mappedPlaces.find((item) => item.id === id);
      if (!place) return;
      setSelectedId(id);
      setQuery("");
      focus([place.longitudeValue, place.latitudeValue], 17);
    },
    [focus, mappedPlaces],
  );

  const fetchRoute = useCallback(
    async (destination: MappedCampusPlace, silent = false) => {
      if (!userLocation || !insideCampus) return;
      const requestId = routeRequestRef.current + 1;
      routeRequestRef.current = requestId;
      if (!silent) setRouteLoading(true);
      setRouteError("");

      const origin: LngLat = [userLocation.longitude, userLocation.latitude];
      try {
        const response = await api<CampusWalkingRoute>(
          "/v1/student/campus/route",
          {
            method: "POST",
            timeoutMs: 12_000,
            body: JSON.stringify({
              origin: {
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
              },
              destination: {
                latitude: destination.latitudeValue,
                longitude: destination.longitudeValue,
                placeId: destination.id,
              },
            }),
          },
        );

        if (routeRequestRef.current !== requestId) return;
        setRoute(response);
        setRouteDestinationId(destination.id);
        routeOriginRef.current = origin;
        routeAtRef.current = Date.now();

        const midpoint: LngLat = [
          (origin[0] + destination.longitudeValue) / 2,
          (origin[1] + destination.latitudeValue) / 2,
        ];
        focus(midpoint, routeZoom(response.distanceMeters));
      } catch (error) {
        if (routeRequestRef.current !== requestId) return;
        if (!silent) setRoute(null);
        setRouteError(errorMessage(error));
      } finally {
        if (routeRequestRef.current === requestId) setRouteLoading(false);
      }
    },
    [focus, insideCampus, userLocation],
  );

  useEffect(() => {
    if (
      !route ||
      !routeDestination ||
      !navigationActive ||
      !insideCampus ||
      !userLocation ||
      !routeOriginRef.current
    ) {
      return;
    }
    const current: LngLat = [userLocation.longitude, userLocation.latitude];
    if (
      !shouldRefreshWalkingRoute(
        routeOriginRef.current,
        current,
        routeAtRef.current,
      )
    ) {
      return;
    }
    void fetchRoute(routeDestination, true);
  }, [
    fetchRoute,
    insideCampus,
    navigationActive,
    route,
    routeDestination,
    userLocation,
  ]);

  const clearRoute = useCallback(() => {
    routeRequestRef.current += 1;
    setRoute(null);
    setRouteDestinationId(null);
    setRouteError("");
    setNavigationActive(false);
    routeOriginRef.current = null;
    routeAtRef.current = 0;
    if (selectedPlace) {
      focus([selectedPlace.longitudeValue, selectedPlace.latitudeValue], 17);
    }
  }, [focus, selectedPlace]);

  const enableLocation = useCallback(() => {
    if (permissionStatus === "denied" && !canAskAgain) {
      void Linking.openSettings();
      return;
    }
    void requestLocation(true);
  }, [canAskAgain, permissionStatus, requestLocation]);

  const directDistance =
    selectedPlace && userLocation
      ? distanceMetres(
          [userLocation.longitude, userLocation.latitude],
          [selectedPlace.longitudeValue, selectedPlace.latitudeValue],
        )
      : null;

  const showOffCampus =
    permissionStatus === "granted" && Boolean(userLocation) && !insideCampus;
  const showSearchResults = resultPlaces.length > 0 && !route;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.map}>
        <CampusMapSurface
          campus={directory.campus}
          focusCoordinate={focusCoordinate}
          focusToken={focusToken}
          focusZoom={focusZoom}
          onMapLoadError={() => setMapError(true)}
          onMapReady={() => {
            setMapReady(true);
            setMapError(false);
          }}
          onSelectPlace={selectPlace}
          places={filteredPlaces}
          route={route}
          selectedPlaceId={selectedId}
          showUserLocation={insideCampus}
          userLocation={userLocation}
        />
      </View>

      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topArea}>
          <View style={styles.brandRow}>
            <View>
              <Text style={styles.eyebrow}>CAMPUS NAVIGATION</Text>
              <Text style={styles.campusName}>
                {directory.campus?.name ?? "UNIBEN"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Centre map"
              accessibilityRole="button"
              onPress={recenter}
              style={({ pressed }) => [
                styles.roundButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons color={theme.deepBrand} name="navigate" size={21} />
            </Pressable>
          </View>

          {route && routeDestination ? (
            <View style={styles.routeInputCard}>
              <View style={styles.routeDots}>
                <View style={styles.originDot} />
                <View style={styles.routeDotsLine} />
                <Ionicons color={theme.deepBrand} name="location" size={16} />
              </View>
              <View style={styles.routeInputCopy}>
                <Text style={styles.routeInputMuted}>Your location</Text>
                <View style={styles.routeInputDivider} />
                <Text numberOfLines={1} style={styles.routeInputDestination}>
                  {routeDestination.name}
                </Text>
              </View>
              <Pressable onPress={clearRoute} style={styles.closeRoute}>
                <Ionicons color={theme.textMuted} name="close" size={20} />
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.searchBox}>
                <Ionicons color={theme.deepBrand} name="search" size={20} />
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setQuery}
                  placeholder="Where to?"
                  placeholderTextColor={theme.textFaint}
                  returnKeyType="search"
                  style={styles.searchInput}
                  value={query}
                />
                {query ? (
                  <Pressable onPress={() => setQuery("")} style={styles.searchClear}>
                    <Ionicons color={theme.textMuted} name="close-circle" size={18} />
                  </Pressable>
                ) : null}
              </View>

              <ScrollView
                contentContainerStyle={styles.filtersContent}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filters}
              >
                {categories.map((item) => {
                  const active = category === item;
                  return (
                    <Pressable
                      key={item}
                      onPress={() => setCategory(item)}
                      style={({ pressed }) => [
                        styles.filterChip,
                        active && styles.filterChipActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      {item !== "ALL" ? (
                        <Ionicons
                          color={active ? "#FFFFFF" : theme.deepBrand}
                          name={categoryIcon(item) as keyof typeof Ionicons.glyphMap}
                          size={14}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.filterText,
                          active && styles.filterTextActive,
                        ]}
                      >
                        {item === "ALL" ? "All" : categoryLabel(item)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {permissionStatus === "checking" ? (
            <View style={styles.notice}>
              <ActivityIndicator color={theme.deepBrand} size="small" />
              <Text style={styles.noticeText}>Finding your location…</Text>
            </View>
          ) : permissionStatus === "denied" ||
            permissionStatus === "services-off" ||
            permissionStatus === "unavailable" ? (
            <View style={styles.notice}>
              <Ionicons color={theme.deepBrand} name="location-outline" size={20} />
              <Text numberOfLines={2} style={styles.noticeText}>
                {permissionStatus === "services-off"
                  ? "Location is turned off."
                  : "Turn on location for live campus directions."}
              </Text>
              <Pressable onPress={enableLocation} style={styles.noticeAction}>
                <Text style={styles.noticeActionText}>Enable</Text>
              </Pressable>
            </View>
          ) : showOffCampus ? (
            <View style={styles.notice}>
              <Ionicons color={theme.deepBrand} name="exit-outline" size={20} />
              <Text numberOfLines={2} style={styles.noticeText}>
                You’re off campus. Browse UNIBEN now; live directions start inside campus.
              </Text>
            </View>
          ) : null}

          {mapError ? (
            <View style={styles.notice}>
              <Ionicons color={theme.error} name="cloud-offline-outline" size={19} />
              <Text style={styles.noticeText}>
                Map tiles couldn’t load. Check your connection.
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          accessibilityLabel="My location"
          accessibilityRole="button"
          onPress={recenter}
          style={({ pressed }) => [
            styles.locationButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={insideCampus ? "#2F70EB" : theme.text}
            name="locate"
            size={23}
          />
        </Pressable>

        {directoryLoading || !mapReady ? (
          <View style={styles.loadingBadge}>
            <ActivityIndicator color={theme.deepBrand} size="small" />
            <Text style={styles.loadingText}>Loading campus map</Text>
          </View>
        ) : null}

        {directoryError ? (
          <View style={styles.bottomCard}>
            <Text style={styles.cardTitle}>Campus places unavailable</Text>
            <Text style={styles.cardBody}>{directoryError}</Text>
            <Pressable onPress={loadDirectory} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : showSearchResults ? (
          <View style={styles.resultsCard}>
            {resultPlaces.map((place, index) => (
              <Pressable
                key={place.id}
                onPress={() => selectPlace(place.id)}
                style={[
                  styles.resultRow,
                  index < resultPlaces.length - 1 && styles.resultDivider,
                ]}
              >
                <View style={styles.resultIcon}>
                  <Ionicons
                    color={theme.deepBrand}
                    name={categoryIcon(place.category) as keyof typeof Ionicons.glyphMap}
                    size={17}
                  />
                </View>
                <View style={styles.resultCopy}>
                  <Text numberOfLines={1} style={styles.resultName}>
                    {place.name}
                  </Text>
                  <Text style={styles.resultMeta}>
                    {categoryLabel(place.category)}
                  </Text>
                </View>
                <Ionicons color={theme.textFaint} name="chevron-forward" size={17} />
              </Pressable>
            ))}
          </View>
        ) : route && routeDestination ? (
          <View style={styles.routeSummary}>
            {navigationActive && route.steps[0]?.instruction ? (
              <View style={styles.nextStep}>
                <Ionicons color="#FFFFFF" name="walk" size={20} />
                <Text numberOfLines={2} style={styles.nextStepText}>
                  {route.steps[0].instruction}
                </Text>
              </View>
            ) : null}
            <View style={styles.routeSummaryRow}>
              <View style={styles.routeMetric}>
                <Ionicons color={theme.deepBrand} name="walk" size={21} />
                <View>
                  <Text style={styles.routeMetricValue}>
                    {formatDuration(route.durationSeconds)}
                  </Text>
                  <Text style={styles.routeMetricLabel}>
                    {formatDistance(route.distanceMeters)}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  setNavigationActive((value) => !value);
                  if (userLocation) {
                    focus(
                      [userLocation.longitude, userLocation.latitude],
                      17.5,
                    );
                  }
                }}
                style={styles.startButton}
              >
                <Text style={styles.startButtonText}>
                  {navigationActive ? "Following" : "Start"}
                </Text>
                <Ionicons
                  color="#FFFFFF"
                  name={navigationActive ? "navigate" : "arrow-forward"}
                  size={18}
                />
              </Pressable>
            </View>
            {routeError ? <Text style={styles.routeError}>{routeError}</Text> : null}
          </View>
        ) : selectedPlace ? (
          <View style={styles.placeCard}>
            <View style={styles.placeCardTop}>
              <View style={styles.placeIcon}>
                <Ionicons
                  color={theme.deepBrand}
                  name={categoryIcon(selectedPlace.category) as keyof typeof Ionicons.glyphMap}
                  size={22}
                />
              </View>
              <View style={styles.placeCopy}>
                <Text numberOfLines={1} style={styles.placeName}>
                  {selectedPlace.name}
                </Text>
                <Text style={styles.placeMeta}>
                  {categoryLabel(selectedPlace.category)}
                  {directDistance !== null && insideCampus
                    ? ` · ${formatDistance(directDistance)} away`
                    : ""}
                </Text>
              </View>
            </View>
            <Pressable
              disabled={!insideCampus || routeLoading}
              onPress={() => void fetchRoute(selectedPlace)}
              style={({ pressed }) => [
                styles.directionsButton,
                (!insideCampus || routeLoading) && styles.buttonDisabled,
                pressed && insideCampus && styles.pressed,
              ]}
            >
              {routeLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons color="#FFFFFF" name="navigate" size={19} />
              )}
              <Text style={styles.directionsText}>
                {insideCampus ? "Directions" : "Available on campus"}
              </Text>
            </Pressable>
            {routeError ? <Text style={styles.routeError}>{routeError}</Text> : null}
          </View>
        ) : (
          <View style={styles.compactHint}>
            <Ionicons color={theme.deepBrand} name="map-outline" size={18} />
            <Text style={styles.compactHintText}>
              Search or tap a campus place.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { backgroundColor: theme.canvas, flex: 1 },
    map: { ...StyleSheet.absoluteFillObject },
    overlay: { ...StyleSheet.absoluteFillObject },
    topArea: { paddingHorizontal: 14, paddingTop: 8 },
    brandRow: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    eyebrow: {
      color: theme.deepBrand,
      fontFamily: theme.font.bold,
      fontSize: 8.5,
      letterSpacing: 1.1,
    },
    campusName: {
      color: theme.text,
      fontFamily: theme.font.displayStrong,
      fontSize: 19,
      marginTop: 1,
    },
    roundButton: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      height: 44,
      justifyContent: "center",
      width: 44,
      ...theme.floatingShadow,
    },
    searchBox: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: "row",
      gap: 9,
      minHeight: 54,
      paddingHorizontal: 14,
      ...theme.floatingShadow,
    },
    searchInput: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 16,
      paddingVertical: 0,
    },
    searchClear: {
      alignItems: "center",
      height: 40,
      justifyContent: "center",
      width: 32,
    },
    filters: { marginHorizontal: -14, marginTop: 9, maxHeight: 42 },
    filtersContent: { gap: 7, paddingHorizontal: 14 },
    filterChip: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: "row",
      gap: 5,
      height: 36,
      paddingHorizontal: 12,
      ...theme.shadow,
    },
    filterChipActive: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    filterText: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
    },
    filterTextActive: { color: "#FFFFFF" },
    notice: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: "rgba(168,70,46,0.16)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 9,
      marginTop: 9,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 8,
      ...theme.shadow,
    },
    noticeText: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 11,
      lineHeight: 16,
    },
    noticeAction: {
      backgroundColor: theme.surfaceTint,
      borderRadius: 10,
      paddingHorizontal: 11,
      paddingVertical: 8,
    },
    noticeActionText: {
      color: theme.deepBrand,
      fontFamily: theme.font.bold,
      fontSize: 11,
    },
    routeInputCard: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 76,
      paddingHorizontal: 12,
      ...theme.floatingShadow,
    },
    routeDots: { alignItems: "center", marginRight: 10 },
    originDot: {
      backgroundColor: "#2F70EB",
      borderColor: "#FFFFFF",
      borderRadius: 5,
      borderWidth: 2,
      height: 10,
      width: 10,
    },
    routeDotsLine: {
      backgroundColor: theme.border,
      height: 20,
      marginVertical: 2,
      width: 2,
    },
    routeInputCopy: { flex: 1 },
    routeInputMuted: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 11,
    },
    routeInputDivider: {
      backgroundColor: theme.border,
      height: 1,
      marginVertical: 7,
    },
    routeInputDestination: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    closeRoute: {
      alignItems: "center",
      height: 42,
      justifyContent: "center",
      width: 38,
    },
    locationButton: {
      alignItems: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      bottom: 176,
      height: 48,
      justifyContent: "center",
      position: "absolute",
      right: 14,
      width: 48,
      ...theme.floatingShadow,
    },
    loadingBadge: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderRadius: 14,
      bottom: 190,
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      position: "absolute",
    },
    loadingText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 10.5,
    },
    bottomCard: {
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 20,
      borderWidth: 1,
      bottom: 12,
      left: 14,
      padding: 14,
      position: "absolute",
      right: 14,
      ...theme.floatingShadow,
    },
    cardTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    cardBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 4,
    },
    primaryButton: {
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: theme.deepBrand,
      borderRadius: 12,
      marginTop: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    primaryButtonText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
    },
    resultsCard: {
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 20,
      borderWidth: 1,
      bottom: 12,
      left: 14,
      overflow: "hidden",
      position: "absolute",
      right: 14,
      ...theme.floatingShadow,
    },
    resultRow: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 58,
      paddingHorizontal: 12,
    },
    resultDivider: { borderBottomColor: theme.border, borderBottomWidth: 1 },
    resultIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceTint,
      borderRadius: 12,
      height: 36,
      justifyContent: "center",
      marginRight: 10,
      width: 36,
    },
    resultCopy: { flex: 1 },
    resultName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
    },
    resultMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10,
      marginTop: 2,
    },
    placeCard: {
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 20,
      borderWidth: 1,
      bottom: 12,
      left: 14,
      padding: 13,
      position: "absolute",
      right: 14,
      ...theme.floatingShadow,
    },
    placeCardTop: { alignItems: "center", flexDirection: "row" },
    placeIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceTint,
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    placeCopy: { flex: 1, marginLeft: 10 },
    placeName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 15,
    },
    placeMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
      marginTop: 3,
    },
    directionsButton: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      flexDirection: "row",
      gap: 7,
      justifyContent: "center",
      marginTop: 11,
      minHeight: 46,
    },
    directionsText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
    },
    buttonDisabled: { opacity: 0.52 },
    routeSummary: {
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 20,
      borderWidth: 1,
      bottom: 12,
      left: 14,
      overflow: "hidden",
      position: "absolute",
      right: 14,
      ...theme.floatingShadow,
    },
    nextStep: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      flexDirection: "row",
      gap: 9,
      minHeight: 48,
      paddingHorizontal: 13,
      paddingVertical: 9,
    },
    nextStepText: {
      color: "#FFFFFF",
      flex: 1,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
      lineHeight: 16,
    },
    routeSummaryRow: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      padding: 13,
    },
    routeMetric: { alignItems: "center", flexDirection: "row", gap: 9 },
    routeMetricValue: {
      color: theme.text,
      fontFamily: theme.font.displayStrong,
      fontSize: 19,
    },
    routeMetricLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 10,
      marginTop: 1,
    },
    startButton: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      flexDirection: "row",
      gap: 7,
      minHeight: 44,
      paddingHorizontal: 16,
    },
    startButtonText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 12,
    },
    routeError: {
      color: theme.error,
      fontFamily: theme.font.medium,
      fontSize: 10,
      paddingBottom: 10,
      paddingHorizontal: 13,
    },
    compactHint: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: theme.surfaceGlassStrong,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      bottom: 14,
      flexDirection: "row",
      gap: 7,
      paddingHorizontal: 13,
      paddingVertical: 10,
      position: "absolute",
      ...theme.shadow,
    },
    compactHintText: {
      color: theme.text,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
    },
    pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  });
