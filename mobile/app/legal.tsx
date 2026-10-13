import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { useAppearance } from "@/src/lib/appearance";
import { privacySections, termsSections } from "@/src/lib/legal-copy";

export default function Legal() {
  const { document } = useLocalSearchParams<{ document?: string }>();
  const { theme } = useAppearance();
  const isTerms = document === "terms";
  const sections = isTerms ? termsSections : privacySections;
  return (
    <ToolPage title={isTerms ? "Terms and conditions" : "Privacy policy"}>
      <View style={{ backgroundColor: theme.surfaceTint, padding: 20, borderRadius: 18,
        marginBottom: 22, gap: 9 }}>
        <Ionicons name={isTerms ? "document-text-outline" : "shield-checkmark-outline"}
          size={28} color={theme.deepBrand} />
        <Text style={{ fontFamily: theme.font.displayStrong, fontSize: 24,
          lineHeight: 30, color: theme.text }}>
          {isTerms ? "Clear rules for campus life" : "Your information matters"}
        </Text>
        <Text style={{ fontFamily: theme.font.body, fontSize: 14, lineHeight: 22,
          color: theme.textMuted }}>
          {isTerms
            ? "How accounts, academic tools, communities, campus services and payments are expected to work."
            : "What information KampusOne uses, why it is needed, who may receive it and the choices available to you."}
        </Text>
      </View>
      {sections.map((section, index) => (
        <View key={section.title} style={{ borderBottomWidth: 1, borderBottomColor: theme.border,
          paddingBottom: 22, marginBottom: 22 }}>
          <Text accessible={false} importantForAccessibility="no" style={{ fontFamily: theme.font.semibold,
            fontSize: 12, color: theme.deepBrand, marginBottom: 8 }}>
            {String(index + 1).padStart(2, "0")} / {String(sections.length).padStart(2, "0")}
          </Text>
          <Text accessibilityRole="header" style={{ fontFamily: theme.font.display, fontSize: 20, lineHeight: 27,
            color: theme.text, marginBottom: 12 }}>{section.title}</Text>
          {section.paragraphs.map((paragraph, position) => (
            <Text key={position} style={{ fontFamily: theme.font.body,
              fontSize: 14, lineHeight: 23, color: theme.textMuted,
              marginBottom: position === section.paragraphs.length - 1 ? 0 : 11 }}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
      <View style={{ padding: 18, borderRadius: 16, backgroundColor: theme.surface, gap: 10,
        borderColor: theme.border, borderWidth: 1, marginBottom: 24 }}>
        <Text style={{ color: theme.text, fontFamily: theme.font.display, fontSize: 19 }}>
          Need clarification or support?
        </Text>
        <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 21 }}>
          Contact KampusOne through Help & support. Do not include passwords, PINs or one-time codes.
        </Text>
        <ToolButton label="Open Help & support" onPress={() => router.push("/support")} />
        <ToolButton secondary
          label={isTerms ? "Read privacy policy" : "Read terms and conditions"}
          onPress={() => router.replace({ pathname: "/legal", params: { document: isTerms ? "privacy" : "terms" } })} />
      </View>
    </ToolPage>
  );
}
