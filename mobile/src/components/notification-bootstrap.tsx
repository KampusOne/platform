import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/src/auth/auth-context";
import { api } from "@/src/lib/api";
import {
  configureNativeNotifications,
  getRegisteredPushDevice,
  PUSH_ACTION,
  pushSetupAvailability,
  registerPushDevice,
  requestNativeNotificationPermission,
} from "@/src/lib/push-registration";

type NotificationResponseLike = {
  actionIdentifier?: string;
  userText?: string;
  notification: {
    request: {
      identifier: string;
      content: { data?: Record<string, unknown> };
    };
  };
};

type PreferenceResponse = {
  channels: Record<
    string,
    { in_app_enabled: boolean; push_enabled: boolean }
  >;
};

function validAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}

function threadIdFromPath(path: unknown) {
  if (typeof path !== "string") return null;
  const match = path.match(/^\/conversation\?id=([0-9a-f-]{36})(?:&|$)/i);
  return match?.[1] ?? null;
}

async function markPushRead(data: Record<string, unknown>) {
  const notificationId = data.notificationId;
  if (typeof notificationId === "string") {
    await api(
      `/v1/notifications/inbox/${encodeURIComponent(notificationId)}/read`,
      { method: "PATCH" },
    ).catch(() => undefined);
  }
  const threadId = threadIdFromPath(data.path);
  if (threadId) {
    await api(`/v1/messages/threads/${encodeURIComponent(threadId)}/read`, {
      method: "PUT",
    }).catch(() => undefined);
  }
}

async function mutePushCategory(data: Record<string, unknown>) {
  const category = data.preferenceCategory;
  if (typeof category !== "string") return;
  const current = await api<PreferenceResponse>("/v1/notifications/preferences");
  const row = current.channels?.[category];
  if (!row || !row.push_enabled) return;
  await api("/v1/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify({
      channels: {
        ...current.channels,
        [category]: { ...row, push_enabled: false },
      },
    }),
  });
}

export function NotificationBootstrap() {
  const { state, user } = useAuth();
  const lastHandledResponse = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || state !== "authenticated" || !user?.id) return;
    let active = true;
    let running = false;
    let responseSubscription: { remove(): void } | undefined;

    const openNotification = async (response: NotificationResponseLike) => {
      if (!active) return;
      const identifier = response.notification.request.identifier;
      const actionIdentifier = response.actionIdentifier ?? "default";
      const responseKey = `${identifier}:${actionIdentifier}`;
      if (lastHandledResponse.current === responseKey) return;

      const data = response.notification.request.content.data ?? {};
      const path = data.path;
      lastHandledResponse.current = responseKey;

      try {
        if (actionIdentifier === PUSH_ACTION.MARK_READ) {
          await markPushRead(data);
          return;
        }

        if (actionIdentifier === PUSH_ACTION.MUTE) {
          await mutePushCategory(data);
          return;
        }

        if (actionIdentifier === PUSH_ACTION.REPLY) {
          const threadId = threadIdFromPath(path);
          const body = response.userText?.trim();
          if (threadId && body) {
            await api(
              `/v1/messages/threads/${encodeURIComponent(threadId)}/messages`,
              {
                method: "POST",
                body: JSON.stringify({ id: Crypto.randomUUID(), body }),
              },
            );
            await markPushRead(data);
          }
          return;
        }

        if (!validAppPath(path)) return;
        router.push(path as Href);
      } catch (error) {
        console.warn(
          "kampusone.notifications.action",
          error instanceof Error ? error.message : "unknown",
        );
      }
    };

    void import("expo-notifications")
      .then(async (Notifications) => {
        if (!active) return;
        await configureNativeNotifications();
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });
        responseSubscription =
          Notifications.addNotificationResponseReceivedListener(
            openNotification,
          );
        const initialResponse =
          await Notifications.getLastNotificationResponseAsync();
        if (initialResponse) void openNotification(initialResponse);
      })
      .catch((error) => {
        console.warn(
          "kampusone.notifications.listener",
          error instanceof Error ? error.message : "unknown",
        );
      });

    const ensureRegistered = async () => {
      if (!active || running) return;
      running = true;
      try {
        const granted = await requestNativeNotificationPermission();
        if (!active || !granted) return;

        const availability = pushSetupAvailability();
        if (!availability.available) return;

        const registered = await getRegisteredPushDevice(user.id).catch(() => null);
        if (!active || registered) return;
        await registerPushDevice(user.id);
      } catch (error) {
        console.warn(
          "kampusone.notifications.bootstrap",
          error instanceof Error ? error.message : "unknown",
        );
      } finally {
        running = false;
      }
    };

    const initial = setTimeout(() => void ensureRegistered(), 2_500);
    const retry = setInterval(() => void ensureRegistered(), 60_000);

    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(retry);
      responseSubscription?.remove();
    };
  }, [state, user?.id]);

  return null;
}
