import { useEffect, useState } from "react";
import { router } from "expo-router";
import { ToolPage, ToolRow, ToolButton } from "@/src/components/toolkit";
import { useAuth } from "@/src/auth/auth-context";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
type Device = { id: string; device_label: string; last_used_at: string };
export default function Account() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setDevices(
        (await api<{ sessions: Device[] }>("/v1/account/sessions")).sessions,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load devices", "error");
    }
  }
  useEffect(() => {
    void load();
  }, []);
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
  return (
    <ToolPage title="Account manager">
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
      {devices.map((d) => (
        <ToolRow
          key={d.id}
          title={d.device_label || "Signed-in device"}
          detail={new Date(d.last_used_at).toLocaleDateString()}
          trailing={
            <ToolButton
              secondary
              disabled={busy}
              label="Revoke"
              onPress={() => void revoke(d.id)}
            />
          }
        />
      ))}
      <ToolButton
        label="Log out"
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
