import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { ProductScreen } from "@/src/components/product-ui";
import { GlassCard, VerifiedBadge } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const quickActions = [
  { icon: "create-outline" as const, label: "Edit profile" },
  { icon: "notifications-outline" as const, label: "Notifications" },
  { icon: "bookmark-outline" as const, label: "Saved items" },
] as const;

const settings = [
  { icon: "calendar-outline" as const, title: "Timetable settings", body: "Personalise your class schedule" },
  { icon: "musical-notes-outline" as const, title: "Reminder sounds", body: "Choose notification and alarm sounds" },
  { icon: "shield-outline" as const, title: "Privacy & security", body: "Manage your data and privacy" },
  { icon: "options-outline" as const, title: "App preferences", body: "Theme, language and accessibility" },
] as const;

const support = [
  { icon: "help-circle-outline" as const, title: "Help & support", body: "Get help or send feedback" },
  { icon: "information-circle-outline" as const, title: "About KampusOne", body: "Preview version 0.1.0" },
] as const;

export default function ProfileScreen() {
  function tap() {
    void Haptics.selectionAsync();
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
              <Text style={styles.name}>Gideon</Text>
              <VerifiedBadge label="Gideon is verified" size={18} />
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

      <View style={styles.quickRow}>
        {quickActions.map((action) => (
          <Pressable accessibilityRole="button" key={action.label} onPress={tap} style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}>
            <Ionicons name={action.icon} size={26} color={theme.brandPressed} />
            <Text style={styles.quickText}>{action.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Settings</Text>
      <View style={styles.settingsCard}>
        {settings.map((item, index) => <SettingRow {...item} key={item.title} last={index === settings.length - 1} onPress={tap} />)}
      </View>

      <Text style={styles.sectionTitle}>Support</Text>
      <View style={styles.settingsCard}>
        {support.map((item, index) => <SettingRow {...item} key={item.title} last={index === support.length - 1} onPress={tap} />)}
      </View>

      <Pressable accessibilityRole="button" onPress={tap} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
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
