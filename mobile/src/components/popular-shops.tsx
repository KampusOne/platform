import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { VerifiedBadge } from "@/src/components/verified-badge";

type Shop = {
  id: string;
  agent_type: "VENDOR" | "TUTOR" | "RIDER";
  display_name: string;
  profile_image_url: string | null;
  verified?: boolean;
};

export function PopularShops() {
  const { theme } = useAppearance();
  const [shops, setShops] = useState<Shop[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await api<{ brands: Shop[] }>("/v1/featured-brands/public");
      setShops(result.brands);
      setError("");
    } catch {
      setError("Top campus brands could not load. Tap to retry.");
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (error) return (
    <Pressable accessibilityRole="button" onPress={() => void load()} style={{ paddingVertical: 12 }}>
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{error}</Text>
    </Pressable>
  );
  if (!shops.length) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontFamily: theme.font.semibold, fontSize: 17, color: theme.text, marginBottom: 12 }}>Top campus brands</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18 }}>
        {shops.map(shop => {
          const roleName = /^(.*?)\s+(vendor|tutor|rider)$/i.exec(shop.display_name.trim());
          const labelStyle = { fontFamily: theme.font.medium, fontSize: 12, textAlign: 'center' as const, color: theme.text };
          const badge = shop.verified === true ? <VerifiedBadge size={11} label={`Verified ${shop.agent_type.toLowerCase()}`} /> : null;
          return (
          <Pressable
            key={shop.id}
            accessibilityRole="button"
            accessibilityLabel={`View ${shop.display_name}'s ${shop.agent_type.toLowerCase()} profile${shop.verified === true ? ", verified" : ""}`}
            onPress={() => router.push({ pathname: "/student-service", params: { id: shop.id } })}
            style={({ pressed }) => ({ width: 96, alignItems: "center", gap: 7, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: theme.brand, padding: 4 }}>
              {shop.profile_image_url ? (
                <Image accessible={false} source={{ uri: shop.profile_image_url }} style={{ width: "100%", height: "100%", borderRadius: 30 }} />
              ) : (
                <View style={{ flex: 1, borderRadius: 30, backgroundColor: theme.surfaceMuted, justifyContent: "center", alignItems: "center" }}>
                  <Ionicons name="storefront-outline" size={26} color={theme.brand} />
                </View>
              )}
            </View>
            {roleName ? <View style={{ alignItems: 'center', width: '100%' }}>
              <Text numberOfLines={1} style={labelStyle}>{roleName[1]}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}><Text style={labelStyle}>{roleName[2]}</Text>{badge}</View>
            </View> : <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, width: "100%" }}>
              <Text numberOfLines={2} style={[labelStyle, { flexShrink: 1 }]}>{shop.display_name}</Text>{badge}
            </View>}
          </Pressable>
        ); })}
      </ScrollView>
    </View>
  );
}
