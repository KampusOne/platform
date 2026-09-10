import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { AuthScreen, FormField, FormMessage, PrimaryButton, SecondaryButton } from "@/src/components/auth-ui";
import { supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn() {
    setMessage("");
    if (!email.trim() || !password) return setMessage("Enter your email and password.");
    if (!supabase) return setMessage("Login is waiting for the preview environment connection. You can explore the app preview below.");

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (error) return setMessage(error.message);
    router.replace("/today");
  }

  return (
    <AuthScreen body="Your student account works across the KampusOne app and the roles you are later approved for." title="Welcome back">
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}
      <FormField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" textContentType="emailAddress" value={email} />
      <FormField
        autoCapitalize="none"
        autoComplete="current-password"
        label="Password"
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry={!showPassword}
        textContentType="password"
        trailing={<Pressable accessibilityLabel={showPassword ? "Hide password" : "Show password"} hitSlop={10} onPress={() => setShowPassword((value) => !value)}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={theme.textSubtle} /></Pressable>}
        value={password}
      />
      <Pressable accessibilityRole="button" onPress={() => router.push("/forgot-password")} style={styles.forgot}><Text style={styles.forgotText}>Forgot password?</Text></Pressable>
      <PrimaryButton loading={loading} onPress={() => void signIn()}>Log in</PrimaryButton>
      <SecondaryButton onPress={() => router.push("/today")}>Explore preview</SecondaryButton>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/sign-up")} style={styles.create}><Text style={styles.createText}>New to KampusOne? <Text style={styles.createStrong}>Create account</Text></Text></Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: "flex-end", justifyContent: "center", minHeight: 39, marginBottom: 11, marginTop: -9 },
  forgotText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13 },
  create: { alignItems: "center", justifyContent: "center", minHeight: 54 },
  createText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5 },
  createStrong: { color: theme.brandPressed, fontFamily: theme.font.semibold },
});
