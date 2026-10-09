import { KeyboardScrollView as ScrollView } from '@/src/components/keyboard-viewport';
import { InlineLoading } from "@/src/components/skeleton";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { analyticsScreenName, trackAuthAction, trackUiInteraction } from "@/src/lib/analytics";
import { useAuth } from "@/src/auth/auth-context";
import {
  beginSocialSignIn,
  socialConfiguration,
  type SocialProvider,
} from "@/src/lib/social-auth";

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
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node=document.createElement("style");
    node.textContent=`input[data-testid="kampusone-auth-field"]:autofill, input[data-testid="kampusone-auth-field"]:-webkit-autofill { -webkit-box-shadow: 0 0 0 1000px ${theme.surface} inset; box-shadow: 0 0 0 1000px ${theme.surface} inset; -webkit-text-fill-color: ${theme.text}; caret-color: ${theme.text}; }`;
    document.head.appendChild(node);
    return () => node.remove();
  }, [theme.surface,theme.text]);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.safe}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          style={{flex:1}}
          contentContainerStyle={[styles.content,{paddingBottom:Math.max(32,insets.bottom+16)}]}
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
                onPress={() => {
                  trackUiInteraction("navigate_back", {
                    screen: analyticsScreenName(pathname),
                    component: "auth_header",
                  });
                  (onBack ?? (() => router.back()))();
                }}
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
        <View pointerEvents="none" style={styles.leadingIcon}><Ionicons
          color={focused ? DEEP_TERRACOTTA : theme.clay}
          name={icon}
          size={20}
        /></View>
        <TextInput
          {...props}
          testID="kampusone-auth-field"
          underlineColorAndroid="transparent"
          importantForAutofill="yes"
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
          placeholderTextColor={theme.textMuted}
          secureTextEntry={secureTextEntry && !revealed}
          selectionColor={DEEP_TERRACOTTA}
          style={[styles.input,secureTextEntry&&{paddingRight:54}, code && styles.codeInput, style]}
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
  analyticsAction = "primary_press",
}: {
  children: ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  analyticsAction?: string;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const pathname = usePathname();

  const buttonLabel = typeof children === "string" ? children : "Continue";
  return (
    <Pressable
      accessibilityLabel={loading ? `${buttonLabel}, in progress` : buttonLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        trackUiInteraction(analyticsAction, {
          screen: analyticsScreenName(pathname),
          component: "auth_primary_button",
        });
        onPress();
      }}
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
  // Original approved Google asset, bundled for offline rendering; keep its ratio.
  // https://developers.google.com/static/identity/images/g-logo.png
  return <Image accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" source={require("@/assets/auth/google-g.png")} resizeMode="contain" style={{width:20,height:20,flexShrink:0}} />;
}

export function SocialAuthButtons() {
  const { theme, styles } = useThemeStyles(createStyles);
  const pathname = usePathname();
  const { beginSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [socialError,setSocialError] = useState("");
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
    const screen = analyticsScreenName(pathname);
    trackAuthAction(`${provider}_sign_in_started`, {
      screen,
      component: "social_auth_button",
    });
    setPending(true);
    setSocialError("");
    try {
      const session = await beginSocialSignIn(provider);
      if (session) {
        await beginSession(session);
        trackAuthAction(`${provider}_sign_in_completed`, {
          screen,
          component: "social_auth_button",
        });
        router.replace("/");
      }
    } catch (e) {
      trackAuthAction(`${provider}_sign_in_failed`, {
        screen,
        component: "social_auth_button",
        errorCode: "SIGN_IN_FAILED",
      });
      setSocialError(e instanceof Error ? e.message : "Sign-in could not be completed.");
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

      <FormError message={socialError} />
      {pending ? (
        <Text style={styles.socialHelp} accessibilityLiveRegion="polite">
          Opening sign in
        </Text>
      ) : null}
    </View>
  );
}

export function FormError({ message }: { message: string }) {
  const {theme,styles}=useThemeStyles(createStyles);
  if(!message)return null;
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}><Ionicons name="alert-circle-outline" size={20} color={theme.error}/><Text style={styles.errorText}>{message}</Text></View>;
}

export function FormNotice({ children }: { children: ReactNode }) {
  const {theme,styles}=useThemeStyles(createStyles);
  return <View accessibilityLiveRegion="polite" style={styles.notice}><Ionicons name="information-circle-outline" size={20} color={theme.clay}/><Text style={styles.noticeText}>{children}</Text></View>;
}

export function TextLink({
  children,
  onPress,
  disabled = false,
  analyticsAction = "text_link_press",
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  analyticsAction?: string;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const pathname = usePathname();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        trackUiInteraction(analyticsAction, {
          screen: analyticsScreenName(pathname),
          component: "auth_text_link",
        });
        onPress();
      }}
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
      flexGrow: 1,
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
      color: theme.accentText,
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
      backgroundColor: theme.surface,
      borderColor: "#9A8D84",
      borderRadius: 14,
      borderWidth: 1.25,
      minHeight: 56,
      position: "relative",
      overflow: "hidden",
    },
    fieldFocused: {
      borderColor: DEEP_TERRACOTTA,
      borderWidth: 2,

    },
    fieldError: {
      backgroundColor: theme.surfaceSoft,
      borderColor: theme.error,
    },
    fieldDisabled: {
      backgroundColor: theme.surfaceSoft,
      borderColor: theme.border,
      opacity: 0.65,
    },
    leadingIcon: {position:"absolute",left:15,top:0,bottom:0,justifyContent:"center",zIndex:1},
    input: {
      color: theme.text,
      width: "100%",
      fontFamily: theme.font.body,
      fontSize: 15,
      minHeight: 53,
      paddingLeft: 46,
      paddingRight: 14,
      paddingVertical: 0,
      backgroundColor:"transparent",
    },
    codeInput: {
      fontFamily: theme.font.semibold,
      fontSize: 21,
      letterSpacing: 8,
    },
    eye: {
      position:"absolute",
      right:6,
      top:4,
      zIndex:1,
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
      backgroundColor: theme.surfaceSoft,
      borderColor: theme.border,
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
      backgroundColor: theme.surfaceSoft,
      borderLeftColor: DEEP_TERRACOTTA,
      borderLeftWidth: 3,
      flexDirection: "row",
      gap: 8,
      marginBottom: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    errorText: {
      color: theme.accentText,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 12.5,
      lineHeight: 18,
    },
    notice: {
      alignItems: "flex-start",
      backgroundColor: theme.surfaceSoft,
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
      color: theme.accentText,
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
