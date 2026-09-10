import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

type FeatureStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  next: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export function FeatureState({ eyebrow, title, description, next, icon }: FeatureStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <Ionicons name={icon} size={27} color={theme.brand} />
      </View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.rule} />
      <Text style={styles.nextLabel}>OPENS AFTER</Text>
      <Text style={styles.next}>{next}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    paddingBottom: 80,
  },
  icon: {
    alignItems: "center",
    backgroundColor: theme.surfaceMuted,
    borderColor: "#E7D2C7",
    borderRadius: 25,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    marginBottom: theme.spacing[6],
    width: 50,
  },
  eyebrow: {
    color: theme.brand,
    fontFamily: "Manrope-ExtraBold",
    fontSize: 11,
    letterSpacing: 1.3,
    marginBottom: theme.spacing[3],
  },
  title: {
    color: theme.text,
    fontFamily: "Manrope-ExtraBold",
    fontSize: 34,
    letterSpacing: -1.5,
    lineHeight: 38,
    maxWidth: 330,
  },
  description: {
    color: theme.textMuted,
    fontFamily: "Manrope-Regular",
    fontSize: 15,
    lineHeight: 23,
    marginTop: theme.spacing[4],
    maxWidth: 420,
  },
  rule: {
    backgroundColor: theme.border,
    height: 1,
    marginVertical: theme.spacing[6],
    maxWidth: 420,
  },
  nextLabel: {
    color: theme.textMuted,
    fontFamily: "Manrope-ExtraBold",
    fontSize: 9,
    letterSpacing: 1.2,
  },
  next: {
    color: theme.text,
    fontFamily: "Manrope-SemiBold",
    fontSize: 13,
    marginTop: 5,
  },
});
