import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  onBellPress?: () => void;
  unread?: boolean;
  showBell?: boolean;
};

export function AppHeader({
  title = "Good morning, Gideon",
  subtitle = "Thursday 10 September · Week 2",
  onBellPress,
  unread = true,
  showBell = true,
}: AppHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.brand} accessible accessibilityLabel={`KampusOne. ${title}. ${subtitle}`}>
        <Image source={require("@/assets/icon.png")} style={styles.mark} resizeMode="contain" />
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {showBell ? (
          <Pressable
            accessibilityLabel="Open notifications"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBellPress}
            style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
          >
            <Ionicons name="notifications-outline" size={21} color={theme.text} />
            {unread ? <View style={styles.unread} /> : null}
          </Pressable>
        ) : null}
        <View style={styles.avatar} accessibilityLabel="Gideon profile preview">
          <Text style={styles.avatarText}>GI</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: theme.spacing[4],
    paddingTop: 4,
  },
  brand: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 11,
  },
  mark: {
    borderRadius: 10,
    height: 34,
    width: 34,
  },
  copy: { flex: 1 },
  title: {
    color: theme.text,
    fontFamily: theme.font.display,
    fontSize: 18,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  subtitle: {
    color: theme.textSubtle,
    fontFamily: theme.font.body,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    marginLeft: 10,
  },
  bell: {
    alignItems: "center",
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    position: "relative",
    width: 44,
  },
  unread: {
    backgroundColor: theme.brand,
    borderColor: theme.canvas,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 9,
    position: "absolute",
    right: 8,
    top: 8,
    width: 9,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: theme.surfaceMuted,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarText: {
    color: theme.brandPressed,
    fontFamily: theme.font.display,
    fontSize: 14,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
