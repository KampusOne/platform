import { router } from "expo-router";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  AuthField,
  AuthShell,
  FormError,
  PrimaryButton,
  SocialAuthButtons,
  TextLink,
} from "@/src/components/auth-ui";
import { ApiError, authApi } from "@/src/lib/api";
import { theme } from "@/src/theme";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpScreen() {
  const { width } = useWindowDimensions();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validEmail = emailPattern.test(email.trim());
  const passwordLongEnough = password.length >= 10;
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;
  const compactNames = width < 370;
  const canSubmit = Boolean(firstName.trim() && lastName.trim() && validEmail && passwordLongEnough && passwordsMatch && acceptedTerms);

  async function submit() {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Enter your first and last name.");
      return;
    }
    if (!validEmail) {
      setError("Enter a valid email address.");
      return;
    }
    if (!passwordLongEnough) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }
    if (!acceptedTerms) {
      setError("Review and accept the Terms and Privacy Policy to continue.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await authApi.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        acceptedTerms: true,
      });
      if (result.status === "already_registered") {
        router.replace({ pathname: "/(auth)/sign-in", params: { email: result.email, reason: "already_registered" } });
        return;
      }
      router.replace({ pathname: "/(auth)/verify", params: { email: email.trim().toLowerCase() } });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We could not create your account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="Your campus in one place. Join a simpler, more prepared student life." title="Create account">
      <Image
        accessible={false}
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={require("@/assets/illustrations/auth-study-v2.png")}
        style={styles.illustration}
      />

      <View style={[styles.nameRow, compactNames && styles.nameRowCompact]}>
        <View style={styles.nameField}>
          <AuthField
            autoCapitalize="words"
            autoComplete="given-name"
            hideLabel
            icon="person-outline"
            label="First name"
            onChangeText={setFirstName}
            placeholder="First name"
            textContentType="givenName"
            value={firstName}
          />
        </View>
        <View style={styles.nameField}>
          <AuthField
            autoCapitalize="words"
            autoComplete="family-name"
            hideLabel
            icon="person-outline"
            label="Last name"
            onChangeText={setLastName}
            placeholder="Last name"
            textContentType="familyName"
            value={lastName}
          />
        </View>
      </View>
      <AuthField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        hideLabel
        icon="mail-outline"
        keyboardType="email-address"
        label="Email address"
        onChangeText={setEmail}
        placeholder="Email address"
        textContentType="emailAddress"
        value={email}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete="new-password"
        autoCorrect={false}
        hideLabel
        icon="lock-closed-outline"
        label="Password"
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        textContentType="newPassword"
        value={password}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete="new-password"
        autoCorrect={false}
        error={Boolean(confirmPassword) && !passwordsMatch}
        hideLabel
        icon="lock-closed-outline"
        label="Confirm password"
        onChangeText={setConfirmPassword}
        onSubmitEditing={() => void submit()}
        placeholder="Confirm password"
        returnKeyType="go"
        secureTextEntry
        textContentType="newPassword"
        value={confirmPassword}
      />

      <Text
        accessibilityLiveRegion="polite"
        style={[styles.hint, Boolean(confirmPassword) && !passwordsMatch && styles.hintError]}
      >
        {Boolean(confirmPassword) && !passwordsMatch
          ? "Your passwords do not match."
          : "Use at least 10 characters."}
      </Text>
      <View style={styles.termsRow}>
        <Pressable
          accessibilityLabel="Accept the Terms and Privacy Policy"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptedTerms }}
          onPress={() => setAcceptedTerms((value) => !value)}
          style={({ pressed }) => [styles.checkbox, acceptedTerms && styles.checkboxChecked, pressed && styles.checkboxPressed]}
        >
          {acceptedTerms ? <Ionicons color="#FFFFFF" name="checkmark" size={17} /> : null}
        </Pressable>
        <View style={styles.termsCopy}>
          <Text style={styles.termsText}>I agree to the account terms and data policy.</Text>
          <View style={styles.termsLinks}>
            <TextLink onPress={() => void Linking.openURL("https://kampusone.app/terms")}>Terms</TextLink>
            <Text style={styles.termsAnd}>and</Text>
            <TextLink onPress={() => void Linking.openURL("https://kampusone.app/privacy")}>Privacy Policy</TextLink>
          </View>
        </View>
      </View>
      <FormError message={error} />
      <PrimaryButton disabled={!canSubmit} loading={loading} onPress={() => void submit()}>
        Create account
      </PrimaryButton>

      <SocialAuthButtons />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account?</Text>
        <TextLink onPress={() => router.replace("/(auth)/sign-in")}>Sign in</TextLink>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  illustration: {
    alignSelf: "center",
    height: 190,
    marginBottom: 18,
    marginTop: -14,
    width: "100%",
  },
  nameRow: {
    flexDirection: "row",
    gap: 10,
  },
  nameRowCompact: {
    flexDirection: "column",
    gap: 0,
  },
  nameField: {
    flex: 1,
  },
  hint: {
    color: theme.textSubtle,
    fontFamily: theme.font.body,
    fontSize: 11.5,
    lineHeight: 17,
    marginBottom: 16,
    marginTop: -4,
  },
  hintError: {
    color: theme.error,
    fontFamily: theme.font.medium,
  },
  termsRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 11,
    marginBottom: 16,
  },
  checkbox: {
    alignItems: "center",
    borderColor: theme.clay,
    borderRadius: 7,
    borderWidth: 1.5,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  checkboxChecked: {
    backgroundColor: theme.deepBrand,
    borderColor: theme.deepBrand,
  },
  checkboxPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  termsCopy: {
    flex: 1,
    paddingTop: 2,
  },
  termsText: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 12,
    lineHeight: 17,
  },
  termsLinks: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  termsAnd: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 12,
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
