import { StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

export function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
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
    fontFamily: "Manrope-ExtraBold",
    fontSize: 19,
    letterSpacing: -0.7,
  },
  meta: {
    color: theme.textMuted,
    fontFamily: "Manrope-SemiBold",
    fontSize: 11,
  },
});
