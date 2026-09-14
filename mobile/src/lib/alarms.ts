import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
export type Alarm = {
  id: string;
  label: string;
  time: string;
  days: number[];
  enabled: boolean;
  sound: "default" | "silent";
  vibration: boolean;
  snooze_minutes: number;
  timetable_entry_id?: string | null;
  fires_at?: string | null;
};
let queue: Promise<unknown> = Promise.resolve();
export async function syncAlarms(
  alarms: Alarm[],
  requestPermission = false,
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const operation = queue
    .catch(() => undefined)
    .then(async () => {
      if (Platform.OS === "android")
        for (const sound of ["default", "silent"])
          for (const vibration of [true, false])
            await Notifications.setNotificationChannelAsync(
              `k1-${sound}-${vibration}`,
              {
                name: "Campus reminders",
                importance: Notifications.AndroidImportance.HIGH,
                sound: sound === "silent" ? null : "default",
                enableVibrate: vibration,
                vibrationPattern: vibration ? [0, 200, 100, 200] : [0],
              },
            );
      let permissions = await Notifications.getPermissionsAsync();
      if (!permissions.granted && requestPermission)
        permissions = await Notifications.requestPermissionsAsync();
      if (!permissions.granted) return false;
      await Notifications.setNotificationCategoryAsync("k1-alarm", [
        {
          identifier: "snooze",
          buttonTitle: "Snooze",
          options: { opensAppToForeground: false },
        },
        {
          identifier: "dismiss",
          buttonTitle: "Dismiss",
          options: { opensAppToForeground: false },
        },
      ]);
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const expected = new Map<string, { alarm: Alarm; day: number }>();
      for (const alarm of alarms.filter((a) => a.enabled))
        for (const day of alarm.days.length
          ? alarm.days
          : alarm.fires_at && Date.parse(alarm.fires_at) > Date.now()
            ? [-1]
            : [])
          expected.set(`k1-alarm-${alarm.id}-${day}`, { alarm, day });
      // Only replace this app's alarm requests. Remote/push notifications are untouched.
      for (const entry of scheduled)
        if (entry.identifier.startsWith("k1-alarm-"))
          await Notifications.cancelScheduledNotificationAsync(
            entry.identifier,
          );
      for (const [identifier, { alarm, day }] of expected) {
        const [hour, minute] = alarm.time.split(":").map(Number);
        await Notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: alarm.label,
            body: "Your reminder",
            sound: alarm.sound === "default" ? "default" : false,
            categoryIdentifier: "k1-alarm",
            data: { alarmId: alarm.id, snoozeMinutes: alarm.snooze_minutes },
          },
          trigger:
            day === -1
              ? {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: new Date(alarm.fires_at!),
                  channelId: `k1-${alarm.sound}-${alarm.vibration}`,
                }
              : {
                  type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                  weekday: day + 1,
                  hour: hour!,
                  minute: minute!,
                  channelId: `k1-${alarm.sound}-${alarm.vibration}`,
                },
        });
      }
      return true;
    });
  queue = operation;
  return operation;
}
export async function clearScheduledAlarms() {
  if (Platform.OS === "web") return;
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (
      n.identifier.startsWith("k1-alarm-") ||
      n.identifier.startsWith("k1-snooze-")
    )
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
export function listenForSnooze() {
  if (Platform.OS === "web") return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async (n) => ({
      shouldPlaySound: n.request.content.sound !== null,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const listener = Notifications.addNotificationResponseReceivedListener(
    (r) => {
      if (
        r.actionIdentifier !== "snooze" ||
        r.notification.request.content.categoryIdentifier !== "k1-alarm"
      )
        return;
      const original = r.notification.request.content;
      const raw = Number(original.data?.snoozeMinutes);
      const seconds = Math.max(1, Math.min(30, raw || 5)) * 60;
      void Notifications.scheduleNotificationAsync({
        identifier: `k1-snooze-${r.notification.request.identifier}`,
        content: {
          title: original.title ?? "Reminder",
          body: original.body ?? "",
          data: original.data ?? {},
          sound: original.sound ? "default" : false,
          categoryIdentifier: "k1-alarm",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds,
          repeats: false,
        },
      });
    },
  );
  return () => listener.remove();
}
