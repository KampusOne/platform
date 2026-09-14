import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { StyleSheet, View } from "react-native";
import { theme } from "@/src/theme";

export function ScreenSkeleton() {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      accessibilityLabel="Loading"
      accessibilityState={{ busy: true }}
      style={styles.screen}
    >
      <View style={[styles.block, { width: 96, height: 22 }]} />
      <View
        style={[styles.block, { width: "66%", height: 38, marginTop: 26 }]}
      />
      <View style={[styles.block, { width: "42%", height: 18 }]} />
      <View style={[styles.block, { height: 164, marginTop: 26 }]} />
      <View
        style={[styles.block, { width: "50%", height: 24, marginTop: 20 }]}
      />
      {[0, 1, 2].map((id) => (
        <View key={id} style={[styles.block, { height: 64 }]} />
      ))}
    </View>
  );
}
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      backgroundColor: theme.canvas,
      flex: 1,
      padding: 24,
      paddingTop: 60,
      gap: 12,
      width: "100%",
      maxWidth: 540,
      alignSelf: "center",
    },
    block: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      width: "100%",
    },
  });
const styles = createStyles(theme);
