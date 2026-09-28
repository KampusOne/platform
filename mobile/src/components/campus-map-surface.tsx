import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
} from "@maplibre/maplibre-react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
  CAMPUS_MAP_STYLE_URL,
  campusCenter,
  categoryIcon,
  type CampusDirectory,
  type CampusLocation,
  type CampusWalkingRoute,
  type LngLat,
  type MappedCampusPlace,
} from "@/src/lib/campus-map";

type Props = {
  campus: CampusDirectory | null;
  places: MappedCampusPlace[];
  route: CampusWalkingRoute | null;
  selectedPlaceId: string | null;
  userLocation: CampusLocation | null;
  showUserLocation: boolean;
  focusCoordinate: LngLat | null;
  focusZoom: number;
  focusToken: number;
  onMapReady: () => void;
  onMapLoadError: () => void;
  onSelectPlace: (id: string) => void;
};

function markerColor(category: string, brand: string) {
  const colors: Record<string, string> = {
    ACADEMIC: "#526FA8",
    FOOD: "#B95D50",
    HEALTH: "#A8462E",
    HOSTEL: "#8D5535",
    SERVICE: "#7A6A5D",
    SPORT: "#4B7B54",
    TRANSPORT: "#3F6B78",
  };
  return colors[category.toUpperCase()] ?? brand;
}

