import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

export function SectionHeading({ title, meta, onPress }: { title: string; meta?: string; onPress?: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {meta ? (
        <Pressable accessibilityRole={onPress ? "button" : undefined} disabled={!onPress} hitSlop={8} onPress={onPress}>
          {({ pressed }) => <Text style={[styles.meta, pressed && styles.pressed]}>{meta}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "baseline",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing[3],
  },
  title: {
    color: theme.text,
    fontFamily: theme.font.display,
    fontSize: 19,
    letterSpacing: -0.2,
  },
  meta: {
    color: theme.brand,
    fontFamily: theme.font.semibold,
    fontSize: 13,
  },
  pressed: { opacity: 0.58 },
});
