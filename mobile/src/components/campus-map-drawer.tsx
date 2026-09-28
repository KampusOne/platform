import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { useThemeStyles, type Theme } from "@/src/lib/appearance";

type IconName = keyof typeof Ionicons.glyphMap;

export type CampusMapDrawerPlace = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  search_aliases?: readonly string[] | null;
};

type RouteSummary = {
  distanceMetres: number;
  originName: string;
  destinationName: string;
};

type Props = {
  error: string;
  loading: boolean;
  places: CampusMapDrawerPlace[];
  query: string;
  choosingOrigin: boolean;
  destinationName?: string;
  route: RouteSummary | null;
  locationAccuracy: number | null;
  locationError: string;
  locationLoading: boolean;
  locationPermission: "granted" | "denied" | "undetermined";
  onQueryChange: (value: string) => void;
  onPickDestination: (id: string) => void;
  onPickOrigin: (id: string) => void;
  onUseCurrentLocation: () => void;
  onClearRoute: () => void;
};

const RECENTS_KEY = "k1.campus-map.recent-destinations.v1";
const COLLAPSED_HEIGHT = 92;

const categoryIcons: Record<string, IconName> = {
  ACADEMIC: "school-outline",
  FOOD: "restaurant-outline",
  HEALTH: "medkit-outline",
  HOSTEL: "bed-outline",
  SERVICE: "help-buoy-outline",
  SPORT: "football-outline",
  TRANSPORT: "bus-outline",
};

