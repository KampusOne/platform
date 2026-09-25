import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";
import { readCache, writeCache } from "./device-cache";
export type PushDevice = {
  id: string;
  platform: string;
  active?: boolean;
  label: string;
  build_version?: string;
  created_at?: string;
};
const registrationKey = (userId: string) => "push-device." + userId;
export function pushSetupAvailability() {
  if (Platform.OS === "web")
    return {
      available: false,
      message:
        "Remote push is available in the installed Android and iOS app. This web preview shows your notification inbox; it does not register for native push.",
    };
  if (Constants.appOwnership === "expo")
    return {
      available: false,
      message:
        "Open an installed KampusOne development or release build to set up push notifications.",
    };
  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId)
    return {
      available: false,
      message:
        "This build needs its Expo project ID before push can be set up. Install a configured KampusOne build.",
    };
  return {
    available: true,
    message: "Push notifications for this device",
    projectId,
  };
}
export async function listPushDevices(): Promise<PushDevice[]> {
  return (await api<{ devices: PushDevice[] }>("/v1/notifications/devices"))
    .devices;
}
export async function registerPushDevice(userId: string) {
  const availability = pushSetupAvailability();
  if (!availability.available || !availability.projectId)
    throw new Error(availability.message);
  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("kampusone-updates", {
      name: "Campus updates",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted)
    permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      "Notification permission was not granted. You can allow it in your device settings.",
    );
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: availability.projectId,
  });
  const response = await api<{ device?: { id: string }; id?: string }>(
    "/v1/notifications/devices",
    {
      method: "POST",
      body: JSON.stringify({
        expoPushToken: token.data,
        platform: Platform.OS,
        label: `KampusOne ${Platform.OS}`,
        buildVersion: Constants.expoConfig?.version ?? "unknown",
      }),
    },
  );
  const id = response.device?.id ?? response.id;
  if (!id)
    throw new Error(
      "The server did not confirm this device registration. Try again.",
    );
  await writeCache(registrationKey(userId), { id }, 365 * 86400_000);
  return id;
}
export async function getRegisteredPushDevice(userId: string) {
  const saved = await readCache<{ id: string }>(registrationKey(userId));
  if (!saved?.id) return null;
  const devices = await listPushDevices();
  return (
    devices.find(
      (device) => device.id === saved.id && device.active !== false,
    ) ?? null
  );
}
export async function unregisterPushDevice(userId: string) {
  const saved = await readCache<{ id: string }>(registrationKey(userId));
  if (!saved?.id) return;
  await api("/v1/notifications/devices/" + encodeURIComponent(saved.id), {
    method: "DELETE",
  });
  await writeCache(registrationKey(userId), null);
}
