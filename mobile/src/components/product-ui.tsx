import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export function ProductScreen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, 540);
  const entry = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reducedMotion) {
      entry.stopAnimation();
      entry.setValue(1);
      return;
    }
    entry.setValue(0);
    const animation = Animated.timing(entry, {
      duration: theme.motion.screen,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entry, reducedMotion]);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View pointerEvents="none" style={styles.ambientTop} />
      <View pointerEvents="none" style={styles.ambientBottom} />
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { width: contentWidth }, style]}
        keyboardDismissMode="interactive"
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

export function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  onFilterPress,
}: Pick<TextInputProps, "value" | "onChangeText" | "placeholder"> & { onFilterPress?: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, focused && styles.searchFocused]}>
      <Ionicons color={theme.deepBrand} name="search-outline" size={22} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        returnKeyType="search"
        style={styles.searchInput}
        value={value}
      />
      {value ? (
        <Pressable accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={10} onPress={() => onChangeText?.("")} style={styles.searchAction}>
          <Ionicons color={theme.textMuted} name="close" size={20} />
        </Pressable>
      ) : onFilterPress ? (
        <Pressable
          accessibilityLabel="Open filters"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.selectionAsync();
            onFilterPress();
          }}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
        >
          <Ionicons color={theme.deepBrand} name="options-outline" size={19} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function FilterRow({ items, selected, onSelect }: {
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
            onPress={() => {
              void Haptics.selectionAsync();
              onSelect(item);
            }}
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
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reducedMotion) {
      entry.setValue(1);
      return;
    }
    entry.setValue(0);
    const animation = Animated.spring(entry, { damping: 14, mass: 0.7, stiffness: 190, toValue: 1, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entry, message, reducedMotion]);

  return (
    <Animated.View
      accessibilityRole="alert"
      style={[
        styles.feedback,
        tone === "success" && styles.feedbackSuccess,
        { opacity: entry, transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      <Ionicons
        color={tone === "success" ? theme.success : theme.deepBrand}
        name={tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"}
        size={19}
      />
      <Text style={[styles.feedbackText, tone === "success" && styles.feedbackTextSuccess]}>{message}</Text>
    </Animated.View>
  );
}

export function EmptyResult({
  title,
  body,
  image,
  icon = "file-tray-outline",
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  image?: ImageSourcePropType;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      {image ? (
        <Image accessible={false} accessibilityIgnoresInvertColors resizeMode="contain" source={image} style={styles.emptyImage} />
      ) : (
        <View style={styles.emptyIcon}><Ionicons color={theme.deepBrand} name={icon} size={28} /></View>
      )}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}>
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function IconButton({ icon, label, onPress, active = false }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, pressed && styles.pressed]}
    >
      <Ionicons color={active ? "#FFFFFF" : theme.text} name={icon} size={21} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
  ambientTop: { backgroundColor: "rgba(233,177,142,0.13)", borderRadius: 130, height: 250, position: "absolute", right: -150, top: -122, width: 250 },
  ambientBottom: { backgroundColor: "rgba(241,223,200,0.20)", borderRadius: 120, height: 220, left: -170, position: "absolute", top: 620, width: 220 },
  content: { alignSelf: "center", paddingBottom: 118, paddingHorizontal: 20 },
  search: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.90)",
    borderColor: "rgba(41,35,31,0.08)",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 8,
    ...theme.shadow,
  },
  searchFocused: { borderColor: theme.brand, borderWidth: 1.5, shadowColor: theme.brand, shadowOpacity: 0.14, shadowRadius: 4 },
  searchInput: { color: theme.text, flex: 1, fontFamily: theme.font.body, fontSize: 14.5, minHeight: 54 },
  searchAction: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  filterButton: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  filters: { gap: 10, paddingHorizontal: 1, paddingVertical: 2 },
  filter: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.78)", borderColor: theme.border, borderRadius: 16, borderWidth: 1, height: 44, justifyContent: "center", minWidth: 82, paddingHorizontal: 17 },
  filterActive: { backgroundColor: theme.deepBrand, borderColor: theme.deepBrand },
  filterText: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 13 },
  filterTextActive: { color: "#FFFFFF", fontFamily: theme.font.semibold },
  feedback: { alignItems: "center", backgroundColor: "#FFF8F4", borderColor: "rgba(168,70,46,0.18)", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 12, paddingHorizontal: 13, paddingVertical: 11 },
  feedbackSuccess: { backgroundColor: "#F3F7F3", borderColor: "rgba(75,123,84,0.22)" },
  feedbackText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12.5, lineHeight: 18 },
  feedbackTextSuccess: { color: theme.success },
  empty: { alignItems: "center", justifyContent: "center", minHeight: 270, paddingHorizontal: 22, paddingVertical: 32 },
  emptyImage: { height: 220, maxWidth: 360, width: "100%" },
  emptyIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 20, height: 60, justifyContent: "center", width: 60 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, lineHeight: 25, marginTop: 16, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 20, marginTop: 7, maxWidth: 340, textAlign: "center" },
  emptyAction: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, justifyContent: "center", marginTop: 18, minHeight: 48, paddingHorizontal: 18 },
  emptyActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13.5 },
  iconButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.84)", borderColor: theme.border, borderRadius: 15, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  iconButtonActive: { backgroundColor: theme.deepBrand, borderColor: theme.deepBrand },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
});
