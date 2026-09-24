import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "@/src/theme";
export function ToolPage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  // Use the containing viewport, not a possibly stale window-width measurement.
  // Both scroll viewport and content need a definite width on React Native Web.
  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/explore")
            }
            style={styles.icon}
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function ToolField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  const { theme, styles } = useThemeStyles(createStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textMuted}
        selectionColor={theme.brand}
        {...props}
        style={[
          styles.input,
          props.multiline && { minHeight: 100, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function ToolButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      <Text
        style={[styles.buttonText, secondary && { color: theme.deepBrand }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function ToolRow({
  title,
  detail,
  icon,
  onPress,
  trailing,
}: {
  title: string;
  detail?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={styles.row}
    >
      {icon ? <Ionicons name={icon} color={theme.deepBrand} size={22} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      {trailing ??
        (onPress ? (
          <Ionicons name="chevron-forward" color={theme.textMuted} size={18} />
        ) : null)}
    </Pressable>
  );
}
export const toolStyles = StyleSheet.create({
  section: { marginTop: 24, gap: 12 },
  heading: { fontFamily: theme.font.display, fontSize: 21, color: theme.text },
  body: {
    fontFamily: theme.font.body,
    fontSize: 14,
    lineHeight: 23,
    color: theme.textMuted,
  },
});
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { backgroundColor: theme.canvas, flex: 1, width: "100%", minWidth: 0 },
    scroll: { flex: 1, width: "100%", alignSelf: "stretch" },
    content: {
      width: "100%",
      maxWidth: 540,
      alignSelf: "center",
      alignItems: "stretch",
      paddingBottom: 118,
      paddingHorizontal: 20,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      width: "100%",
      minWidth: 0,
      gap: 8,
      marginBottom: 24,
    },
    icon: { width: 44, height: 44, justifyContent: "center", flexShrink: 0 },
    title: {
      fontFamily: theme.font.displayStrong,
      fontSize: 25,
      color: theme.text,
      flex: 1,
      minWidth: 0,
    },
    field: { gap: 8, marginBottom: 18 },
    label: { fontFamily: theme.font.medium, fontSize: 13, color: theme.text },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 12,
      minHeight: 50,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: theme.text,
      fontFamily: theme.font.body,
      fontSize: 15,
    },
    button: {
      minHeight: 50,
      backgroundColor: theme.deepBrand,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
      paddingHorizontal: 18,
      marginVertical: 6,
    },
    secondary: { backgroundColor: theme.surfaceMuted },
    buttonText: {
      color: "#fff",
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderColor: theme.border,
      minHeight: 64,
    },
    rowTitle: {
      fontFamily: theme.font.semibold,
      fontSize: 15,
      color: theme.text,
    },
    detail: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 19,
      color: theme.textMuted,
      marginTop: 4,
    },
  });
const styles = createStyles(theme);
