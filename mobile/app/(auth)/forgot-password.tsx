import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const validEmail = emailPattern.test(email.trim());
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;

  async function send() {
    if (!validEmail) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      await authApi.forgotPassword(email.trim());
      setStep("reset");
      setSeconds(60);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not send the reset email.");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!validEmail || resending || seconds > 0) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      await authApi.forgotPassword(email.trim());
      setSeconds(60);
      setNotice("A fresh reset code is on its way if an account uses this email.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not send another reset code.");
    } finally {
      setResending(false);
    }
  }

  async function reset() {
    if (code.length !== 6) {
      setError("Enter the six-digit reset code.");
      return;
    }
    if (password.length < 10) {
      setError("Use at least 10 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      await authApi.resetPassword(email.trim(), code, password);
      router.replace("/(auth)/sign-in");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not reset the password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow={`Step ${step === "email" ? "1" : "2"} of 2`}
      onBack={step === "reset" ? () => setStep("email") : undefined}
      subtitle={
        step === "email"
          ? "Enter the email connected to your account and we’ll send a one-time reset code."
          : "Enter the code from your email, then choose a new password."
      }
      title={step === "email" ? "Reset your password" : "Choose a new password"}
    >
      <View accessibilityLabel={`Password reset step ${step === "email" ? "1" : "2"} of 2`} style={styles.progress}>
        <View style={styles.progressActive} />
        <View style={step === "reset" ? styles.progressActive : styles.progressInactive} />
      </View>

      {step === "email" ? (
        <AuthField
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          icon="mail-outline"
          keyboardType="email-address"
          label="Email address"
          onChangeText={(value) => {
            setEmail(value);
            setError("");
          }}
          onSubmitEditing={() => void send()}
          placeholder="Enter your email"
          returnKeyType="send"
          textContentType="emailAddress"
          value={email}
        />
      ) : (
        <>
          <FormNotice>
            Reset instructions were requested for <Text selectable style={styles.email}>{email}</Text>. The code expires in 10 minutes.
          </FormNotice>
          <AuthField
            autoComplete="one-time-code"
            code
            icon="keypad-outline"
            inputMode="numeric"
            keyboardType="number-pad"
            label="Reset code"
            maxLength={6}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, ""));
              setError("");
            }}
            placeholder="000000"
            selectTextOnFocus
            textContentType="oneTimeCode"
            value={code}
          />
          <AuthField
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect={false}
            icon="lock-closed-outline"
            label="New password"
            onChangeText={setPassword}
            placeholder="At least 10 characters"
            secureTextEntry
            textContentType="newPassword"
            value={password}
          />
          <AuthField
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect={false}
            error={Boolean(confirmPassword) && !passwordsMatch}
            icon="lock-closed-outline"
            label="Confirm new password"
            onChangeText={setConfirmPassword}
            onSubmitEditing={() => void reset()}
            placeholder="Enter it again"
            returnKeyType="go"
            secureTextEntry
            textContentType="newPassword"
            value={confirmPassword}
          />
          <View style={styles.resendRow}>
            <Text accessibilityLiveRegion="polite" style={styles.resendText}>
              {seconds > 0 ? `Request another code in ${seconds}s` : "Code missing or expired?"}
            </Text>
            {seconds === 0 ? (
              <TextLink disabled={resending} onPress={() => void resend()}>
                {resending ? "Sending…" : "Send again"}
              </TextLink>
            ) : null}
          </View>
        </>
      )}

      {notice ? <FormNotice>{notice}</FormNotice> : null}
      <FormError message={error} />
      <PrimaryButton
        disabled={
          step === "email"
            ? !validEmail
            : code.length !== 6 || password.length < 10 || !passwordsMatch
        }
        loading={loading}
        onPress={() => void (step === "email" ? send() : reset())}
      >
        {step === "email" ? "Send reset code" : "Update password"}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  progress: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 30,
  },
  progressActive: {
    backgroundColor: "#A8462E",
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  progressInactive: {
    backgroundColor: theme.border,
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  email: {
    color: theme.text,
    fontFamily: theme.font.semibold,
  },
  resendRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
    marginBottom: 18,
    marginTop: -4,
  },
  resendText: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 12.5,
  },
});
