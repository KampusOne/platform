begin;
alter table public.student_alarms add column calendar_event_id uuid references public.student_calendar_events(id) on delete cascade;
create unique index student_alarms_calendar_unique on public.student_alarms(user_id,calendar_event_id) where calendar_event_id is not null;
alter table public.student_exams add column assessment_kind text not null default 'EXAM' check(assessment_kind in('EXAM','TEST'));
alter table public.student_exams add column is_personal boolean not null default false;
alter table public.student_exams add column reminders_enabled boolean not null default true;

create or replace function app_private.sync_exam_alarms(p_user uuid) returns integer language plpgsql set search_path='' as $$
declare paper record; lead integer; alarm uuid; instant timestamptz; n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('exam-schedule:'||p_user::text,0));
 delete from public.student_alarms where id in(select l.alarm_id from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where e.user_id=p_user);
 for paper in
  select chosen.* from (
   (select distinct on(x.exam_date) x.* from public.student_exams x where x.user_id=p_user and not x.is_personal and x.reminders_enabled order by x.exam_date,x.starts_at,x.id)
   union all
   (select x.* from public.student_exams x where x.user_id=p_user and x.is_personal and x.reminders_enabled)
  ) chosen
  where chosen.exam_date>=(now() at time zone 'Africa/Lagos')::date
   and not exists(select 1 from app_private.exam_day_acknowledgements a where a.user_id=p_user and a.exam_date=chosen.exam_date)
  order by chosen.exam_date,chosen.starts_at,chosen.id loop
  foreach lead in array array[120,60,30,15] loop
   instant=((paper.exam_date+paper.starts_at) at time zone 'Africa/Lagos')-make_interval(mins=>lead);
   if instant<=now() then continue;end if;
   alarm=gen_random_uuid();
   insert into public.student_alarms(id,user_id,institution_id,label,time,days,enabled,sound,vibration,snooze_minutes,fires_at)
    values(alarm,p_user,paper.institution_id,coalesce(nullif(paper.course_code,''),paper.title)||case when paper.assessment_kind='TEST' then ' · class test in ' else ' · exam in ' end||lead||' minutes',
     (instant at time zone 'Africa/Lagos')::time,'{}'::smallint[],true,'default',true,5,instant);
   insert into app_private.exam_alarm_links(alarm_id,exam_id,lead_minutes) values(alarm,paper.id,lead);n=n+1;
  end loop;
 end loop;
 return n;
end $$;

create or replace function app_private.import_exam_schedule(p_user uuid,p_institution uuid,p_request uuid,p_hash text,p_entries jsonb)
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
 -- Personal class tests and private exams survive a timetable replacement.
 delete from public.student_alarms where id in(select l.alarm_id from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where e.user_id=p_user and not e.is_personal);
 delete from public.student_exams where user_id=p_user and not is_personal;
 insert into public.student_exams(user_id,institution_id,title,course_code,exam_date,starts_at,ends_at,venue)
  select p_user,p_institution,x.title,x."courseCode",x.date::date,x."startsAt"::time,x."endsAt"::time,x.venue
  from jsonb_to_recordset(p_entries)x(title text,"courseCode" text,date text,"startsAt" text,"endsAt" text,venue text)
  on conflict(user_id,exam_date,starts_at,course_code,title) do nothing;
 get diagnostics n=row_count;
 perform app_private.sync_exam_alarms(p_user);
 insert into app_private.exam_schedule_imports(user_id,request_id,request_hash,imported) values(p_user,p_request,p_hash,n);
 return query select n,false;
end $$;

