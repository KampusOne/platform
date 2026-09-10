import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { CampusScape, HeaderBadge, StreakCard } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  onBellPress?: () => void;
  unread?: boolean;
  showBell?: boolean;
  showStreak?: boolean;
  badge?: { icon?: keyof typeof Ionicons.glyphMap; text: string; verified?: boolean };
};

export function AppHeader({
  title = "Good morning, Gideon",
  subtitle = "Thursday, 10 September",
  onBellPress,
  unread = true,
  showBell = true,
  showStreak = false,
  badge,
}: AppHeaderProps) {
  return (
    <View style={[styles.hero, showStreak && styles.heroWithStreak]}>
      <CampusScape compact={!showStreak} />

      {showStreak ? (
        <View style={styles.streakRow}>
          <StreakCard />
          <HeaderActions onBellPress={onBellPress} showBell={showBell} unread={unread} />
        </View>
      ) : (
        <View style={styles.floatingActions}>
          <HeaderActions onBellPress={onBellPress} showBell={showBell} unread={unread} />
        </View>
      )}

      <View style={[styles.copy, showStreak && styles.copyWithStreak]} accessible accessibilityLabel={`${title}. ${subtitle}`}>
        <Text style={[styles.title, showStreak && styles.homeTitle]}>{title}</Text>
        <Text style={[styles.subtitle, showStreak && styles.homeSubtitle]}>{subtitle}</Text>
        {badge ? <HeaderBadge {...badge} /> : null}
      </View>
    </View>
  );
}

function HeaderActions({
  onBellPress,
  showBell,
  unread,
}: {
  onBellPress: (() => void) | undefined;
  showBell: boolean;
  unread: boolean;
}) {
  return (
    <View style={styles.actions}>
      {showBell ? (
        <Pressable
          accessibilityLabel="Open notifications"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBellPress}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
        >
          <View pointerEvents="none" style={styles.buttonShine} />
          <Ionicons name="notifications-outline" size={23} color={theme.text} />
          {unread ? <View style={styles.unread} /> : null}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Open Gideon's profile"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => router.push("/profile")}
        style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
      >
        <View style={styles.avatarFallback}><Text style={styles.avatarFallbackText}>GI</Text></View>
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: "https://avatars.githubusercontent.com/u/167391941?v=4" }}
          style={styles.avatar}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 184,
    marginHorizontal: -theme.spacing[5],
    overflow: "hidden",
    paddingHorizontal: theme.spacing[5],
    position: "relative",
  },
  heroWithStreak: { height: 184 },
  streakRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingTop: 4 },
  floatingActions: { position: "absolute", right: theme.spacing[5], top: 4, zIndex: 4 },
  actions: { alignItems: "center", flexDirection: "row", gap: 9 },
  roundButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.90)",
    borderColor: "rgba(255,255,255,0.96)",
    borderRadius: 25,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 50,
    ...theme.shadow,
  },
  buttonShine: { backgroundColor: "rgba(255,255,255,0.78)", borderRadius: 20, height: 20, left: 4, position: "absolute", right: 4, top: -8 },
  unread: { backgroundColor: theme.brand, borderColor: theme.warmWhite, borderRadius: 5, borderWidth: 1.5, height: 10, position: "absolute", right: 8, top: 8, width: 10 },
  avatarButton: { borderColor: "rgba(255,255,255,0.96)", borderRadius: 25, borderWidth: 2, height: 50, overflow: "hidden", width: 50, ...theme.shadow },
  avatarFallback: { alignItems: "center", backgroundColor: theme.surfaceMuted, bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  avatarFallbackText: { color: theme.brandPressed, fontFamily: theme.font.display, fontSize: 14 },
  avatar: { bottom: 0, height: "100%", left: 0, position: "absolute", right: 0, top: 0, width: "100%" },
  copy: { maxWidth: "72%", paddingTop: 18, position: "relative", zIndex: 2 },
  copyWithStreak: { maxWidth: "78%", paddingTop: 8 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 34, letterSpacing: -1.2, lineHeight: 38 },
  homeTitle: { fontSize: 31, letterSpacing: -1, lineHeight: 36 },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 20, marginTop: 3 },
  homeSubtitle: {
    color: theme.brandPressed,
    fontFamily: theme.font.calligraphy,
    fontSize: 15.5,
    letterSpacing: 0.08,
    lineHeight: 22,
    marginTop: 2,
    textShadowColor: "rgba(255,253,252,0.96)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 6,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.95 }] },
});
