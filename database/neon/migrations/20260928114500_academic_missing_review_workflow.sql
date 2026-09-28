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
as $$
declare
  submission public.academic_missing_submissions%rowtype;
  v_faculty_id uuid;
  v_department_id uuid;
  v_course_id uuid;
  v_faculty_name text;
  v_department_name text;
  v_programme_name text;
  v_faculty_slug text;
  v_department_slug text;
begin
  select s.*
  into submission
  from public.academic_missing_submissions s
  where s.id=p_submission
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

  v_faculty_name := coalesce(nullif(btrim(p_faculty_name),''),submission.faculty_name);
  v_department_name := coalesce(nullif(btrim(p_department_name),''),submission.department_name);
  v_programme_name := coalesce(nullif(btrim(p_programme_name),''),submission.programme_name);

  if submission.kind='FACULTY' then
    if v_faculty_name is null or char_length(v_faculty_name)<2 then
      raise exception using errcode='22023', message='FACULTY_NAME_REQUIRED';
    end if;
    v_faculty_slug := trim(both '-' from regexp_replace(lower(v_faculty_name),'[^a-z0-9]+','-','g'));
    select f.id into v_faculty_id
    from public.faculties f
    where f.university_id=submission.institution_id
      and f.deleted_at is null
      and (lower(f.name)=lower(v_faculty_name) or f.slug=v_faculty_slug)
    limit 1;
    if v_faculty_id is null then
      v_faculty_id:=gen_random_uuid();
      insert into public.faculties(
        id,university_id,name,slug,primary_source_url,source_verified_at,updated_at
      ) values(
        v_faculty_id,submission.institution_id,v_faculty_name,v_faculty_slug,p_source_url,now(),now()
      );
    else
      update public.faculties f
      set name=v_faculty_name,primary_source_url=p_source_url,source_verified_at=now(),deleted_at=null,updated_at=now()
      where f.id=v_faculty_id;
    end if;
  else
    v_faculty_id:=submission.selected_faculty_id;
    if v_faculty_id is null or not exists(
      select 1 from public.faculties f
      where f.id=v_faculty_id and f.university_id=submission.institution_id and f.deleted_at is null
    ) then
      raise exception using errcode='22023', message='FACULTY_SCOPE_REQUIRED';
    end if;
  end if;

  if submission.kind in ('FACULTY','DEPARTMENT') then
    if v_department_name is null or char_length(v_department_name)<2 then
      raise exception using errcode='22023', message='DEPARTMENT_NAME_REQUIRED';
    end if;
    v_department_slug:=trim(both '-' from regexp_replace(lower(v_department_name),'[^a-z0-9]+','-','g'));
    select d.id into v_department_id
    from public.departments d
    where d.faculty_id=v_faculty_id
      and d.deleted_at is null
      and (lower(d.name)=lower(v_department_name) or d.slug=v_department_slug)
    limit 1;
    if v_department_id is null then
      v_department_id:=gen_random_uuid();
      insert into public.departments(
        id,faculty_id,name,slug,primary_source_url,source_verified_at,updated_at
      ) values(
        v_department_id,v_faculty_id,v_department_name,v_department_slug,p_source_url,now(),now()
      );
    else
      update public.departments d
      set name=v_department_name,primary_source_url=p_source_url,source_verified_at=now(),deleted_at=null,updated_at=now()
      where d.id=v_department_id;
    end if;
  else
    v_department_id:=submission.selected_department_id;
    if v_department_id is null or not exists(
      select 1
      from public.departments d
      join public.faculties f on f.id=d.faculty_id
      where d.id=v_department_id
        and f.id=v_faculty_id
        and f.university_id=submission.institution_id
        and d.deleted_at is null
        and f.deleted_at is null
    ) then
      raise exception using errcode='22023', message='DEPARTMENT_SCOPE_REQUIRED';
    end if;
  end if;

  if v_programme_name is not null and char_length(v_programme_name)>=2 then
    select course.id into v_course_id
    from public.courses course
    where course.department_id=v_department_id
      and course.deleted_at is null
      and lower(course.name)=lower(v_programme_name)
    limit 1;
    if v_course_id is null then
      v_course_id:=gen_random_uuid();
      insert into public.courses(
        id,department_id,name,code,award,normal_duration_years,
        primary_source_url,source_verified_at,updated_at
      ) values(
        v_course_id,v_department_id,v_programme_name,nullif(btrim(p_code),''),
        nullif(btrim(p_award),''),p_duration,p_source_url,now(),now()
      );
    else
      update public.courses course
      set
        name=v_programme_name,
        code=coalesce(nullif(btrim(p_code),''),course.code),
        award=coalesce(nullif(btrim(p_award),''),course.award),
        normal_duration_years=coalesce(p_duration,course.normal_duration_years),
        primary_source_url=p_source_url,
        source_verified_at=now(),
        deleted_at=null,
        updated_at=now()
      where course.id=v_course_id;
    end if;
  elsif submission.kind='PROGRAMME' then
    raise exception using errcode='22023', message='PROGRAMME_NAME_REQUIRED';
  end if;

  update public.academic_missing_submissions s
  set
    faculty_name=v_faculty_name,
    department_name=v_department_name,
    programme_name=v_programme_name,
    status='APPROVED',
    linked_faculty_id=v_faculty_id,
    linked_department_id=v_department_id,
    linked_course_id=v_course_id,
    review_note=p_reason,
    reviewed_by=p_actor,
    reviewed_at=now(),
    updated_at=now()
  where s.id=p_submission;

  update public.profiles p
  set
    faculty_id=v_faculty_id,
    department_id=v_department_id,
    course_id=v_course_id,
    provisional_academic_submission_id=null,
    updated_at=now()
  where p.provisional_academic_submission_id=p_submission
    and p.university_id=submission.institution_id
    and p.deleted_at is null;

  insert into app_private.audit_events(
    actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata
  ) values(
    p_actor,submission.institution_id,'academic.missing_submission.approved',
    'academic_missing_submission',p_submission::text,p_request,'succeeded',
    jsonb_build_object(
      'reason',p_reason,
      'primarySourceUrl',p_source_url,
      'kind',submission.kind,
      'facultyId',v_faculty_id,
      'departmentId',v_department_id,
      'courseId',v_course_id
    )
  );

  return query select 'APPROVED'::text,v_faculty_id,v_department_id,v_course_id;
end;
$$;

revoke all on function app_private.approve_academic_missing_submission(
  uuid,uuid,text,text,text,text,text,text,text,numeric,text
) from public;

commit;
