import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
  const entry = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!live) return;
      if (reduced) {
        entry.setValue(1);
        return;
      }
      Animated.timing(entry, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start();
    });
    return () => { live = false; };
  }, [entry]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View pointerEvents="none" style={styles.ambientTop} />
      <View pointerEvents="none" style={styles.ambientMiddle} />
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { width: contentWidth }, style]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{
          opacity: entry,
          transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        }}
      >
        {children}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

export function SearchField({ value, onChangeText, placeholder }: Pick<TextInputProps, "value" | "onChangeText" | "placeholder">) {
  return (
    <View style={styles.search}>
      <View pointerEvents="none" style={styles.searchShine} />
      <Ionicons name="search-outline" size={21} color={theme.brandPressed} />
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
          <Ionicons name="close-circle" size={20} color={theme.textSubtle} />
        </Pressable>
      ) : (
        <View style={styles.filterButton}><Ionicons name="options-outline" size={18} color={theme.brandPressed} /></View>
      )}
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
  const entry = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entry, { damping: 14, mass: 0.7, stiffness: 190, toValue: 1, useNativeDriver: true }).start();
  }, [entry, message]);

  return (
    <Animated.View
      accessibilityRole="alert"
      style={[
        styles.feedback,
        tone === "success" && styles.feedbackSuccess,
        { opacity: entry, transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      <Ionicons
        name={tone === "success" ? "checkmark-done" : "information-circle"}
        size={19}
        color={tone === "success" ? theme.statusPositive : theme.brandPressed}
      />
      <Text style={[styles.feedbackText, tone === "success" && styles.feedbackTextSuccess]}>{message}</Text>
    </Animated.View>
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
  safe: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
  ambientTop: { backgroundColor: "rgba(233,177,142,0.14)", borderRadius: 130, height: 260, position: "absolute", right: -118, top: -96, width: 260 },
  ambientMiddle: { backgroundColor: "rgba(241,223,200,0.20)", borderRadius: 110, height: 220, left: -147, position: "absolute", top: 460, width: 220 },
  content: { alignSelf: "center", paddingBottom: 126, paddingHorizontal: theme.spacing[5] },
  search: {
    alignItems: "center",
    backgroundColor: "rgba(255,253,252,0.91)",
    borderColor: "rgba(255,255,255,0.96)",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    height: 58,
    overflow: "hidden",
    paddingLeft: 16,
    paddingRight: 9,
    position: "relative",
    ...theme.shadow,
  },
  searchShine: { backgroundColor: "rgba(255,255,255,0.74)", height: 22, left: 3, position: "absolute", right: 3, top: -10 },
  searchInput: { color: theme.text, flex: 1, fontFamily: theme.font.body, fontSize: 14.5, height: 54 },
  filterButton: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  filters: { gap: 8, paddingHorizontal: 1, paddingVertical: 2 },
  filter: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.68)", borderColor: "rgba(195,93,56,0.09)", borderRadius: 15, borderWidth: 1, height: 42, justifyContent: "center", minWidth: 82, paddingHorizontal: 17 },
  filterActive: { backgroundColor: theme.brand, borderColor: theme.brand },
  filterText: { color: theme.brandPressed, fontFamily: theme.font.medium, fontSize: 13 },
  filterTextActive: { color: "#FFFFFF", fontFamily: theme.font.semibold },
  feedback: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.94)", borderColor: "rgba(168,70,46,0.18)", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 12, paddingHorizontal: 13, paddingVertical: 11, ...theme.shadow },
  feedbackSuccess: { backgroundColor: "rgba(241,223,200,0.48)", borderColor: "rgba(111,48,37,0.16)" },
  feedbackText: { color: theme.brandPressed, flex: 1, fontFamily: theme.font.medium, fontSize: 12.5, lineHeight: 18 },
  feedbackTextSuccess: { color: theme.statusPositive },
  empty: { alignItems: "center", backgroundColor: theme.surfaceGlass, borderColor: "rgba(255,255,255,0.94)", borderRadius: 22, borderStyle: "dashed", borderWidth: 1, padding: 28, ...theme.shadow },
  emptyIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 20, height: 58, justifyContent: "center", width: 58 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 19, marginTop: 13 },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 21, marginTop: 6, textAlign: "center" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
