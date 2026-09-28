begin;

-- Student-reported academic catalogue gaps.
-- Preserve valid parent selections so a missing programme does not erase a known
-- faculty/department, and a missing department does not erase a known faculty.

alter table public.academic_missing_submissions
  add column if not exists kind text not null default 'DEPARTMENT';

alter table public.academic_missing_submissions
  drop constraint if exists academic_missing_submissions_kind_check;

alter table public.academic_missing_submissions
  add constraint academic_missing_submissions_kind_check
  check (kind in ('FACULTY','DEPARTMENT','PROGRAMME'));

alter table public.academic_missing_submissions
  alter column department_name drop not null;

alter table public.academic_missing_submissions
  add column if not exists selected_faculty_id uuid references public.faculties(id),
  add column if not exists selected_department_id uuid references public.departments(id),
  add column if not exists linked_faculty_id uuid references public.faculties(id),
  add column if not exists linked_course_id uuid references public.courses(id);

alter table public.faculties
  add column if not exists primary_source_url text,
  add column if not exists source_verified_at timestamptz;

alter table public.departments
  add column if not exists primary_source_url text,
  add column if not exists source_verified_at timestamptz;

-- Existing records represented a missing department path.
update public.academic_missing_submissions
set kind = 'DEPARTMENT'
where kind is null or kind not in ('FACULTY','DEPARTMENT','PROGRAMME');

alter table public.academic_missing_submissions
  drop constraint if exists academic_missing_submissions_user_id_institution_id_department_name_key;

create index if not exists academic_missing_submission_queue_idx
  on public.academic_missing_submissions(institution_id,status,created_at desc);

create unique index if not exists academic_missing_open_dedupe_idx
  on public.academic_missing_submissions(
    user_id,
    institution_id,
    kind,
    coalesce(faculty_name,''),
    coalesce(department_name,''),
    coalesce(programme_name,'')
  )
  where status in ('PENDING','NEEDS_CORRECTION');


create or replace function app_private.approve_academic_missing_submission(
  p_submission uuid,
  p_actor uuid,
  p_source_url text,
  p_reason text,
  p_faculty_name text default null,
  p_department_name text default null,
  p_programme_name text default null,
  p_code text default '',
  p_award text default '',
  p_duration numeric default null,
  p_request text default null
)
returns table(
  outcome text,
  published_faculty_id uuid,
  published_department_id uuid,
  published_course_id uuid
)
language plpgsql
set search_path=''
as $
declare
  submission public.academic_missing_submissions%rowtype;
  faculty_id uuid;
  department_id uuid;
  course_id uuid;
  faculty_name text;
  department_name text;
  programme_name text;
  faculty_slug text;
  department_slug text;
