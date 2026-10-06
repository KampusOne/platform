begin;
create table public.student_exams(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,
 institution_id uuid not null references public.universities(id),title text not null check(length(title) between 1 and 160),
 course_code text not null default '' check(length(course_code)<=30),exam_date date not null,
 starts_at time not null,ends_at time not null,venue text not null default '' check(length(venue)<=180),
 created_at timestamptz not null default now(),check(ends_at>starts_at),unique(user_id,exam_date,starts_at,course_code,title)
);
create index student_exams_schedule_idx on public.student_exams(user_id,exam_date,starts_at,id);
create table app_private.exam_schedule_imports(user_id uuid not null references public.users(id) on delete cascade,
 request_id uuid not null,request_hash text not null,imported integer not null,created_at timestamptz not null default now(),primary key(user_id,request_id));
create table app_private.exam_day_acknowledgements(user_id uuid not null references public.users(id) on delete cascade,
 exam_date date not null,acknowledged_at timestamptz not null default now(),primary key(user_id,exam_date));
create table app_private.exam_alarm_links(alarm_id uuid primary key references public.student_alarms(id) on delete cascade,
 exam_id uuid not null references public.student_exams(id) on delete cascade,lead_minutes integer not null check(lead_minutes in(120,60,30,15)),unique(exam_id,lead_minutes));
create table app_private.exam_disable_challenges(id uuid primary key,user_id uuid not null references public.users(id) on delete cascade,
 exam_date date not null,code_hash text not null,expires_at timestamptz not null,attempts integer not null default 0 check(attempts between 0 and 5),
 consumed_at timestamptz,created_at timestamptz not null default now());
create index exam_disable_pending_idx on app_private.exam_disable_challenges(user_id,created_at desc);
alter table public.student_exams enable row level security;
alter table app_private.exam_schedule_imports enable row level security;
alter table app_private.exam_day_acknowledgements enable row level security;
alter table app_private.exam_alarm_links enable row level security;
alter table app_private.exam_disable_challenges enable row level security;
revoke all on public.student_exams,app_private.exam_schedule_imports,app_private.exam_day_acknowledgements,app_private.exam_alarm_links,app_private.exam_disable_challenges from public;
create function app_private.sync_exam_alarms(p_user uuid) returns integer language plpgsql set search_path='' as $$
declare paper record; lead integer; alarm uuid; instant timestamptz;n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('exam-schedule:'||p_user::text,0));
 -- Remove only linked exam alarms; ordinary alarms remain user-owned.
 delete from public.student_alarms where id in(select l.alarm_id from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where e.user_id=p_user);
 for paper in select distinct on(exam_date) x.* from public.student_exams x
   where x.user_id=p_user and x.exam_date>=(now() at time zone 'Africa/Lagos')::date
   and not exists(select 1 from app_private.exam_day_acknowledgements a where a.user_id=p_user and a.exam_date=x.exam_date)
   order by exam_date,starts_at,id loop
  foreach lead in array array[120,60,30,15] loop
   instant=((paper.exam_date+paper.starts_at) at time zone 'Africa/Lagos')-make_interval(mins=>lead);
   if instant<=now() then continue;end if;
   alarm=gen_random_uuid();
   insert into public.student_alarms(id,user_id,institution_id,label,time,days,enabled,sound,vibration,snooze_minutes,fires_at)
    values(alarm,p_user,paper.institution_id,coalesce(nullif(paper.course_code,''),paper.title)||' · exam in '||lead||' minutes',
     (instant at time zone 'Africa/Lagos')::time,'{}'::smallint[],true,'default',true,5,instant);
   insert into app_private.exam_alarm_links(alarm_id,exam_id,lead_minutes) values(alarm,paper.id,lead);n=n+1;
  end loop;
 end loop;
 return n;
end $$;
create function app_private.import_exam_schedule(p_user uuid,p_institution uuid,p_request uuid,p_hash text,p_entries jsonb)
returns table(imported integer,replayed boolean) language plpgsql set search_path='' as $$
declare prior app_private.exam_schedule_imports; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('exam-schedule:'||p_user::text,0));
 if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_institution and deleted_at is null) then raise exception 'EXAM_TENANT_CHANGED';end if;
 select * into prior from app_private.exam_schedule_imports where user_id=p_user and request_id=p_request;
 if found then
  if prior.request_hash<>p_hash then raise exception 'EXAM_REQUEST_CONFLICT';end if;
  return query select prior.imported,true;return;
 end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 80 then raise exception 'EXAM_IMPORT_INVALID';end if;
 -- Replacing a schedule also removes its previous alarms, including reminders
 -- which would otherwise outlive the deleted paper through the link cascade.
 delete from public.student_alarms where id in(select l.alarm_id from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where e.user_id=p_user);
 delete from public.student_exams where user_id=p_user;
 insert into public.student_exams(user_id,institution_id,title,course_code,exam_date,starts_at,ends_at,venue)
  select p_user,p_institution,x.title,x."courseCode",x.date::date,x."startsAt"::time,x."endsAt"::time,x.venue
  from jsonb_to_recordset(p_entries)x(title text,"courseCode" text,date text,"startsAt" text,"endsAt" text,venue text);
 get diagnostics n=row_count;
 perform app_private.sync_exam_alarms(p_user);
 insert into app_private.exam_schedule_imports(user_id,request_id,request_hash,imported) values(p_user,p_request,p_hash,n);
 return query select n,false;
end $$;
create function app_private.confirm_exam_awareness(p_user uuid,p_challenge uuid,p_hash text) returns text language plpgsql set search_path='' as $$
declare c app_private.exam_disable_challenges;
begin
 perform pg_advisory_xact_lock(hashtextextended('exam-schedule:'||p_user::text,0));
 select * into c from app_private.exam_disable_challenges where id=p_challenge and user_id=p_user for update;
 if not found or c.expires_at<=now() or c.attempts>=5 then return 'EXPIRED';end if;
 if c.consumed_at is not null then return 'ALREADY_CONFIRMED';end if;
 if c.code_hash<>p_hash then update app_private.exam_disable_challenges set attempts=attempts+1 where id=c.id;return 'INCORRECT';end if;
 insert into app_private.exam_day_acknowledgements(user_id,exam_date) values(p_user,c.exam_date) on conflict do nothing;
 update public.student_alarms set enabled=false,updated_at=now() where user_id=p_user and id in(
  select l.alarm_id from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where e.user_id=p_user and e.exam_date=c.exam_date);
 update app_private.exam_disable_challenges set consumed_at=now() where id=c.id;
 return 'CONFIRMED';
end $$;
revoke all on function app_private.sync_exam_alarms(uuid) from public;
revoke all on function app_private.import_exam_schedule(uuid,uuid,uuid,text,jsonb) from public;
revoke all on function app_private.confirm_exam_awareness(uuid,uuid,text) from public;
create index ai_private_memory_search_idx on app_private.ai_requests using gin(to_tsvector('english',coalesce(result->>'prompt','')))
 where status='COMPLETED' and mode<>'timetable';
commit;
