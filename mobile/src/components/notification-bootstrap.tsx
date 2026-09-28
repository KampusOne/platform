import { useEffect } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/src/auth/auth-context";
import {
  getRegisteredPushDevice,
  pushSetupAvailability,
  registerPushDevice,
  requestNativeNotificationPermission,
} from "@/src/lib/push-registration";

export function NotificationBootstrap() {
  const { state, user } = useAuth();

  useEffect(() => {
    if (Platform.OS === "web" || state !== "authenticated" || !user?.id) return;
    let active = true;
    let running = false;

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
    };
  }, [state, user?.id]);

  return null;
}
