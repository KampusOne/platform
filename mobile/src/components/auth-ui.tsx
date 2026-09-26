import { InlineLoading } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import {
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
import { useAuth } from "@/src/auth/auth-context";
import {
  beginSocialSignIn,
  socialConfiguration,
  type SocialProvider,
} from "@/src/lib/social-auth";
import { useToast } from "./toast";

const DEEP_TERRACOTTA = "#A8462E";

export function AuthShell({
  children,
  title,
  subtitle,
  eyebrow,
  back = true,
  onBack,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  back?: boolean;
  onBack?: (() => void) | undefined;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <KeyboardAvoidingView
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : Platform.OS === "android"
              ? "height"
              : undefined
        }
        style={styles.safe}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topbar}>
            {back && (onBack || router.canGoBack()) ? (
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={4}
                onPress={onBack ?? (() => router.back())}
                style={({ pressed }) => [
                  styles.back,
                  pressed && styles.backPressed,
                ]}
              >
                <Ionicons color={theme.text} name="arrow-back" size={27} />
              </Pressable>
            ) : (
              <View style={styles.backPlaceholder} />
            )}
          </View>
          <View style={styles.heading}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type AuthFieldProps = TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  hideLabel?: boolean;
  error?: boolean;
  code?: boolean;
};

export function AuthField({
  label,
  icon,
  hideLabel = false,
  error = false,
  code = false,
  editable = true,
  secureTextEntry = false,
  onBlur,
  onFocus,
  style,
  ...props
}: AuthFieldProps) {
  const { theme, styles } = useThemeStyles(createStyles);

  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.fieldGroup}>
      {!hideLabel ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          error && styles.fieldError,
          !editable && styles.fieldDisabled,
        ]}
      >
        <Ionicons
          color={focused ? DEEP_TERRACOTTA : theme.clay}
          name={icon}
          size={20}
        />
        <TextInput
          {...props}
          accessibilityLabel={label}
          accessibilityState={{ disabled: !editable }}
          editable={editable}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor="#766960"
          secureTextEntry={secureTextEntry && !revealed}
          selectionColor={DEEP_TERRACOTTA}
          style={[styles.input, code && styles.codeInput, style]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityLabel={
              revealed
                ? `Hide ${label.toLowerCase()}`
                : `Show ${label.toLowerCase()}`
            }
            accessibilityRole="button"
            hitSlop={2}
            onPress={() => setRevealed((value) => !value)}
            style={({ pressed }) => [styles.eye, pressed && styles.eyePressed]}
          >
            <Ionicons
              color={theme.textMuted}
              name={revealed ? "eye-off-outline" : "eye-outline"}
              size={22}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function PrimaryButton({
  children,
  onPress,
  loading = false,
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  const buttonLabel = typeof children === "string" ? children : "Continue";
  return (
    <Pressable
      accessibilityLabel={loading ? `${buttonLabel}, in progress` : buttonLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        (disabled || loading) && styles.controlDisabled,
        pressed && styles.primaryPressed,
      ]}
    >
      <Text style={styles.primaryText} accessibilityLiveRegion="polite">
        {loading ? `${buttonLabel}…` : children}
      </Text>
    </Pressable>
  );
}

function GoogleMark() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.googleMark}
    >
      <View style={[styles.googleArc, styles.googleArcBlue]} />
      <View style={[styles.googleArc, styles.googleArcRed]} />
      <View style={[styles.googleArc, styles.googleArcYellow]} />
      <View style={[styles.googleArc, styles.googleArcGreen]} />
      <View style={styles.googleMarkCutout} />
      <View style={styles.googleMarkGap} />
      <View style={styles.googleMarkBar} />
    </View>
  );
}

