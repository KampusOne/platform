import { useEffect, useMemo, useState } from "react";
import { FlatList, Keyboard, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { KeyboardModal } from "./keyboard-viewport";
import { ToolField } from "./toolkit";
import { RetryIconButton } from "./retry-icon-button";

export type CampusPlace = {
  id: string;
  name: string;
  campus_id?: string;
  campus_name?: string;
  delivery_zone_id?: string | null;
  search_aliases?: string[] | null;
  has_map_point?: boolean;
};
type Props = {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  onSelect?: (place: CampusPlace) => void;
  endpoint?: string;
  options?: CampusPlace[];
  disabled?: boolean;
};
const searchable = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-NG").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function CampusPlaceChoice({ label, value, onChange, onSelect, endpoint = "/v1/student/delivery-places", options, disabled = false }: Props) {
  const { theme } = useAppearance();
  const [places, setPlaces] = useState<CampusPlace[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (disabled) { setOpen(false); setQuery(""); } }, [disabled]);
  useEffect(() => {
    if (options !== undefined) return;
    let mounted = true;
    const controller = new AbortController();
    setPlaces([]); setLoading(true); setError("");
    void (async () => {
      const all = new Map<string, CampusPlace>(), seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const path = cursor ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : endpoint;
        const result: { places?: CampusPlace[]; pickupPoints?: CampusPlace[]; nextCursor?: string | null } = await api(path, { signal: controller.signal, cache: "reload" });
        for (const place of result.places ?? result.pickupPoints ?? []) all.set(place.id, place);
        cursor = result.nextCursor ?? null;
        if (cursor && seen.has(cursor)) throw Error("The campus directory could not finish loading. Try again.");
        if (cursor) seen.add(cursor);
      } while (cursor && !controller.signal.aborted);
      if (mounted) setPlaces([...all.values()]);
    })().catch(error => { if (mounted) setError(error instanceof Error ? error.message : "Campus locations could not load."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; controller.abort(); };
  }, [endpoint, revision, options]);
  const choices = options ?? places;
  const selected = choices.find(place => place.id === value);
  const filtered = useMemo(() => {
    const tokens = searchable(query).split(" ").filter(Boolean);
    return choices.filter(place => {
      const text = searchable([place.name, place.campus_name, ...(place.search_aliases ?? [])].filter(Boolean).join(" "));
      return tokens.every(token => text.includes(token));
    }).sort((a, b) => a.name.localeCompare(b.name, "en-NG"));
  }, [choices, query]);
  function close() { Keyboard.dismiss(); setOpen(false); setQuery(""); }
  const text = { color: theme.text, fontFamily: theme.font.body };

  return (
    <View style={{ gap: 8, marginVertical: 12 }}>
      <Text style={{ ...text, fontFamily: theme.font.semibold }}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`Choose ${label.toLowerCase()}`}
        accessibilityState={{ disabled, expanded: open }} disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 15, minHeight: 64, borderWidth: 1, borderColor: theme.border, borderRadius: 14, backgroundColor: theme.surface, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}
      >
        <Ionicons name="location-outline" size={22} color={theme.brand} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...text, fontFamily: theme.font.medium }}>{selected?.name ?? "Find a campus location"}</Text>
          {loading ? <Text style={{ ...text, color: theme.textMuted, fontSize: 12, marginTop: 4 }}>Loading locations…</Text> : null}
          {selected?.campus_name ? <Text style={{ ...text, color: theme.textMuted, fontSize: 12, marginTop: 4 }}>{selected.campus_name}</Text> : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={theme.textMuted} />
      </Pressable>
      {error ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text accessibilityRole="alert" style={{ ...text, flex: 1, color: theme.error }}>{error}</Text><RetryIconButton label="Retry campus locations" busy={loading} onPress={() => setRevision(n => n + 1)} /></View> : null}
      <KeyboardModal visible={open} animationType="none" onRequestClose={close}>
        <SafeAreaView accessibilityViewIsModal edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.canvas }}>
          <View style={{ flex: 1, width: "100%", maxWidth: 660, alignSelf: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8, minHeight: 62 }}>
              <Text style={{ ...text, flex: 1, fontFamily: theme.font.displayStrong, fontSize: 23 }}>Campus locations</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close campus locations" onPress={close} style={{ minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
            </View>
            <View style={{ paddingHorizontal: 20 }}>
              <ToolField label="Search campus locations" placeholder="Building, hostel, faculty or landmark" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
              <Text accessibilityLiveRegion="polite" style={{ ...text, color: theme.textMuted, fontSize: 12, marginBottom: 12 }}>{loading ? "Loading campus locations…" : `${filtered.length} ${filtered.length === 1 ? "location" : "locations"}`}</Text>
              {value ? <Pressable accessibilityRole="button" accessibilityLabel="Clear selected location" disabled={disabled} onPress={() => { onChange(null); close(); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ ...text, color: theme.brand }}>Clear selected location</Text></Pressable> : null}
              {error ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingBottom: 12 }}><Text accessibilityRole="alert" style={{ ...text, color: theme.error, flex: 1 }}>{error}</Text><RetryIconButton label="Retry campus locations" busy={loading} onPress={() => setRevision(n => n + 1)} /></View> : null}
            </View>
            <FlatList
              accessibilityLabel="Campus location results" data={filtered} keyExtractor={place => place.id}
              keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
              ListEmptyComponent={!loading && !error ? <Text style={{ ...text, padding: 20, color: theme.textMuted }}>{choices.length ? "No matches. Try another name or landmark." : "No published campus locations yet."}</Text> : null}
              renderItem={({ item }) => (
                <Pressable accessibilityRole="radio" accessibilityLabel={`${item.name}${item.campus_name ? `, ${item.campus_name}` : ""}`} accessibilityState={{ checked: value === item.id, disabled }} disabled={disabled}
                  onPress={() => { onChange(item.id); onSelect?.(item); close(); }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, backgroundColor: value === item.id ? theme.surfaceMuted : pressed ? theme.surface : "transparent" })}
                >
                  <Ionicons name="location-outline" size={20} color={value === item.id ? theme.brand : theme.textMuted} />
                  <View style={{ flex: 1, gap: 4 }}><Text style={{ ...text, fontFamily: theme.font.medium, lineHeight: 21 }}>{item.name}</Text>{item.campus_name ? <Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>{item.campus_name}</Text> : null}{item.has_map_point === false ? <Text style={{ ...text, color: theme.textMuted, fontSize: 12 }}>Address only · map point pending</Text> : null}</View>
                  {value === item.id ? <Ionicons name="checkmark-circle" size={22} color={theme.brand} /> : null}
                </Pressable>
              )}
            />
          </View>
        </SafeAreaView>
      </KeyboardModal>
    </View>
  );
}
