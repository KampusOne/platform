import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  onBellPress?: () => void;
  unread?: boolean;
  showBell?: boolean;
  showStreak?: boolean;
  streakDays?: number | null;
  badge?: { icon?: keyof typeof Ionicons.glyphMap; text: string; verified?: boolean };
  initials?: string;
  avatarUrl?: string | null | undefined;
};

export function AppHeader({
  title = "Welcome back",
  subtitle = "",
  onBellPress,
  unread = false,
  showBell = true,
  showStreak = false,
  streakDays,
  badge,
  initials = "KO",
  avatarUrl,
}: AppHeaderProps) {
  return (
    <View style={styles.header}>
      {showStreak ? (
        <View style={styles.streak} accessibilityLabel={streakDays == null ? "Start your streak" : `${streakDays} day streak`} accessible>
          <Ionicons color={theme.brand} name="flame-outline" size={22} />
          <Text style={styles.streakText}>{streakDays == null ? "Start your streak" : `${streakDays} day streak`}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <View accessible accessibilityLabel={[title, subtitle].filter(Boolean).join(". ")} style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {badge ? (
            <View style={styles.badge}>
              {badge.verified ? (
                <View style={styles.verified}><Ionicons color="#FFFFFF" name="checkmark" size={10} /></View>
              ) : badge.icon ? (
                <Ionicons color={theme.deepBrand} name={badge.icon} size={14} />
              ) : null}
              <Text style={styles.badgeText}>{badge.text}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          {showBell ? (
            <Pressable
              accessibilityLabel="Open notifications"
              accessibilityRole="button"
              accessibilityState={{ disabled: !onBellPress }}
              disabled={!onBellPress}
              hitSlop={4}
              onPress={onBellPress}
              style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
            >
              <Ionicons color={theme.text} name="notifications-outline" size={21} />
              {unread ? <View style={styles.unread} /> : null}
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Open your profile"
            accessibilityRole="button"
            hitSlop={4}
            onPress={() => router.push("/profile")}
            style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
          >
            <View style={styles.avatarFallback}><Text style={styles.avatarFallbackText}>{initials}</Text></View>
            {avatarUrl ? <Image accessible={false} accessibilityIgnoresInvertColors source={{ uri: avatarUrl }} style={styles.avatar} /> : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 22, paddingTop: 8 },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 14, justifyContent: "space-between" },
  copy: { flex: 1 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 27, letterSpacing: -0.5, lineHeight: 32 },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 20, marginTop: 4 },
  actions: { alignItems: "center", flexDirection: "row", gap: 8 },
  roundButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.88)", borderColor: theme.border, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", position: "relative", width: 44 },
  unread: { backgroundColor: theme.brand, borderColor: "#FFFFFF", borderRadius: 4, borderWidth: 1, height: 8, position: "absolute", right: 8, top: 8, width: 8 },
  avatarButton: { borderColor: "rgba(195,93,56,0.24)", borderRadius: 22, borderWidth: 1, height: 44, overflow: "hidden", width: 44 },
  avatarFallback: { alignItems: "center", backgroundColor: theme.sand, bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  avatarFallbackText: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 12 },
  avatar: { height: "100%", width: "100%" },
  badge: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 8 },
  badgeText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 },
  verified: { alignItems: "center", backgroundColor: theme.verification, borderRadius: 7, height: 14, justifyContent: "center", width: 14 },
  streak: { alignItems: "center", flexDirection: "row", gap: 5, marginBottom: 10, minHeight: 28 },
  streakText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
});
