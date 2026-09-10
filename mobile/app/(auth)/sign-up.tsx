import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthField, AuthShell, FormError, PrimaryButton, TextLink } from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

export default function SignUpScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true); setError("");
    try {
      await authApi.register({ firstName, lastName, email, password });
      router.replace({ pathname: "/(auth)/verify", params: { email: email.trim().toLowerCase() } });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not create your account.");
    } finally { setLoading(false); }
  }

  return (
    <AuthShell subtitle="Use an email you can open now. We will send a real six-digit verification code." title="Create your account">
      <View style={styles.nameRow}>
        <View style={styles.nameField}><AuthField autoCapitalize="words" icon="person-outline" label="First name" onChangeText={setFirstName} value={firstName} /></View>
        <View style={styles.nameField}><AuthField autoCapitalize="words" icon="person-outline" label="Last name" onChangeText={setLastName} value={lastName} /></View>
      </View>
      <AuthField autoCapitalize="none" autoComplete="email" icon="mail-outline" keyboardType="email-address" label="Email address" onChangeText={setEmail} value={email} />
      <AuthField autoCapitalize="none" autoComplete="new-password" icon="lock-closed-outline" label="Password" onChangeText={setPassword} secureTextEntry value={password} />
      <Text style={styles.hint}>Use at least 10 characters. By continuing, you accept the Terms and Privacy Policy.</Text>
      <FormError message={error} />
      <PrimaryButton disabled={!firstName || !lastName || !email || password.length < 10} loading={loading} onPress={() => void submit()}>Create account</PrimaryButton>
      <View style={styles.footer}><Text style={styles.footerText}>Already registered?</Text><TextLink onPress={() => router.replace("/(auth)/sign-in")}>Sign in</TextLink></View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: "row", gap: 10 },
  nameField: { flex: 1 },
  hint: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginBottom: 16, marginTop: -5 },
  footer: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "center", marginTop: 22 },
  footerText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5 },
});
