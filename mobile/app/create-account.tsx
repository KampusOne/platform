import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AuthScreen, FormField, InlineNotice, PrimaryButton, authStyles } from "@/src/components/auth-ui";
import { isSupabaseConfigured, readableAuthError, supabase } from "@/src/lib/supabase";

export default function CreateAccountScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createAccount() {
    setError(null);
    if (name.trim().length < 2) return setError("Enter the name you use for school records.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");

    if (!supabase) {
      router.push({ pathname: "/verify-email", params: { email: email.trim(), preview: "1" } });
      return;
    }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: Linking.createURL("/onboarding"),
      },
    });
    setLoading(false);
    if (signUpError) return setError(readableAuthError(signUpError));
    router.push({ pathname: "/verify-email", params: { email: email.trim().toLowerCase() } });
  }

  return (
    <AuthScreen
      eyebrow="Student account"
      title="Let’s set up your campus day."
      description="Use an email you can access. We will verify it before collecting your school details."
    >
      <View style={authStyles.form}>
        {!isSupabaseConfigured ? <InlineNotice>Preview mode is active. The flow works, but no account will be stored yet.</InlineNotice> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <FormField autoCapitalize="words" icon="person-outline" label="Full name" onChangeText={setName} placeholder="e.g. Gideon Igiehon" value={name} />
        <FormField autoComplete="email" icon="mail-outline" keyboardType="email-address" label="Email address" onChangeText={setEmail} placeholder="you@example.com" value={email} />
        <FormField autoComplete="new-password" icon="lock-closed-outline" label="Password" onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry value={password} />
        <PrimaryButton loading={loading} onPress={() => void createAccount()}>Create account</PrimaryButton>
      </View>
      <View style={authStyles.footer}>
        <Text style={authStyles.secondaryCopy}>Already registered? </Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace("/login")}><Text style={authStyles.link}>Sign in</Text></Pressable>
      </View>
    </AuthScreen>
  );
}
