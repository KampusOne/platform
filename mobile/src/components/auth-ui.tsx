import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

export function AuthShell({
  children,
  title,
  subtitle,
  back = true,
  brand = true,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
  back?: boolean;
  brand?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topbar}>
            {back ? (
              <Pressable accessibilityLabel="Go back" hitSlop={10} onPress={() => router.back()} style={styles.back}>
                <Ionicons name="arrow-back" size={21} color={theme.text} />
              </Pressable>
            ) : <View style={styles.backPlaceholder} />}
            {brand ? <Image resizeMode="contain" source={require("@/assets/brand/kampusone-horizontal-ink.png")} style={styles.brand} /> : null}
            <View style={styles.backPlaceholder} />
          </View>
          <View style={styles.heading}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthField({ label, icon, ...props }: TextInputProps & { label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <Ionicons name={icon} size={19} color={theme.brandPressed} />
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={theme.textSubtle}
          style={styles.input}
          {...props}
        />
      </View>
    </View>
  );
}

export function PrimaryButton({ children, onPress, loading = false, disabled = false }: {
  children: ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, (disabled || loading) && styles.disabled, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{children}</Text>}
    </Pressable>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <Ionicons name="alert-circle-outline" size={18} color={theme.deepBrand} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function TextLink({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return <Pressable hitSlop={8} onPress={onPress}><Text style={styles.link}>{children}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  content: { alignSelf: "center", minHeight: "100%", paddingBottom: 42, paddingHorizontal: 24, width: "100%", maxWidth: 540 },
  topbar: { alignItems: "center", flexDirection: "row", height: 64, justifyContent: "space-between" },
  back: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 16, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  backPlaceholder: { width: 44 },
  brand: { height: 30, width: 142 },
  heading: { marginBottom: 26, marginTop: 20 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 32, letterSpacing: -0.8, lineHeight: 37 },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14.5, lineHeight: 22, marginTop: 8 },
  fieldGroup: { marginBottom: 16 },
  label: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, marginBottom: 7 },
  field: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 56, paddingHorizontal: 15 },
  input: { color: theme.text, flex: 1, fontFamily: theme.font.body, fontSize: 15, minHeight: 54 },
  primary: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, height: 58, justifyContent: "center", marginTop: 8, ...theme.shadow },
  primaryText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 15 },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  error: { alignItems: "flex-start", backgroundColor: "#FFF0EB", borderColor: "#F0C4B4", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 14, padding: 12 },
  errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12.5, lineHeight: 18 },
  link: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5 },
});
