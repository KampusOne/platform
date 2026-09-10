import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { FormMessage } from "@/src/components/auth-ui";
import { ProductScreen } from "@/src/components/product-ui";
import { GlassCard, PressScale } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

export default function AiSummaryScreen() {
  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "sparkles", text: "AI study tool" }} showBell={false} subtitle="A dedicated workspace for notes and PDFs." title="AI summary" unread={false} />
      <FormMessage>This feature is visible in navigation but remains locked until a provider key, per-student quota, timeout, content policy and kill switch are configured.</FormMessage>

      <GlassCard style={styles.uploadCard}>
        <View style={styles.uploadIcon}><Ionicons name="cloud-upload-outline" size={33} color={theme.brandPressed} /></View>
        <Text style={styles.uploadTitle}>Add a note or PDF</Text>
        <Text style={styles.uploadBody}>Supported at launch: PDF, photographed notes and pasted text. You review extracted text before any AI request is sent.</Text>
        <Pressable accessibilityRole="button" disabled style={styles.disabledButton}><Text style={styles.disabledText}>Upload locked for this phase</Text></Pressable>
      </GlassCard>

      <View style={styles.flow}>
        <Step icon="document-text-outline" number="1" title="Check the text" body="Nothing is sent until you confirm what was read." />
        <Step icon="options-outline" number="2" title="Choose the output" body="Summary, flashcards, quiz or key definitions." />
        <Step icon="download-outline" number="3" title="Save for later" body="Keep the result in your academic workspace." />
      </View>

      <PressScale accessibilityLabel="View Student Pro plan" onPress={() => router.push("/student-pro")} style={styles.planLink}><Text style={styles.planText}>See planned Student Pro limits</Text><Ionicons name="arrow-forward" size={18} color={theme.brandPressed} /></PressScale>
    </ProductScreen>
  );
}

function Step({ icon, number, title, body }: { icon: keyof typeof Ionicons.glyphMap; number: string; title: string; body: string }) {
  return <View style={styles.step}><View style={styles.stepIcon}><Ionicons name={icon} size={21} color={theme.brandPressed} /></View><View style={styles.stepCopy}><Text style={styles.stepNumber}>STEP {number}</Text><Text style={styles.stepTitle}>{title}</Text><Text style={styles.stepBody}>{body}</Text></View></View>;
}

const styles = StyleSheet.create({
  uploadCard: { alignItems: "center", borderStyle: "dashed", padding: 25 },
  uploadIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 22, height: 66, justifyContent: "center", width: 66 },
  uploadTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, marginTop: 14 },
  uploadBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 19, marginTop: 7, textAlign: "center" },
  disabledButton: { alignItems: "center", backgroundColor: "rgba(195,93,56,0.13)", borderRadius: 14, justifyContent: "center", marginTop: 17, minHeight: 47, paddingHorizontal: 18, width: "100%" },
  disabledText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12.5 },
  flow: { gap: 9, marginTop: 22 },
  step: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.85)", borderColor: "rgba(41,35,31,0.08)", borderRadius: 17, borderWidth: 1, flexDirection: "row", minHeight: 86, padding: 12 },
  stepIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  stepCopy: { flex: 1, marginLeft: 12 },
  stepNumber: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.7 },
  stepTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5, marginTop: 2 },
  stepBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, marginTop: 2 },
  planLink: { alignItems: "center", flexDirection: "row", justifyContent: "center", minHeight: 54, marginTop: 12 },
  planText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12.5, marginRight: 7 },
});
