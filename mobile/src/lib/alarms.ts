import { syncWebAlarms, stopWebAlarms } from "./web-alarms";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
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
  if (Platform.OS === "web") return syncWebAlarms(alarms, requestPermission);
  const operation = queue
    .catch(() => undefined)
    .then(async () => {
      if (Platform.OS === "android")
        for (const sound of ["default", "silent"])
          for (const vibration of [true, false])
            await Notifications.setNotificationChannelAsync(
              `k1-${sound}-${vibration}`,
              {
                name: "KampusOne alarms",
                importance: Notifications.AndroidImportance.MAX,
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
      if (Platform.OS === "ios" && expected.size > 60) throw new Error("Use at most 60 weekly reminder slots on this iPhone. Disable some reminders, then sync again.");
      const signatures = new Map(scheduled.map(entry=>[entry.identifier,entry.content.data?.alarmSignature]));
      // Preserve unchanged reminders so a refresh cannot cancel an imminent alarm.
      for (const entry of scheduled)
        if (entry.identifier.startsWith("k1-alarm-") && !expected.has(entry.identifier))
          await Notifications.cancelScheduledNotificationAsync(
            entry.identifier,
          );
      for (const [identifier, { alarm, day }] of expected) {
        const signature=JSON.stringify([alarm.time,alarm.days,alarm.fires_at,alarm.label,alarm.sound,alarm.vibration,alarm.snooze_minutes,new Date().getTimezoneOffset()]);
        if(signatures.get(identifier)===signature)continue;
        const [hour, minute] = alarm.time.split(":").map(Number);
        // Campus timetable hours are Africa/Lagos (UTC+1), even on a device set to another zone.
        const campusNow=new Date(Date.now()+3600000);
        const date=new Date(Date.UTC(campusNow.getUTCFullYear(),campusNow.getUTCMonth(),campusNow.getUTCDate()+((day-campusNow.getUTCDay()+7)%7),hour!-1,minute!));
        await Notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: alarm.label,
            body: "Alarm ringing · tap to dismiss or snooze",
            sound: alarm.sound === "default" ? "default" : false,
            categoryIdentifier: "k1-alarm",
            data: { alarmId: alarm.id, alarmLabel: alarm.label, alarmTime: alarm.time, snoozeMinutes: alarm.snooze_minutes, alarmSignature:signature },
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
                  weekday: date.getDay() + 1,
                  hour: date.getHours(),
                  minute: date.getMinutes(),
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
  if (Platform.OS === "web") { stopWebAlarms(); return; }
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (
      n.identifier.startsWith("k1-alarm-") ||
      n.identifier.startsWith("k1-snooze-")
    )
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
export async function scheduleAlarmSnooze({
  alarmId,
  label,
  snoozeMinutes,
  sound = true,
}: {
  alarmId: string;
  label: string;
  snoozeMinutes: number;
  sound?: boolean;
}) {
  if (Platform.OS === "web") return;
  const minutes = Math.max(1, Math.min(30, snoozeMinutes || 5));
  await Notifications.scheduleNotificationAsync({
    identifier: `k1-snooze-${alarmId}-${Date.now()}`,
    content: {
      title: label || "KampusOne alarm",
      body: "Snoozed alarm ringing",
      data: { alarmId, alarmLabel: label, snoozeMinutes: minutes },
      sound: sound ? "default" : false,
      categoryIdentifier: "k1-alarm",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: minutes * 60,
      repeats: false,
      channelId: sound ? "k1-default-true" : "k1-silent-true",
    },
  });
}

function openAlarm(notification: Notifications.Notification) {
  const content = notification.request.content;
  const data = content.data ?? {};
  const alarmId = typeof data.alarmId === "string" ? data.alarmId : "";
  if (!alarmId) return;
  router.push({
    pathname: "/alarm-ring",
    params: {
      alarmId,
      label: typeof data.alarmLabel === "string" ? data.alarmLabel : content.title ?? "Alarm",
      time: typeof data.alarmTime === "string" ? data.alarmTime : "",
      snoozeMinutes: String(Number(data.snoozeMinutes) || 5),
      notificationId: notification.request.identifier,
    },
  } as never);
}

export function listenForSnooze() {
  if (Platform.OS === "web") return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async (n) => ({
      shouldPlaySound: Boolean(n.request.content.sound),
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  const received = Notifications.addNotificationReceivedListener((notification) => {
    if (notification.request.content.categoryIdentifier === "k1-alarm") {
      openAlarm(notification);
    }
  });

  const response = Notifications.addNotificationResponseReceivedListener((r) => {
    if (r.notification.request.content.categoryIdentifier !== "k1-alarm") return;
    const original = r.notification.request.content;
    const alarmId = typeof original.data?.alarmId === "string" ? original.data.alarmId : "";

    if (r.actionIdentifier === "snooze") {
      void scheduleAlarmSnooze({
        alarmId,
        label: typeof original.data?.alarmLabel === "string" ? original.data.alarmLabel : original.title ?? "Alarm",
        snoozeMinutes: Number(original.data?.snoozeMinutes) || 5,
        sound: Boolean(original.sound),
      }).catch(() => undefined);
      return;
    }

    if (r.actionIdentifier === "dismiss") return;
    openAlarm(r.notification);
  });

  return () => {
    received.remove();
    response.remove();
  };
}
