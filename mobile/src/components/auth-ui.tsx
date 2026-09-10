import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

export function AuthScreen({
  children,
  title,
  body,
  step,
  totalSteps,
  back = true,
}: {
  children: ReactNode;
  title: string;
  body: string;
  step?: number;
  totalSteps?: number;
  back?: boolean;
}) {
  const { width } = useWindowDimensions();

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <View pointerEvents="none" style={styles.ambientTop} />
      <View pointerEvents="none" style={styles.ambientBottom} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { width: Math.min(width, 540) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            {back ? (
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  void Haptics.selectionAsync();
                  router.back();
                }}
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              >
                <Ionicons name="chevron-back" size={21} color={theme.text} />
              </Pressable>
            ) : (
              <View style={styles.backSpacer} />
            )}
            {typeof step === "number" && typeof totalSteps === "number" ? (
              <Text style={styles.stepLabel}>STEP {step} OF {totalSteps}</Text>
            ) : null}
          </View>

          {typeof step === "number" && typeof totalSteps === "number" ? (
            <View accessibilityLabel={`Step ${step} of ${totalSteps}`} style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(8, (step / totalSteps) * 100)}%` }]} />
            </View>
          ) : null}

          <View style={styles.heading}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
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
  error,
  trailing,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error && styles.inputError]}>
        <TextInput
          {...props}
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={theme.textSubtle}
          selectionColor={theme.brand}
          style={[styles.input, props.multiline && styles.inputMultiline, props.style]}
        />
        {trailing}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  children,
  onPress,
  loading = false,
  disabled = false,
  icon,
}: {
  children: ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: inactive }}
      disabled={inactive}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.primaryButton, inactive && styles.buttonDisabled, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : icon ? <Ionicons name={icon} size={20} color="#FFFFFF" /> : null}
      <Text style={styles.primaryButtonText}>{children}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryButtonText}>{children}</Text>
    </Pressable>
  );
}

export function FormMessage({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" }) {
  return (
    <View accessibilityRole="alert" style={[styles.message, tone === "error" && styles.messageError, tone === "success" && styles.messageSuccess]}>
      <Ionicons
        name={tone === "error" ? "alert-circle-outline" : tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"}
        size={20}
        color={tone === "error" ? "#9C3F32" : tone === "success" ? theme.statusPositive : theme.brandPressed}
      />
      <Text style={[styles.messageText, tone === "error" && styles.messageTextError]}>{children}</Text>
    </View>
  );
}

export function ChoiceButton({
  label,
  meta,
  selected,
  onPress,
  icon,
}: {
  label: string;
  meta?: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}
    >
      {icon ? <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}><Ionicons name={icon} size={20} color={selected ? "#FFFFFF" : theme.brandPressed} /></View> : null}
      <View style={styles.choiceCopy}>
        <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
        {meta ? <Text style={styles.choiceMeta}>{meta}</Text> : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioCore} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
  keyboard: { flex: 1 },
  content: { alignSelf: "center", flexGrow: 1, paddingBottom: 34, paddingHorizontal: 24, paddingTop: 8 },
  ambientTop: { backgroundColor: "rgba(233,177,142,0.20)", borderRadius: 160, height: 300, position: "absolute", right: -175, top: -165, width: 300 },
  ambientBottom: { backgroundColor: "rgba(241,223,200,0.28)", borderRadius: 130, bottom: -155, height: 260, left: -150, position: "absolute", width: 260 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 48 },
  backButton: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.90)", borderColor: "rgba(41,35,31,0.10)", borderRadius: 14, borderWidth: 1, height: 44, justifyContent: "center", width: 44, ...theme.shadow },
  backSpacer: { height: 44, width: 44 },
  stepLabel: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 11, letterSpacing: 1.1 },
  progressTrack: { backgroundColor: "rgba(41,35,31,0.08)", borderRadius: 4, height: 6, marginTop: 15, overflow: "hidden" },
  progressFill: { backgroundColor: theme.brand, borderRadius: 4, height: 6 },
  heading: { marginBottom: 25, marginTop: 29 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 31, letterSpacing: -0.8, lineHeight: 36 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14.5, lineHeight: 22, marginTop: 8 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13, marginBottom: 7 },
  inputWrap: { alignItems: "center", backgroundColor: theme.warmWhite, borderColor: "rgba(41,35,31,0.13)", borderRadius: 15, borderWidth: 1.5, flexDirection: "row", minHeight: 54, overflow: "hidden", paddingHorizontal: 15, ...theme.shadow },
  inputError: { borderColor: "rgba(156,63,50,0.68)" },
  input: { color: theme.text, flex: 1, fontFamily: theme.font.body, fontSize: 15, minHeight: 52, paddingVertical: 0 },
  inputMultiline: { minHeight: 94, paddingTop: 14, textAlignVertical: "top" },
  hintText: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  errorText: { color: "#9C3F32", fontFamily: theme.font.medium, fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  primaryButton: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 16, flexDirection: "row", gap: 9, justifyContent: "center", minHeight: 54, paddingHorizontal: 20, ...theme.shadow },
  secondaryButton: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.78)", borderColor: "rgba(41,35,31,0.13)", borderRadius: 16, borderWidth: 1.5, justifyContent: "center", minHeight: 54, paddingHorizontal: 20 },
  primaryButtonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 15 },
  secondaryButtonText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  buttonDisabled: { opacity: 0.48 },
  message: { alignItems: "flex-start", backgroundColor: "rgba(241,223,200,0.46)", borderColor: "rgba(168,70,46,0.14)", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 16, padding: 12 },
  messageError: { backgroundColor: "rgba(156,63,50,0.07)", borderColor: "rgba(156,63,50,0.20)" },
  messageSuccess: { backgroundColor: "rgba(154,91,62,0.08)", borderColor: "rgba(154,91,62,0.18)" },
  messageText: { color: theme.brandPressed, flex: 1, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18 },
  messageTextError: { color: "#7E3028" },
  choice: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.83)", borderColor: "rgba(41,35,31,0.10)", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, minHeight: 68, padding: 12, ...theme.shadow },
  choiceSelected: { backgroundColor: "rgba(241,223,200,0.54)", borderColor: "rgba(195,93,56,0.48)" },
  choiceIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.30)", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  choiceIconSelected: { backgroundColor: theme.brand },
  choiceCopy: { flex: 1 },
  choiceLabel: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  choiceLabelSelected: { color: theme.brandPressed },
  choiceMeta: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  radio: { alignItems: "center", borderColor: "rgba(41,35,31,0.24)", borderRadius: 10, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  radioSelected: { borderColor: theme.brand },
  radioCore: { backgroundColor: theme.brand, borderRadius: 5, height: 10, width: 10 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

export const authStyles = styles;
