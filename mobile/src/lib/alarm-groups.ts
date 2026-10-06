import type { Alarm } from "./alarms";
export const alarmCategories = [
  { id: "REGULAR", title: "Personal alarms", description: "Your everyday plans", icon: "alarm-outline" },
  { id: "TIMETABLE", title: "Class timetable", description: "Reminders before your classes", icon: "book-outline" },
  { id: "EXAM", title: "Exams & tests", description: "Stay awake and ready for your paper", icon: "school-outline" },
  { id: "CALENDAR", title: "Academic calendar", description: "Important campus dates", icon: "calendar-outline" },
] as const;
export type AlarmCategory = typeof alarmCategories[number]["id"];
export function alarmCategory(alarm: Alarm): AlarmCategory {
  if (alarm.exam_id) return "EXAM";
  if (alarm.calendar_event_id) return "CALENDAR";
  if (alarm.timetable_entry_id) return "TIMETABLE";
  return "REGULAR";
}
