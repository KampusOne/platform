import { router } from "expo-router";
import { Text } from "react-native";
import { ToolPage, ToolRow } from "@/src/components/toolkit";
import { useAppearance } from "@/src/lib/appearance";

export default function AccountOwnership() {
  const { theme } = useAppearance();
  return (
    <ToolPage title="Account ownership">
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, lineHeight: 23, marginBottom: 20 }}>
        You control your account and personal data. For help or a data request, contact support.
      </Text>
      <ToolRow
        title="Contact support"
        icon="help-circle-outline"
        onPress={() => router.push({ pathname: "/support", params: { category: "PRIVACY" } })}
      />
      <ToolRow
        title="Delete account"
        detail="Review what is removed before confirming with an email code"
        icon="trash-outline"
        onPress={() => router.push("/delete-account")}
      />
    </ToolPage>
  );
}
