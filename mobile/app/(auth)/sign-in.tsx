import { router } from "expo-router";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { AuthField, AuthShell, FormError, PrimaryButton, TextLink } from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

export default function SignInScreen() {
  const { beginSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true); setError("");
    try {
      const session = await authApi.login(email, password);
      await beginSession(session);
      router.replace("/");
    } catch (caught) {
      if (caught instanceof ApiError && caught.details?.verificationRequired) {
        router.replace({ pathname: "/(auth)/verify", params: { email: email.trim().toLowerCase() } });
        return;
      }
      setError(caught instanceof ApiError ? caught.message : "We could not sign you in.");
    } finally { setLoading(false); }
  }

  return (
    <AuthShell subtitle="Your timetable, verified campus updates and student services are waiting." title="Welcome back">
      <Image resizeMode="cover" source={require("@/assets/brand-scenes/campus-life.png")} style={styles.photo} />
      <AuthField autoCapitalize="none" autoComplete="email" icon="mail-outline" keyboardType="email-address" label="Email address" onChangeText={setEmail} value={email} />
      <AuthField autoCapitalize="none" autoComplete="current-password" icon="lock-closed-outline" label="Password" onChangeText={setPassword} secureTextEntry value={password} />
      <View style={styles.forgot}><TextLink onPress={() => router.push("/(auth)/forgot-password")}>Forgot password?</TextLink></View>
      <FormError message={error} />
      <PrimaryButton disabled={!email || !password} loading={loading} onPress={() => void submit()}>Sign in</PrimaryButton>
      <View style={styles.footer}><Text style={styles.footerText}>New to KampusOne?</Text><TextLink onPress={() => router.replace("/(auth)/sign-up")}>Create account</TextLink></View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  photo: { borderRadius: 22, height: 150, marginBottom: 22, width: "100%" },
  forgot: { alignItems: "flex-end", marginBottom: 14, marginTop: -5 },
  footer: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "center", marginTop: 22 },
  footerText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5 },
});
