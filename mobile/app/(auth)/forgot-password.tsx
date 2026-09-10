import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthField, AuthShell, FormError, PrimaryButton } from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true); setError("");
    try { await authApi.forgotPassword(email); setStep("reset"); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "We could not send the reset email."); }
    finally { setLoading(false); }
  }

  async function reset() {
    setLoading(true); setError("");
    try { await authApi.resetPassword(email, code, password); router.replace("/(auth)/sign-in"); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "We could not reset the password."); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell subtitle={step === "email" ? "We will email a one-time reset code if the account exists." : `Enter the code sent to ${email}.`} title="Reset your password">
      {step === "email" ? (
        <AuthField autoCapitalize="none" icon="mail-outline" keyboardType="email-address" label="Email address" onChangeText={setEmail} value={email} />
      ) : (
        <>
          <View style={styles.sent}><Text style={styles.sentText}>Reset email sent. The code expires in 10 minutes.</Text></View>
          <AuthField icon="keypad-outline" keyboardType="number-pad" label="Reset code" maxLength={6} onChangeText={(value) => setCode(value.replace(/\D/g, ""))} value={code} />
          <AuthField autoCapitalize="none" icon="lock-closed-outline" label="New password" onChangeText={setPassword} secureTextEntry value={password} />
        </>
      )}
      <FormError message={error} />
      <PrimaryButton disabled={step === "email" ? !email : code.length !== 6 || password.length < 10} loading={loading} onPress={() => void (step === "email" ? send() : reset())}>{step === "email" ? "Send reset code" : "Update password"}</PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({ sent: { backgroundColor: theme.surfaceMuted, borderRadius: 14, marginBottom: 18, padding: 13 }, sentText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12.5 } });
