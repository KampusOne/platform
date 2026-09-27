import { InlineLoading } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  FlatList,
  Image,
  type LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FilterRow, SearchField } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const categories = [
  "All",
  "Academic",
  "Service",
  "Transport",
  "Hostel",
  "Food",
  "Health",
  "Sport",
] as const;

const MIN_MAP_HEIGHT = 360;
const MAX_MAP_HEIGHT = 440;
const MIN_MAP_ZOOM = 0.85;
const MAX_MAP_ZOOM = 2.35;
const WALKING_METRES_PER_MINUTE = 75;

type IconName = keyof typeof Ionicons.glyphMap;
type Place = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  latitude: string | null;
  longitude: string | null;
  accessibility_notes: string | null;
  image_url: string | null;
  verified_at: string | null;
};
type MappedPlace = Place & { latitudeValue: number; longitudeValue: number };
type PixelPoint = { x: number; y: number };
type CampusEdge = { a: string; b: string; distance: number };
type CampusRoute = { distance: number; ids: string[] };
type Projection = {
  centerLatitude: number;
  centerLongitude: number;
  scale: number;
};

const icons: Record<string, IconName> = {
  ACADEMIC: "school-outline",
  FOOD: "restaurant-outline",
  HEALTH: "medkit-outline",
  HOSTEL: "bed-outline",
  SERVICE: "help-buoy-outline",
  SPORT: "football-outline",
  TRANSPORT: "bus-outline",
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

const zoneColors: Record<string, string> = {
  ACADEMIC: "rgba(82,111,168,.10)",
  FOOD: "rgba(185,93,80,.10)",
  HEALTH: "rgba(168,70,46,.10)",
  HOSTEL: "rgba(141,85,53,.11)",
  SERVICE: "rgba(122,106,93,.09)",
  SPORT: "rgba(75,123,84,.10)",
  TRANSPORT: "rgba(63,107,120,.09)",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coordinatesFor(place: Place) {
  if (
    place.latitude === null ||
    place.longitude === null ||
    !place.latitude.trim() ||
    !place.longitude.trim()
  ) {
    return null;
  }

  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function distanceBetween(a: MappedPlace, b: MappedPlace) {
  const earthRadius = 6371000;
  const latitudeA = (a.latitudeValue * Math.PI) / 180;
  const latitudeB = (b.latitudeValue * Math.PI) / 180;
  const latitudeDelta = ((b.latitudeValue - a.latitudeValue) * Math.PI) / 180;
  const longitudeDelta = ((b.longitudeValue - a.longitudeValue) * Math.PI) / 180;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function campusEdges(places: MappedPlace[]): CampusEdge[] {
  const edges = new Map<string, CampusEdge>();

  for (const place of places) {
    const nearest = places
      .filter((candidate) => candidate.id !== place.id)
      .map((candidate) => ({
        candidate,
        distance: distanceBetween(place, candidate),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);

    for (const item of nearest) {
      const first = place.id < item.candidate.id ? place.id : item.candidate.id;
      const second = place.id < item.candidate.id ? item.candidate.id : place.id;
      const key = first + ":" + second;
      if (!edges.has(key)) {
        edges.set(key, {
          a: first,
          b: second,
          distance: item.distance,
        });
      }
    }
  }

  return Array.from(edges.values());
}

function shortestCampusRoute(
  places: MappedPlace[],
  edges: CampusEdge[],
  originId: string,
  destinationId: string,
): CampusRoute | null {
  if (!originId || !destinationId || originId === destinationId) return null;

  const placeIds = new Set(places.map((place) => place.id));
  if (!placeIds.has(originId) || !placeIds.has(destinationId)) return null;

  const adjacency = new Map<string, Array<{ id: string; distance: number }>>();
  for (const place of places) adjacency.set(place.id, []);
  for (const edge of edges) {
    adjacency.get(edge.a)?.push({ id: edge.b, distance: edge.distance });
    adjacency.get(edge.b)?.push({ id: edge.a, distance: edge.distance });
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const pending = new Set(placeIds);
  for (const id of placeIds) distances.set(id, Number.POSITIVE_INFINITY);
  distances.set(originId, 0);

  while (pending.size) {
    let current = "";
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const id of pending) {
      const distance = distances.get(id) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = id;
        currentDistance = distance;
      }
    }

    if (!current || !Number.isFinite(currentDistance)) break;
    pending.delete(current);
    if (current === destinationId) break;

    for (const neighbour of adjacency.get(current) ?? []) {
      if (!pending.has(neighbour.id)) continue;
      const nextDistance = currentDistance + neighbour.distance;
      if (nextDistance < (distances.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbour.id, nextDistance);
        previous.set(neighbour.id, current);
      }
    }
  }

  const total = distances.get(destinationId);
  if (!Number.isFinite(total)) return null;

  const ids = [destinationId];
  let current = destinationId;
  while (current !== originId) {
    const previousId = previous.get(current);
    if (!previousId) return null;
    ids.unshift(previousId);
    current = previousId;
  }

  return { distance: total ?? 0, ids };
}

function createProjection(
  places: MappedPlace[],
  width: number,
  height: number,
  zoom: number,
): Projection | null {
  if (!places.length || width <= 0 || height <= 0) return null;

  let minimumLatitude = places[0]?.latitudeValue ?? 0;
  let maximumLatitude = minimumLatitude;
  let minimumLongitude = places[0]?.longitudeValue ?? 0;
  let maximumLongitude = minimumLongitude;

  for (const place of places) {
    minimumLatitude = Math.min(minimumLatitude, place.latitudeValue);
    maximumLatitude = Math.max(maximumLatitude, place.latitudeValue);
    minimumLongitude = Math.min(minimumLongitude, place.longitudeValue);
    maximumLongitude = Math.max(maximumLongitude, place.longitudeValue);
  }

  const latitudeSpan = Math.max(maximumLatitude - minimumLatitude, 0.0025);
  const longitudeSpan = Math.max(maximumLongitude - minimumLongitude, 0.0025);
  const usableWidth = Math.max(180, width - 76);
  const usableHeight = Math.max(180, height - 126);
  const scale = Math.min(
    usableWidth / longitudeSpan,
    usableHeight / latitudeSpan,
  );

  return {
    centerLatitude: (minimumLatitude + maximumLatitude) / 2,
    centerLongitude: (minimumLongitude + maximumLongitude) / 2,
    scale: scale * zoom,
  };
}

function pointFor(
  place: MappedPlace,
  projection: Projection,
  width: number,
  height: number,
  pan: PixelPoint,
): PixelPoint {
  return {
    x:
      width / 2 +
      (place.longitudeValue - projection.centerLongitude) * projection.scale +
      pan.x,
    y:
      height / 2 -
      (place.latitudeValue - projection.centerLatitude) * projection.scale +
      pan.y,
  };
}

function routeEdgeKeys(route: CampusRoute | null) {
  const keys = new Set<string>();
  if (!route) return keys;

  for (let index = 1; index < route.ids.length; index += 1) {
    const a = route.ids[index - 1] ?? "";
    const b = route.ids[index] ?? "";
    keys.add(a < b ? a + ":" + b : b + ":" + a);
  }

  return keys;
}

function formatDistance(metres: number) {
  if (metres < 1000) return Math.max(1, Math.round(metres)) + " m";
  return (metres / 1000).toFixed(metres >= 10000 ? 0 : 1) + " km";
}

function VerificationBadge() {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.verifiedBadge}
    >
      <Ionicons color={theme.verificationMark} name="checkmark" size={9} />
    </View>
  );
}

function MapSegment({
  active,
  from,
  to,
}: {
  active: boolean;
  from: PixelPoint;
  to: PixelPoint;
}) {
  const { styles } = useThemeStyles(createStyles);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (length < 1) return null;

  const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
  return (
    <View
      pointerEvents="none"
      style={[
        active ? styles.routeSegment : styles.walkwaySegment,
        {
          left: (from.x + to.x) / 2 - length / 2,
          top: (from.y + to.y) / 2 - (active ? 3 : 2),
          width: length,
          transform: [{ rotate: angle + "deg" }],
        },
      ]}
    />
  );
}

function CampusMap({
  choosingOrigin,
  destination,
  directoryError,
  directoryLoading,
  height,
  onCancelRoute,
  onDirections,
  onLayout,
  onSelect,
  origin,
  places,
  route,
  selected,
  visiblePlaceIds,
  width,
}: {
  choosingOrigin: boolean;
  destination: MappedPlace | undefined;
  directoryError: boolean;
  directoryLoading: boolean;
  height: number;
  onCancelRoute: () => void;
  onDirections: (place: Place) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onSelect: (id: string) => void;
  origin: MappedPlace | undefined;
  places: MappedPlace[];
  route: CampusRoute | null;
  selected: MappedPlace | undefined;
  visiblePlaceIds: Set<string>;
  width: number;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PixelPoint>({ x: 0, y: 0 });
  const panRef = useRef<PixelPoint>(pan);
  const dragStartRef = useRef<PixelPoint>({ x: 0, y: 0 });
  const canPanRef = useRef(false);

  const boundsKey = useMemo(
    () => places.map((place) => place.id).sort().join("|"),
    [places],
  );
  const projection = useMemo(
    () => createProjection(places, width, height, zoom),
    [height, places, width, zoom],
  );
  const edges = useMemo(() => campusEdges(places), [places]);
  const activeEdges = useMemo(() => routeEdgeKeys(route), [route]);
  const placeById = useMemo(
    () => new Map(places.map((place) => [place.id, place] as const)),
    [places],
  );

  useEffect(() => {
    const centered = { x: 0, y: 0 };
    panRef.current = centered;
    setPan(centered);
    setZoom(1);
  }, [boundsKey]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  canPanRef.current = projection !== null;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          canPanRef.current &&
          (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
        onPanResponderGrant: () => {
          dragStartRef.current = panRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          setPan({
            x: dragStartRef.current.x + gesture.dx,
            y: dragStartRef.current.y + gesture.dy,
          });
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  const points = useMemo(() => {
    const result = new Map<string, PixelPoint>();
    if (!projection) return result;
    for (const place of places) {
      result.set(place.id, pointFor(place, projection, width, height, pan));
    }
    return result;
  }, [height, pan, places, projection, width]);

  const categoryZones = useMemo(() => {
    const groups = new Map<string, PixelPoint[]>();
    for (const place of places) {
      const point = points.get(place.id);
      if (!point) continue;
      const group = groups.get(place.category) ?? [];
      group.push(point);
      groups.set(place.category, group);
    }

    return Array.from(groups.entries())
      .filter(([, group]) => group.length >= 2)
      .map(([category, group]) => {
        const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
        const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
        return { category, x, y };
      });
  }, [places, points]);

  const recenter = useCallback(() => {
    void Haptics.selectionAsync();
    const centered = { x: 0, y: 0 };
    panRef.current = centered;
    setPan(centered);
    setZoom(1);
  }, []);

  const canZoomIn = zoom < MAX_MAP_ZOOM;
  const canZoomOut = zoom > MIN_MAP_ZOOM;

  return (
    <View style={styles.mapFrame}>
      <View
        {...panResponder.panHandlers}
        onLayout={onLayout}
        style={[styles.mapViewport, { height }]}
      >
        <View pointerEvents="none" style={styles.campusBoundary} />

        {categoryZones.map((zone) => (
          <View
            key={zone.category}
            pointerEvents="none"
            style={[
              styles.zone,
              {
                backgroundColor: zoneColors[zone.category] ?? "rgba(168,70,46,.07)",
                left: zone.x - 72,
                top: zone.y - 50,
              },
            ]}
          >
            <Text style={styles.zoneLabel}>
              {zone.category.charAt(0) + zone.category.slice(1).toLowerCase()}
            </Text>
          </View>
        ))}

        {projection
          ? edges.map((edge) => {
              const from = points.get(edge.a);
              const to = points.get(edge.b);
              if (!from || !to) return null;
              const key = edge.a < edge.b ? edge.a + ":" + edge.b : edge.b + ":" + edge.a;
              return (
                <MapSegment
                  active={activeEdges.has(key)}
                  from={from}
                  key={key}
                  to={to}
                />
              );
            })
          : null}

        {projection
          ? places.map((place) => {
              const position = points.get(place.id);
              if (!position) return null;
              if (
                position.x < -40 ||
                position.x > width + 40 ||
                position.y < -40 ||
                position.y > height + 40
              ) {
                return null;
              }

              const isOrigin = place.id === origin?.id;
              const isDestination = place.id === destination?.id;
              const isSelected = place.id === selected?.id;
              const isVisible =
                visiblePlaceIds.has(place.id) ||
                choosingOrigin ||
                Boolean(route) ||
                isOrigin ||
                isDestination;

              return (
                <Pressable
                  accessibilityLabel={
                    place.name +
                    ", " +
                    place.category.toLowerCase() +
                    (place.verified_at ? ", verified campus place" : "")
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  hitSlop={5}
                  key={place.id}
                  onPress={() => onSelect(place.id)}
                  style={({ pressed }) => [
                    styles.pin,
                    {
                      backgroundColor:
                        markerColors[place.category] ?? theme.brand,
                      left: position.x,
                      opacity: isVisible ? 1 : 0.24,
                      top: position.y,
                    },
                    (isSelected || isOrigin || isDestination) && styles.pinActive,
                    isOrigin && styles.pinOrigin,
                    isDestination && styles.pinDestination,
                    pressed && styles.pinPressed,
                  ]}
                >
                  <Ionicons
                    color="#FFFFFF"
                    name={
                      isOrigin
                        ? "walk"
                        : isDestination
                          ? "flag"
                          : icons[place.category] ?? "location-outline"
                    }
                    size={isSelected || isOrigin || isDestination ? 17 : 14}
                  />
                </Pressable>
              );
            })
          : null}

        <View pointerEvents="none" style={styles.layerBadge}>
          <View style={styles.layerBadgeIcon}>
            <Ionicons color="#FFFFFF" name="map" size={13} />
          </View>
          <View>
            <Text style={styles.layerBadgeTitle}>KampusOne map</Text>
            <Text style={styles.layerBadgeMeta}>Campus layer</Text>
          </View>
        </View>

        <View style={styles.mapControls}>
          <Pressable
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canZoomIn }}
            disabled={!canZoomIn}
            onPress={() => {
              void Haptics.selectionAsync();
              setZoom((current) => clamp(current + 0.2, MIN_MAP_ZOOM, MAX_MAP_ZOOM));
            }}
            style={({ pressed }) => [
              styles.zoomButton,
              !canZoomIn && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color={theme.text} name="add" size={20} />
          </Pressable>
          <View style={styles.controlDivider} />
          <Pressable
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canZoomOut }}
            disabled={!canZoomOut}
            onPress={() => {
              void Haptics.selectionAsync();
              setZoom((current) => clamp(current - 0.2, MIN_MAP_ZOOM, MAX_MAP_ZOOM));
            }}
            style={({ pressed }) => [
              styles.zoomButton,
              !canZoomOut && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color={theme.text} name="remove" size={20} />
          </Pressable>
          <View style={styles.controlDivider} />
          <Pressable
            accessibilityLabel="Recenter campus map"
            accessibilityRole="button"
            accessibilityState={{ disabled: !projection }}
            disabled={!projection}
            onPress={recenter}
            style={({ pressed }) => [
              styles.zoomButton,
              !projection && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color={theme.text} name="locate-outline" size={18} />
          </Pressable>
        </View>

        {!projection && directoryLoading ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <InlineLoading color={theme.brand} />
            <Text style={styles.mapFeedbackTitle}>Loading campus map…</Text>
          </View>
        ) : null}

        {!projection && directoryError ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <Ionicons
              color={theme.accentText}
              name="cloud-offline-outline"
              size={24}
            />
            <Text style={styles.mapFeedbackTitle}>Campus map unavailable</Text>
            <Text style={styles.mapFeedbackText}>
              Retry below to load the campus directory.
            </Text>
          </View>
        ) : null}

        {!projection && !directoryLoading && !directoryError ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <Ionicons color={theme.textMuted} name="map-outline" size={26} />
            <Text style={styles.mapFeedbackTitle}>No mapped places yet</Text>
          </View>
        ) : null}

        {choosingOrigin && destination ? (
          <View style={styles.routePrompt}>
            <View style={styles.routePromptIcon}>
              <Ionicons color="#FFFFFF" name="walk" size={17} />
            </View>
            <View style={styles.routePromptCopy}>
              <Text style={styles.routePromptTitle}>Choose where you are starting</Text>
              <Text numberOfLines={1} style={styles.routePromptText}>
                Tap any campus pin to route to {destination.name}.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cancel directions"
              accessibilityRole="button"
              onPress={onCancelRoute}
              style={({ pressed }) => [
                styles.routeClose,
                pressed && styles.controlPressed,
              ]}
            >
              <Ionicons color={theme.text} name="close" size={18} />
            </Pressable>
          </View>
        ) : null}

        {route && origin && destination ? (
          <View style={styles.routeSummary}>
            <View style={styles.routeSummaryTop}>
              <View style={styles.routeSummaryCopy}>
                <Text numberOfLines={1} style={styles.routeSummaryTitle}>
                  {origin.name} → {destination.name}
                </Text>
                <Text style={styles.routeSummaryMeta}>
                  {formatDistance(route.distance)} · about{" "}
                  {Math.max(
                    1,
                    Math.ceil(route.distance / WALKING_METRES_PER_MINUTE),
                  )}{" "}
                  min walk
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Clear directions"
                accessibilityRole="button"
                onPress={onCancelRoute}
                style={({ pressed }) => [
                  styles.routeClose,
                  pressed && styles.controlPressed,
                ]}
              >
                <Ionicons color={theme.text} name="close" size={18} />
              </Pressable>
            </View>
            <View style={styles.routeLegend}>
              <View style={styles.routeLegendLine} />
              <Text style={styles.routeLegendText}>KampusOne campus route</Text>
            </View>
          </View>
        ) : null}
      </View>

      {!choosingOrigin && !route && selected ? (
        <View style={styles.selectedPlace}>
          <View
            style={[
              styles.selectedPlaceIcon,
              {
                backgroundColor: markerColors[selected.category] ?? theme.brand,
              },
            ]}
          >
            <Ionicons
              color="#FFFFFF"
              name={icons[selected.category] ?? "location-outline"}
              size={17}
            />
          </View>
          <View style={styles.selectedPlaceCopy}>
            <View style={styles.selectedPlaceNameRow}>
              <Text
                accessibilityLabel={
                  selected.name +
                  (selected.verified_at ? ", verified campus place" : "")
                }
                numberOfLines={1}
                style={styles.selectedPlaceName}
              >
                {selected.name}
              </Text>
              {selected.verified_at ? <VerificationBadge /> : null}
            </View>
            <Text numberOfLines={1} style={styles.selectedPlaceMeta}>
              {selected.category.toLowerCase()} · tap directions to route here
            </Text>
          </View>
          <Pressable
            accessibilityLabel={"Directions to " + selected.name}
            accessibilityRole="button"
            onPress={() => onDirections(selected)}
            style={({ pressed }) => [
              styles.mapDirection,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color="#FFFFFF" name="navigate" size={17} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.mapCaption}>
          <Ionicons
            color={theme.brandPressed}
            name="git-branch-outline"
            size={16}
          />
          <Text style={styles.mapCaptionText}>
            Drag to explore, zoom, choose a place, and get campus directions
            without leaving KampusOne.
          </Text>
        </View>
      )}
    </View>
  );
}

function PlaceRow({
  onDirections,
  onSelect,
  place,
  selected,
}: {
  onDirections: (place: Place) => void;
  onSelect: (id: string) => void;
  place: Place;
  selected: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const hasCoordinates = coordinatesFor(place) !== null;

  return (
    <View style={[styles.placeRow, selected && styles.placeRowSelected]}>
      <Pressable
        accessibilityLabel={"Show " + place.name + " on campus map"}
        accessibilityRole="button"
        onPress={() => onSelect(place.id)}
        style={({ pressed }) => [
          styles.placeMain,
          pressed && styles.placeMainPressed,
        ]}
      >
        {place.image_url ? (
          <Image
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            resizeMode="cover"
            source={{ uri: place.image_url }}
            style={styles.placeImage}
          />
        ) : (
          <View style={styles.placeIcon}>
            <Ionicons
              color={theme.brandPressed}
              name={icons[place.category] ?? "location-outline"}
              size={21}
            />
          </View>
        )}
        <View style={styles.placeCopy}>
          <View style={styles.placeCategoryRow}>
            <Text style={styles.placeCategory}>
              {place.category.toLowerCase()}
            </Text>
            {place.verified_at ? <VerificationBadge /> : null}
          </View>
          <Text numberOfLines={1} style={styles.placeName}>
            {place.name}
          </Text>
          <Text numberOfLines={2} style={styles.placeDescription}>
            {place.description ??
              "Campus information will be added by a verified editor."}
          </Text>
          {place.accessibility_notes ? (
            <View style={styles.accessibilityRow}>
              <Ionicons
                color={theme.info}
                name="accessibility-outline"
                size={13}
              />
              <Text numberOfLines={1} style={styles.accessibilityText}>
                {place.accessibility_notes}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={
          hasCoordinates
            ? "Directions to " + place.name
            : "Directions unavailable for " + place.name
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !hasCoordinates }}
        disabled={!hasCoordinates}
        onPress={() => onDirections(place)}
        style={({ pressed }) => [
          styles.rowDirection,
          !hasCoordinates && styles.rowDirectionDisabled,
          pressed && styles.controlPressed,
        ]}
      >
        <Ionicons
          color={hasCoordinates ? "#FFFFFF" : theme.textSubtle}
          name={hasCoordinates ? "navigate" : "location-outline"}
          size={17}
        />
      </Pressable>
    </View>
  );
}

export default function MapScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { width } = useWindowDimensions();
  const mapHeight = clamp(width * 1.08, MIN_MAP_HEIGHT, MAX_MAP_HEIGHT);

  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<(typeof categories)[number]>("All");
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mapWidth, setMapWidth] = useState(360);
  const [routeDestinationId, setRouteDestinationId] = useState("");
  const [routeOriginId, setRouteOriginId] = useState("");
  const [choosingOrigin, setChoosingOrigin] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const response = await api<{ places: Place[] }>("/v1/student/campus/places");
      setPlaces(response.places);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Campus places could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filtered = useMemo(
    () =>
      places.filter((place) => {
        const needle = query.trim().toLowerCase();
        return (
          (selectedCategory === "All" ||
            place.category.toUpperCase() === selectedCategory.toUpperCase()) &&
          (!needle ||
            (place.name + " " + (place.description ?? ""))
              .toLowerCase()
              .includes(needle))
        );
      }),
    [places, query, selectedCategory],
  );

  const allMappedPlaces = useMemo<MappedPlace[]>(
    () =>
      places.flatMap((place) => {
        const coordinates = coordinatesFor(place);
        if (!coordinates) return [];
        return [
          {
            ...place,
            latitudeValue: coordinates.latitude,
            longitudeValue: coordinates.longitude,
          },
        ];
      }),
    [places],
  );

  const mappedPlaces = useMemo<MappedPlace[]>(
    () =>
      filtered.flatMap((place) => {
        const coordinates = coordinatesFor(place);
        if (!coordinates) return [];
        return [
          {
            ...place,
            latitudeValue: coordinates.latitude,
            longitudeValue: coordinates.longitude,
          },
        ];
      }),
    [filtered],
  );

  const visiblePlaceIds = useMemo(
    () => new Set(mappedPlaces.map((place) => place.id)),
    [mappedPlaces],
  );
  const selectedPlace =
    allMappedPlaces.find((place) => place.id === selectedPlaceId) ??
    mappedPlaces[0];
  const routeOrigin = allMappedPlaces.find(
    (place) => place.id === routeOriginId,
  );
  const routeDestination = allMappedPlaces.find(
    (place) => place.id === routeDestinationId,
  );
  const graphEdges = useMemo(
    () => campusEdges(allMappedPlaces),
    [allMappedPlaces],
  );
  const route = useMemo(
    () =>
      shortestCampusRoute(
        allMappedPlaces,
        graphEdges,
        routeOriginId,
        routeDestinationId,
      ),
    [allMappedPlaces, graphEdges, routeDestinationId, routeOriginId],
  );

  const clearRoute = useCallback(() => {
    void Haptics.selectionAsync();
    setRouteOriginId("");
    setRouteDestinationId("");
    setChoosingOrigin(false);
    setNotice("");
  }, []);

  const beginDirections = useCallback((place: Place) => {
    if (!coordinatesFor(place)) {
      const message =
        "Directions are unavailable until this place has mapped coordinates.";
      setNotice(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }

    void Haptics.selectionAsync();
    setSelectedPlaceId(place.id);
    setRouteDestinationId(place.id);
    setRouteOriginId("");
    setChoosingOrigin(true);
    setNotice("");
    AccessibilityInfo.announceForAccessibility(
      "Choose your starting point on the campus map.",
    );
  }, []);

  const selectPlace = useCallback(
    (id: string) => {
      void Haptics.selectionAsync();

      if (choosingOrigin) {
        if (id === routeDestinationId) {
          const message = "Choose a different starting point.";
          setNotice(message);
          AccessibilityInfo.announceForAccessibility(message);
          return;
        }
        setRouteOriginId(id);
        setChoosingOrigin(false);
        setNotice("");
        AccessibilityInfo.announceForAccessibility(
          "Campus directions are ready.",
        );
        return;
      }

      setSelectedPlaceId(id);
    },
    [choosingOrigin, routeDestinationId],
  );

  const updateMapLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setMapWidth((current) =>
      Math.abs(current - nextWidth) > 1 ? nextWidth : current,
    );
  }, []);

  const canShowDirectory = Boolean(places.length) || (!loading && !error);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={canShowDirectory ? filtered : []}
        initialNumToRender={7}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(place) => place.id}
        ListEmptyComponent={
          canShowDirectory ? (
            <View style={styles.directoryEmpty}>
              <Ionicons color={theme.brand} name="location-outline" size={29} />
              <Text style={styles.directoryEmptyTitle}>Place not found</Text>
              <Text style={styles.directoryEmptyBody}>
                Try another search or choose a different campus category.
              </Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>CAMPUS NAVIGATION</Text>
                <Text style={styles.title}>Find your way around</Text>
              </View>
              <View style={styles.headerIcon}>
                <Ionicons color={theme.brandPressed} name="navigate" size={20} />
              </View>
            </View>

            <SearchField
              onChangeText={setQuery}
              placeholder="Find a building or service"
              value={query}
            />
            <View style={styles.filters}>
              <FilterRow
                items={categories}
                onSelect={(item) =>
                  setSelectedCategory(item as typeof selectedCategory)
                }
                selected={selectedCategory}
              />
            </View>

            {notice ? (
              <View style={styles.notice}>
                <Ionicons
                  accessible={false}
                  color={theme.accentText}
                  name="information-circle-outline"
                  size={18}
                />
                <Text
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={styles.noticeText}
                >
                  {notice}
                </Text>
                <Pressable
                  accessibilityLabel="Dismiss map notice"
                  accessibilityRole="button"
                  onPress={() => setNotice("")}
                  style={({ pressed }) => [
                    styles.noticeDismiss,
                    pressed && styles.controlPressed,
                  ]}
                >
                  <Ionicons color={theme.textSubtle} name="close" size={19} />
                </Pressable>
              </View>
            ) : null}

            <CampusMap
              choosingOrigin={choosingOrigin}
              destination={routeDestination}
              directoryError={Boolean(error) && !places.length}
              directoryLoading={loading}
              height={mapHeight}
              onCancelRoute={clearRoute}
              onDirections={beginDirections}
              onLayout={updateMapLayout}
              onSelect={selectPlace}
              origin={routeOrigin}
              places={allMappedPlaces}
              route={route}
              selected={selectedPlace}
              visiblePlaceIds={visiblePlaceIds}
              width={mapWidth}
            />

            {loading ? (
              <View
                accessibilityLiveRegion="polite"
                style={styles.directoryLoading}
              >
                <InlineLoading color={theme.brand} />
                <Text style={styles.directoryLoadingText}>
                  Loading campus places…
                </Text>
              </View>
            ) : null}

            {error ? (
              <Pressable
                accessibilityLabel={
                  "The campus directory is unavailable. " + error + ". Retry"
                }
                accessibilityRole="button"
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
                style={({ pressed }) => [
                  styles.error,
                  pressed && styles.controlPressed,
                ]}
              >
                <Ionicons
                  color={theme.accentText}
                  name="cloud-offline-outline"
                  size={20}
                />
                <View style={styles.errorCopy}>
                  <Text style={styles.errorTitle}>
                    The campus directory is unavailable
                  </Text>
                  <Text style={styles.errorText}>{error} Tap to retry.</Text>
                </View>
              </Pressable>
            ) : null}

            {canShowDirectory ? (
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Places on campus</Text>
                  <Text style={styles.sectionSubtitle}>
                    {filtered.length}{" "}
                    {filtered.length === 1 ? "place" : "places"} in this view
                  </Text>
                </View>
                <View style={styles.coordinateKey}>
                  <View style={styles.coordinateKeyLine} />
                  <Text style={styles.coordinateKeyText}>In-app directions</Text>
                </View>
              </View>
            ) : null}
          </>
        }
        maxToRenderPerBatch={9}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item: place }) => (
          <PlaceRow
            onDirections={beginDirections}
            onSelect={selectPlace}
            place={place}
            selected={place.id === selectedPlaceId}
          />
        )}
        showsVerticalScrollIndicator={false}
        style={[styles.directory, { width: Math.min(width, 560) }]}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { backgroundColor: theme.canvas, flex: 1 },
    directory: { alignSelf: "center" },
    listContent: { paddingBottom: 120, paddingHorizontal: 18, paddingTop: 10 },
    header: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 16,
      paddingHorizontal: 2,
    },
    eyebrow: {
      color: theme.brandPressed,
      fontFamily: theme.font.bold,
      fontSize: 9,
      letterSpacing: 1.1,
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 26,
      lineHeight: 31,
      marginTop: 2,
    },
    headerIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 18,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    filters: { marginBottom: 14, marginTop: 12 },
    notice: {
      alignItems: "center",
      backgroundColor: "rgba(241,223,200,.50)",
      borderColor: "rgba(168,70,46,.14)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 8,
      marginBottom: 12,
      minHeight: 52,
      paddingLeft: 12,
      paddingRight: 4,
      paddingVertical: 4,
    },
    noticeText: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
      lineHeight: 17,
    },
    noticeDismiss: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    mapFrame: {
      backgroundColor: theme.surfaceRaised,
      borderColor: "rgba(120,86,66,.18)",
      borderRadius: 26,
      borderWidth: 1,
      overflow: "hidden",
      ...theme.shadow,
    },
    mapViewport: {
      backgroundColor: "#F2E9DC",
      overflow: "hidden",
      position: "relative",
      width: "100%",
    },
    campusBoundary: {
      backgroundColor: "rgba(255,255,255,.42)",
      borderColor: "rgba(168,70,46,.18)",
      borderRadius: 34,
      borderWidth: 2,
      bottom: 22,
      left: 18,
      position: "absolute",
      right: 18,
      top: 22,
    },
    zone: {
      alignItems: "center",
      borderRadius: 42,
      height: 100,
      justifyContent: "flex-start",
      paddingTop: 10,
      position: "absolute",
      width: 144,
    },
    zoneLabel: {
      color: "rgba(66,54,46,.47)",
      fontFamily: theme.font.bold,
      fontSize: 8,
      letterSpacing: 0.55,
      textTransform: "uppercase",
    },
    walkwaySegment: {
      backgroundColor: "rgba(97,83,73,.26)",
      borderRadius: 2,
      height: 4,
      position: "absolute",
    },
    routeSegment: {
      backgroundColor: theme.deepBrand,
      borderColor: "rgba(255,255,255,.90)",
      borderRadius: 3,
      borderWidth: 1,
      height: 6,
      position: "absolute",
    },
    layerBadge: {
      alignItems: "center",
      backgroundColor: "rgba(255,252,248,.94)",
      borderColor: "rgba(120,86,66,.16)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 8,
      left: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      position: "absolute",
      top: 10,
      ...theme.shadow,
    },
    layerBadgeIcon: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 10,
      height: 27,
      justifyContent: "center",
      width: 27,
    },
    layerBadgeTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 10.5,
    },
    layerBadgeMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 8.5,
      marginTop: 1,
    },
    mapControls: {
      backgroundColor: "rgba(255,252,248,.95)",
      borderColor: "rgba(120,86,66,.16)",
      borderRadius: 15,
      borderWidth: 1,
      overflow: "hidden",
      position: "absolute",
      right: 10,
      top: 10,
      ...theme.shadow,
    },
    zoomButton: {
      alignItems: "center",
      height: 42,
      justifyContent: "center",
      width: 42,
    },
    controlDivider: {
      backgroundColor: "rgba(120,86,66,.12)",
      height: 1,
      marginHorizontal: 8,
    },
    controlDisabled: { opacity: 0.35 },
    controlPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
    mapFeedback: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: "rgba(255,252,248,.94)",
      borderColor: "rgba(120,86,66,.16)",
      borderRadius: 18,
      borderWidth: 1,
      gap: 7,
      left: 48,
      padding: 16,
      position: "absolute",
      right: 48,
      top: 142,
      ...theme.shadow,
    },
    mapFeedbackTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
      textAlign: "center",
    },
    mapFeedbackText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 10.5,
      lineHeight: 15,
      textAlign: "center",
    },
    pin: {
      alignItems: "center",
      borderColor: "#FFFFFF",
      borderRadius: 17,
      borderWidth: 2,
      height: 34,
      justifyContent: "center",
      marginLeft: -17,
      marginTop: -17,
      position: "absolute",
      width: 34,
      ...theme.shadow,
    },
    pinActive: {
      borderRadius: 20,
      borderWidth: 3,
      height: 40,
      marginLeft: -20,
      marginTop: -20,
      width: 40,
    },
    pinOrigin: { borderColor: "#F6C453" },
    pinDestination: { borderColor: theme.deepBrand },
    pinPressed: { opacity: 0.82, transform: [{ scale: 0.95 }] },
    routePrompt: {
      alignItems: "center",
      backgroundColor: "rgba(255,252,248,.97)",
      borderColor: "rgba(168,70,46,.18)",
      borderRadius: 18,
      borderWidth: 1,
      bottom: 12,
      flexDirection: "row",
      gap: 9,
      left: 12,
      padding: 10,
      position: "absolute",
      right: 12,
      ...theme.shadow,
    },
    routePromptIcon: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 13,
      height: 38,
      justifyContent: "center",
      width: 38,
    },
    routePromptCopy: { flex: 1 },
    routePromptTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
    },
    routePromptText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 9.5,
      marginTop: 2,
    },
    routeClose: {
      alignItems: "center",
      borderRadius: 12,
      height: 38,
      justifyContent: "center",
      width: 38,
    },
    routeSummary: {
      backgroundColor: "rgba(255,252,248,.97)",
      borderColor: "rgba(168,70,46,.18)",
      borderRadius: 18,
      borderWidth: 1,
      bottom: 12,
      left: 12,
      padding: 11,
      position: "absolute",
      right: 12,
      ...theme.shadow,
    },
    routeSummaryTop: { alignItems: "center", flexDirection: "row" },
    routeSummaryCopy: { flex: 1, paddingRight: 8 },
    routeSummaryTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
    },
    routeSummaryMeta: {
      color: theme.brandPressed,
      fontFamily: theme.font.semibold,
      fontSize: 9.5,
      marginTop: 3,
    },
    routeLegend: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      marginTop: 8,
    },
    routeLegendLine: {
      backgroundColor: theme.deepBrand,
      borderRadius: 2,
      height: 4,
      width: 28,
    },
    routeLegendText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 8.5,
    },
    selectedPlace: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 72,
      paddingHorizontal: 11,
      paddingVertical: 10,
    },
    selectedPlaceIcon: {
      alignItems: "center",
      borderRadius: 13,
      height: 42,
      justifyContent: "center",
      width: 42,
    },
    selectedPlaceCopy: { flex: 1, marginLeft: 9 },
    selectedPlaceNameRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
    },
    selectedPlaceName: {
      color: theme.text,
      flexShrink: 1,
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
    },
    selectedPlaceMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 9.5,
      marginTop: 2,
    },
    mapDirection: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    mapCaption: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      minHeight: 56,
      paddingHorizontal: 12,
    },
    mapCaptionText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.body,
      fontSize: 10,
      lineHeight: 15,
    },
    verifiedBadge: {
      alignItems: "center",
      backgroundColor: theme.brand,
      borderRadius: 7,
      height: 14,
      justifyContent: "center",
      width: 14,
    },
    directoryLoading: { alignItems: "center", gap: 8, paddingVertical: 24 },
    directoryLoadingText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
    },
    error: {
      alignItems: "center",
      backgroundColor: theme.surfaceSoft,
      borderRadius: 18,
      flexDirection: "row",
      gap: 11,
      marginTop: 14,
      minHeight: 72,
      padding: 14,
    },
    errorCopy: { flex: 1 },
    errorTitle: {
      color: theme.accentText,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    errorText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: 2,
    },
    sectionHeader: {
      alignItems: "flex-end",
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 24,
      paddingHorizontal: 2,
    },
    sectionTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 22,
    },
    sectionSubtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      marginTop: 3,
    },
    coordinateKey: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
      paddingBottom: 3,
    },
    coordinateKeyLine: {
      backgroundColor: theme.deepBrand,
      borderRadius: 2,
      height: 4,
      width: 20,
    },
    coordinateKeyText: {
      color: theme.brandPressed,
      fontFamily: theme.font.medium,
      fontSize: 9.5,
    },
    placeRow: {
      alignItems: "center",
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      minHeight: 106,
      paddingVertical: 10,
    },
    placeRowSelected: {
      backgroundColor: "rgba(241,223,200,.20)",
      borderRadius: 16,
      paddingHorizontal: 6,
    },
    placeMain: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      minHeight: 82,
    },
    placeMainPressed: { opacity: 0.76 },
    placeImage: { borderRadius: 15, height: 66, width: 66 },
    placeIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 15,
      height: 62,
      justifyContent: "center",
      width: 62,
    },
    placeCopy: { flex: 1, marginLeft: 11 },
    placeCategoryRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
    },
    placeCategory: {
      color: theme.brandPressed,
      fontFamily: theme.font.bold,
      fontSize: 8.5,
      letterSpacing: 0.55,
      textTransform: "uppercase",
    },
    placeName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
      marginTop: 3,
    },
    placeDescription: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
      lineHeight: 15,
      marginTop: 2,
    },
    accessibilityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      marginTop: 4,
    },
    accessibilityText: {
      color: theme.info,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 9.5,
    },
    rowDirection: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      marginLeft: 8,
      width: 44,
    },
    rowDirectionDisabled: {
      backgroundColor: theme.surfaceMuted,
      opacity: 0.52,
    },
    directoryEmpty: {
      alignItems: "center",
      minHeight: 220,
      paddingHorizontal: 24,
      paddingTop: 48,
    },
    directoryEmptyTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 19,
      marginTop: 10,
    },
    directoryEmptyBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      lineHeight: 19,
      marginTop: 5,
      textAlign: "center",
    },
  });

const styles = createStyles(theme);
