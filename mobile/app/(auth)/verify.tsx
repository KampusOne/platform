import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import {
  AuthField,
  AuthShell,
  FormError,
  FormNotice,
  PrimaryButton,
  TextLink,
} from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

const DEEP_TERRACOTTA = "#A8462E";

export default function VerifyEmailScreen() {
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
      setError("Return to Create account and enter your email again.");
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
      setError(caught instanceof ApiError ? caught.message : "We could not verify that code.");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!email || resending) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      await authApi.resend(email);
      setSeconds(60);
      setNotice("A fresh code is on its way if this account is still waiting for verification.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not resend the code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Email verification"
      subtitle="Enter the six-digit code we sent. It expires in 10 minutes and works only once."
      title="Check your email"
    >
      <View style={styles.emailRow}>
        <Ionicons color={DEEP_TERRACOTTA} name="mail-outline" size={19} />
        <Text selectable style={styles.email}>
          {email || "No email address supplied"}
        </Text>
      </View>

      <AuthField
        autoComplete="one-time-code"
        code
        icon="keypad-outline"
        inputMode="numeric"
        keyboardType="number-pad"
        label="Verification code"
        maxLength={6}
        onChangeText={(value) => {
          setCode(value.replace(/\D/g, ""));
          setError("");
        }}
        onSubmitEditing={() => void verify()}
        placeholder="000000"
        returnKeyType="done"
        selectTextOnFocus
        textContentType="oneTimeCode"
        value={code}
      />

      <Text style={styles.copyHelp}>You can paste the code here or press and hold to copy it.</Text>
      {notice ? <FormNotice>{notice}</FormNotice> : null}
      <FormError message={error} />
      <PrimaryButton disabled={code.length !== 6 || !email} loading={loading} onPress={() => void verify()}>
        Verify and continue
      </PrimaryButton>

      <View style={styles.resend}>
        <Text accessibilityLiveRegion="polite" style={styles.resendText}>
          {seconds > 0 ? `Request another code in ${seconds}s` : "Didn’t receive the email?"}
        </Text>
        {seconds === 0 ? (
          <TextLink disabled={resending || !email} onPress={() => void resend()}>
            {resending ? "Sending…" : "Send another code"}
          </TextLink>
        ) : null}
      </View>

      {!email ? (
        <View style={styles.missingEmail}>
          <TextLink onPress={() => router.replace("/(auth)/sign-up")}>Return to Create account</TextLink>
        </View>
      ) : null}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  emailRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  email: {
    color: theme.text,
    flex: 1,
    fontFamily: theme.font.semibold,
    fontSize: 14,
  },
  copyHelp: {
    color: theme.textSubtle,
    fontFamily: theme.font.body,
    fontSize: 11.5,
    lineHeight: 17,
    marginBottom: 18,
    marginTop: -6,
  },
  resend: {
    alignItems: "center",
    gap: 7,
    marginTop: 24,
  },
  resendText: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 12.5,
  },
  missingEmail: {
    alignItems: "center",
    marginTop: 18,
  },
});
