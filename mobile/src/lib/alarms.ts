import { syncWebAlarms, stopWebAlarms } from "./web-alarms";
import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import { nativeAlarms } from "./native-alarms";
import * as Notifications from "expo-notifications";
export type Alarm = {
  id: string;
  label: string;
  time: string;
  days: number[];
  enabled: boolean;
  sound: "default" | "silent" | `media:${string}`;
  sound_name?: string | null;
  sound_url?: string | null;
  vibration: boolean;
  snooze_minutes: number;
  timetable_entry_id?: string | null;
  fires_at?: string | null;
  course_code?: string | null;
  course_title?: string | null;
  class_starts_at?: string | null;
  class_ends_at?: string | null;
  venue?: string | null;
  lecturer?: string | null;
  reminder_minutes?: number | null;
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
      if (nativeAlarms) {
        if (requestPermission) await nativeAlarms.requestExactPermission();
        for (const alarm of alarms) {
          if (alarm.enabled && alarm.sound.startsWith("media:") && alarm.sound_url) {
            try {
              await nativeAlarms.cacheAlarmSound(alarm.id, alarm.sound_url);
            } catch {
              // Reliability first: the native service falls back to the device alarm tone
              // if this particular custom sound cannot be cached.
            }
          }
        }
        const nativeScheduled = await nativeAlarms.sync(JSON.stringify(alarms));
        const nativeReady = await nativeAlarms.status();
        if (nativeScheduled && nativeReady && permissions.granted) {
          for (const item of await Notifications.getAllScheduledNotificationsAsync())
            if (item.identifier.startsWith("k1-alarm-") || item.identifier.startsWith("k1-snooze-"))
              await Notifications.cancelScheduledNotificationAsync(item.identifier);
          return true;
        }
      }
      if (!permissions.granted) return false;
      await Notifications.setNotificationCategoryAsync("k1-alarm", [
        {
          identifier: "snooze",
          buttonTitle: "Snooze",
          options: { opensAppToForeground: true },
        },
        {
          identifier: "dismiss",
          buttonTitle: "Dismiss",
          options: { opensAppToForeground: true },
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
        const notificationSound = alarm.sound === "silent" ? "silent" : "default";
        const [hour, minute] = alarm.time.split(":").map(Number);
        // Campus timetable hours are Africa/Lagos (UTC+1), even on a device set to another zone.
        const campusNow=new Date(Date.now()+3600000);
        const date=new Date(Date.UTC(campusNow.getUTCFullYear(),campusNow.getUTCMonth(),campusNow.getUTCDate()+((day-campusNow.getUTCDay()+7)%7),hour!-1,minute!));
        await Notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: alarm.timetable_entry_id ? alarm.course_code || alarm.label : alarm.label,
            body: alarm.timetable_entry_id
              ? [
                  `Class in ${alarm.reminder_minutes ?? 15} minutes`,
                  alarm.class_starts_at ? `starts ${alarm.class_starts_at}` : null,
                  alarm.venue || null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Time for your reminder",
            sound: notificationSound === "default" ? "default" : false,
            categoryIdentifier: "k1-alarm",
            data: {
              alarmId: alarm.id,
              alarmTime: alarm.time,
              snoozeMinutes: alarm.snooze_minutes,
              alarmSignature: signature,
              label: alarm.label,
              path: `/alarm-ring?alarmId=${alarm.id}`,
              sound: alarm.sound,
              vibration: alarm.vibration,
              courseCode: alarm.course_code ?? undefined,
              classTitle: alarm.course_title ?? undefined,
              classStartsAt: alarm.class_starts_at ?? undefined,
              classEndsAt: alarm.class_ends_at ?? undefined,
              venue: alarm.venue ?? undefined,
              lecturer: alarm.lecturer ?? undefined,
              leadMinutes: alarm.reminder_minutes ?? undefined,
            },
          },
          trigger:
            day === -1
              ? {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: new Date(alarm.fires_at!),
                  channelId: `k1-${notificationSound}-${alarm.vibration}`,
                }
              : {
                  type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                  weekday: date.getDay() + 1,
                  hour: date.getHours(),
                  minute: date.getMinutes(),
                  channelId: `k1-${notificationSound}-${alarm.vibration}`,
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
  if (nativeAlarms) { const active=await nativeAlarms.active(); if(active)await nativeAlarms.dismiss(JSON.parse(active).id); await nativeAlarms.sync("[]"); }
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (
      n.identifier.startsWith("k1-alarm-") ||
      n.identifier.startsWith("k1-snooze-")
    )
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
export async function snoozeNotification(original: Pick<Notifications.NotificationContent,"title"|"body"|"data"|"sound">) {
  const raw = Number(original.data?.snoozeMinutes);
  await Notifications.scheduleNotificationAsync({
    identifier: `k1-snooze-${String(original.data?.alarmId ?? Date.now())}`,
    content: {title: original.title ?? "Reminder",body: original.body ?? "",data: original.data ?? {},sound: original.sound ? "default" : false,categoryIdentifier: "k1-alarm"},
    trigger: {type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,seconds: Math.max(1, Math.min(30, raw || 5)) * 60,repeats: false,channelId: original.sound ? "k1-default-true" : "k1-silent-true"},
  });
}
export function listenForSnooze() {
  if (Platform.OS === "web") return () => {};
  Notifications.setNotificationHandler({handleNotification: async n => ({shouldPlaySound: Boolean(n.request.content.sound),shouldSetBadge: false,shouldShowBanner: true,shouldShowList: true})});
  let disposed=false;
  const handled=new Set<string>();
  const respond=async(r:Notifications.NotificationResponse)=>{
    const key=r.notification.request.identifier+":"+r.notification.date+":"+r.actionIdentifier;
    if(handled.has(key)||disposed)return;handled.add(key);
    const original=r.notification.request.content;
    if(original.categoryIdentifier==='k1-alarm'){
      await Notifications.dismissNotificationAsync(r.notification.request.identifier);
      if(r.actionIdentifier==='snooze'){await snoozeNotification(original);return;}
      if(r.actionIdentifier==='dismiss')return;
      router.push({pathname:'/alarm-ring',params:{
        alarmId:String(original.data?.alarmId??''),
        alarmTime:typeof original.data?.alarmTime==='string'?original.data.alarmTime:undefined,
        label:String(original.data?.label??original.title??'Alarm'),
        snooze:String(original.data?.snoozeMinutes??5),
        notificationId:r.notification.request.identifier,
        courseCode:typeof original.data?.courseCode==='string'?original.data.courseCode:undefined,
        classTitle:typeof original.data?.classTitle==='string'?original.data.classTitle:undefined,
        classStartsAt:typeof original.data?.classStartsAt==='string'?original.data.classStartsAt:undefined,
        classEndsAt:typeof original.data?.classEndsAt==='string'?original.data.classEndsAt:undefined,
        venue:typeof original.data?.venue==='string'?original.data.venue:undefined,
        lecturer:typeof original.data?.lecturer==='string'?original.data.lecturer:undefined,
        leadMinutes:String(original.data?.leadMinutes??15),
      }});
    }else{
      const path=original.data?.path;
      if(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//'))router.push(path as Href);
    }
    await Notifications.clearLastNotificationResponseAsync();
  };
  const response=Notifications.addNotificationResponseReceivedListener(r=>{void respond(r).catch(()=>undefined);});
  void Notifications.getLastNotificationResponseAsync().then(r=>{if(r)void respond(r).catch(()=>undefined);});
  return()=>{disposed=true;response.remove();};
}
