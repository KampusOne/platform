import { Pressable, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCapabilities } from "./agent-shortcuts";
import { useAppearance } from "@/src/lib/appearance";
export function CreateAction({ role }: { role: "VENDOR" | "TUTOR" }) {
  const { width } = useWindowDimensions();
  const { theme } = useAppearance();
  const caps = useCapabilities();
  if (!caps.profiles.some((p) => p.agent_type === role)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={role === "VENDOR" ? "Add product" : "Create tutorial"}
      onPress={() =>
        router.push({ pathname: "/agent-create", params: { role } })
      }
      style={{
        position: "absolute",
        right: Math.max(22, (width - 540) / 2 + 22),
        bottom: 108,
        width: 58,
        height: 58,
        borderRadius: 29,
        backgroundColor: theme.brandPressed,
        alignItems: "center",
        justifyContent: "center",
        elevation: 5,
      }}
    >
      <Ionicons
        name={role === "VENDOR" ? "bag-add-outline" : "add"}
        color="#fff"
        size={26}
      />
    </Pressable>
  );
}
