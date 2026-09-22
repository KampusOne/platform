import { View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

/** A compact twelve-lobed brand seal. No circular plate, shadow or entrance animation. */
export function VerifiedBadge({ size = 13, label = "Verified account" }: { size?: number; label?: string }) {
  const { theme } = useAppearance();
  const petal = size * 0.76;
  const inset = (size - petal) / 2;
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
    {[0, 30, 60].map((angle) => <View key={angle} pointerEvents="none" style={{ position: "absolute", left: inset, top: inset, width: petal, height: petal, borderRadius: size * 0.1, backgroundColor: theme.deepBrand, transform: [{ rotate: `${angle}deg` }] }} />)}
    <View pointerEvents="none" style={{ width: size * 0.44, height: size * 0.25, borderLeftWidth: Math.max(1.3, size * 0.105), borderBottomWidth: Math.max(1.3, size * 0.105), borderColor: theme.verificationMark, marginTop: -size * 0.09, transform: [{ rotate: "-45deg" }] }} />
  </View>;
}
