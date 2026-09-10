import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { AuthScreen, FormField, FormMessage, PrimaryButton, SecondaryButton } from "@/src/components/auth-ui";
import { supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  async function sendReset() {
    setMessage("");
    if (!email.includes("@")) return setMessage("Enter the email address on your account.");
    if (!supabase) return setMessage("Password recovery is waiting for the preview environment connection.");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: "kampusone://auth/reset" });
    setLoading(false);
    if (error) return setMessage(error.message);
    setSent(true);
  }

  return (
    <AuthScreen body="We’ll send a secure recovery link. For safety, old sessions can be revoked after you reset your password." title="Reset your password">
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}
      {sent ? (
        <>
          <FormMessage tone="success">If an account exists for {email}, a recovery email is on its way.</FormMessage>
          <Text style={styles.note}>Open the link on the phone where KampusOne is installed.</Text>
          <SecondaryButton onPress={() => router.replace("/sign-in")}>Back to login</SecondaryButton>
        </>
      ) : (
        <>
          <FormField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" textContentType="emailAddress" value={email} />
          <PrimaryButton loading={loading} onPress={() => void sendReset()}>Send recovery link</PrimaryButton>
        </>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  note: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 20, marginBottom: 18 },
});
