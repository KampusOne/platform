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
  registeredAt?: number;
};

export const PUSH_ACTION = {
  REPLY: "KAMPUSONE_REPLY",
  MARK_READ: "KAMPUSONE_MARK_READ",
  MUTE: "KAMPUSONE_MUTE",
  READ: "KAMPUSONE_READ",
} as const;

export const PUSH_CATEGORY = {
  MESSAGE: "KAMPUSONE_MESSAGE",
  SOCIAL: "KAMPUSONE_SOCIAL",
  NEWSLETTER: "KAMPUSONE_NEWSLETTER",
  UPDATE: "KAMPUSONE_UPDATE",
} as const;

export const PUSH_CHANNEL = {
  MESSAGES: "kampusone-messages-v1",
  SOCIAL: "kampusone-social-v1",
  NEWSLETTER: "kampusone-newsletter-v1",
  UPDATES: "kampusone-updates-v2",
} as const;

const registrationKey = (userId: string) => "push-device." + userId;

export function pushSetupAvailability() {
  if (Platform.OS === "web")
    return {
      available: false,
      message:
        "Push notifications are available in the installed KampusOne app.",
    };
  if (Constants.appOwnership === "expo")
    return {
      available: false,
      message:
        "Install the latest KampusOne app to manage push notifications.",
    };

  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

  if (typeof projectId !== "string" || !projectId)
    return {
      available: false,
      message:
        "Push notifications are not available in this build yet.",
    };

  return {
    available: true,
    message: "Get important KampusOne updates on this device.",
    projectId,
  };
}

export async function configureNativeNotifications() {
  if (Platform.OS === "web") return;
  const Notifications = await import("expo-notifications");

  if (Platform.OS === "android") {
    const common = {
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default" as const,
      vibrationPattern: [0, 180, 100, 180],
      enableVibrate: true,
    };
    await Promise.all([
      Notifications.setNotificationChannelAsync(PUSH_CHANNEL.MESSAGES, {
        ...common,
        name: "Messages",
        description: "New KampusOne messages and message requests.",
      }),
      Notifications.setNotificationChannelAsync(PUSH_CHANNEL.SOCIAL, {
        ...common,
        name: "Social activity",
        description: "KampusOne social activity you choose to receive on your phone.",
      }),
      Notifications.setNotificationChannelAsync(PUSH_CHANNEL.NEWSLETTER, {
        ...common,
        name: "KampusOne Newsletter",
        description: "New posts and important updates from KampusOne Newsletter.",
      }),
      Notifications.setNotificationChannelAsync(PUSH_CHANNEL.UPDATES, {
        ...common,
        name: "KampusOne updates",
        description: "Classes, announcements and important campus updates.",
      }),
    ]);
  }

  await Promise.all([
    Notifications.setNotificationCategoryAsync(PUSH_CATEGORY.MESSAGE, [
      {
        identifier: PUSH_ACTION.REPLY,
        buttonTitle: "Reply",
        options: { opensAppToForeground: true },
        textInput: {
          submitButtonTitle: "Send",
          placeholder: "Reply…",
        },
      },
      {
        identifier: PUSH_ACTION.MARK_READ,
        buttonTitle: "Mark as read",
        options: { opensAppToForeground: true },
      },
      {
        identifier: PUSH_ACTION.MUTE,
        buttonTitle: "Mute",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(PUSH_CATEGORY.NEWSLETTER, [
      {
        identifier: PUSH_ACTION.READ,
        buttonTitle: "Read",
        options: { opensAppToForeground: true },
      },
      {
        identifier: PUSH_ACTION.MARK_READ,
        buttonTitle: "Mark as read",
        options: { opensAppToForeground: true },
      },
      {
        identifier: PUSH_ACTION.MUTE,
        buttonTitle: "Mute",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(PUSH_CATEGORY.SOCIAL, [
      {
        identifier: PUSH_ACTION.MARK_READ,
        buttonTitle: "Mark as read",
        options: { opensAppToForeground: true },
      },
      {
        identifier: PUSH_ACTION.MUTE,
        buttonTitle: "Mute",
        options: { opensAppToForeground: true },
      },
    ]),
    Notifications.setNotificationCategoryAsync(PUSH_CATEGORY.UPDATE, [
      {
        identifier: PUSH_ACTION.MARK_READ,
        buttonTitle: "Mark as read",
        options: { opensAppToForeground: true },
      },
      {
        identifier: PUSH_ACTION.MUTE,
        buttonTitle: "Mute",
        options: { opensAppToForeground: true },
      },
    ]),
  ]);
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const Notifications = await import("expo-notifications");
  await configureNativeNotifications();

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  return permission.granted;
}

export async function listPushDevices(): Promise<PushDevice[]> {
  return (await api<{ devices: PushDevice[] }>("/v1/notifications/devices"))
    .devices;
}

export async function registerPushDevice(userId: string) {
  const availability = pushSetupAvailability();
  if (!availability.available || !availability.projectId)
    throw new Error(availability.message);

  const granted = await requestNativeNotificationPermission();
  if (!granted)
    throw new Error(
      "Notification permission was not granted. You can allow it in your device settings.",
    );

  const Notifications = await import("expo-notifications");
  let token: Awaited<ReturnType<typeof Notifications.getExpoPushTokenAsync>>;
  try {
    token = await Notifications.getExpoPushTokenAsync({
      projectId: availability.projectId,
    });
  } catch {
    throw new Error(
      Platform.OS === "android"
        ? "This KampusOne Android build is missing or cannot use its Firebase push credentials. Install a push-enabled build or retry after reconnecting."
        : "This KampusOne build could not register for push notifications. Retry when you are online.",
    );
  }

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

  await writeCache(registrationKey(userId), { id, registeredAt: Date.now() }, 365 * 86400_000);
  return id;
}

export async function getRegisteredPushDevice(userId: string) {
  const saved = await readCache<{ id: string; registeredAt?: number }>(registrationKey(userId));
  if (!saved?.id) return null;
  const devices = await listPushDevices();
  const device = devices.find(
      (device) => device.id === saved.id && device.active !== false,
    );
  return device ? { ...device, registeredAt: saved.registeredAt } : null;
}

export async function unregisterPushDevice(userId: string) {
  const saved = await readCache<{ id: string }>(registrationKey(userId));
  if (!saved?.id) return;
  await api("/v1/notifications/devices/" + encodeURIComponent(saved.id), {
    method: "DELETE",
  });
  await writeCache(registrationKey(userId), null);
}
