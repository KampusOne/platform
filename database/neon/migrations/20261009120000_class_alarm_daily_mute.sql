begin;
-- Students may quiet their timetable alarms for one Lagos calendar day.
-- This does not disable the recurring alarm or affect exams, calendar or personal reminders.
alter table public.student_alarms add column if not exists muted_on date;
comment on column public.student_alarms.muted_on is 'Africa/Lagos date on which this alarm is temporarily silenced. Recurrence resumes the next day.';
-- The private function owns scope and concurrency: it cannot quiet personal,
-- calendar, or assessment alarms, nor any other student's reminders.
create function app_private.set_class_alarms_muted_today(p_user uuid,p_muted boolean)
returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('class-alarms:'||p_user::text,0));
  update public.student_alarms alarm
  set muted_on = case when p_muted then (now() at time zone 'Africa/Lagos')::date else null end,
      updated_at = now()
  where alarm.user_id=p_user and alarm.enabled and alarm.timetable_entry_id is not null
    and not exists(select 1 from app_private.exam_alarm_links l where l.alarm_id=alarm.id)
    and (
      extract(dow from now() at time zone 'Africa/Lagos')::smallint=any(alarm.days)
      or (cardinality(alarm.days)=0 and alarm.fires_at is not null
          and (alarm.fires_at at time zone 'Africa/Lagos')::date=(now() at time zone 'Africa/Lagos')::date)
    )
    and (p_muted or alarm.muted_on=(now() at time zone 'Africa/Lagos')::date);
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function app_private.set_class_alarms_muted_today(uuid,boolean) from public;
commit;
