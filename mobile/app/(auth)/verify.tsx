import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { AuthField, AuthShell, FormError, PrimaryButton, TextLink } from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const { beginSession } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  async function verify() {
    setLoading(true); setError(""); setNotice("");
    try {
      const session = await authApi.verify(email, code);
      await beginSession(session);
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not verify that code.");
    } finally { setLoading(false); }
  }

  async function resend() {
    setError(""); setNotice("");
    try {
      await authApi.resend(email);
      setSeconds(60);
      setNotice("If the account is awaiting verification, a fresh code is on its way.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not resend the code.");
    }
  }

  return (
    <AuthShell subtitle={`If ${email || "this address"} can be registered, a six-digit code is on its way. It expires in 10 minutes and can only be used once.`} title="Check your email">
      <AuthField autoComplete="one-time-code" icon="keypad-outline" keyboardType="number-pad" label="Verification code" maxLength={6} onChangeText={(value) => setCode(value.replace(/\D/g, ""))} placeholder="000000" value={code} />
      {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
      <FormError message={error} />
      <PrimaryButton disabled={code.length !== 6 || !email} loading={loading} onPress={() => void verify()}>Verify and continue</PrimaryButton>
      <View style={styles.resend}>
        <Text style={styles.resendText}>{seconds > 0 ? `You can request another code in ${seconds}s` : "Didn’t receive the email?"}</Text>
        {seconds === 0 ? <TextLink onPress={() => void resend()}>Send another code</TextLink> : null}
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  notice: { backgroundColor: theme.surfaceMuted, borderRadius: 13, marginBottom: 14, padding: 12 },
  noticeText: { color: theme.statusPositive, fontFamily: theme.font.medium, fontSize: 12.5 },
  resend: { alignItems: "center", gap: 6, marginTop: 22 },
  resendText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5 },
});
