import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/src/auth/session-context";
import { AppHeader } from "@/src/components/app-header";
import { ProductScreen } from "@/src/components/product-ui";
import { GlassCard, VerifiedBadge } from "@/src/components/visual-system";
import { supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

const quickActions = [
  { href: "/onboarding" as const, icon: "create-outline" as const, label: "Edit profile" },
  { href: "/permissions" as const, icon: "notifications-outline" as const, label: "Permissions" },
  { href: "/study-tools" as const, icon: "bookmark-outline" as const, label: "Saved tools" },
] as const;

const settings = [
  { href: "/timetable" as const, icon: "calendar-outline" as const, title: "Timetable settings", body: "Personalise your class schedule" },
  { href: "/permissions" as const, icon: "musical-notes-outline" as const, title: "Reminder sounds", body: "Test notification and alarm readiness" },
  { href: "/permissions" as const, icon: "shield-outline" as const, title: "Privacy & permissions", body: "Manage location and notification access" },
  { href: "/student-pro" as const, icon: "sparkles-outline" as const, title: "KampusOne Pro", body: "See free and planned student tiers" },
] as const;

const support = [
  { icon: "help-circle-outline" as const, title: "Help & support", body: "Get help or send feedback" },
  { icon: "information-circle-outline" as const, title: "About KampusOne", body: "Preview version 0.1.0" },
] as const;

export default function ProfileScreen() {
  const { session } = useSession();
  const displayName = typeof session?.user.user_metadata.display_name === "string" ? session.user.user_metadata.display_name : "Gideon";

  function tap() {
    void Haptics.selectionAsync();
  }

  async function logOut() {
    tap();
    await supabase?.auth.signOut();
    router.replace("/");
  }

  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "person", text: "Student account" }} showBell={false} subtitle="Manage your account and preferences." title="Profile" unread={false} />

      <GlassCard style={styles.profileCard}>
        <View style={styles.identityRow}>
          <View style={styles.photoWrap}>
            <View style={styles.photo}>
              <Text style={styles.photoFallback}>GI</Text>
              <Image source={{ uri: "https://avatars.githubusercontent.com/u/167391941?v=4" }} style={styles.photoImage} />
            </View>
            <Pressable accessibilityLabel="Change profile picture" accessibilityRole="button" onPress={tap} style={({ pressed }) => [styles.camera, pressed && styles.pressed]}>
              <Ionicons name="camera" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={styles.identityCopy}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{displayName}</Text>
              {!session ? <VerifiedBadge label={`${displayName} is a verified preview profile`} size={18} /> : null}
            </View>
            <Text style={styles.programme}>Computer Education</Text>
            <View style={styles.levelChip}><Ionicons name="school" size={15} color={theme.brandPressed} /><Text style={styles.levelText}>200 Level</Text></View>
          </View>
        </View>
        <View style={styles.profileRule} />
        <Pressable accessibilityRole="button" onPress={tap} style={({ pressed }) => [styles.campusStatement, pressed && styles.pressed]}>
          <View style={styles.statementIcon}><Ionicons name="business-outline" size={23} color={theme.brandPressed} /></View>
          <View style={styles.statementCopy}><Text style={styles.statementTitle}>Same campus. Brighter futures.</Text><Text style={styles.statementBody}>Computer Education student at KampusOne. Learning today. Building tomorrow.</Text></View>
          <Ionicons name="chevron-forward" size={19} color={theme.brandPressed} />
        </Pressable>
      </GlassCard>

      <Pressable accessibilityRole="button" onPress={() => router.push("/permissions")} style={({ pressed }) => [styles.permissionWarning, pressed && styles.pressed]}>
        <View style={styles.warningIcon}><Ionicons name="notifications-off-outline" size={20} color={theme.statusAttention} /></View>
        <View style={styles.warningCopy}><Text style={styles.warningTitle}>Check notification readiness</Text><Text style={styles.warningBody}>You could miss a class alert while permissions or push delivery are off.</Text></View>
        <Ionicons name="chevron-forward" size={18} color={theme.statusAttention} />
      </Pressable>

      <View style={styles.quickRow}>
        {quickActions.map((action) => (
          <Pressable accessibilityRole="button" key={action.label} onPress={() => { tap(); router.push(action.href); }} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}>
            <Ionicons name={action.icon} size={26} color={theme.brandPressed} />
            <Text style={styles.quickText}>{action.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Settings</Text>
      <View style={styles.settingsCard}>
        {settings.map((item, index) => <SettingRow {...item} key={item.title} last={index === settings.length - 1} onPress={() => { tap(); router.push(item.href); }} />)}
      </View>

      <Text style={styles.sectionTitle}>Support</Text>
      <View style={styles.settingsCard}>
        {support.map((item, index) => <SettingRow {...item} key={item.title} last={index === support.length - 1} onPress={tap} />)}
      </View>

      <Pressable accessibilityRole="button" onPress={() => void logOut()} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
        <Ionicons name="log-out-outline" size={23} color={theme.brandPressed} />
        <Text style={styles.logoutText}>Log out</Text>
        <Ionicons name="chevron-forward" size={19} color={theme.brandPressed} />
      </Pressable>
    </ProductScreen>
  );
}

function SettingRow({ icon, title, body, last, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; last: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.settingRow, !last && styles.settingBorder, pressed && styles.pressed]}>
      <View style={styles.settingIcon}><Ionicons name={icon} size={20} color={theme.brandPressed} /></View>
      <View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingBody}>{body}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={theme.brandPressed} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profileCard: { padding: 17 },
  identityRow: { alignItems: "center", flexDirection: "row" },
  photoWrap: { position: "relative" },
  photo: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderColor: "rgba(255,255,255,0.98)", borderRadius: 47, borderWidth: 3, height: 94, justifyContent: "center", overflow: "hidden", width: 94, ...theme.shadow },
  photoFallback: { color: theme.brandPressed, fontFamily: theme.font.displayStrong, fontSize: 24 },
  photoImage: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, width: "100%", height: "100%" },
  camera: { alignItems: "center", backgroundColor: theme.brand, borderColor: theme.warmWhite, borderRadius: 17, borderWidth: 3, bottom: 1, height: 34, justifyContent: "center", position: "absolute", right: -2, width: 34 },
  identityCopy: { flex: 1, marginLeft: 17 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  name: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 26, letterSpacing: -0.5 },
  programme: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, marginTop: 2 },
  levelChip: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(233,177,142,0.27)", borderRadius: 12, flexDirection: "row", gap: 6, marginTop: 12, minHeight: 34, paddingHorizontal: 11 },
  levelText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12 },
  profileRule: { backgroundColor: theme.border, height: StyleSheet.hairlineWidth, marginVertical: 15 },
  campusStatement: { alignItems: "center", flexDirection: "row" },
  statementIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.25)", borderRadius: 18, height: 52, justifyContent: "center", width: 52 },
  statementCopy: { flex: 1, marginHorizontal: 11 },
  statementTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  statementBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  permissionWarning: { alignItems: "center", backgroundColor: "rgba(241,223,200,0.48)", borderColor: "rgba(140,90,37,0.18)", borderRadius: 16, borderWidth: 1, flexDirection: "row", marginTop: 12, padding: 12 },
  warningIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.68)", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  warningCopy: { flex: 1, marginHorizontal: 9 },
  warningTitle: { color: theme.statusAttention, fontFamily: theme.font.semibold, fontSize: 12 },
  warningBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  quickRow: { flexDirection: "row", gap: 9, marginTop: 18 },
  quickCard: { alignItems: "center", backgroundColor: "rgba(252,230,220,0.63)", borderColor: "rgba(255,255,255,0.94)", borderRadius: 18, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 102, padding: 10, ...theme.shadow },
  quickText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 11.5, marginTop: 9, textAlign: "center" },
  sectionTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 22, letterSpacing: -0.3, marginBottom: 11, marginTop: 25 },
  settingsCard: { backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 20, borderWidth: 1, overflow: "hidden", paddingHorizontal: 13, ...theme.shadow },
  settingRow: { alignItems: "center", flexDirection: "row", minHeight: 76, paddingVertical: 10 },
  settingBorder: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
  settingIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.24)", borderRadius: 14, height: 43, justifyContent: "center", width: 43 },
  settingCopy: { flex: 1, marginLeft: 11 },
  settingTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  settingBody: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  logout: { alignItems: "center", backgroundColor: "rgba(252,230,220,0.67)", borderColor: "rgba(195,93,56,0.13)", borderRadius: 18, borderWidth: 1, flexDirection: "row", marginTop: 18, minHeight: 62, paddingHorizontal: 16 },
  logoutText: { color: theme.brandPressed, flex: 1, fontFamily: theme.font.semibold, fontSize: 14, marginLeft: 10 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
});
