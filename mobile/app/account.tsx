import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { ToolPage, ToolRow, ToolButton } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
type Device = {
  id: string;
  device_label: string;
  last_used_at: string;
  created_at?: string;
};
export default function Account() {
  const { user, signOut } = useAuth();
  const { theme } = useAppearance();
  const toast = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setDevices(
        (await api<{ sessions: Device[] }>("/v1/account/sessions")).sessions,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load device sessions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api("/v1/account/sessions/" + id, { method: "DELETE" });
      await load();
      toast("Device session revoked", "success");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not revoke session",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  const latest = devices[0];
  return (
    <ToolPage title="Account & security">
      <ToolRow title={user?.email ?? "Account"} icon="mail-outline" />
      <ToolRow
        title="Edit profile"
        icon="person-outline"
        onPress={() => router.push("/account-edit")}
      />
      <ToolRow
        title="Change password"
        icon="key-outline"
        onPress={() => router.push("/forgot-password")}
      />
      <ToolRow
        title="Data and privacy requests"
        icon="shield-checkmark-outline"
        onPress={() =>
          router.push({ pathname: "/support", params: { category: "PRIVACY" } })
        }
      />
      {loading ? (
        <ScreenSkeleton variant="list" compact />
      ) : error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
          <ToolButton
            secondary
            label="Retry device sessions"
            onPress={() => {
              setLoading(true);
              void load();
            }}
          />
        </>
      ) : (
        <>
          <ToolRow
            title="Recent account activity"
            detail={
              latest
                ? `${latest.device_label || "Signed-in device"} · ${new Date(latest.last_used_at).toLocaleString()}`
                : "No active device sessions were returned."
            }
            icon="shield-checkmark-outline"
          />
          <ToolRow
            title={expanded ? "Hide device sessions" : "Manage device sessions"}
            detail={`${devices.length} active session${devices.length === 1 ? "" : "s"}`}
            icon="phone-portrait-outline"
            onPress={() => setExpanded(!expanded)}
          />
          {expanded ? (
            <Text
              style={{
                color: theme.textMuted,
                fontFamily: theme.font.body,
                lineHeight: 20,
                fontSize: 12,
                paddingVertical: 10,
              }}
            >
              Revoke a session you do not recognise. Revoking the device you are
              using may sign you out.
            </Text>
          ) : null}
          {expanded
            ? devices.map((d) => (
                <ToolRow
                  key={d.id}
                  title={d.device_label || "Signed-in device"}
                  detail={`Last active ${new Date(d.last_used_at).toLocaleString()}`}
                  trailing={
                    <ToolButton
                      secondary
                      disabled={busy}
                      label="Revoke"
                      onPress={() => void revoke(d.id)}
                    />
                  }
                />
              ))
            : null}
        </>
      )}
      <ToolButton
        label={busy ? "Please wait…" : "Log out"}
        secondary
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void signOut().finally(() => setBusy(false));
        }}
      />
    </ToolPage>
  );
}
