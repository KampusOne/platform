import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
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

export function CampusMapSurface({
  campus,
  places,
  selectedPlaceId,
  onSelectPlace,
  onMapReady,
}: Props) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      onLayout={onMapReady}
      style={styles.root}
    >
      <View style={styles.gridA} />
      <View style={styles.gridB} />
      <View style={styles.centerCopy}>
        <Ionicons color={theme.deepBrand} name="map-outline" size={28} />
        <Text style={styles.title}>{campus?.name ?? "Campus map"}</Text>
        <Text style={styles.body}>
          Live OSM navigation is available in the Android and iOS build.
        </Text>
      </View>

      {places.slice(0, 7).map((place, index) => (
        <View
          key={place.id}
          style={[
            styles.previewPin,
            {
              left: 34 + ((index * 57) % 230),
              top: 70 + ((index * 83) % 250),
            },
            place.id === selectedPlaceId && styles.previewPinSelected,
          ]}
        >
          <Ionicons
            color="#FFFFFF"
            name={categoryIcon(place.category) as keyof typeof Ionicons.glyphMap}
            onPress={() => onSelectPlace(place.id)}
            size={14}
          />
        </View>
      ))}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      backgroundColor: "#EEE8E0",
      flex: 1,
      overflow: "hidden",
      position: "relative",
    },
    gridA: {
      backgroundColor: "rgba(255,255,255,0.44)",
      height: 54,
      left: -40,
      position: "absolute",
      right: -40,
      top: 150,
      transform: [{ rotate: "-16deg" }],
    },
    gridB: {
      backgroundColor: "rgba(255,255,255,0.42)",
      bottom: 120,
      height: 48,
      left: -60,
      position: "absolute",
      right: -60,
      transform: [{ rotate: "24deg" }],
    },
    centerCopy: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: "rgba(255,255,255,0.92)",
      borderColor: theme.border,
      borderRadius: 18,
      borderWidth: 1,
      maxWidth: 300,
      paddingHorizontal: 22,
      paddingVertical: 18,
      position: "absolute",
      top: "38%",
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 16,
      marginTop: 7,
    },
    body: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
      textAlign: "center",
    },
    previewPin: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderColor: "#FFFFFF",
      borderRadius: 16,
      borderWidth: 2,
      height: 32,
      justifyContent: "center",
      position: "absolute",
      width: 32,
    },
    previewPinSelected: {
      height: 38,
      width: 38,
    },
  });
