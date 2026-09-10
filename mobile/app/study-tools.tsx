import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { ProductScreen } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { GlassCard, PressScale } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const tools = [
  { href: "/timetable" as const, icon: "calendar-outline" as const, title: "Smart timetable", body: "View classes, add a class and prepare reminders.", status: "Manual setup ready" },
  { href: "/gpa" as const, icon: "calculator-outline" as const, title: "GPA & CGPA", body: "Calculate a semester and keep your progress together.", status: "Works offline" },
  { href: "/ai-summary" as const, icon: "sparkles-outline" as const, title: "AI note summary", body: "Turn a note or PDF into a shorter study guide.", status: "Provider gated" },
  { href: "/tutorials" as const, icon: "people-outline" as const, title: "Tutors & materials", body: "Find course help, PDFs, videos and learning history.", status: "Preview catalogue" },
] as const;

export default function StudyToolsScreen() {
  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "school", text: "Academic workspace" }} showBell={false} subtitle="Timetable, results and learning tools in one place." title="Study tools" unread={false} />

      <GlassCard style={styles.summary}>
        <View style={styles.summaryTop}><View><Text style={styles.summaryEyebrow}>YOUR ACADEMIC JOURNEY</Text><Text style={styles.summaryTitle}>200 Level · First semester</Text></View><View style={styles.score}><Text style={styles.scoreValue}>3.72</Text><Text style={styles.scoreLabel}>CGPA</Text></View></View>
        <View style={styles.rule} />
        <View style={styles.summaryFacts}><Text style={styles.fact}>4 classes today</Text><Text style={styles.fact}>12 saved files</Text><Text style={styles.fact}>7-day streak</Text></View>
      </GlassCard>

      <View style={styles.section}><SectionHeading title="Everything for school" /><View style={styles.list}>{tools.map((tool) => (
        <PressScale accessibilityLabel={tool.title} key={tool.title} onPress={() => router.push(tool.href)} style={styles.tool}>
          <View style={styles.icon}><Ionicons name={tool.icon} size={23} color={theme.brandPressed} /></View>
          <View style={styles.copy}><Text style={styles.title}>{tool.title}</Text><Text style={styles.body}>{tool.body}</Text><Text style={styles.status}>{tool.status}</Text></View>
          <Ionicons name="chevron-forward" size={19} color={theme.brandPressed} />
        </PressScale>
      ))}</View></View>

      <PressScale accessibilityLabel="View Student Pro plans" onPress={() => router.push("/student-pro")} style={styles.proCard}>
        <View><Text style={styles.proEyebrow}>KAMPUSONE STUDENT PRO</Text><Text style={styles.proTitle}>More AI study capacity when you need it.</Text><Text style={styles.proBody}>Core campus tools stay free. Plans only unlock metered extras.</Text></View>
        <View style={styles.proArrow}><Ionicons name="arrow-forward" size={20} color="#FFFFFF" /></View>
      </PressScale>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  summary: { padding: 17 },
  summaryTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  summaryEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9.5, letterSpacing: 0.75 },
  summaryTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 18, marginTop: 5 },
  score: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 16, minWidth: 68, paddingHorizontal: 12, paddingVertical: 9 },
  scoreValue: { color: theme.brandPressed, fontFamily: theme.font.displayStrong, fontSize: 21 },
  scoreLabel: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8, letterSpacing: 0.5 },
  rule: { backgroundColor: theme.border, height: StyleSheet.hairlineWidth, marginVertical: 14 },
  summaryFacts: { flexDirection: "row", justifyContent: "space-between" },
  fact: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5 },
  section: { marginTop: 27 },
  list: { gap: 10 },
  tool: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 98, padding: 13, ...theme.shadow },
  icon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  copy: { flex: 1, marginHorizontal: 12 },
  title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, lineHeight: 16, marginTop: 3 },
  status: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 9.5, marginTop: 6 },
  proCard: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 22, flexDirection: "row", justifyContent: "space-between", marginTop: 27, overflow: "hidden", padding: 18 },
  proEyebrow: { color: theme.peach, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: 0.8 },
  proTitle: { color: "#FFFFFF", fontFamily: theme.font.display, fontSize: 18, lineHeight: 22, marginTop: 7, maxWidth: 270 },
  proBody: { color: "rgba(255,255,255,0.68)", fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 5, maxWidth: 270 },
  proArrow: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 18, height: 42, justifyContent: "center", marginLeft: 10, width: 42 },
});
