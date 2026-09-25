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
    void (async () => {
      const granted = await requestNativeNotificationPermission();
      if (!active || !granted) return;

      const availability = pushSetupAvailability();
      if (!availability.available) return;

      const registered = await getRegisteredPushDevice(user.id).catch(() => null);
      if (!active || registered) return;
      await registerPushDevice(user.id);
    })().catch((error) => {
      console.warn("kampusone.notifications.bootstrap", error instanceof Error ? error.message : "unknown");
    });

    return () => {
      active = false;
    };
  }, [state, user?.id]);

  return null;
}