begin
  select *
  into submission
  from public.academic_missing_submissions
  where id=p_submission
  for update;

  if not found then
    return query select 'NOT_FOUND'::text,null::uuid,null::uuid,null::uuid;
    return;
  end if;

  if submission.status not in ('PENDING','NEEDS_CORRECTION') then
    return query select 'CONFLICT'::text,submission.linked_faculty_id,submission.linked_department_id,submission.linked_course_id;
    return;
  end if;

  if p_source_url is null or btrim(p_source_url)='' or p_reason is null or char_length(btrim(p_reason))<10 then
    raise exception using errcode='22023', message='SOURCE_AND_REASON_REQUIRED';
  end if;

  faculty_name := coalesce(nullif(btrim(p_faculty_name),''),submission.faculty_name);
  department_name := coalesce(nullif(btrim(p_department_name),''),submission.department_name);
  programme_name := coalesce(nullif(btrim(p_programme_name),''),submission.programme_name);

  if submission.kind='FACULTY' then
    if faculty_name is null or char_length(faculty_name)<2 then
      raise exception using errcode='22023', message='FACULTY_NAME_REQUIRED';
    end if;
    faculty_slug := trim(both '-' from regexp_replace(lower(faculty_name),'[^a-z0-9]+','-','g'));
    select id into faculty_id
    from public.faculties
    where university_id=submission.institution_id
      and deleted_at is null
      and (lower(name)=lower(faculty_name) or slug=faculty_slug)
    limit 1;
    if faculty_id is null then
      faculty_id:=gen_random_uuid();
      insert into public.faculties(
        id,university_id,name,slug,primary_source_url,source_verified_at,updated_at
      ) values(
        faculty_id,submission.institution_id,faculty_name,faculty_slug,p_source_url,now(),now()
      );
    else
      update public.faculties
      set name=faculty_name,primary_source_url=p_source_url,source_verified_at=now(),deleted_at=null,updated_at=now()
      where id=faculty_id;
    end if;
  else
    faculty_id:=submission.selected_faculty_id;
    if faculty_id is null or not exists(
      select 1 from public.faculties
      where id=faculty_id and university_id=submission.institution_id and deleted_at is null
    ) then
      raise exception using errcode='22023', message='FACULTY_SCOPE_REQUIRED';
    end if;
  end if;

  if submission.kind in ('FACULTY','DEPARTMENT') then
    if department_name is null or char_length(department_name)<2 then
      raise exception using errcode='22023', message='DEPARTMENT_NAME_REQUIRED';
    end if;
    department_slug:=trim(both '-' from regexp_replace(lower(department_name),'[^a-z0-9]+','-','g'));
    select id into department_id
    from public.departments
    where faculty_id=faculty_id
      and deleted_at is null
      and (lower(name)=lower(department_name) or slug=department_slug)
    limit 1;
    if department_id is null then
      department_id:=gen_random_uuid();
      insert into public.departments(
        id,faculty_id,name,slug,primary_source_url,source_verified_at,updated_at
      ) values(
        department_id,faculty_id,department_name,department_slug,p_source_url,now(),now()
      );
    else
      update public.departments
      set name=department_name,primary_source_url=p_source_url,source_verified_at=now(),deleted_at=null,updated_at=now()
      where id=department_id;
    end if;
  else
    department_id:=submission.selected_department_id;
    if department_id is null or not exists(
      select 1
      from public.departments d
      join public.faculties f on f.id=d.faculty_id
      where d.id=department_id
        and f.id=faculty_id
        and f.university_id=submission.institution_id
        and d.deleted_at is null
        and f.deleted_at is null
    ) then
      raise exception using errcode='22023', message='DEPARTMENT_SCOPE_REQUIRED';
    end if;
  end if;

  if programme_name is not null and char_length(programme_name)>=2 then
    select id into course_id
    from public.courses
    where department_id=department_id
      and deleted_at is null
      and lower(name)=lower(programme_name)
    limit 1;
    if course_id is null then
      course_id:=gen_random_uuid();
      insert into public.courses(
        id,department_id,name,code,award,normal_duration_years,
        primary_source_url,source_verified_at,updated_at
      ) values(
        course_id,department_id,programme_name,nullif(btrim(p_code),''),
        nullif(btrim(p_award),''),p_duration,p_source_url,now(),now()
      );
    else
      update public.courses
      set
        name=programme_name,
        code=coalesce(nullif(btrim(p_code),''),code),
        award=coalesce(nullif(btrim(p_award),''),award),
        normal_duration_years=coalesce(p_duration,normal_duration_years),
        primary_source_url=p_source_url,
        source_verified_at=now(),
        deleted_at=null,
        updated_at=now()
      where id=course_id;
    end if;
  elsif submission.kind='PROGRAMME' then
    raise exception using errcode='22023', message='PROGRAMME_NAME_REQUIRED';
  end if;

  update public.academic_missing_submissions
  set
    faculty_name=faculty_name,
    department_name=department_name,
    programme_name=programme_name,
    status='APPROVED',
    linked_faculty_id=faculty_id,
    linked_department_id=department_id,
    linked_course_id=course_id,
    review_note=p_reason,
    reviewed_by=p_actor,
    reviewed_at=now(),
    updated_at=now()
  where id=p_submission;

  update public.profiles
  set
    faculty_id=faculty_id,
    department_id=department_id,
    course_id=course_id,
    provisional_academic_submission_id=null,
    updated_at=now()
  where provisional_academic_submission_id=p_submission
    and university_id=submission.institution_id
    and deleted_at is null;

  insert into app_private.audit_events(
    actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata
  ) values(
    p_actor,submission.institution_id,'academic.missing_submission.approved',
    'academic_missing_submission',p_submission::text,p_request,'succeeded',
    jsonb_build_object(
      'reason',p_reason,
      'primarySourceUrl',p_source_url,
      'kind',submission.kind,
      'facultyId',faculty_id,
      'departmentId',department_id,
      'courseId',course_id
    )
  );

  return query select 'APPROVED'::text,faculty_id,department_id,course_id;
end;
$;

revoke all on function app_private.approve_academic_missing_submission(
  uuid,uuid,text,text,text,text,text,text,text,numeric,text
) from public;

commit;
