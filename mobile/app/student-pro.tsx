import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { FormMessage } from "@/src/components/auth-ui";
import { ProductScreen } from "@/src/components/product-ui";
import { GlassCard } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const plans = [
  { name: "Student", price: "Free", body: "Today, timetable, GPA, campus directory, verified updates and saved items.", active: true },
  { name: "Student Pro", price: "Pricing later", body: "Higher AI note limits, premium study workflows and expanded offline tools.", active: false },
] as const;

export default function StudentProScreen() {
  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "sparkles", text: "Plans & usage" }} showBell={false} subtitle="Core campus utility stays free." title="KampusOne plans" unread={false} />
      <FormMessage>No payment is collected in this phase. Pricing, refund rules, provider costs and Paystack verification must be approved together before checkout opens.</FormMessage>
      <View style={styles.list}>{plans.map((plan) => (
        <GlassCard key={plan.name} style={[styles.plan, plan.active && styles.planActive]}>
          <View style={styles.planTop}><View><Text style={styles.planName}>{plan.name}</Text><Text style={styles.planPrice}>{plan.price}</Text></View>{plan.active ? <View style={styles.active}><Ionicons name="checkmark-circle" size={16} color={theme.statusPositive} /><Text style={styles.activeText}>Current plan</Text></View> : <View style={styles.locked}><Ionicons name="lock-closed-outline" size={15} color={theme.brandPressed} /><Text style={styles.lockedText}>Not for sale</Text></View>}</View>
          <Text style={styles.planBody}>{plan.body}</Text>
        </GlassCard>
      ))}</View>
      <View style={styles.promise}><Text style={styles.promiseTitle}>The KampusOne promise</Text><Text style={styles.promiseBody}>Students should never need Pro just to know where class is, calculate a GPA, receive a safety notice or access essential campus information.</Text></View>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  plan: { padding: 18 },
  planActive: { borderColor: "rgba(195,93,56,0.28)" },
  planTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  planName: { color: theme.text, fontFamily: theme.font.display, fontSize: 21 },
  planPrice: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13, marginTop: 4 },
  planBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 19, marginTop: 15 },
  active: { alignItems: "center", backgroundColor: "rgba(154,91,62,0.10)", borderRadius: 11, flexDirection: "row", gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  activeText: { color: theme.statusPositive, fontFamily: theme.font.semibold, fontSize: 9.5 },
  locked: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 11, flexDirection: "row", gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  lockedText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 9.5 },
  promise: { backgroundColor: theme.deepBrand, borderRadius: 21, marginTop: 22, padding: 18 },
  promiseTitle: { color: "#FFFFFF", fontFamily: theme.font.display, fontSize: 18 },
  promiseBody: { color: "rgba(255,255,255,0.72)", fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, marginTop: 7 },
});