export function CampusMapSurface({
  campus,
  places,
  route,
  selectedPlaceId,
  userLocation,
  showUserLocation,
  focusCoordinate,
  focusZoom,
  focusToken,
  onMapReady,
  onMapLoadError,
  onSelectPlace,
}: Props) {
  const { theme, styles } = useThemeStyles(createStyles);
  const cameraRef = useRef<any>(null);
  const center = campusCenter(campus);

  useEffect(() => {
    if (!focusCoordinate || !cameraRef.current) return;
    void cameraRef.current.setStop({
      center: focusCoordinate,
      zoom: focusZoom,
      duration: 360,
      easing: "ease",
    });
  }, [focusCoordinate, focusToken, focusZoom]);

  const boundaryData = useMemo(() => {
    let boundary = campus?.boundary ?? [];
    if (boundary.length < 3 && campus?.navigation_bounds) {
      const north = Number(campus.navigation_bounds.north);
      const south = Number(campus.navigation_bounds.south);
      const east = Number(campus.navigation_bounds.east);
      const west = Number(campus.navigation_bounds.west);
      if ([north, south, east, west].every(Number.isFinite)) {
        boundary = [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
          [west, north],
        ];
      }
    }
    if (boundary.length < 3) return null;
    const closed =
      boundary[0]?.[0] === boundary[boundary.length - 1]?.[0] &&
      boundary[0]?.[1] === boundary[boundary.length - 1]?.[1]
        ? boundary
        : [...boundary, boundary[0]!];
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [closed] },
    } as any;
  }, [campus?.boundary, campus?.navigation_bounds]);

  const routeData = useMemo(() => {
    if (!route || route.geometry.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: route.geometry },
    } as any;
  }, [route]);

  return (
    <View style={styles.root}>
      <MapLibreMap
        androidView="surface"
        attribution
        compass
        logo={false}
        mapStyle={CAMPUS_MAP_STYLE_URL}
        onDidFailLoadingMap={onMapLoadError}
        onDidFinishLoadingMap={onMapReady}
        preferredFramesPerSecond={60}
        scaleBar={false}
        style={StyleSheet.absoluteFill}
        tintColor={theme.deepBrand}
      >
        <Camera
          initialViewState={{
            center,
            zoom: 15.1,
            bearing: 0,
            pitch: 0,
          }}
          maxZoom={20}
          minZoom={12.5}
          ref={cameraRef}
        />

        {boundaryData ? (
          <GeoJSONSource data={boundaryData} id="kampus-campus-boundary">
            <Layer
              id="kampus-campus-fill"
              paint={{
                "fill-color": theme.brand,
                "fill-opacity": 0.055,
              } as never}
              type="fill"
            />
            <Layer
              id="kampus-campus-outline"
              paint={{
                "line-color": theme.deepBrand,
                "line-opacity": 0.72,
                "line-width": 2.2,
                "line-dasharray": [2, 1.6],
              } as never}
              type="line"
            />
          </GeoJSONSource>
        ) : null}

        {routeData ? (
          <GeoJSONSource data={routeData} id="kampus-walking-route">
            <Layer
              id="kampus-route-casing"
              paint={{
                "line-color": "#FFFFFF",
                "line-opacity": 0.92,
                "line-width": 9,
              } as never}
              type="line"
            />
            <Layer
              id="kampus-route-line"
              paint={{
                "line-color": theme.deepBrand,
                "line-opacity": 0.98,
                "line-width": 6,
              } as never}
              type="line"
            />
          </GeoJSONSource>
        ) : null}

        {places.map((place) => {
          const selected = place.id === selectedPlaceId;
          return (
            <Marker
              anchor="bottom"
              id={place.id}
              key={place.id}
              lngLat={[place.longitudeValue, place.latitudeValue]}
              onPress={() => onSelectPlace(place.id)}
            >
              <View collapsable={false} style={styles.markerStack}>
                {selected ? (
                  <View style={styles.markerLabel}>
                    <Text numberOfLines={1} style={styles.markerLabelText}>
                      {place.name}
                    </Text>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.marker,
                    {
                      backgroundColor: markerColor(place.category, theme.deepBrand),
                    },
                    selected && styles.markerSelected,
                  ]}
                >
                  <Ionicons
                    color="#FFFFFF"
                    name={categoryIcon(place.category) as keyof typeof Ionicons.glyphMap}
                    size={selected ? 18 : 16}
                  />
                </View>
                <View
                  style={[
                    styles.markerTip,
                    {
                      borderTopColor: markerColor(place.category, theme.deepBrand),
                    },
                  ]}
                />
              </View>
            </Marker>
          );
        })}

        {showUserLocation && userLocation ? (
          <Marker
            anchor="center"
            id="kampus-current-location"
            lngLat={[userLocation.longitude, userLocation.latitude]}
          >
            <View collapsable={false} style={styles.userMarkerWrap}>
              <View style={styles.userAccuracy} />
              <View style={styles.userMarkerOuter}>
                <View style={styles.userMarkerInner} />
              </View>
            </View>
          </Marker>
        ) : null}
      </MapLibreMap>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      backgroundColor: theme.surfaceMuted,
      flex: 1,
      overflow: "hidden",
    },
    markerStack: {
      alignItems: "center",
      justifyContent: "flex-end",
    },
    marker: {
      alignItems: "center",
      borderColor: "#FFFFFF",
      borderRadius: 18,
      borderWidth: 2,
      height: 36,
      justifyContent: "center",
      width: 36,
      ...theme.shadow,
    },
    markerSelected: {
      borderRadius: 21,
      borderWidth: 3,
      height: 42,
      width: 42,
    },
    markerTip: {
      borderLeftColor: "transparent",
      borderLeftWidth: 5,
      borderRightColor: "transparent",
      borderRightWidth: 5,
      borderTopWidth: 8,
      height: 0,
      marginTop: -1,
      width: 0,
    },
    markerLabel: {
      backgroundColor: "rgba(30,25,23,0.92)",
      borderRadius: 8,
      marginBottom: 5,
      maxWidth: 190,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    markerLabelText: {
      color: "#FFFFFF",
      fontFamily: theme.font.semibold,
      fontSize: 11,
    },
    userMarkerWrap: {
      alignItems: "center",
      height: 68,
      justifyContent: "center",
      width: 68,
    },
    userAccuracy: {
      backgroundColor: "rgba(47,112,235,0.15)",
      borderColor: "rgba(47,112,235,0.20)",
      borderRadius: 34,
      borderWidth: 1,
      height: 68,
      position: "absolute",
      width: 68,
    },
    userMarkerOuter: {
      alignItems: "center",
      backgroundColor: "#FFFFFF",
      borderRadius: 13,
      height: 26,
      justifyContent: "center",
      width: 26,
      ...theme.shadow,
    },
    userMarkerInner: {
      backgroundColor: "#2F70EB",
      borderRadius: 9,
      height: 18,
      width: 18,
    },
  });
