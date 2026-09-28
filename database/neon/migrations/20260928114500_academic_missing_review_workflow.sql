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

commit;