export function SocialAuthButtons() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { beginSession } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [providers, setProviders] = useState<SocialProvider[]>([]);

  useEffect(() => {
    let active = true;
    void socialConfiguration()
      .then((config) => {
        if (active) setProviders(config.providers);
      })
      .catch(() => {
        if (active) setProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signIn(provider: "google" | "apple") {
    setPending(true);
    try {
      const session = await beginSocialSignIn(provider);
      if (session) {
        await beginSession(session);
        router.replace("/");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sign-in could not be completed.");
    } finally {
      setPending(false);
    }
  }

  const appleDisabled = pending || !providers.includes("apple");

  return (
    <View
      accessibilityLabel="Other sign-in methods"
      style={styles.socialSection}
    >
      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.divider} />
      </View>

      <Pressable
        accessibilityLabel="Continue with Google"
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        onPress={() => void signIn("google")}
        style={({ pressed }) => [
          styles.socialButton,
          styles.googleButton,
          pending && styles.socialButtonDisabled,
          pressed && !pending && styles.socialButtonPressed,
        ]}
      >
        <GoogleMark />
        <Text style={styles.socialButtonText}>Continue with Google</Text>
      </Pressable>

      <Pressable
        accessibilityLabel="Continue with Apple"
        accessibilityRole="button"
        accessibilityState={{ disabled: appleDisabled }}
        disabled={appleDisabled}
        onPress={() => void signIn("apple")}
        style={({ pressed }) => [
          styles.socialButton,
          appleDisabled && styles.socialButtonDisabled,
          pressed && !appleDisabled && styles.socialButtonPressed,
        ]}
      >
        <Ionicons color={theme.text} name="logo-apple" size={23} />
        <Text style={styles.socialButtonText}>Continue with Apple</Text>
      </Pressable>

      {pending ? (
        <Text style={styles.socialHelp} accessibilityLiveRegion="polite">
          Opening sign in
        </Text>
      ) : null}
    </View>
  );
}

export function FormError({ message }: { message: string }) {
  const toast = useToast();
  useEffect(() => {
    if (message) toast(message, "error");
  }, [message, toast]);
  return null;
}

export function FormNotice({ children }: { children: ReactNode }) {
  const toast = useToast();
  const message =
    typeof children === "string"
      ? children
      : Array.isArray(children)
        ? children
            .filter((x) => typeof x === "string" || typeof x === "number")
            .join("")
        : "";
  useEffect(() => {
    if (message) toast(message);
  }, [message, toast]);
  return null;
}

export function TextLink({
  children,
  onPress,
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkTarget,
        pressed && styles.linkPressed,
        disabled && styles.linkDisabled,
      ]}
    >
      <Text style={styles.link}>{children}</Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: {
      backgroundColor: theme.canvas,
      flex: 1,
    },
    content: {
      alignSelf: "center",
      minHeight: "100%",
      paddingBottom: 20,
      paddingHorizontal: 24,
      width: "100%",
      maxWidth: 540,
    },
    topbar: {
      alignItems: "center",
      flexDirection: "row",
      height: 48,
    },
    back: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      marginLeft: -8,
      width: 44,
    },
    backPressed: {
      opacity: 0.55,
      transform: [{ translateX: -2 }],
    },
    backPlaceholder: {
      height: 44,
      width: 44,
    },
    heading: {
      marginBottom: 24,
      marginTop: 10,
    },
    eyebrow: {
      color: DEEP_TERRACOTTA,
      fontFamily: theme.font.bold,
      fontSize: 10,
      letterSpacing: 1.3,
      marginBottom: 8,
      textTransform: "uppercase",
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.displayStrong,
      fontSize: 34,
      letterSpacing: -0.9,
      lineHeight: 39,
    },
    subtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 8,
      maxWidth: 450,
    },
    fieldGroup: {
      marginBottom: 15,
    },
    label: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 13,
      marginBottom: 7,
    },
    field: {
      alignItems: "center",
      backgroundColor: "rgba(255,253,252,0.72)",
      borderColor: "#9A8D84",
      borderRadius: 14,
      borderWidth: 1.25,
      flexDirection: "row",
      gap: 11,
      minHeight: 56,
      paddingLeft: 15,
      paddingRight: 9,
    },
    fieldFocused: {
      borderColor: DEEP_TERRACOTTA,
      borderWidth: 2,
      paddingLeft: 14.25,
      paddingRight: 8.25,
    },
    fieldError: {
      backgroundColor: "#FFF8F5",
      borderColor: theme.error,
    },
    fieldDisabled: {
      backgroundColor: "#EFEAE5",
      borderColor: theme.border,
      opacity: 0.65,
    },
    input: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.body,
      fontSize: 15,
      minHeight: 53,
      paddingVertical: 0,
    },
    codeInput: {
      fontFamily: theme.font.semibold,
      fontSize: 21,
      letterSpacing: 8,
    },
    eye: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    eyePressed: {
      opacity: 0.55,
    },
    primary: {
      alignItems: "center",
      backgroundColor: DEEP_TERRACOTTA,
      borderRadius: 15,
      height: 56,
      justifyContent: "center",
      marginTop: 4,
    },
    primaryPressed: {
      backgroundColor: "#8F3C29",
      transform: [{ scale: 0.99 }],
    },
    primaryText: {
      color: "#FFFFFF",
      fontFamily: theme.font.bold,
      fontSize: 15,
    },
    controlDisabled: {
      backgroundColor: "#C9A99B",
      opacity: 0.72,
    },
    socialSection: {
      marginTop: 14,
    },
    dividerRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 14,
      marginBottom: 16,
    },
    divider: {
      backgroundColor: "#D8CEC7",
      flex: 1,
      height: StyleSheet.hairlineWidth,
    },
    dividerText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 13,
    },
    socialButton: {
      alignItems: "center",
      backgroundColor: "#F7F3F0",
      borderColor: "#E3DAD3",
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: "row",
      gap: 12,
      height: 54,
      justifyContent: "center",
      marginBottom: 10,
    },
    googleButton: {
      backgroundColor: "#FFFFFF",
      borderColor: "#D7CEC7",
    },
    socialButtonPressed: {
      backgroundColor: "#EEE7E1",
      transform: [{ scale: 0.99 }],
    },
    socialButtonDisabled: {
      opacity: 0.46,
    },
    socialButtonText: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14,
    },
    googleMark: {
      height: 22,
      position: "relative",
      width: 22,
    },
    googleArc: {
      borderRadius: 11,
      height: 22,
      left: 0,
      position: "absolute",
      top: 0,
      width: 22,
    },
    googleArcBlue: {
      borderColor: "#4285F4",
      borderRightColor: "transparent",
      borderWidth: 4,
      transform: [{ rotate: "-35deg" }],
    },
    googleArcRed: {
      borderColor: "transparent",
      borderRightColor: "#EA4335",
      borderTopColor: "#EA4335",
      borderWidth: 4,
      transform: [{ rotate: "-35deg" }],
    },
    googleArcYellow: {
      borderBottomColor: "#FBBC05",
      borderColor: "transparent",
      borderLeftColor: "#FBBC05",
      borderWidth: 4,
      transform: [{ rotate: "-35deg" }],
    },
    googleArcGreen: {
      borderBottomColor: "#34A853",
      borderColor: "transparent",
      borderRightColor: "#34A853",
      borderWidth: 4,
      transform: [{ rotate: "-35deg" }],
    },
    googleMarkCutout: {
      backgroundColor: "#FFFFFF",
      borderRadius: 7,
      height: 14,
      left: 4,
      position: "absolute",
      top: 4,
      width: 14,
    },
    googleMarkGap: {
      backgroundColor: "#FFFFFF",
      height: 8,
      position: "absolute",
      right: -1,
      top: 4,
      width: 8,
    },
    googleMarkBar: {
      backgroundColor: "#4285F4",
      height: 4,
      position: "absolute",
      right: 0,
      top: 9,
      width: 10,
    },
    socialHelp: {
      color: theme.textSubtle,
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 1,
      textAlign: "center",
    },
    error: {
      alignItems: "flex-start",
      backgroundColor: "#FFF1EC",
      borderLeftColor: DEEP_TERRACOTTA,
      borderLeftWidth: 3,
      flexDirection: "row",
      gap: 8,
      marginBottom: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    errorText: {
      color: theme.deepBrand,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
    },
    notice: {
      alignItems: "flex-start",
      backgroundColor: "#F6E8DF",
      borderLeftColor: theme.clay,
      borderLeftWidth: 3,
      flexDirection: "row",
      gap: 8,
      marginBottom: 16,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    noticeText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
    },
    link: {
      color: DEEP_TERRACOTTA,
      fontFamily: theme.font.semibold,
      fontSize: 13.5,
    },
    linkTarget: {
      alignItems: "center",
      alignSelf: "flex-start",
      justifyContent: "center",
      minHeight: 44,
      minWidth: 44,
    },
    linkPressed: {
      opacity: 0.58,
    },
    linkDisabled: {
      opacity: 0.42,
    },
  });
const styles = createStyles(theme);
