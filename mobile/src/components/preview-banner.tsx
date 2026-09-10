import { StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

export function PreviewBanner({ children }: { children: string }) {
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <View style={styles.dot} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: theme.surfaceMuted,
    borderColor: "#E7CFC3",
    borderRadius: theme.radius.small,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: theme.spacing[6],
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  dot: {
    backgroundColor: theme.warning,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  text: {
    color: "#755C50",
    fontFamily: theme.font.semibold,
    fontSize: 11,
  },
});
