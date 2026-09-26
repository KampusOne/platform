import { useThemeStyles, type Theme } from "@/src/lib/appearance";
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
import { OtpCodeInput } from "@/src/components/otp-code-input";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ResetStep = "email" | "code" | "password";

export default function ForgotPasswordScreen() {
  const { theme, styles } = useThemeStyles(createStyles);

  const [step, setStep] = useState<ResetStep>("email");
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
  const passwordsMatch =
    Boolean(confirmPassword) && password === confirmPassword;
  const stepNumber = step === "email" ? 1 : step === "code" ? 2 : 3;

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
      setCode("");
      setPassword("");
      setConfirmPassword("");
      setStep("code");
      setSeconds(60);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not send the reset code.",
      );
    } finally {
      setLoading(false);
    }
  }

  function checkCode() {
    if (code.length !== 6) {
      setError("Enter the six-digit code.");
      return;
    }

    setError("");
    setNotice("");
    setStep("password");
  }

  async function resend() {
    if (!validEmail || resending || seconds > 0) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      await authApi.forgotPassword(email.trim());
      setCode("");
      setSeconds(60);
      setNotice("New code sent.");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not send another code.",
      );
    } finally {
      setResending(false);
    }
  }

  async function reset() {
    if (password.length < 10) {
      setError("Use at least 10 characters.");
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
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not reset the password.",
      );
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    setError("");
    setNotice("");
    if (step === "password") {
      setStep("code");
      return;
    }
    if (step === "code") setStep("email");
  }

  const title =
    step === "email"
      ? "Reset your password"
      : step === "code"
        ? "Enter your code"
        : "New password";
  const subtitle =
    step === "email"
      ? "Enter your email to get a reset code."
      : step === "code"
        ? `Sent to ${email}.`
        : "Enter a new password.";

  return (
    <AuthShell
      eyebrow={`Step ${stepNumber} of 3`}
      onBack={step === "email" ? undefined : goBack}
      subtitle={subtitle}
      title={title}
    >
      <View
        accessibilityLabel={`Password reset step ${stepNumber} of 3`}
        style={styles.progress}
      >
        {[1, 2, 3].map((number) => (
          <View
            key={number}
            style={
              number <= stepNumber
                ? styles.progressActive
                : styles.progressInactive
            }
          />
        ))}
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
      ) : null}

      {step === "code" ? (
        <>
          <OtpCodeInput
            autoFocus
            error={Boolean(error)}
            label="Reset code"
            onChangeText={(value) => {
              setCode(value);
              setError("");
            }}
            value={code}
          />
          <View style={styles.resendRow}>
            <Text accessibilityLiveRegion="polite" style={styles.resendText}>
              {seconds > 0 ? `Resend in ${seconds}s` : "Didn’t get it?"}
            </Text>
            {seconds === 0 ? (
              <TextLink disabled={resending} onPress={() => void resend()}>
                {resending ? "Sending…" : "Resend"}
              </TextLink>
            ) : null}
          </View>
        </>
      ) : null}

      {step === "password" ? (
        <>
          <AuthField
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect={false}
            icon="lock-closed-outline"
            label="New password"
            onChangeText={(value) => {
              setPassword(value);
              setError("");
            }}
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
            label="Confirm password"
            onChangeText={(value) => {
              setConfirmPassword(value);
              setError("");
            }}
            onSubmitEditing={() => void reset()}
            placeholder="Enter it again"
            returnKeyType="go"
            secureTextEntry
            textContentType="newPassword"
            value={confirmPassword}
          />
        </>
      ) : null}

      {notice ? <FormNotice>{notice}</FormNotice> : null}
      <FormError message={error} />
      <PrimaryButton
        disabled={
          step === "email"
            ? !validEmail
            : step === "code"
              ? code.length !== 6
              : password.length < 10 || !passwordsMatch
        }
        loading={loading}
        onPress={() =>
          void (step === "email"
            ? send()
            : step === "code"
              ? checkCode()
              : reset())
        }
      >
        {step === "email"
          ? "Send reset code"
          : step === "code"
            ? "Continue"
            : "Update password"}
      </PrimaryButton>
    </AuthShell>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
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
    resendRow: {
      alignItems: "center",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      justifyContent: "flex-end",
      marginBottom: 18,
      marginTop: -6,
    },
    resendText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
    },
  });
const styles = createStyles(theme);