create function app_private.add_personal_assessment(p_user uuid,p_institution uuid,p_request uuid,p_hash text,p_kind text,p_entry jsonb)
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
 if p_kind not in('EXAM','TEST') or jsonb_typeof(p_entry)<>'object' then raise exception 'EXAM_IMPORT_INVALID';end if;
 if (select count(*) from public.student_exams where user_id=p_user and is_personal)>=20 then raise exception 'PERSONAL_ASSESSMENTS_FULL';end if;
 insert into public.student_exams(user_id,institution_id,title,course_code,exam_date,starts_at,ends_at,venue,assessment_kind,is_personal)
 values(p_user,p_institution,p_entry->>'title',coalesce(p_entry->>'courseCode',''),(p_entry->>'date')::date,(p_entry->>'startsAt')::time,(p_entry->>'endsAt')::time,coalesce(p_entry->>'venue',''),p_kind,true)
 on conflict(user_id,exam_date,starts_at,course_code,title) do nothing;
 get diagnostics n=row_count;
 perform app_private.sync_exam_alarms(p_user);
 insert into app_private.exam_schedule_imports(user_id,request_id,request_hash,imported) values(p_user,p_request,p_hash,n);
 return query select n,false;
end $$;

create function app_private.clear_student_alarms(p_user uuid,p_ids uuid[]) returns integer language plpgsql set search_path='' as $$
declare papers uuid[]; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('exam-schedule:'||p_user::text,0));
 select array_agg(distinct e.id) into papers from public.student_exams e join app_private.exam_alarm_links l on l.exam_id=e.id
  where e.user_id=p_user and l.alarm_id=any(p_ids);
 if exists(select 1 from public.student_exams e where e.user_id=p_user and e.id=any(coalesce(papers,'{}'))
  and (e.exam_date+e.starts_at) at time zone 'Africa/Lagos' > now()
  and ((e.exam_date+e.starts_at) at time zone 'Africa/Lagos')-now()<=interval '3 hours'
  and not exists(select 1 from app_private.exam_day_acknowledgements a where a.user_id=p_user and a.exam_date=e.exam_date)) then
  raise exception 'EXAM_AWARENESS_REQUIRED';
 end if;
 update public.timetable_entries set reminder_enabled=false,updated_at=now() where user_id=p_user
  and id in(select timetable_entry_id from public.student_alarms where user_id=p_user and id=any(p_ids));
 update public.student_exams set reminders_enabled=false where user_id=p_user and id=any(coalesce(papers,'{}'));
 delete from public.student_alarms where user_id=p_user and (id=any(p_ids) or id in(select alarm_id from app_private.exam_alarm_links where exam_id=any(coalesce(papers,'{}'))));
 get diagnostics n=row_count; return n;
end $$;

create function app_private.import_exam_alarms(p_user uuid,p_ids uuid[]) returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('exam-schedule:'||p_user::text,0));
 update public.student_exams set reminders_enabled=true where user_id=p_user and id=any(p_ids)
  and (exam_date+starts_at) at time zone 'Africa/Lagos'>now()
  and not exists(select 1 from app_private.exam_day_acknowledgements a where a.user_id=p_user and a.exam_date=student_exams.exam_date);
 get diagnostics n=row_count;
 perform app_private.sync_exam_alarms(p_user); return n;
end $$;

create function app_private.import_calendar_alarms(p_user uuid,p_ids uuid[],p_time time) returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||'-alarms',0));
 insert into public.student_alarms(user_id,institution_id,label,time,days,enabled,sound,vibration,snooze_minutes,fires_at,calendar_event_id)
 select p_user,e.institution_id,e.title,p_time,'{}'::smallint[],true,'default',true,5,(e.starts_on+p_time) at time zone 'Africa/Lagos',e.id
 from public.student_calendar_events e where e.user_id=p_user and e.id=any(p_ids)
  and (e.starts_on+p_time) at time zone 'Africa/Lagos'>now()
 on conflict(user_id,calendar_event_id) where calendar_event_id is not null
 do update set label=excluded.label,time=excluded.time,fires_at=excluded.fires_at,enabled=true,updated_at=now();
 get diagnostics n=row_count; return n;
end $$;
revoke all on function app_private.add_personal_assessment(uuid,uuid,uuid,text,text,jsonb),app_private.clear_student_alarms(uuid,uuid[]),app_private.import_exam_alarms(uuid,uuid[]),app_private.import_calendar_alarms(uuid,uuid[],time) from public;
commit;
