import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { isSupabaseConfigured, supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

export default function WelcomeScreen() {
  const [checking, setChecking] = useState(Boolean(supabase));

  useEffect(() => {
    let active = true;
    void supabase?.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) router.replace("/(tabs)");
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>K1</Text></View>
          <Text style={styles.brandText}>KampusOne</Text>
        </View>

        <View style={styles.illustration} accessibilityLabel="A calm campus day illustration">
          <View style={styles.sun} />
          <View style={styles.cloudOne} />
          <View style={styles.cloudTwo} />
          <View style={styles.path} />
          <View style={styles.building}>
            <View style={styles.roof} />
            <View style={styles.windowRow}>
              {[0, 1, 2].map((item) => <View key={item} style={styles.window} />)}
            </View>
            <View style={styles.door} />
          </View>
          <View style={styles.tree}><View style={styles.treeTop} /><View style={styles.treeTrunk} /></View>
          <View style={styles.student}>
            <View style={styles.studentHead} />
            <View style={styles.studentBody}><Ionicons color={theme.white} name="book-outline" size={18} /></View>
          </View>
        </View>

        <View style={styles.copy}>
          <Text style={styles.kicker}>Your campus, in rhythm</Text>
          <Text style={styles.title}>Be ready before you need to be.</Text>
          <Text style={styles.description}>
            Classes, deadlines, campus places and study tools—organised around your day.
          </Text>
        </View>

        <View style={styles.actions}>
          {!isSupabaseConfigured ? (
            <View style={styles.previewNote}>
              <Ionicons color={theme.brandPressed} name="flask-outline" size={17} />
              <Text style={styles.previewText}>Preview mode · connect Supabase to create real accounts</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={checking}
            onPress={() => router.push("/intro")}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText}>{checking ? "Checking your session…" : "Get started"}</Text>
            <Ionicons color={theme.white} name="arrow-forward" size={20} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/login")} style={styles.login}>
            <Text style={styles.loginText}>I already have an account</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  page: { flex: 1, marginHorizontal: "auto", maxWidth: 560, paddingHorizontal: theme.spacing[5], width: "100%" },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 9, paddingTop: 12 },
  brandMark: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 10, height: 34, justifyContent: "center", width: 34 },
  brandMarkText: { color: theme.white, fontFamily: theme.font.displayStrong, fontSize: 12 },
  brandText: { color: theme.text, fontFamily: theme.font.display, fontSize: 21 },
  illustration: { alignSelf: "center", height: 280, marginTop: 24, maxWidth: 430, overflow: "hidden", position: "relative", width: "100%" },
  sun: { backgroundColor: "#E9B18E", borderRadius: 46, height: 92, position: "absolute", right: 22, top: 22, width: 92 },
  cloudOne: { backgroundColor: "rgba(255,255,255,0.88)", borderRadius: 30, height: 38, left: 20, position: "absolute", top: 63, width: 105 },
  cloudTwo: { backgroundColor: "rgba(255,255,255,0.70)", borderRadius: 26, height: 30, position: "absolute", right: 78, top: 98, width: 72 },
  path: { backgroundColor: "#EAD8C6", borderRadius: 100, bottom: -45, height: 160, left: "20%", position: "absolute", transform: [{ rotate: "-8deg" }], width: "62%" },
  building: { alignItems: "center", backgroundColor: "#F3D6C3", borderColor: "#C35D38", borderRadius: 8, borderWidth: 2, bottom: 45, height: 118, left: "14%", position: "absolute", width: "48%" },
  roof: { backgroundColor: theme.brandPressed, borderRadius: 5, height: 18, marginTop: -12, transform: [{ skewX: "-12deg" }], width: "112%" },
  windowRow: { flexDirection: "row", gap: 13, marginTop: 24 },
  window: { backgroundColor: "#FFF8F2", borderColor: "#A8462E", borderRadius: 4, borderWidth: 1.5, height: 28, width: 25 },
  door: { backgroundColor: theme.brand, borderTopLeftRadius: 7, borderTopRightRadius: 7, bottom: 0, height: 39, position: "absolute", width: 28 },
  tree: { alignItems: "center", bottom: 42, position: "absolute", right: "12%" },
  treeTop: { backgroundColor: "#9C754A", borderRadius: 44, height: 80, width: 70 },
  treeTrunk: { backgroundColor: "#7C4E37", height: 42, marginTop: -9, width: 10 },
  student: { alignItems: "center", bottom: 18, left: "57%", position: "absolute" },
  studentHead: { backgroundColor: "#5E392A", borderRadius: 15, height: 27, width: 27 },
  studentBody: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 16, height: 58, justifyContent: "center", marginTop: -1, width: 44 },
  copy: { marginTop: 3 },
  kicker: { color: theme.brandPressed, fontFamily: theme.font.calligraphy, fontSize: 16, marginBottom: 9 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 36, letterSpacing: -1.2, lineHeight: 40, maxWidth: 470 },
  description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 15.5, lineHeight: 23, marginTop: 12, maxWidth: 470 },
  actions: { gap: 10, marginTop: "auto", paddingBottom: 18, paddingTop: 24 },
  previewNote: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 7, marginBottom: 3 },
  previewText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5 },
  primary: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 58, ...theme.shadow },
  primaryPressed: { backgroundColor: theme.brandPressed, transform: [{ scale: 0.98 }] },
  primaryText: { color: theme.white, fontFamily: theme.font.bold, fontSize: 15.5 },
  login: { alignItems: "center", justifyContent: "center", minHeight: 48 },
  loginText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 14.5 },
});
