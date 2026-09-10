import * as Linking from "expo-linking";
import { useState } from "react";
import { View } from "react-native";

import { AuthScreen, FormField, InlineNotice, PrimaryButton, authStyles } from "@/src/components/auth-ui";
import { readableAuthError, supabase } from "@/src/lib/supabase";

export default function RecoverScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recover() {
    setError(null);
    setMessage(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email connected to your account.");
    if (!supabase) return setMessage("Preview complete. A live project will send the recovery email here.");
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: Linking.createURL("/login"),
    });
    setLoading(false);
    if (resetError) return setError(readableAuthError(resetError));
    setMessage("If the account exists, a secure recovery link is on its way.");
  }

  return (
    <AuthScreen eyebrow="Account recovery" title="Reset without the panic." description="We will send a secure recovery link. For privacy, the response is the same whether an account exists or not.">
      <View style={authStyles.form}>
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
        <FormField autoComplete="email" icon="mail-outline" keyboardType="email-address" label="Email address" onChangeText={setEmail} placeholder="you@example.com" value={email} />
        <PrimaryButton loading={loading} onPress={() => void recover()}>Send recovery link</PrimaryButton>
      </View>
    </AuthScreen>
  );
}
