begin;
alter table public.student_calendar_events add column if not exists completed_at timestamptz;
create table if not exists public.shared_academic_calendars (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.universities(id),
 session_label text not null check(session_label ~ '^[0-9]{4}/[0-9]{4}$'),
 programme_type text not null check(programme_type in ('undergraduate','postgraduate','other')),
 faculty_id uuid references public.faculties(id), department_id uuid references public.departments(id),
 events jsonb not null check(jsonb_typeof(events)='array' and jsonb_array_length(events) between 1 and 80),
 source_title text not null check(length(source_title) between 1 and 160),
 source_import_id uuid not null, submitted_by uuid not null references public.users(id),
 status text not null default 'SUBMITTED' check(status in ('SUBMITTED','PUBLISHED','REJECTED')),
 review_note text, reviewed_by uuid references public.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(submitted_by,source_import_id) references public.calendar_imports(user_id,request_id),
 unique(submitted_by,source_import_id,programme_type),
 check(department_id is null or faculty_id is not null),
 check(status='SUBMITTED' or (reviewed_by is not null and reviewed_at is not null))
);
create index if not exists shared_academic_calendars_scope on public.shared_academic_calendars(institution_id,session_label,programme_type,status);
create table if not exists public.student_level_transitions (
 user_id uuid primary key references public.users(id), institution_id uuid not null references public.universities(id),
 source_course_id uuid not null references public.courses(id),source_import_id uuid not null,
 session_label text not null check(session_label ~ '^[0-9]{4}/[0-9]{4}$'),
 from_level text not null check(from_level ~ '^[1-9]00$'),to_level text not null check(to_level ~ '^[1-9]00$'),
 exam_ends_on date not null, confirmed_at timestamptz not null default now(),
 status text not null default 'PLANNED' check(status in ('PLANNED','COMPLETED','CANCELLED')),
 completed_at timestamptz,
 foreign key(user_id,source_import_id) references public.calendar_imports(user_id,request_id),
 check(to_level::int=from_level::int+100)
);
create index if not exists student_level_transitions_due on public.student_level_transitions(exam_ends_on) where status='PLANNED';
alter table public.shared_academic_calendars enable row level security;
alter table public.student_level_transitions enable row level security;

-- The owner has explicitly confirmed their full-session final examination and next level.
-- A profile transfer, changed level/course, disabled account or curriculum boundary cancels it.
create or replace function app_private.apply_due_academic_progressions() returns integer language plpgsql as $$
declare transition public.student_level_transitions%rowtype; profile public.profiles%rowtype; max_level integer; account_active boolean; applied integer:=0;
begin
 for transition in select * from public.student_level_transitions where status='PLANNED' and exam_ends_on<(now() at time zone 'Africa/Lagos')::date order by exam_ends_on limit 200 for update skip locked loop
  select * into profile from public.profiles where user_id=transition.user_id for update;
  select status::text='ACTIVE' into account_active from public.users where id=transition.user_id;
  select ceil(normal_duration_years)::int*100 into max_level from public.courses where id=transition.source_course_id;
  if profile.user_id is null or profile.deleted_at is not null or not coalesce(account_active,false) or profile.university_id is distinct from transition.institution_id or profile.course_id is distinct from transition.source_course_id or profile.current_level is distinct from transition.from_level or max_level is null or transition.to_level::int>max_level then
   update public.student_level_transitions set status='CANCELLED' where user_id=transition.user_id;
   continue;
  end if;
  update public.profiles set current_level=transition.to_level,updated_at=now() where user_id=transition.user_id;
  update public.student_level_transitions set status='COMPLETED',completed_at=now() where user_id=transition.user_id;
  insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key) values(transition.user_id,transition.institution_id,'Your next level is ready','Your confirmed academic calendar moved your profile to '||transition.to_level||' level. Check your profile if your school schedule changed.','/academic-calendar','level-transition:'||transition.user_id::text||':'||transition.session_label) on conflict do nothing;
  insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata) values(transition.user_id,transition.institution_id,'academic.progression.applied','profile',transition.user_id::text,'succeeded',jsonb_build_object('fromLevel',transition.from_level,'toLevel',transition.to_level,'session',transition.session_label));
  applied:=applied+1;
 end loop;
 return applied;
end;$$;
revoke all on function app_private.apply_due_academic_progressions() from public;
commit;
