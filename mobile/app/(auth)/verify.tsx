import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import {
  AuthShell,
  FormError,
  FormNotice,
  PrimaryButton,
  TextLink,
} from "@/src/components/auth-ui";
import { OtpCodeInput } from "@/src/components/otp-code-input";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

export default function VerifyEmailScreen() {
  const { theme, styles } = useThemeStyles(createStyles);

  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const { beginSession } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  async function verify() {
    if (!email) {
      setError("Enter your email again.");
      return;
    }
    if (code.length !== 6) {
      setError("Enter the six-digit code.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const session = await authApi.verify(email, code);
      await beginSession(session);
      router.replace("/");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not verify that code.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!email || resending || seconds > 0) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      await authApi.resend(email);
      setCode("");
      setSeconds(60);
      setNotice("New code sent.");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not resend the code.",
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Verify email"
      subtitle={email ? `Sent to ${email}.` : "Enter the code sent to your email."}
      title="Enter your code"
    >
      <OtpCodeInput
        autoFocus
        error={Boolean(error)}
        label="Verification code"
        onChangeText={(value) => {
          setCode(value);
          setError("");
        }}
        value={code}
      />

      {notice ? <FormNotice>{notice}</FormNotice> : null}
      <FormError message={error} />
      <PrimaryButton
        disabled={code.length !== 6 || !email}
        loading={loading}
        onPress={() => void verify()}
      >
        Continue
      </PrimaryButton>

      <View style={styles.resend}>
        <Text accessibilityLiveRegion="polite" style={styles.resendText}>
          {seconds > 0 ? `Resend in ${seconds}s` : "Didn’t get it?"}
        </Text>
        {seconds === 0 ? (
          <TextLink
            disabled={resending || !email}
            onPress={() => void resend()}
          >
            {resending ? "Sending…" : "Resend"}
          </TextLink>
        ) : null}
      </View>

      {!email ? (
        <View style={styles.missingEmail}>
          <TextLink onPress={() => router.replace("/(auth)/sign-up")}>
            Back to create account
          </TextLink>
        </View>
      ) : null}
    </AuthShell>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    resend: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      justifyContent: "center",
      marginTop: 18,
    },
    resendText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
    },
    missingEmail: {
      alignItems: "center",
      marginTop: 14,
    },
  });
const styles = createStyles(theme);
