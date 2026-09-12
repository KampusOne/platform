import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import {
  AuthField,
  AuthShell,
  FormError,
  FormNotice,
  PrimaryButton,
  SocialAuthButtons,
  TextLink,
} from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const params = useLocalSearchParams<{ email?: string; reason?: string }>();
  const { beginSession } = useAuth();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const validEmail = emailPattern.test(email.trim());

  async function submit() {
    if (!validEmail) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const session = await authApi.login(email.trim(), password);
      await beginSession(session);
      router.replace("/");
    } catch (caught) {
      if (caught instanceof ApiError && caught.details?.verificationRequired) {
        router.replace({ pathname: "/(auth)/verify", params: { email: email.trim().toLowerCase() } });
        return;
      }
      setError(caught instanceof ApiError ? caught.message : "We could not sign you in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      subtitle="Your timetable, verified campus updates and student services are waiting."
      title="Welcome back"
    >
      <Image
        accessible={false}
        accessibilityElementsHidden
        accessibilityIgnoresInvertColors
        importantForAccessibility="no-hide-descendants"
        resizeMode="contain"
        source={require("@/assets/illustrations/auth-study-v2.png")}
        style={styles.illustration}
      />

      <View style={styles.form}>
        {params.reason === "already_registered" ? <FormNotice>This email already has an account. Sign in instead.</FormNotice> : null}
        <AuthField
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          icon="mail-outline"
          keyboardType="email-address"
          label="Email address"
          onChangeText={setEmail}
          placeholder="Enter your email"
          returnKeyType="next"
          textContentType="emailAddress"
          value={email}
        />
        <AuthField
          autoCapitalize="none"
          autoComplete="current-password"
          autoCorrect={false}
          icon="lock-closed-outline"
          label="Password"
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          placeholder="Enter your password"
          returnKeyType="go"
          secureTextEntry
          textContentType="password"
          value={password}
        />
        <View style={styles.forgot}>
          <TextLink onPress={() => router.push("/(auth)/forgot-password")}>Forgot password?</TextLink>
        </View>
        <FormError message={error} />
        <PrimaryButton disabled={!validEmail || !password} loading={loading} onPress={() => void submit()}>
          Sign in
        </PrimaryButton>
      </View>

      <SocialAuthButtons />

      <View style={styles.footer}>
        <Text style={styles.footerText}>New here?</Text>
        <TextLink onPress={() => router.replace("/(auth)/sign-up")}>Create account</TextLink>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  illustration: {
    alignSelf: "center",
    height: 218,
    marginBottom: 22,
    marginTop: -12,
    width: "100%",
  },
  form: {
    width: "100%",
  },
  forgot: {
    alignItems: "flex-end",
    marginBottom: 17,
    marginTop: -7,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    justifyContent: "center",
    marginTop: 24,
  },
  footerText: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 13.5,
  },
});
