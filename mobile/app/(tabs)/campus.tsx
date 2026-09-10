import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader } from "@/src/components/app-header";
import { PreviewBanner } from "@/src/components/preview-banner";
import { theme } from "@/src/theme";

const groups = [
  ["Academic places", "Lecture theatres, libraries, faculty offices", "school-outline"],
  ["Student essentials", "Health, safety, transport, and support", "heart-outline"],
  ["Getting around", "Landmarks and clear campus directions", "navigate-outline"],
] as const;

export default function CampusScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader />
        <PreviewBanner>DIRECTORY STRUCTURE · NO LIVE PLACES</PreviewBanner>
        <Text style={styles.eyebrow}>CAMPUS</Text>
        <Text style={styles.title}>Find the place, not the stress.</Text>
        <Text style={styles.description}>A practical campus directory will combine trusted listings, landmarks, and low-data directions.</Text>
        <View style={styles.list}>
          {groups.map(([title, description, icon]) => (
            <View style={styles.row} key={title}>
              <View style={styles.icon}><Ionicons name={icon} size={21} color={theme.brand} /></View>
              <View style={styles.text}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDescription}>{description}</Text></View>
              <Text style={styles.state}>PLANNED</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  content: { alignSelf: "center", maxWidth: 680, paddingBottom: 60, paddingHorizontal: theme.spacing[5], width: "100%" },
  eyebrow: { color: theme.brand, fontFamily: "Manrope-ExtraBold", fontSize: 10, letterSpacing: 1.3 },
  title: { color: theme.text, fontFamily: "Manrope-ExtraBold", fontSize: 35, letterSpacing: -1.5, lineHeight: 40, marginTop: 9, maxWidth: 380 },
  description: { color: theme.textMuted, fontFamily: "Manrope-Regular", fontSize: 14, lineHeight: 22, marginTop: theme.spacing[4], maxWidth: 440 },
  list: { borderTopColor: theme.border, borderTopWidth: 1, marginTop: theme.spacing[8] },
  row: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 88 },
  icon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 11, height: 42, justifyContent: "center", marginRight: theme.spacing[3], width: 42 },
  text: { flex: 1, paddingRight: 10 },
  rowTitle: { color: theme.text, fontFamily: "Manrope-SemiBold", fontSize: 13 },
  rowDescription: { color: theme.textMuted, fontFamily: "Manrope-Regular", fontSize: 10, lineHeight: 15, marginTop: 3 },
  state: { color: theme.textMuted, fontFamily: "Manrope-ExtraBold", fontSize: 8, letterSpacing: 0.8 },
});
