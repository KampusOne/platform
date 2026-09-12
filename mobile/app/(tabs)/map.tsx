import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  type LayoutChangeEvent,
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

const categories = ["All", "Academic", "Service", "Transport", "Hostel", "Food", "Health", "Sport"] as const;
const TILE_SIZE = 256;
const MAP_HEIGHT = 324;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const OSM_TILE_BASE = (process.env.EXPO_PUBLIC_OSM_TILE_URL ?? "https://tile.openstreetmap.org").replace(/\/+$/, "");
const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";
const TILE_HEADERS = { "User-Agent": "KampusOne/0.1 (+https://kampusone.app)" };

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
type MapView = { latitude: number; longitude: number; zoom: number };
type PixelPoint = { x: number; y: number };
type MapTile = { key: string; left: number; top: number; uri: string };
type TileStatus = { failed: number; key: string; loaded: number };

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapTileX(value: number, tileCount: number) {
  return ((value % tileCount) + tileCount) % tileCount;
}

function coordinatesFor(place: Place) {
  if (place.latitude === null || place.longitude === null || !place.latitude.trim() || !place.longitude.trim()) return null;
  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -85.05112878 || latitude > 85.05112878 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function normalizedMercator(latitude: number, longitude: number): PixelPoint {
  const safeLatitude = clamp(latitude, -85.05112878, 85.05112878);
  const sinLatitude = Math.sin((safeLatitude * Math.PI) / 180);
  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI),
  };
}

function latitudeFromMercatorY(y: number) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

function worldPixel(latitude: number, longitude: number, zoom: number): PixelPoint {
  const normalized = normalizedMercator(latitude, longitude);
  const worldSize = TILE_SIZE * 2 ** zoom;
  return { x: normalized.x * worldSize, y: normalized.y * worldSize };
}

function fitMapView(places: MappedPlace[], width: number, height: number): MapView | null {
  if (!places.length) return null;

  const first = normalizedMercator(places[0]?.latitudeValue ?? 0, places[0]?.longitudeValue ?? 0);
  let minimumX = first.x;
  let maximumX = first.x;
  let minimumY = first.y;
  let maximumY = first.y;

  for (const place of places) {
    const point = normalizedMercator(place.latitudeValue, place.longitudeValue);
    minimumX = Math.min(minimumX, point.x);
    maximumX = Math.max(maximumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
  }

  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  const spanX = maximumX - minimumX;
  const spanY = maximumY - minimumY;
  const innerWidth = Math.max(120, width - 92);
  const innerHeight = Math.max(120, height - 116);
  const zoomX = spanX > 0 ? Math.log2(innerWidth / (TILE_SIZE * spanX)) : MAX_ZOOM;
  const zoomY = spanY > 0 ? Math.log2(innerHeight / (TILE_SIZE * spanY)) : MAX_ZOOM;
  const fittedZoom = places.length === 1 ? 17 : Math.floor(Math.min(zoomX, zoomY));

  return {
    latitude: latitudeFromMercatorY(centerY),
    longitude: centerX * 360 - 180,
    zoom: clamp(fittedZoom, MIN_ZOOM, 18),
  };
}

function visibleTiles(view: MapView, width: number, height: number): MapTile[] {
  const center = worldPixel(view.latitude, view.longitude, view.zoom);
  const leftEdge = center.x - width / 2;
  const topEdge = center.y - height / 2;
  const rightEdge = center.x + width / 2;
  const bottomEdge = center.y + height / 2;
  const minimumTileX = Math.floor(leftEdge / TILE_SIZE);
  const maximumTileX = Math.floor(rightEdge / TILE_SIZE);
  const minimumTileY = Math.floor(topEdge / TILE_SIZE);
  const maximumTileY = Math.floor(bottomEdge / TILE_SIZE);
  const tileCount = 2 ** view.zoom;
  const tiles: MapTile[] = [];

  for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
      const wrappedX = wrapTileX(tileX, tileCount);
      tiles.push({
        key: `${view.zoom}/${tileX}/${tileY}`,
        left: tileX * TILE_SIZE - leftEdge,
        top: tileY * TILE_SIZE - topEdge,
        uri: `${OSM_TILE_BASE}/${view.zoom}/${wrappedX}/${tileY}.png`,
      });
    }
  }

  return tiles;
}

