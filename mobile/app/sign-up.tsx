import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthScreen, FormField, FormMessage, PrimaryButton } from "@/src/components/auth-ui";
import { authRedirectUrl, supabase } from "@/src/lib/supabase";
import { theme } from "@/src/theme";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const passwordChecks = useMemo(() => ({
    length: password.length >= 10,
    mixed: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /\d/.test(password),
  }), [password]);
  const passwordValid = Object.values(passwordChecks).every(Boolean);

  async function submit() {
    setMessage("");
    if (name.trim().length < 2) return setMessage("Enter your full name.");
    if (!emailPattern.test(email.trim())) return setMessage("Enter a valid email address.");
    if (!passwordValid) return setMessage("Use at least 10 characters with upper and lowercase letters and a number.");
    if (password !== confirmPassword) return setMessage("The passwords do not match.");
    if (!accepted) return setMessage("Please accept the terms and privacy notice to continue.");
    if (!supabase) return setMessage("Account creation is waiting for the preview environment connection. You can still explore the app preview.");

    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: authRedirectUrl,
      },
    });
    setLoading(false);

    if (error) return setMessage(error.message);
    if (data.session) return router.replace("/onboarding");
    router.push({ pathname: "/verify-email", params: { email: normalizedEmail } });
  }

  return (
    <AuthScreen body="Use an email you check often. You’ll confirm it before setting up your school profile." title="Create your account">
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}
      <FormField autoCapitalize="words" autoComplete="name" label="Full name" onChangeText={setName} placeholder="Igiehon Gideon" textContentType="name" value={name} />
      <FormField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" textContentType="emailAddress" value={email} />
      <FormField
        autoCapitalize="none"
        autoComplete="new-password"
        label="Password"
        onChangeText={setPassword}
        placeholder="At least 10 characters"
        secureTextEntry={!showPassword}
        textContentType="newPassword"
        trailing={<Pressable accessibilityLabel={showPassword ? "Hide password" : "Show password"} hitSlop={10} onPress={() => setShowPassword((value) => !value)}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={theme.textSubtle} /></Pressable>}
        value={password}
      />
      <View style={styles.passwordChecks}>
        <PasswordCheck complete={passwordChecks.length} text="10+ characters" />
        <PasswordCheck complete={passwordChecks.mixed} text="Upper & lowercase" />
        <PasswordCheck complete={passwordChecks.number} text="One number" />
      </View>
      <FormField autoCapitalize="none" autoComplete="new-password" label="Confirm password" onChangeText={setConfirmPassword} placeholder="Type it again" secureTextEntry={!showPassword} textContentType="newPassword" value={confirmPassword} />

      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted((value) => !value)} style={styles.consent}>
        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>{accepted ? <Ionicons name="checkmark" size={17} color="#FFFFFF" /> : null}</View>
        <Text style={styles.consentText}>I agree to the <Text style={styles.consentLink}>terms of use</Text> and <Text style={styles.consentLink}>privacy notice</Text>.</Text>
      </Pressable>

      <PrimaryButton disabled={!accepted} loading={loading} onPress={() => void submit()}>Create my account</PrimaryButton>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/sign-in")} style={styles.signInLink}><Text style={styles.signInText}>Already have an account? <Text style={styles.signInStrong}>Log in</Text></Text></Pressable>
    </AuthScreen>
  );
}

function PasswordCheck({ complete, text }: { complete: boolean; text: string }) {
  return <View style={styles.check}><Ionicons name={complete ? "checkmark-circle" : "ellipse-outline"} size={15} color={complete ? theme.statusPositive : theme.textSubtle} /><Text style={[styles.checkText, complete && styles.checkTextDone]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  passwordChecks: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 17, marginTop: -8 },
  check: { alignItems: "center", flexDirection: "row", gap: 4 },
  checkText: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5 },
  checkTextDone: { color: theme.statusPositive },
  consent: { alignItems: "flex-start", flexDirection: "row", gap: 11, marginBottom: 21 },
  checkbox: { alignItems: "center", borderColor: "rgba(41,35,31,0.24)", borderRadius: 8, borderWidth: 1.5, height: 25, justifyContent: "center", marginTop: 1, width: 25 },
  checkboxChecked: { backgroundColor: theme.brand, borderColor: theme.brand },
  consentText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 19 },
  consentLink: { color: theme.brandPressed, fontFamily: theme.font.semibold },
  signInLink: { alignItems: "center", minHeight: 52, justifyContent: "center" },
  signInText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5 },
  signInStrong: { color: theme.brandPressed, fontFamily: theme.font.semibold },
});
