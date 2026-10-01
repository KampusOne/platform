import { router } from "expo-router";
import { ToolPage, ToolRow } from "@/src/components/toolkit";

export default function ProfileSettings() {
  return (
    <ToolPage title="Profile settings">
      <ToolRow
        title="Personal details"
        detail="Name, username, bio and profile photos"
        icon="person-outline"
        onPress={() => router.push("/account-edit")}
      />
      <ToolRow
        title="Data and privacy"
        detail="Get help with your personal data"
        icon="shield-checkmark-outline"
        onPress={() => router.push({ pathname: "/support", params: { category: "PRIVACY" } })}
      />
      <ToolRow
        title="Account ownership"
        detail="Manage your KampusOne account"
        icon="settings-outline"
        onPress={() => router.push("/account-ownership")}
      />
    </ToolPage>
  );
}
