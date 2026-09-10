import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { AuthScreen, FormField, FormMessage, PrimaryButton } from "@/src/components/auth-ui";
import { supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const email = Array.isArray(params.email) ? params.email[0] ?? "" : params.email ?? "";
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"error" | "success">("error");
  const [seconds, setSeconds] = useState(45);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  async function confirm() {
    setMessage("");
    setTone("error");
    if (!/^\d{6}$/.test(token)) return setMessage("Enter the six-digit code from your email.");
    if (!email) return setMessage("Your email address is missing. Go back and request a new code.");
    if (!supabase) return setMessage("Email verification is waiting for the preview environment connection.");

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
    setLoading(false);
    if (error) return setMessage(error.message);
    router.replace("/onboarding");
  }

  async function resend() {
    if (!supabase || !email || seconds > 0) return;
    setLoading(true);
    const { error } = await supabase.auth.resend({ email, type: "signup" });
    setLoading(false);
    if (error) {
      setTone("error");
      setMessage(error.message);
      return;
    }
    setTone("success");
    setMessage("A new code is on its way.");
    setSeconds(45);
  }

  return (
    <AuthScreen body={`We sent a six-digit code to ${email || "your email"}. It expires in 10 minutes.`} title="Confirm your email">
      {message ? <FormMessage tone={tone}>{message}</FormMessage> : null}
      <FormField
        autoComplete="one-time-code"
        keyboardType="number-pad"
        label="Verification code"
        maxLength={6}
        onChangeText={(value) => setToken(value.replace(/\D/g, ""))}
        placeholder="000000"
        returnKeyType="done"
        style={styles.codeInput}
        textContentType="oneTimeCode"
        value={token}
      />
      <PrimaryButton disabled={token.length !== 6} loading={loading} onPress={() => void confirm()}>Confirm email</PrimaryButton>
      <Pressable accessibilityRole="button" disabled={seconds > 0 || loading} onPress={() => void resend()} style={styles.resend}>
        <Text style={[styles.resendText, seconds > 0 && styles.resendDisabled]}>{seconds > 0 ? `Send another code in ${seconds}s` : "Send another code"}</Text>
      </Pressable>
      <Text style={styles.help}>Check Spam or Promotions if the email is not in your inbox.</Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  codeInput: { fontFamily: theme.font.displayStrong, fontSize: 24, letterSpacing: 12, textAlign: "center" },
  resend: { alignItems: "center", justifyContent: "center", minHeight: 50, marginTop: 5 },
  resendText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5 },
  resendDisabled: { color: theme.textSubtle },
  help: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, textAlign: "center" },
});