const travelModes: Array<{
  id: string;
  label: string;
  icon: IconName;
  metresPerMinute: number;
  price: string;
}> = [
  {
    id: "walk",
    label: "Walk",
    icon: "walk-outline",
    metresPerMinute: 75,
    price: "Free",
  },
  {
    id: "bicycle",
    label: "Bicycle",
    icon: "bicycle-outline",
    metresPerMinute: 250,
    price: "Free",
  },
  {
    id: "shuttle",
    label: "School shuttle",
    icon: "bus-outline",
    metresPerMinute: 300,
    price: "₦250",
  },
  {
    id: "cab",
    label: "Private cab",
    icon: "car-outline",
    metresPerMinute: 400,
    price: "₦1,250",
  },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatDistance(metres: number) {
  if (metres < 1000) return Math.max(1, Math.round(metres)) + " m";
  return (metres / 1000).toFixed(metres >= 10000 ? 0 : 1) + " km";
}

function PlaceItem({
  place,
  recent = false,
  onPress,
}: {
  place: CampusMapDrawerPlace;
  recent?: boolean;
  onPress: () => void;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  return (
    <Pressable
      accessibilityLabel={place.name}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.placeItem,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.placeIcon}>
        <Ionicons
          color={theme.textMuted}
          name={recent ? "time-outline" : categoryIcons[place.category] ?? "location-outline"}
          size={20}
        />
      </View>
      <View style={styles.placeCopy}>
        <Text numberOfLines={1} style={styles.placeName}>
          {place.name}
        </Text>
        <Text numberOfLines={1} style={styles.placeMeta}>
          {place.category.charAt(0) + place.category.slice(1).toLowerCase()}
          {place.description ? " · " + place.description : ""}
        </Text>
      </View>
      <Ionicons color={theme.textSubtle} name="chevron-forward" size={18} />
    </Pressable>
  );
}

export function CampusMapDrawer({
  choosingOrigin,
  destinationName,
  error,
  loading,
  locationAccuracy,
  locationError,
  locationLoading,
  locationPermission,
  onClearRoute,
  onPickDestination,
  onPickOrigin,
  onQueryChange,
  onUseCurrentLocation,
  places,
  query,
  route,
}: Props) {
  const { theme, styles } = useThemeStyles(createStyles);
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(true);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const expandedHeight = Math.min(520, Math.max(340, height * 0.52));
  const routeHeight = Math.min(430, Math.max(330, height * 0.44));
  const maximumHeight = route ? routeHeight : expandedHeight;
  const targetHeight = expanded ? maximumHeight : COLLAPSED_HEIGHT;
  const sheetHeight = useRef(new Animated.Value(targetHeight)).current;
  const dragStart = useRef(targetHeight);

  useEffect(() => {
    void AsyncStorage.getItem(RECENTS_KEY)
      .then((value) => {
        if (!value) return;
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          setRecentIds(
            parsed.filter((item): item is string => typeof item === "string").slice(0, 5),
          );
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    Animated.spring(sheetHeight, {
      toValue: targetHeight,
      useNativeDriver: false,
      damping: 23,
      stiffness: 210,
      mass: 0.75,
    }).start();
  }, [sheetHeight, targetHeight]);

  useEffect(() => {
    if (choosingOrigin || route) setExpanded(true);
  }, [choosingOrigin, route]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          sheetHeight.stopAnimation((value) => {
            dragStart.current = value;
          });
        },
        onPanResponderMove: (_event, gesture) => {
          sheetHeight.setValue(
            clamp(
              dragStart.current - gesture.dy,
              COLLAPSED_HEIGHT,
              maximumHeight,
            ),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const shouldExpand =
            gesture.vy < -0.35 ||
            (gesture.vy <= 0.35 &&
              dragStart.current - gesture.dy >
                COLLAPSED_HEIGHT + (maximumHeight - COLLAPSED_HEIGHT) * 0.45);
          setExpanded(shouldExpand);
          void Haptics.selectionAsync();
        },
        onPanResponderTerminate: () => {
          Animated.spring(sheetHeight, {
            toValue: targetHeight,
            useNativeDriver: false,
          }).start();
        },
      }),
    [maximumHeight, sheetHeight, targetHeight],
  );

  const placeById = useMemo(
    () => new Map(places.map((place) => [place.id, place] as const)),
    [places],
  );

  const recentPlaces = useMemo(
    () =>
      recentIds
        .map((id) => placeById.get(id))
        .filter((place): place is CampusMapDrawerPlace => Boolean(place)),
    [placeById, recentIds],
  );

  const suggestions = useMemo(() => {
    const order = [
      "ACADEMIC",
      "SERVICE",
      "TRANSPORT",
      "FOOD",
      "HOSTEL",
      "HEALTH",
      "SPORT",
    ];
    const picked: CampusMapDrawerPlace[] = [];
    for (const category of order) {
      const match = places.find(
        (place) =>
          place.category.toUpperCase() === category &&
          !picked.some((item) => item.id === place.id),
      );
      if (match) picked.push(match);
      if (picked.length >= 6) break;
    }
    if (picked.length < 6) {
      for (const place of places) {
        if (!picked.some((item) => item.id === place.id)) picked.push(place);
        if (picked.length >= 6) break;
      }
    }
    return picked;
  }, [places]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return places
      .filter((place) =>
        (
          place.name +
          " " +
          (place.description ?? "") +
          " " +
          place.category +
          " " +
          (place.search_aliases?.join(" ") ?? "")
        )
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 12);
  }, [places, query]);

  const rememberDestination = (id: string) => {
    setRecentIds((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, 5);
      void AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(
        () => undefined,
      );
      return next;
    });
  };

  const pickPlace = (place: CampusMapDrawerPlace) => {
    void Haptics.selectionAsync();
    if (choosingOrigin) {
      onPickOrigin(place.id);
      return;
    }
    rememberDestination(place.id);
    onQueryChange(place.name);
    onPickDestination(place.id);
  };

  const routeModes = route
    ? travelModes.map((mode) => ({
        ...mode,
        minutes: Math.max(
          1,
          Math.ceil(route.distanceMetres / mode.metresPerMinute),
        ),
      }))
    : [];

  return (
    <Animated.View
      accessibilityViewIsModal={false}
      style={[styles.sheet, { height: sheetHeight }]}
    >
      <View {...panResponder.panHandlers} style={styles.handleArea}>
        <View style={styles.handle} />
      </View>

      {route ? (
        <View style={styles.routeHeader}>
          <View style={styles.routeHeaderCopy}>
            <Text numberOfLines={1} style={styles.routeTitle}>
              {route.destinationName}
            </Text>
            <Text numberOfLines={1} style={styles.routeSubtitle}>
              {route.originName} → {route.destinationName}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Clear campus route"
            accessibilityRole="button"
            onPress={onClearRoute}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons color={theme.text} name="close" size={20} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.searchBox}>
          <Ionicons color={theme.text} name="search" size={22} />
          <TextInput
            accessibilityLabel="Where to?"
            autoCorrect={false}
            onChangeText={onQueryChange}
            onFocus={() => setExpanded(true)}
            placeholder="Where to?"
            placeholderTextColor={theme.text}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="Clear destination search"
              accessibilityRole="button"
              onPress={() => onQueryChange("")}
              style={({ pressed }) => [
                styles.clearSearch,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons color={theme.textMuted} name="close-circle" size={20} />
            </Pressable>
          ) : null}
        </View>
      )}

      {expanded ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {route ? (
            <>
              <View style={styles.distanceRow}>
                <View style={styles.distanceBadge}>
                  <Ionicons color={theme.brandPressed} name="navigate-outline" size={18} />
                </View>
                <View style={styles.distanceCopy}>
                  <Text style={styles.distanceValue}>
                    {formatDistance(route.distanceMetres)}
                  </Text>
                  <Text style={styles.distanceLabel}>Campus route distance</Text>
                </View>
              </View>

              <View style={styles.modeList}>
                {routeModes.map((mode) => (
                  <View key={mode.id} style={styles.modeRow}>
                    <View style={styles.modeIcon}>
                      <Ionicons color={theme.text} name={mode.icon} size={22} />
                    </View>
                    <View style={styles.modeCopy}>
                      <Text style={styles.modeName}>{mode.label}</Text>
                      <Text style={styles.modeMeta}>
                        {mode.minutes} min · {formatDistance(route.distanceMetres)}
                      </Text>
                    </View>
                    <Text style={styles.modePrice}>{mode.price}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : choosingOrigin ? (
            <>
              <View style={styles.originNotice}>
                <View style={styles.originNoticeIcon}>
                  <Ionicons color="#FFFFFF" name="locate-outline" size={18} />
                </View>
                <View style={styles.originNoticeCopy}>
                  <Text style={styles.originNoticeTitle}>Choose your starting point</Text>
                  <Text numberOfLines={2} style={styles.originNoticeText}>
                    Pick a campus place below or tap a pin on the map to route to {destinationName ?? "your destination"}.
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityLabel="Use current location as your starting point"
                accessibilityRole="button"
                onPress={onUseCurrentLocation}
                style={({ pressed }) => [
                  styles.currentLocationItem,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.currentLocationIcon}>
                  <Ionicons color="#FFFFFF" name="locate" size={20} />
                </View>
                <View style={styles.placeCopy}>
                  <Text style={styles.placeName}>
                    {locationLoading
                      ? "Getting current location…"
                      : locationPermission === "granted"
                        ? "Current location"
                        : "Use current location"}
                  </Text>
                  <Text numberOfLines={2} style={styles.placeMeta}>
                    {locationError ||
                      (locationAccuracy !== null
                        ? "Live device position · about ±" +
                          Math.max(1, Math.round(locationAccuracy)) +
                          " m accuracy"
                        : "Use your phone location while KampusOne is open")}
                  </Text>
                </View>
                <Ionicons color={theme.textSubtle} name="chevron-forward" size={18} />
              </Pressable>

              <Text style={styles.sectionLabel}>Campus places</Text>
              {searchResults.length
                ? searchResults.map((place) => (
                    <PlaceItem
                      key={place.id}
                      onPress={() => pickPlace(place)}
                      place={place}
                    />
                  ))
                : suggestions.map((place) => (
                    <PlaceItem
                      key={place.id}
                      onPress={() => pickPlace(place)}
                      place={place}
                    />
                  ))}
            </>
          ) : (
            <>
              {loading ? (
                <View style={styles.stateRow}>
                  <Ionicons color={theme.brand} name="map-outline" size={20} />
                  <Text style={styles.stateText}>Loading campus places…</Text>
                </View>
              ) : null}

              {error ? (
                <View style={styles.stateRow}>
                  <Ionicons color={theme.error} name="cloud-offline-outline" size={20} />
                  <Text style={styles.stateText}>{error}</Text>
                </View>
              ) : null}

              {query.trim() ? (
                <>
                  <Text style={styles.sectionLabel}>Search results</Text>
                  {searchResults.length ? (
                    searchResults.map((place) => (
                      <PlaceItem
                        key={place.id}
                        onPress={() => pickPlace(place)}
                        place={place}
                      />
                    ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons color={theme.textMuted} name="search-outline" size={22} />
                      <Text style={styles.emptyText}>No campus place found.</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  {recentPlaces.length ? (
                    <>
                      <Text style={styles.sectionLabel}>Recent</Text>
                      {recentPlaces.map((place) => (
                        <PlaceItem
                          key={place.id}
                          onPress={() => pickPlace(place)}
                          place={place}
                          recent
                        />
                      ))}
                    </>
                  ) : null}

                  <Text style={styles.sectionLabel}>Suggested places</Text>
                  {suggestions.map((place) => (
                    <PlaceItem
                      key={place.id}
                      onPress={() => pickPlace(place)}
                      place={place}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      ) : null}
    </Animated.View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: theme.surfaceRaised,
      borderColor: theme.border,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      bottom: 0,
      left: 0,
      overflow: "hidden",
      position: "absolute",
      right: 0,
      ...theme.shadow,
    },
    handleArea: {
      alignItems: "center",
      height: 26,
      justifyContent: "center",
    },
    handle: {
      backgroundColor: theme.border,
      borderRadius: 3,
      height: 5,
      width: 58,
    },
    searchBox: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      flexDirection: "row",
      marginHorizontal: 20,
      minHeight: 58,
      paddingHorizontal: 16,
    },
    searchInput: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.semibold,
      fontSize: 18,
      marginLeft: 12,
      paddingVertical: 0,
    },
    clearSearch: {
      alignItems: "center",
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    routeHeader: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 60,
      paddingHorizontal: 20,
    },
    routeHeaderCopy: {
      flex: 1,
      paddingRight: 12,
    },
    routeTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 18,
    },
    routeSubtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      marginTop: 3,
    },
    closeButton: {
      alignItems: "center",
      borderRadius: 20,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    content: {
      paddingBottom: 28,
      paddingHorizontal: 20,
      paddingTop: 14,
    },
    sectionLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.semibold,
      fontSize: 11,
      letterSpacing: 0.25,
      marginBottom: 6,
      marginTop: 10,
      textTransform: "uppercase",
    },
    placeItem: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 72,
    },
    currentLocationItem: {
      alignItems: "center",
      backgroundColor: theme.surfaceSoft,
      borderRadius: 16,
      flexDirection: "row",
      marginBottom: 6,
      minHeight: 72,
      paddingHorizontal: 10,
    },
    currentLocationIcon: {
      alignItems: "center",
      backgroundColor: "#2F7CF6",
      borderRadius: 14,
      height: 52,
      justifyContent: "center",
      width: 52,
    },
    placeIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      height: 52,
      justifyContent: "center",
      width: 52,
    },
    placeCopy: {
      flex: 1,
      marginLeft: 14,
      minWidth: 0,
    },
    placeName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
    },
    placeMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      marginTop: 3,
    },
    pressed: {
      opacity: 0.68,
    },
    stateRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      minHeight: 52,
    },
    stateText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.body,
      fontSize: 12,
    },
    emptyState: {
      alignItems: "center",
      gap: 8,
      justifyContent: "center",
      minHeight: 90,
    },
    emptyText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
    },
    originNotice: {
      alignItems: "center",
      backgroundColor: theme.surfaceSoft,
      borderRadius: 18,
      flexDirection: "row",
      gap: 12,
      marginBottom: 8,
      padding: 14,
    },
    originNoticeIcon: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      height: 42,
      justifyContent: "center",
      width: 42,
    },
    originNoticeCopy: {
      flex: 1,
    },
    originNoticeTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    originNoticeText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 3,
    },
    distanceRow: {
      alignItems: "center",
      flexDirection: "row",
      marginBottom: 8,
      minHeight: 58,
    },
    distanceBadge: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      height: 48,
      justifyContent: "center",
      width: 48,
    },
    distanceCopy: {
      marginLeft: 12,
    },
    distanceValue: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 16,
    },
    distanceLabel: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
      marginTop: 2,
    },
    modeList: {
      marginTop: 4,
    },
    modeRow: {
      alignItems: "center",
      borderBottomColor: theme.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      minHeight: 76,
    },
    modeIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      height: 50,
      justifyContent: "center",
      width: 50,
    },
    modeCopy: {
      flex: 1,
      marginLeft: 14,
    },
    modeName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
    },
    modeMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      marginTop: 3,
    },
    modePrice: {
      color: theme.text,
      fontFamily: theme.font.bold,
      fontSize: 14,
    },
  });
