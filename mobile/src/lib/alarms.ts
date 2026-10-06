import {api} from "./api";
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
  calendar_event_id?: string | null;
  assessment_kind?: "TEST" | "EXAM" | null;
  exam_id?: string | null;
  exam_lead_minutes?: number | null;
  pause_from?: string | null;
  pause_until?: string | null;
};
export function normalizeAlarm(value: unknown): Alarm | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  const alarmDays = Array.isArray(raw.days)
    ? raw.days
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const rawSound = typeof raw.sound === "string" ? raw.sound : "default";
  const sound: Alarm["sound"] =
    rawSound === "silent" || rawSound === "default" || rawSound.startsWith("media:")
      ? (rawSound as Alarm["sound"])
      : "default";
  const time =
    typeof raw.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)
      ? raw.time
      : "08:00";
  const snooze = Number(raw.snooze_minutes);
  return {
    id: raw.id,
    calendar_event_id:typeof raw.calendar_event_id==="string"?raw.calendar_event_id:null,
    assessment_kind:raw.assessment_kind==="TEST"?"TEST":raw.assessment_kind==="EXAM"?"EXAM":null,
    exam_id:typeof raw.exam_id==="string"?raw.exam_id:null,
    exam_lead_minutes:Number.isFinite(Number(raw.exam_lead_minutes))?Number(raw.exam_lead_minutes):null,
    pause_from:typeof raw.pause_from==="string"?raw.pause_from:null,
    pause_until:typeof raw.pause_until==="string"?raw.pause_until:null,
    label:
      typeof raw.label === "string" && raw.label.trim() ? raw.label : "Alarm",
    time,
    days: Array.from(new Set(alarmDays)),
    enabled: raw.enabled !== false,
    sound,
    sound_name: typeof raw.sound_name === "string" ? raw.sound_name : null,
    sound_url: typeof raw.sound_url === "string" ? raw.sound_url : null,
    vibration: raw.vibration !== false,
    snooze_minutes: Number.isFinite(snooze)
      ? Math.max(1, Math.min(30, Math.trunc(snooze)))
      : 5,
    timetable_entry_id:
      typeof raw.timetable_entry_id === "string" ? raw.timetable_entry_id : null,
    fires_at: typeof raw.fires_at === "string" ? raw.fires_at : null,
    course_code: typeof raw.course_code === "string" ? raw.course_code : null,
    course_title: typeof raw.course_title === "string" ? raw.course_title : null,
    class_starts_at:
      typeof raw.class_starts_at === "string" ? raw.class_starts_at : null,
    class_ends_at:
      typeof raw.class_ends_at === "string" ? raw.class_ends_at : null,
    venue: typeof raw.venue === "string" ? raw.venue : null,
    lecturer: typeof raw.lecturer === "string" ? raw.lecturer : null,
    reminder_minutes: Number.isFinite(Number(raw.reminder_minutes))
      ? Number(raw.reminder_minutes)
      : null,
  };
}
export function normalizeAlarms(value: unknown): Alarm[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeAlarm)
    .filter((alarm): alarm is Alarm => Boolean(alarm));
}
let queue: Promise<unknown> = Promise.resolve();
export async function syncAlarms(
  alarms: Alarm[],
  requestPermission = false,
): Promise<boolean> {
  alarms = normalizeAlarms(alarms);
  try{const runtime=await api<{policy:{alarms_enabled:boolean}}>("/v1/notifications/runtime");if(runtime?.policy?.alarms_enabled===false)alarms=alarms.map(alarm=>({...alarm,enabled:false}));}catch{/* Keep the last known local schedule available offline. */}
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
      const expected = new Map<string, { alarm: Alarm; day: number; date?:Date }>();
      for (const alarm of alarms.filter((a) => a.enabled)) {
        if(alarm.days.length&&alarm.timetable_entry_id&&alarm.pause_from&&alarm.pause_until){
          const campusNow=new Date(Date.now()+3600000),[hour,minute]=alarm.time.split(':').map(Number);
          for(let offset=0;offset<56;offset++){
            const date=new Date(Date.UTC(campusNow.getUTCFullYear(),campusNow.getUTCMonth(),campusNow.getUTCDate()+offset,hour!-1,minute!));
            const localDay=new Date(date.getTime()+3600000),key=localDay.toISOString().slice(0,10);
            if(date.getTime()<=Date.now()||!alarm.days.includes(localDay.getUTCDay())||(key>=alarm.pause_from&&key<=alarm.pause_until))continue;
            expected.set(`k1-alarm-${alarm.id}-${key}`,{alarm,day:-1,date});
          }
          continue;
        }
        for (const day of alarm.days.length
          ? alarm.days
          : alarm.fires_at && Date.parse(alarm.fires_at) > Date.now()
            ? [-1]
            : [])
          expected.set(`k1-alarm-${alarm.id}-${day}`, { alarm, day });
      }
      if (Platform.OS === "ios" && expected.size > 60) {
        const entries=[...expected.entries()].sort((a,b)=>(a[1].date?.getTime()??(a[1].alarm.fires_at?Date.parse(a[1].alarm.fires_at):0))-(b[1].date?.getTime()??(b[1].alarm.fires_at?Date.parse(b[1].alarm.fires_at):0)));
        expected.clear();for(const [key,value]of entries.slice(0,60))expected.set(key,value);
      }
      const signatures = new Map(scheduled.map(entry=>[entry.identifier,entry.content.data?.alarmSignature]));
      // Preserve unchanged reminders so a refresh cannot cancel an imminent alarm.
      for (const entry of scheduled)
        if (entry.identifier.startsWith("k1-alarm-") && !expected.has(entry.identifier))
          await Notifications.cancelScheduledNotificationAsync(
            entry.identifier,
          );
      for (const [identifier, { alarm, day,date:occurrence }] of expected) {
        const signature=JSON.stringify([alarm.time,alarm.days,alarm.fires_at,alarm.pause_from,alarm.pause_until,occurrence?.toISOString(),alarm.label,alarm.sound,alarm.vibration,alarm.snooze_minutes,new Date().getTimezoneOffset()]);
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
            body: alarm.exam_id ? `First exam in ${alarm.exam_lead_minutes??15} minutes${alarm.venue?' · '+alarm.venue:''}` : alarm.timetable_entry_id
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
              examId:alarm.exam_id??undefined,
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
                  date: occurrence??new Date(alarm.fires_at!),
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
      if(r.actionIdentifier==='dismiss'){if(original.data?.examId)router.push({pathname:'/exam-awareness',params:{alarmId:String(original.data.alarmId)}});return;}
      router.push({pathname:'/alarm-ring',params:{
        alarmId:String(original.data?.alarmId??''),
        examId:typeof original.data?.examId==='string'?original.data.examId:undefined,
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
