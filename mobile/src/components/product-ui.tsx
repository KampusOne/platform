import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

export function ProductScreen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, 540);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { width: contentWidth }, style]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function SearchField({ value, onChangeText, placeholder }: Pick<TextInputProps, "value" | "onChangeText" | "placeholder">) {
  return (
    <View style={styles.search}>
      <Ionicons name="search-outline" size={20} color={theme.textSubtle} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSubtle}
        returnKeyType="search"
        style={styles.searchInput}
        value={value}
      />
      {value ? (
        <Pressable accessibilityLabel="Clear search" hitSlop={10} onPress={() => onChangeText?.("")}>
          <Ionicons name="close-circle" size={19} color={theme.textSubtle} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function FilterRow({
  items,
  selected,
  onSelect,
}: {
  items: readonly string[];
  selected: string;
  onSelect: (item: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.filters} horizontal showsHorizontalScrollIndicator={false}>
      {items.map((item) => {
        const active = item === selected;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={item}
            onPress={() => onSelect(item)}
            style={({ pressed }) => [styles.filter, active && styles.filterActive, pressed && styles.pressed]}
          >
            <Text style={[styles.filterText, active && styles.filterTextActive]}>{item}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function InlineFeedback({ message, tone = "brand" }: { message: string; tone?: "brand" | "success" }) {
  return (
    <View style={[styles.feedback, tone === "success" && styles.feedbackSuccess]} accessibilityRole="alert">
      <Ionicons
        name={tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"}
        size={19}
        color={tone === "success" ? theme.success : theme.brandPressed}
      />
      <Text style={[styles.feedbackText, tone === "success" && styles.feedbackTextSuccess]}>{message}</Text>
    </View>
  );
}

export function EmptyResult({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name="search-outline" size={25} color={theme.brand} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  content: {
    alignSelf: "center",
    paddingBottom: 118,
    paddingHorizontal: theme.spacing[5],
  },
  search: {
    alignItems: "center",
    backgroundColor: "rgba(41,35,31,0.05)",
    borderColor: "rgba(41,35,31,0.02)",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    height: 50,
    paddingHorizontal: 15,
  },
  searchInput: {
    color: theme.text,
    flex: 1,
    fontFamily: theme.font.body,
    fontSize: 15,
    height: 48,
  },
  filters: { gap: 8, paddingVertical: 1 },
  filter: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1.5,
    height: 39,
    justifyContent: "center",
    paddingHorizontal: 15,
  },
  filterActive: { backgroundColor: "rgba(233,177,142,0.3)", borderColor: theme.brand },
  filterText: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13.5 },
  filterTextActive: { color: theme.brandPressed, fontFamily: theme.font.semibold },
  feedback: {
    alignItems: "center",
    backgroundColor: "rgba(168,70,46,0.08)",
    borderColor: "rgba(168,70,46,0.22)",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  feedbackSuccess: { backgroundColor: "rgba(45,125,89,0.09)", borderColor: "rgba(45,125,89,0.2)" },
  feedbackText: { color: theme.brandPressed, flex: 1, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 18 },
  feedbackTextSuccess: { color: theme.success },
  empty: {
    alignItems: "center",
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.border,
    borderRadius: 20,
    borderStyle: "dashed",
    borderWidth: 1,
    padding: 26,
  },
  emptyIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 18, height: 54, justifyContent: "center", width: 54 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 18, marginTop: 12 },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 6, textAlign: "center" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
