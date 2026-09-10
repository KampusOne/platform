import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { AuthScreen, FormField, InlineNotice, PrimaryButton, authStyles } from "@/src/components/auth-ui";
import { readableAuthError, supabase } from "@/src/lib/supabase";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string; preview?: string }>();
  const email = params.email ?? "your email";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setError(null);
    if (params.preview === "1" || !supabase) {
      router.replace("/onboarding");
      return;
    }
    if (!/^\d{6,8}$/.test(code.trim())) return setError("Enter the verification code from your email.");
    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "signup" });
    setLoading(false);
    if (verifyError) return setError(readableAuthError(verifyError));
    router.replace("/onboarding");
  }

  async function resend() {
    setMessage(null);
    setError(null);
    if (!supabase) return setMessage("Preview code ready—enter any six digits.");
    const { error: resendError } = await supabase.auth.resend({ email, type: "signup" });
    if (resendError) return setError(readableAuthError(resendError));
    setMessage("A fresh code is on its way.");
  }

  return (
    <AuthScreen eyebrow="Email verification" title="Check your inbox." description={`We sent a short verification code to ${email}.`}>
      <View style={authStyles.form}>
        {params.preview === "1" ? <InlineNotice>Preview mode: enter any six digits to continue.</InlineNotice> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
        <FormField
          autoComplete="one-time-code"
          icon="keypad-outline"
          keyboardType="number-pad"
          label="Verification code"
          maxLength={8}
          onChangeText={setCode}
          placeholder="000000"
          value={code}
        />
        <PrimaryButton loading={loading} onPress={() => void verify()}>Verify email</PrimaryButton>
        <Text onPress={() => void resend()} style={[authStyles.link, authStyles.linkCenter]}>Send another code</Text>
      </View>
    </AuthScreen>
  );
}
