import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InlineLoading } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { parseCoordinate } from "@/src/lib/campus-navigation";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Place = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
};
type DirectoryResponse = { places: Place[]; campus?: { name?: string } | null };

export default function CampusMapScreenWeb() {
  const { theme, styles } = useThemeStyles(createStyles);
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api<DirectoryResponse>("/v1/student/campus/places", { timeoutMs: 8_000 })
      .then((response) => { if (active) setDirectory(response); })
      .catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "Campus places could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const places = directory?.places ?? [];
    if (!needle) return places;
    return places.filter((place) => (place.name + " " + (place.description ?? "")).toLowerCase().includes(needle));
  }, [directory, query]);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.eyebrow}>CAMPUS NAVIGATION</Text>
      <Text style={styles.title}>{directory?.campus?.name ?? "Find your way around campus"}</Text>
      <Text style={styles.body}>Live GPS walking navigation is available in the KampusOne Android and iOS app. The web view keeps the same searchable campus directory.</Text>
      <View style={styles.search}>
        <Ionicons color={theme.deepBrand} name="search" size={20} />
        <TextInput onChangeText={setQuery} placeholder="Search buildings, hostels, food or services" placeholderTextColor={theme.textFaint} style={styles.input} value={query} />
      </View>
      {loading ? <View style={styles.loading}><InlineLoading /><Text style={styles.meta}>Loading campus places…</Text></View> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        contentContainerStyle={styles.list}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const mapped = parseCoordinate(item.latitude) !== null && parseCoordinate(item.longitude) !== null;
          return <View style={styles.row}>
            <View style={styles.icon}><Ionicons color={theme.deepBrand} name="location-outline" size={20} /></View>
            <View style={styles.copy}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.category.toLowerCase()} · {mapped ? "mapped" : "location pending"}</Text></View>
          </View>;
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { backgroundColor: theme.canvas, flex: 1, paddingHorizontal: 18, paddingTop: 22 },
  eyebrow: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 1.1 },
  title: { color: theme.text, fontFamily: theme.font.display, fontSize: 28, marginTop: 4 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, marginTop: 8, maxWidth: 560 },
  search: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", marginTop: 18, paddingHorizontal: 14 },
  input: { color: theme.text, flex: 1, fontFamily: theme.font.medium, fontSize: 14, minHeight: 52, marginLeft: 9 },
  list: { paddingBottom: 110, paddingTop: 10 },
  row: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 72 },
  icon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  copy: { flex: 1, marginLeft: 11 },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  meta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, marginTop: 3 },
  loading: { alignItems: "center", flexDirection: "row", gap: 8, paddingVertical: 16 },
  error: { color: theme.error, fontFamily: theme.font.medium, fontSize: 12, paddingVertical: 12 },
});
