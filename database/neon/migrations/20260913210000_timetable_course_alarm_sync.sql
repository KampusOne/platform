begin;
create or replace function app_private.sync_timetable_tools() returns trigger
language plpgsql set search_path='' as $$
declare reminder_at timestamp; reminder_day smallint;
begin
  if new.status::text='ARCHIVED' then
    delete from public.student_alarms where user_id=new.user_id and timetable_entry_id=new.id;
    return new;
  end if;
  if nullif(trim(new.course_code),'') is not null then
    insert into public.course_drafts(user_id,institution_id,course_code,title)
    values(new.user_id,new.university_id,upper(trim(new.course_code)),new.title)
    on conflict(user_id,course_code) do update set title=excluded.title,updated_at=now();
  end if;
  reminder_at:=date '2026-09-13'+new.starts_at-make_interval(mins=>new.reminder_minutes);
  reminder_day:=((new.day_of_week+(reminder_at::date-date '2026-09-13')+7)%7)::smallint;
  insert into public.student_alarms(user_id,institution_id,timetable_entry_id,label,time,days,enabled)
  values(new.user_id,new.university_id,new.id,left(new.title,120),reminder_at::time,array[reminder_day],new.reminder_enabled)
  on conflict(user_id,timetable_entry_id) do update set label=excluded.label,time=excluded.time,days=excluded.days,enabled=excluded.enabled,updated_at=now();
  return new;
end $$;
revoke all on function app_private.sync_timetable_tools() from public;
drop trigger if exists timetable_tools_sync on public.timetable_entries;
create trigger timetable_tools_sync after insert or update of title,course_code,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled,status on public.timetable_entries for each row execute function app_private.sync_timetable_tools();
-- Backfill course names only. Existing device-alert preferences are not enabled.
insert into public.course_drafts(user_id,institution_id,course_code,title)
select distinct on(user_id,upper(trim(course_code))) user_id,university_id,upper(trim(course_code)),title
from public.timetable_entries where status::text<>'ARCHIVED' and nullif(trim(course_code),'') is not null
order by user_id,upper(trim(course_code)),updated_at desc on conflict do nothing;
commit;