function markerPosition(place: MappedPlace, view: MapView, width: number, height: number) {
  const center = worldPixel(view.latitude, view.longitude, view.zoom);
  const point = worldPixel(place.latitudeValue, place.longitudeValue, view.zoom);
  const worldSize = TILE_SIZE * 2 ** view.zoom;
  let horizontalOffset = point.x - center.x;
  if (horizontalOffset > worldSize / 2) horizontalOffset -= worldSize;
  if (horizontalOffset < -worldSize / 2) horizontalOffset += worldSize;
  return { left: width / 2 + horizontalOffset, top: height / 2 + point.y - center.y };
}

function VerificationBadge() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.verifiedBadge}>
      <Ionicons color={theme.verificationMark} name="checkmark" size={9} />
    </View>
  );
}

function RasterTile({ onSettled, tile }: { onSettled: (loaded: boolean) => void; tile: MapTile }) {
  const settled = useRef(false);
  const settle = useCallback((loaded: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onSettled(loaded);
  }, [onSettled]);

  return (
    <Image
      accessible={false}
      accessibilityIgnoresInvertColors
      fadeDuration={0}
      onError={() => settle(false)}
      onLoad={() => settle(true)}
      resizeMode="cover"
      source={{ cache: "force-cache", headers: TILE_HEADERS, uri: tile.uri }}
      style={[styles.mapTile, { left: tile.left, top: tile.top }]}
    />
  );
}

