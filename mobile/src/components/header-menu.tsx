import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";

type MenuItem = { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean };

export function HeaderMenu({ label = "More options", items }: { label?: string; items: MenuItem[] }) {
  const { theme } = useAppearance();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="ellipsis-horizontal" size={24} color={theme.text} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityLabel="Close menu" onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "center", padding: 24 }}>
        <View accessibilityViewIsModal style={{ alignSelf: "center", width: "100%", maxWidth: 360, backgroundColor: theme.surface, borderRadius: 18, padding: 8 }}>
          {items.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityState={{ disabled: Boolean(item.disabled) }} disabled={item.disabled} onPress={() => { setOpen(false); item.onPress(); }} style={{ minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12, opacity: item.disabled ? 0.45 : 1 }}>
            <Ionicons name={item.icon} size={21} color={theme.deepBrand} />
            <Text style={{ flex: 1, fontFamily: theme.font.medium, color: theme.text, fontSize: 15 }}>{item.label}</Text>
          </Pressable>)}
        </View>
      </Pressable>
    </Modal>
  </>;
}
