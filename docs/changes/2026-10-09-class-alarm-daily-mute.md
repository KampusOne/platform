# Class alarm follow-up and day-only mute (2026-10-09)

## Problem
Dismissing a regular class timetable alarm could land students on the exam-awareness screen with missing paper details and an unusable confirmation. There was no safe way to silence later class reminders for the remainder of the same day.

## Decision
- The first dismissed **class timetable** reminder of a Lagos day offers an optional choice: continue receiving class alerts, or mute that day's remaining class alerts.
- Actual `EXAM` and `TEST` alarms follow the existing exam email-code awareness process; only their server-linked UUID allows that flow. Personal and calendar alarms are unaffected.
- Persist a `muted_on` Lagos date per timetable-linked alarm. Use a private, user-scoped DB function to mutate only today's class reminders. Never disable the recurring alarm itself.
- Android native alarms, scheduled Expo notifications, web alarms, and snoozes all filter this date. Upcoming alarm previews do not show muted alarms.
- Users can independently mute/resume via the Class timetable group in Alarms. Normal recurrence automatically resumes on the next eligible day.
- The Android native notification Dismiss action records a dismiss event, so on the next foreground session the student may see the first-class reminder decision even if the full-screen React Native route was not opened.
- The class and exam pages use brand typography, static loading states, clear button labels and contextual course information; neither page uses circular loader overlays.

## Safe release order
1. Apply `database/neon/migrations/20261009120000_class_alarm_daily_mute.sql` in the correct production Neon database. Verify column and `app_private.set_class_alarms_muted_today` exist.
2. Release the Worker with `GET /v1/learning/alarms` returning `muted_on`, and `POST /v1/learning/alarms/class-today` available.
3. Release the mobile/web clients and rebuild Android native APK to exercise the native scheduler and notification receiver.
4. Run mobile/Worker CI; on a physical Android device test first-dismiss (in-app and notification action), mute/resume today, another timezone, overnight rollover, true exam OTP, personal and calendar alarms, Android reboot and an offline restore.

No production migration or APK release was executed by this branch alone.