function OpenStreetMap({
  directoryError,
  directoryLoading,
  height,
  onDirections,
  onLayout,
  onRecenter,
  onSelect,
  onZoom,
  places,
  selected,
  viewportPlaces,
  width,
  zoomAdjustment,
}: {
  directoryError: boolean;
  directoryLoading: boolean;
  height: number;
  onDirections: (place: Place) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onRecenter: () => void;
  onSelect: (id: string) => void;
  onZoom: (change: number) => void;
  places: MappedPlace[];
  selected: MappedPlace | undefined;
  viewportPlaces: MappedPlace[];
  width: number;
  zoomAdjustment: number;
}) {
  const fittedView = useMemo(() => fitMapView(viewportPlaces, width, height), [height, viewportPlaces, width]);
  const view = useMemo(() => fittedView ? {
    ...fittedView,
    zoom: clamp(fittedView.zoom + zoomAdjustment, MIN_ZOOM, MAX_ZOOM),
  } : null, [fittedView, zoomAdjustment]);
  const tiles = useMemo(() => view ? visibleTiles(view, width, height) : [], [height, view, width]);
  const tileSetKey = useMemo(() => tiles.map((tile) => tile.key).join("|"), [tiles]);
  const [tileStatus, setTileStatus] = useState<TileStatus>({ failed: 0, key: "", loaded: 0 });

  const settleTile = useCallback((loaded: boolean) => {
    setTileStatus((current) => {
      const status = current.key === tileSetKey ? current : { failed: 0, key: tileSetKey, loaded: 0 };
      return loaded
        ? { ...status, loaded: status.loaded + 1 }
        : { ...status, failed: status.failed + 1 };
    });
  }, [tileSetKey]);

  const currentStatus = tileStatus.key === tileSetKey ? tileStatus : { failed: 0, key: tileSetKey, loaded: 0 };
  const tilesLoading = Boolean(tiles.length) && currentStatus.loaded === 0 && currentStatus.failed < tiles.length;
  const tilesUnavailable = Boolean(tiles.length) && currentStatus.loaded === 0 && currentStatus.failed >= tiles.length;
  const partialFailure = currentStatus.loaded > 0 && currentStatus.failed > 0;
  const canZoomIn = view !== null && view.zoom < MAX_ZOOM;
  const canZoomOut = view !== null && view.zoom > MIN_ZOOM;

  return (
    <View style={styles.mapFrame}>
      <View onLayout={onLayout} style={[styles.mapViewport, { height }]}>
        {tiles.map((tile) => <RasterTile key={tile.key} onSettled={settleTile} tile={tile} />)}

        {view ? places.map((place) => {
          const position = markerPosition(place, view, width, height);
          if (position.left < -28 || position.left > width + 28 || position.top < -28 || position.top > height + 28) return null;
          const active = place.id === selected?.id;
          return (
            <Pressable
              accessibilityLabel={`${place.name}, ${place.category.toLowerCase()}${place.verified_at ? ", verified campus place" : ""}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={4}
              key={place.id}
              onPress={() => onSelect(place.id)}
              style={({ pressed }) => [
                styles.pin,
                { backgroundColor: markerColors[place.category] ?? theme.brand, left: position.left, top: position.top },
                active && styles.pinActive,
                pressed && styles.pinPressed,
              ]}
            >
              <Ionicons color="#FFFFFF" name={icons[place.category] ?? "location-outline"} size={active ? 19 : 16} />
            </Pressable>
          );
        }) : null}

        {!view && !directoryLoading && !directoryError ? (
          <View style={styles.mapFallback}>
            <Ionicons color={theme.textMuted} name="map-outline" size={28} />
            <Text style={styles.mapFallbackTitle}>No mapped places in this view</Text>
            <Text style={styles.mapFallbackBody}>A real map can appear after a campus editor saves valid coordinates.</Text>
          </View>
        ) : null}

        {!view && directoryLoading ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <ActivityIndicator color={theme.brand} />
            <Text style={styles.mapFeedbackText}>Loading campus coordinates…</Text>
          </View>
        ) : null}

        {!view && directoryError ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={24} />
            <Text style={styles.mapFeedbackTitle}>Campus map unavailable</Text>
            <Text style={styles.mapFeedbackText}>Retry the campus directory below to load mapped places.</Text>
          </View>
        ) : null}

        {tilesLoading ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <ActivityIndicator color={theme.brand} />
            <Text style={styles.mapFeedbackText}>Loading OpenStreetMap…</Text>
          </View>
        ) : null}

        {tilesUnavailable ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={24} />
            <Text style={styles.mapFeedbackTitle}>Map tiles are unavailable</Text>
            <Text style={styles.mapFeedbackText}>The directory remains available. Directions can open when your connection returns.</Text>
          </View>
        ) : null}

        {partialFailure ? (
          <View pointerEvents="none" style={styles.partialBadge}>
            <Ionicons color={theme.statusAttention} name="warning-outline" size={13} />
            <Text style={styles.partialBadgeText}>Some tiles unavailable</Text>
          </View>
        ) : null}

        <View style={styles.mapControls}>
          <Pressable
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canZoomIn }}
            disabled={!canZoomIn}
            onPress={() => onZoom(1)}
            style={({ pressed }) => [styles.zoomButton, !canZoomIn && styles.controlDisabled, pressed && styles.controlPressed]}
          >
            <Ionicons color={theme.text} name="add" size={21} />
          </Pressable>
          <View style={styles.controlDivider} />
          <Pressable
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canZoomOut }}
            disabled={!canZoomOut}
            onPress={() => onZoom(-1)}
            style={({ pressed }) => [styles.zoomButton, !canZoomOut && styles.controlDisabled, pressed && styles.controlPressed]}
          >
            <Ionicons color={theme.text} name="remove" size={21} />
          </Pressable>
          <View style={styles.controlDivider} />
          <Pressable
            accessibilityHint="Fits all mapped campus places on the map"
            accessibilityLabel="Recenter campus places"
            accessibilityRole="button"
            accessibilityState={{ disabled: !view }}
            disabled={!view}
            onPress={onRecenter}
            style={({ pressed }) => [styles.zoomButton, !view && styles.controlDisabled, pressed && styles.controlPressed]}
          >
            <Ionicons color={theme.text} name="scan-outline" size={19} />
          </Pressable>
        </View>

        {view ? (
          <View pointerEvents="none" style={styles.zoomBadge}>
            <Text style={styles.zoomBadgeText}>z{view.zoom}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityLabel="Open OpenStreetMap copyright and licence information"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(OSM_ATTRIBUTION_URL)}
          style={({ pressed }) => [styles.attribution, pressed && styles.controlPressed]}
        >
          <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
        </Pressable>
      </View>

      {selected ? (
        <View style={styles.selectedPlace}>
          <View style={[styles.selectedPlaceIcon, { backgroundColor: markerColors[selected.category] ?? theme.brand }]}>
            <Ionicons color="#FFFFFF" name={icons[selected.category] ?? "location-outline"} size={17} />
          </View>
          <View style={styles.selectedPlaceCopy}>
            <View style={styles.selectedPlaceNameRow}>
              <Text
                accessibilityLabel={`${selected.name}${selected.verified_at ? ", verified campus place" : ""}`}
                numberOfLines={1}
                style={styles.selectedPlaceName}
              >
                {selected.name}
              </Text>
              {selected.verified_at ? <VerificationBadge /> : null}
            </View>
            <Text numberOfLines={1} style={styles.selectedPlaceMeta}>{selected.category.toLowerCase()} · mapped coordinates</Text>
          </View>
          <Pressable
            accessibilityLabel={`Open directions to ${selected.name} in Google Maps`}
            accessibilityRole="link"
            onPress={() => onDirections(selected)}
            style={({ pressed }) => [styles.mapDirection, pressed && styles.controlPressed]}
          >
            <Ionicons color="#FFFFFF" name="navigate" size={17} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.mapCaption}>
          <Ionicons color={theme.brandPressed} name="information-circle-outline" size={16} />
          <Text style={styles.mapCaptionText}>This map shows only places with reviewed coordinates. It does not provide live navigation.</Text>
        </View>
      )}
    </View>
  );
}

function PlaceRow({ onDirections, place }: { onDirections: (place: Place) => void; place: Place }) {
  const hasCoordinates = coordinatesFor(place) !== null;
  return (
    <View style={styles.placeRow}>
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
          <Ionicons color={theme.brandPressed} name={icons[place.category] ?? "location-outline"} size={22} />
        </View>
      )}
      <View style={styles.placeCopy}>
        <View style={styles.placeCategoryRow}>
          <Text style={styles.placeCategory}>{place.category.toLowerCase()}</Text>
          {place.verified_at ? <VerificationBadge /> : null}
        </View>
        <Text accessibilityLabel={`${place.name}${place.verified_at ? ", verified campus place" : ""}`} style={styles.placeName}>
          {place.name}
        </Text>
        <Text numberOfLines={2} style={styles.placeDescription}>
          {place.description ?? "Campus information will be added by a verified editor."}
        </Text>
        {place.accessibility_notes ? (
          <View style={styles.accessibilityRow}>
            <Ionicons color={theme.info} name="accessibility-outline" size={13} />
            <Text numberOfLines={2} style={styles.accessibilityText}>{place.accessibility_notes}</Text>
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={hasCoordinates ? `Directions to ${place.name}` : `Directions unavailable for ${place.name}`}
        accessibilityRole="link"
        accessibilityState={{ disabled: !hasCoordinates }}
        disabled={!hasCoordinates}
        onPress={() => onDirections(place)}
        style={({ pressed }) => [styles.rowDirection, !hasCoordinates && styles.rowDirectionDisabled, pressed && styles.controlPressed]}
      >
        <Ionicons color={hasCoordinates ? theme.deepBrand : theme.textSubtle} name={hasCoordinates ? "navigate-outline" : "location-outline"} size={20} />
      </Pressable>
    </View>
  );
}

export default function MapScreen() {
  const { width } = useWindowDimensions();
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mapWidth, setMapWidth] = useState(360);
  const [zoomAdjustment, setZoomAdjustment] = useState(0);

  const load = useCallback(async () => {
    try {
      setError("");
      setPlaces((await api<{ places: Place[] }>("/v1/student/campus/places")).places);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Campus places could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => places.filter((place) => {
    const needle = query.trim().toLowerCase();
    return (selected === "All" || place.category.toUpperCase() === selected.toUpperCase())
      && (!needle || `${place.name} ${place.description ?? ""}`.toLowerCase().includes(needle));
  }), [places, query, selected]);

  const allMappedPlaces = useMemo<MappedPlace[]>(() => places.flatMap((place) => {
    const coordinates = coordinatesFor(place);
    if (!coordinates) return [];
    return [{ ...place, latitudeValue: coordinates.latitude, longitudeValue: coordinates.longitude }];
  }), [places]);
  const mappedPlaces = useMemo<MappedPlace[]>(() => filtered.flatMap((place) => {
    const coordinates = coordinatesFor(place);
    if (!coordinates) return [];
    return [{ ...place, latitudeValue: coordinates.latitude, longitudeValue: coordinates.longitude }];
  }), [filtered]);
  const selectedPlace = mappedPlaces.find((place) => place.id === selectedPlaceId) ?? mappedPlaces[0];

  const directions = useCallback(async (place: Place) => {
    const coordinates = coordinatesFor(place);
    if (!coordinates) {
      const message = "Directions are unavailable until a campus editor adds coordinates for this place.";
      setNotice(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }

    const destination = `${coordinates.latitude},${coordinates.longitude}`;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    try {
      void Haptics.selectionAsync();
      await Linking.openURL(url);
    } catch {
      const message = "Google Maps directions could not be opened on this device.";
      setNotice(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, []);

  const selectPlace = useCallback((id: string) => {
    void Haptics.selectionAsync();
    setSelectedPlaceId(id);
  }, []);

  const updateSearch = useCallback((value: string) => {
    setQuery(value);
  }, []);

  const updateCategory = useCallback((item: string) => {
    setSelected(item as typeof selected);
  }, []);

  const updateMapLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setMapWidth((current) => Math.abs(current - nextWidth) > 1 ? nextWidth : current);
  }, []);

  const zoomMap = useCallback((change: number) => {
    void Haptics.selectionAsync();
    setZoomAdjustment((current) => clamp(current + change, -16, 16));
  }, []);

  const recenterMap = useCallback(() => {
    void Haptics.selectionAsync();
    setZoomAdjustment(0);
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
        ListEmptyComponent={canShowDirectory ? (
          <View style={styles.directoryEmpty}>
            <Ionicons color={theme.brand} name="location-outline" size={29} />
            <Text style={styles.directoryEmptyTitle}>Place not found</Text>
            <Text style={styles.directoryEmptyBody}>Try another search or choose a different campus category.</Text>
          </View>
        ) : null}
        ListHeaderComponent={(
          <>
            <SearchField onChangeText={updateSearch} placeholder="Find a building or service" value={query} />
            <View style={styles.filters}>
              <FilterRow items={categories} onSelect={updateCategory} selected={selected} />
            </View>

            {notice ? (
              <View style={styles.notice}>
                <Ionicons accessible={false} color={theme.deepBrand} name="information-circle-outline" size={18} />
                <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.noticeText}>{notice}</Text>
                <Pressable
                  accessibilityLabel="Dismiss map notice"
                  accessibilityRole="button"
                  onPress={() => setNotice("")}
                  style={({ pressed }) => [styles.noticeDismiss, pressed && styles.controlPressed]}
                >
                  <Ionicons color={theme.textSubtle} name="close" size={19} />
                </Pressable>
              </View>
            ) : null}

            <OpenStreetMap
              directoryError={Boolean(error) && !places.length}
              directoryLoading={loading}
              height={MAP_HEIGHT}
              onDirections={(place) => void directions(place)}
              onLayout={updateMapLayout}
              onRecenter={recenterMap}
              onSelect={selectPlace}
              onZoom={zoomMap}
              places={mappedPlaces}
              selected={selectedPlace}
              viewportPlaces={allMappedPlaces}
              width={mapWidth}
              zoomAdjustment={zoomAdjustment}
            />

            {loading ? (
              <View accessibilityLiveRegion="polite" style={styles.directoryLoading}>
                <ActivityIndicator color={theme.brand} />
                <Text style={styles.directoryLoadingText}>Loading reviewed campus places…</Text>
              </View>
            ) : null}

            {error ? (
              <Pressable
                accessibilityLabel={`The campus directory is unavailable. ${error}. Retry`}
                accessibilityRole="button"
                onPress={() => { setLoading(true); void load(); }}
                style={({ pressed }) => [styles.error, pressed && styles.controlPressed]}
              >
                <Ionicons color={theme.deepBrand} name="cloud-offline-outline" size={20} />
                <View style={styles.errorCopy}>
                  <Text style={styles.errorTitle}>The campus directory is unavailable</Text>
                  <Text style={styles.errorText}>{error} Tap to retry.</Text>
                </View>
              </Pressable>
            ) : null}

            {canShowDirectory ? (
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Campus places</Text>
                  <Text style={styles.sectionSubtitle}>{filtered.length} {filtered.length === 1 ? "place" : "places"} in this view</Text>
                </View>
                <View style={styles.coordinateKey}>
                  <Ionicons color={theme.brandPressed} name="navigate-outline" size={14} />
                  <Text style={styles.coordinateKeyText}>Google Maps handoff</Text>
                </View>
              </View>
            ) : null}
          </>
        )}
        maxToRenderPerBatch={9}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item: place }) => <PlaceRow onDirections={(item) => void directions(item)} place={place} />}
        showsVerticalScrollIndicator={false}
        style={[styles.directory, { width: Math.min(width, 540) }]}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1 },
  directory: { alignSelf: "center" },
  listContent: { paddingBottom: 118, paddingHorizontal: 20, paddingTop: 10 },
  filters: { marginBottom: 14, marginTop: 13 },
  notice: { alignItems: "center", backgroundColor: "rgba(241,223,200,.50)", borderColor: "rgba(168,70,46,.14)", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 12, minHeight: 52, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  noticeText: { color: theme.text, flex: 1, fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17 },
  noticeDismiss: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  mapFrame: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 25, borderWidth: 1, overflow: "hidden", ...theme.shadow },
  mapViewport: { backgroundColor: theme.surfaceMuted, overflow: "hidden", position: "relative", width: "100%" },
  mapTile: { height: TILE_SIZE + 1, position: "absolute", width: TILE_SIZE + 1 },
  mapFallback: { alignItems: "center", bottom: 0, justifyContent: "center", left: 32, position: "absolute", right: 32, top: 0 },
  mapFallbackTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, marginTop: 9, textAlign: "center" },
  mapFallbackBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, marginTop: 4, textAlign: "center" },
  mapFeedback: { alignItems: "center", alignSelf: "center", backgroundColor: "rgba(255,255,255,.94)", borderColor: theme.border, borderRadius: 17, borderWidth: 1, gap: 7, left: 48, padding: 14, position: "absolute", right: 48, top: 110, ...theme.shadow },
  mapFeedbackTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5, textAlign: "center" },
  mapFeedbackText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5, lineHeight: 15, textAlign: "center" },
  partialBadge: { alignItems: "center", backgroundColor: "rgba(255,247,233,.95)", borderRadius: 12, flexDirection: "row", gap: 5, left: 10, paddingHorizontal: 9, paddingVertical: 7, position: "absolute", top: 10 },
  partialBadgeText: { color: theme.statusAttention, fontFamily: theme.font.semibold, fontSize: 9 },
  mapControls: { backgroundColor: "rgba(255,255,255,.94)", borderColor: "rgba(255,255,255,.98)", borderRadius: 15, borderWidth: 1, overflow: "hidden", position: "absolute", right: 10, top: 10, ...theme.shadow },
  zoomButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  controlDivider: { backgroundColor: theme.border, height: 1, marginHorizontal: 8 },
  controlDisabled: { opacity: .35 },
  controlPressed: { opacity: .72, transform: [{ scale: .97 }] },
  zoomBadge: { backgroundColor: "rgba(255,255,255,.90)", borderRadius: 9, paddingHorizontal: 7, paddingVertical: 5, position: "absolute", right: 12, top: 151 },
  zoomBadgeText: { color: theme.textMuted, fontFamily: theme.font.bold, fontSize: 8.5 },
  attribution: { alignItems: "center", backgroundColor: "rgba(255,255,255,.93)", borderRadius: 8, bottom: 5, justifyContent: "center", minHeight: 44, minWidth: 44, paddingHorizontal: 10, position: "absolute", right: 5 },
  attributionText: { color: "#34312F", fontFamily: theme.font.medium, fontSize: 9.5, textDecorationLine: "underline" },
  pin: { alignItems: "center", borderColor: "#FFFFFF", borderRadius: 22, borderWidth: 3, height: 44, justifyContent: "center", marginLeft: -22, marginTop: -22, position: "absolute", width: 44, ...theme.shadow },
  pinActive: { borderRadius: 25, height: 50, marginLeft: -25, marginTop: -25, width: 50 },
  pinPressed: { opacity: .82, transform: [{ scale: .96 }] },
  selectedPlace: { alignItems: "center", flexDirection: "row", minHeight: 68, paddingHorizontal: 11, paddingVertical: 10 },
  selectedPlaceIcon: { alignItems: "center", borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  selectedPlaceCopy: { flex: 1, marginLeft: 9 },
  selectedPlaceNameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  selectedPlaceName: { color: theme.text, flexShrink: 1, fontFamily: theme.font.semibold, fontSize: 12.5 },
  selectedPlaceMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 9.5, marginTop: 2, textTransform: "capitalize" },
  mapDirection: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  mapCaption: { alignItems: "center", flexDirection: "row", gap: 7, minHeight: 58, paddingHorizontal: 12 },
  mapCaptionText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 10, lineHeight: 15 },
  verifiedBadge: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 7, height: 14, justifyContent: "center", width: 14 },
  directoryLoading: { alignItems: "center", gap: 8, paddingVertical: 28 },
  directoryLoadingText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 18, flexDirection: "row", gap: 11, marginTop: 16, minHeight: 72, padding: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  errorText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  sectionHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 25 },
  sectionTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 21 },
  sectionSubtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, marginTop: 3 },
  coordinateKey: { alignItems: "center", flexDirection: "row", gap: 4, paddingBottom: 2 },
  coordinateKeyText: { color: theme.brandPressed, fontFamily: theme.font.medium, fontSize: 9.5 },
  placeRow: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 116, paddingVertical: 12 },
  placeImage: { borderRadius: 15, height: 78, width: 78 },
  placeIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 15, height: 68, justifyContent: "center", width: 68 },
  placeCopy: { flex: 1, marginLeft: 11 },
  placeCategoryRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  placeCategory: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: .55, textTransform: "uppercase" },
  placeName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5, marginTop: 4 },
  placeDescription: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  accessibilityRow: { alignItems: "flex-start", flexDirection: "row", gap: 4, marginTop: 5 },
  accessibilityText: { color: theme.info, flex: 1, fontFamily: theme.font.medium, fontSize: 9.5, lineHeight: 13 },
  rowDirection: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, height: 44, justifyContent: "center", marginLeft: 6, width: 44 },
  rowDirectionDisabled: { opacity: .52 },
  directoryEmpty: { alignItems: "center", minHeight: 220, paddingHorizontal: 24, paddingTop: 48 },
  directoryEmptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 19, marginTop: 10 },
  directoryEmptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 19, marginTop: 5, textAlign: "center" },
});
