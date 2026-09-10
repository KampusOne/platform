import { Image, StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

export function AppHeader() {
  return (
    <View style={styles.header}>
      <View style={styles.brand} accessible accessibilityLabel="KampusOne">
        <Image source={require("@/assets/icon.png")} style={styles.mark} resizeMode="contain" />
        <Text style={styles.word}>KampusOne</Text>
      </View>
      <View style={styles.avatar} accessibilityLabel="Preview profile, not signed in">
        <Text style={styles.avatarText}>K1</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: theme.spacing[5],
  },
  brand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  mark: {
    borderRadius: 9,
    height: 31,
    width: 31,
  },
  word: {
    color: theme.text,
    fontFamily: "Manrope-ExtraBold",
    fontSize: 17,
    letterSpacing: -0.6,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: theme.text,
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  avatarText: {
    color: "#FFFFFF",
    fontFamily: "Manrope-ExtraBold",
    fontSize: 11,
  },
});
