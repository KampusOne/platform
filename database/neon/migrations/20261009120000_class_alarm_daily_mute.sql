begin;
-- Students may quiet their timetable alarms for one Lagos calendar day.
-- This does not disable the recurring alarm or affect exams, calendar or personal reminders.
alter table public.student_alarms add column if not exists muted_on date;
comment on column public.student_alarms.muted_on is 'Africa/Lagos date on which this alarm is temporarily silenced. Recurrence resumes the next day.';
commit;
