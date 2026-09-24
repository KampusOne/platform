begin;
-- Billing entitlements are written by trusted, verified billing operations only.
create table if not exists app_private.ai_subscriptions (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text not null check(status in ('ACTIVE','CANCELLED','EXPIRED')),
  current_period_end timestamptz not null,
  billing_reference text unique,
  updated_at timestamptz not null default now()
);
revoke all on app_private.ai_subscriptions from public;
create index if not exists ai_requests_personal_policy_idx on app_private.ai_requests(user_id,mode,created_at);
create table if not exists public.profile_follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  followed_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id,followed_id),
  check(follower_id<>followed_id)
);
create index if not exists profile_followers_idx on public.profile_follows(followed_id);
revoke all on public.profile_follows from public;
alter table public.timetable_entries add column if not exists occurs_on date;
alter table public.timetable_entries drop constraint if exists timetable_entries_user_id_day_of_week_starts_at_title_key;
create unique index if not exists timetable_weekly_unique on public.timetable_entries(user_id,day_of_week,starts_at,title) where occurs_on is null;
create unique index if not exists timetable_dated_unique on public.timetable_entries(user_id,occurs_on,starts_at,title) where occurs_on is not null;
-- The AI action ID is also the timetable primary key; retries cannot add duplicates.
create or replace function app_private.sync_timetable_tools() returns trigger
language plpgsql set search_path='' as $$
declare reminder_at timestamp; reminder_day smallint; fire_at timestamptz;
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
  reminder_at:=coalesce(new.occurs_on,date '2026-09-13')+new.starts_at-make_interval(mins=>new.reminder_minutes);
  reminder_day:=((new.day_of_week+(reminder_at::date-coalesce(new.occurs_on,date '2026-09-13'))+7)%7)::smallint;
  fire_at:=case when new.occurs_on is not null then reminder_at at time zone 'Africa/Lagos' else null end;
  insert into public.student_alarms(user_id,institution_id,timetable_entry_id,label,time,days,enabled,fires_at)
  values(new.user_id,new.university_id,new.id,left(new.title,120),reminder_at::time,
    case when fire_at is null then array[reminder_day] else '{}'::smallint[] end,
    new.reminder_enabled and new.status::text='ACTIVE' and (fire_at is null or fire_at>now()),fire_at)
  on conflict(user_id,timetable_entry_id) do update set label=excluded.label,time=excluded.time,days=excluded.days,
    enabled=excluded.enabled,fires_at=excluded.fires_at,updated_at=now();
  return new;
end $$;
revoke all on function app_private.sync_timetable_tools() from public;
drop trigger if exists timetable_tools_sync on public.timetable_entries;
create trigger timetable_tools_sync after insert or update of title,course_code,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled,status,occurs_on
 on public.timetable_entries for each row execute function app_private.sync_timetable_tools();
commit;
