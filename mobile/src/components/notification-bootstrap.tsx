import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import {
  getRegisteredPushDevice,
  pushSetupAvailability,
  registerPushDevice,
  requestNativeNotificationPermission,
} from "@/src/lib/push-registration";

type NotificationResponseLike = {
  notification: {
    request: {
      identifier: string;
      content: { data?: Record<string, unknown> };
    };
  };
};

export function NotificationBootstrap() {
  const { state, user } = useAuth();
  const lastHandledResponse = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || state !== "authenticated" || !user?.id) return;
    let active = true;
    let running = false;
    let responseSubscription: { remove(): void } | undefined;

    const openNotification = (response: NotificationResponseLike) => {
      if (!active) return;
      const identifier = response.notification.request.identifier;
      if (lastHandledResponse.current === identifier) return;
      const path = response.notification.request.content.data?.path;
      if (
        typeof path !== "string" ||
        !path.startsWith("/") ||
        path.startsWith("//")
      )
        return;
      lastHandledResponse.current = identifier;
      try {
        router.push(path as Href);
      } catch (error) {
        console.warn(
          "kampusone.notifications.open",
          error instanceof Error ? error.message : "unknown",
        );
      }
    };

    void import("expo-notifications")
      .then(async (Notifications) => {
        if (!active) return;
        responseSubscription =
          Notifications.addNotificationResponseReceivedListener(
            openNotification,
          );
        const initialResponse =
          await Notifications.getLastNotificationResponseAsync();
        if (initialResponse) openNotification(initialResponse);
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
