import { useEffect, useState } from "react";
import { Platform, Text } from "react-native";
import {
  getRegisteredPushDevice,
  pushSetupAvailability,
  registerPushDevice,
  unregisterPushDevice,
} from "@/src/lib/push-registration";
import { Ionicons } from "@expo/vector-icons";
import { BrandSwitch } from "@/src/components/brand-switch";
import { ScreenSkeleton } from "@/src/components/skeleton";
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
  hideCgpa: true,
  hideReposts: false,
};
export default function SettingsScreen() {
  const { user } = useAuth();
  const { theme, preference } = useAppearance();
  const toast = useToast();
  const [settings, setSettings] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushRegistered, setPushRegistered] = useState(false);
  const pushAvailability = pushSetupAvailability();
  useEffect(() => {
    let live = true;
    if (user && Platform.OS !== "web")
      void getRegisteredPushDevice(user.id)
        .then((device) => {
          if (live) setPushRegistered(Boolean(device));
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user?.id]);
  async function changePush() {
    if (!user || pushBusy) return;
    setPushBusy(true);
    try {
      if (pushRegistered) {
        await unregisterPushDevice(user.id);
        setPushRegistered(false);
        toast("Push turned off for this device", "success");
      } else {
        await registerPushDevice(user.id);
        setPushRegistered(true);
        toast(
          "Device registered. Delivery can now be tested on this device.",
          "success",
        );
      }
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Push setup could not finish",
        "error",
      );
    } finally {
      setPushBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    if (!user) return;
    void (async () => {
      const cached = await readCache<Settings>("settings." + user.id);
      if (live && cached) setSettings({ ...defaults, ...cached });
      try {
        const { settings: saved } = await api<{ settings: Partial<Settings> }>(
          "/v1/account/settings",
        );
        if (live) setSettings({ ...defaults, ...saved });
      } catch (caught) {
        if (live)
          setError(
            caught instanceof Error
              ? caught.message
              : "Preferences could not load. Try again later.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [user?.id]);
  async function save() {
    setBusy(true);
    try {
      await api("/v1/account/settings", {
        method: "PUT",
        body: JSON.stringify({
          appearance: preference,
          notifications: settings.notifications,
          marketing: settings.marketing,
          haptics: settings.haptics,
          hideCgpa: settings.hideCgpa,
          hideReposts: settings.hideReposts,
        }),
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
      {loading ? <ScreenSkeleton variant="list" compact /> : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.error, lineHeight: 21 }}
        >
          {error}
        </Text>
      ) : null}
      {(["light", "dark", "system"] as const).map((mode) => (
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
            <Ionicons
              accessibilityLabel={
                preference === mode ? "Selected" : "Not selected"
              }
              name={
                preference === mode ? "radio-button-on" : "radio-button-off"
              }
              color={theme.deepBrand}
              size={24}
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
            <BrandSwitch
              label={label}
              disabled={busy || loading}
              value={settings[key]}
              onValueChange={(value) =>
                setSettings((s) => ({ ...s, [key]: value }))
              }
            />
          }
        />
      ))}
      <ToolButton
        label={busy ? "Saving preferences…" : "Save preferences"}
        disabled={busy || loading}
        onPress={() => void save()}
      />
      <ToolRow
        title="Push on this device"
        icon="notifications-outline"
        detail={
          pushRegistered
            ? "This device is registered. Registration does not confirm delivery."
            : pushAvailability.message
        }
      />
      {pushAvailability.available ? (
        <ToolButton
          secondary
          label={
            pushBusy
              ? "Updating device…"
              : pushRegistered
                ? "Turn off push on this device"
                : "Set up push on this device"
          }
          disabled={pushBusy}
          onPress={() => void changePush()}
        />
      ) : null}
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
