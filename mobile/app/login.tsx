import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AuthScreen, FormField, InlineNotice, PrimaryButton, authStyles } from "@/src/components/auth-ui";
import { isSupabaseConfigured, readableAuthError, supabase } from "@/src/lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    if (!email.trim() || !password) return setError("Enter your email and password.");
    if (!supabase) {
      router.replace("/(tabs)");
      return;
    }
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (signInError) return setError(readableAuthError(signInError));
    router.replace("/(tabs)");
  }

  return (
    <AuthScreen eyebrow="Welcome back" title="Pick up where you left off." description="Your timetable, saved GPA work and campus updates are waiting.">
      <View style={authStyles.form}>
        {!isSupabaseConfigured ? <InlineNotice>Preview mode: any email and password opens the sample Today screen.</InlineNotice> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <FormField autoComplete="email" icon="mail-outline" keyboardType="email-address" label="Email address" onChangeText={setEmail} placeholder="you@example.com" value={email} />
        <FormField autoComplete="current-password" icon="lock-closed-outline" label="Password" onChangeText={setPassword} placeholder="Your password" secureTextEntry value={password} />
        <View style={authStyles.rowBetween}>
          <View />
          <Pressable accessibilityRole="link" onPress={() => router.push("/recover")}><Text style={authStyles.link}>Forgot password?</Text></Pressable>
        </View>
        <PrimaryButton loading={loading} onPress={() => void signIn()}>Sign in</PrimaryButton>
      </View>
      <View style={authStyles.footer}>
        <Text style={authStyles.secondaryCopy}>New to KampusOne? </Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace("/create-account")}><Text style={authStyles.link}>Create account</Text></Pressable>
      </View>
    </AuthScreen>
  );
}
