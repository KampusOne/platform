import { useEffect, useState } from "react";
import { Switch } from "react-native";
import { router } from "expo-router";
import { ToolPage, ToolRow, ToolButton } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { setAppearance, useAppearance } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";
import { applyPreferences } from "@/src/lib/preferences";
type Settings = {
  notifications: boolean;
  marketing: boolean;
  haptics: boolean;
  hideCgpa: boolean;
  hideReposts: boolean;
};
const defaults: Settings = {
  notifications: true,
  marketing: false,
  haptics: true,
  hideCgpa: false,
  hideReposts: false,
};
export default function SettingsScreen() {
  const { user } = useAuth();
  const { theme, preference } = useAppearance();
  const toast = useToast();
  const [settings, setSettings] = useState(defaults);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    void readCache<Settings>("settings." + user.id).then(
      (s) => s && setSettings(s),
    );
    void api<{ settings: Partial<Settings> }>("/v1/account/settings")
      .then(({ settings: s }) => setSettings({ ...defaults, ...s }))
      .catch((e) => toast(e.message, "error"));
  }, [user?.id, toast]);
  async function save() {
    setBusy(true);
    try {
      await api("/v1/account/settings", {
        method: "PUT",
        body: JSON.stringify({ ...settings, appearance: preference }),
      });
      await writeCache("settings." + user?.id, settings);
      applyPreferences(settings);
      toast("Preferences saved", "success");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not save preferences",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Settings">
      {(["system", "light", "dark"] as const).map((mode) => (
        <ToolRow
          key={mode}
          title={
            mode === "system"
              ? "Use device appearance"
              : mode === "light"
                ? "Light mode"
                : "Dark mode"
          }
          icon={
            mode === "dark"
              ? "moon-outline"
              : mode === "light"
                ? "sunny-outline"
                : "phone-portrait-outline"
          }
          onPress={() => {
            void setAppearance(mode).catch(() =>
              toast("Could not save appearance", "error"),
            );
          }}
          trailing={
            <Switch
              accessibilityLabel={mode + " appearance"}
              value={preference === mode}
              onValueChange={() => void setAppearance(mode)}
              trackColor={{ true: theme.deepBrand }}
            />
          }
        />
      ))}
      {(
        [
          ["notifications", "Notifications"],
          ["marketing", "Product updates"],
          ["haptics", "Haptics"],
          ["hideCgpa", "Hide CGPA on my profile"],
          ["hideReposts", "Hide my reposts on my profile"],
        ] as const
      ).map(([key, label]) => (
        <ToolRow
          key={key}
          title={label}
          trailing={
            <Switch
              accessibilityLabel={label}
              value={settings[key]}
              onValueChange={(value) =>
                setSettings((s) => ({ ...s, [key]: value }))
              }
              trackColor={{ true: theme.deepBrand }}
            />
          }
        />
      ))}
      <ToolButton
        label="Save preferences"
        disabled={busy}
        onPress={() => void save()}
      />
      <ToolRow
        title="Privacy policy"
        onPress={() =>
          router.push({ pathname: "/legal", params: { document: "privacy" } })
        }
      />
      <ToolRow
        title="Terms of service"
        onPress={() =>
          router.push({ pathname: "/legal", params: { document: "terms" } })
        }
      />
      <ToolRow title="Help & support" onPress={() => router.push("/support")} />
    </ToolPage>
  );
}
