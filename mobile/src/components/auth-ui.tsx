import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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

export function AuthScreen({
  children,
  eyebrow,
  title,
  description,
  back = true,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  back?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            {back ? (
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.back()}
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              >
                <Ionicons name="arrow-back" color={theme.text} size={21} />
              </Pressable>
            ) : (
              <View style={styles.backSpacer} />
            )}
            <View style={styles.wordmark}>
              <View style={styles.wordmarkIcon}>
                <Text style={styles.wordmarkIconText}>K1</Text>
              </View>
              <Text style={styles.wordmarkText}>KampusOne</Text>
            </View>
          </View>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>{description}</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function FormField({
  label,
  hint,
  icon,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        {icon ? <Ionicons color={theme.textSubtle} name={icon} size={19} /> : null}
        <TextInput
          autoCapitalize="none"
          placeholderTextColor={theme.textSubtle}
          style={styles.input}
          {...props}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  children,
  loading = false,
  onPress,
  disabled = false,
}: {
  children: ReactNode;
  loading?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const unavailable = loading || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        unavailable && styles.primaryButtonDisabled,
        pressed && !unavailable && styles.primaryButtonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.white} />
      ) : (
        <>
          <Text style={styles.primaryButtonText}>{children}</Text>
          <Ionicons color={theme.white} name="arrow-forward" size={19} />
        </>
      )}
    </Pressable>
  );
}

export function InlineNotice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "error" | "success";
}) {
  return (
    <View style={[styles.notice, styles[`notice_${tone}`]]}>
      <Ionicons
        color={tone === "error" ? "#9C3F2F" : tone === "success" ? "#376B4C" : theme.brandPressed}
        name={tone === "error" ? "alert-circle-outline" : tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"}
        size={20}
      />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  form: { gap: 17 },
  link: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 14 },
  linkCenter: { alignSelf: "center", paddingVertical: 8 },
  rowBetween: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  secondaryCopy: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14 },
  footer: { alignItems: "center", flexDirection: "row", justifyContent: "center", marginTop: 28 },
});

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    marginHorizontal: "auto",
    maxWidth: 560,
    paddingBottom: 40,
    paddingHorizontal: theme.spacing[5],
    width: "100%",
  },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingTop: 8 },
  backButton: {
    alignItems: "center",
    backgroundColor: theme.surfaceRaised,
    borderColor: "#E6D8CE",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  backSpacer: { height: 44, width: 44 },
  wordmark: { alignItems: "center", flexDirection: "row", gap: 8 },
  wordmarkIcon: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 9, height: 30, justifyContent: "center", width: 30 },
  wordmarkIconText: { color: theme.white, fontFamily: theme.font.displayStrong, fontSize: 11 },
  wordmarkText: { color: theme.text, fontFamily: theme.font.display, fontSize: 18 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  heading: { marginBottom: 30, marginTop: 54 },
  eyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 12, letterSpacing: 1.4, marginBottom: 12, textTransform: "uppercase" },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 38, letterSpacing: -1.2, lineHeight: 42 },
  description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 15.5, lineHeight: 23, marginTop: 12, maxWidth: 470 },
  fieldWrap: { gap: 8 },
  label: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  inputWrap: {
    alignItems: "center",
    backgroundColor: theme.surfaceRaised,
    borderColor: "#DED0C7",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  input: { color: theme.text, flex: 1, fontFamily: theme.font.body, fontSize: 16, minHeight: 52, paddingHorizontal: 11 },
  hint: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: theme.brand,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginTop: 5,
    minHeight: 56,
    paddingHorizontal: 18,
    ...theme.shadow,
  },
  primaryButtonPressed: { backgroundColor: theme.brandPressed, transform: [{ scale: 0.98 }] },
  primaryButtonDisabled: { opacity: 0.56 },
  primaryButtonText: { color: theme.white, fontFamily: theme.font.bold, fontSize: 15 },
  notice: { alignItems: "flex-start", backgroundColor: "#F7ECE4", borderRadius: 14, flexDirection: "row", gap: 10, padding: 14 },
  notice_error: { backgroundColor: "#FBEAE6" },
  notice_success: { backgroundColor: "#EAF5ED" },
  notice_neutral: { backgroundColor: "#F7ECE4" },
  noticeText: { color: theme.text, flex: 1, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 20 },
});
