begin;
-- Additive, review before deployment. No deletion, automatic publication or provider calls.
create table if not exists app_private.staff_access (
 user_id uuid primary key references public.users(id), permissions text[] not null default '{}',
 university_ids uuid[] not null default '{}', all_universities boolean not null default false,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','SUSPENDED')),
 updated_by uuid not null references public.users(id), updated_at timestamptz not null default now(),
 check(all_universities or cardinality(university_ids)>0)
);
create table if not exists public.academic_missing_submissions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),
 institution_id uuid not null references public.universities(id),faculty_name text,department_name text not null,programme_name text,
 source_note text,status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','NEEDS_CORRECTION')),
 linked_department_id uuid references public.departments(id),review_note text,reviewed_by uuid references public.users(id),reviewed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,institution_id,department_name)
);
alter table public.profiles add column if not exists admission_year integer check(admission_year between 1950 and 2200);
alter table public.profiles add column if not exists provisional_academic_submission_id uuid references public.academic_missing_submissions(id);
create table if not exists public.agent_application_drafts (
 user_id uuid primary key references public.users(id),step smallint not null check(step between 0 and 5),values_json jsonb not null,
 updated_at timestamptz not null default now(),check(octet_length(values_json::text)<=65536)
);
alter table public.agent_application_details add column if not exists role_details jsonb not null default '{}';
alter table public.agent_trials alter column expires_at set default (now() + interval '12 months');
-- Existing claimed entitlements remain unchanged until a reviewed adjustment is authorized.
create table if not exists public.product_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),institution_id uuid references public.universities(id),
 event_name text not null check(event_name in ('screen_view','feature_started','feature_completed','feature_failed','timetable_import','study_session','application_submitted')),
 screen text,feature text,error_code text,client_request_id uuid not null,created_at timestamptz not null default now(),unique(user_id,client_request_id)
);
create index if not exists product_events_scope_time_idx on public.product_events(institution_id,created_at desc);
create table if not exists public.feed_reports (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.feed_posts(id),reporter_user_id uuid not null references public.users(id),institution_id uuid not null references public.universities(id),
 reason text not null,status text not null default 'OPEN',created_at timestamptz not null default now(),unique(post_id,reporter_user_id)
);
create table if not exists public.academic_source_documents (
 source_key text primary key,filename text not null,sha256 text not null,metadata_json jsonb not null default '{}',created_at timestamptz not null default now()
);
create table if not exists public.academic_import_batches (
 id uuid primary key default gen_random_uuid(),source_key text not null references public.academic_source_documents(source_key),hash text not null,status text not null default 'STAGED',summary_json jsonb not null default '{}',created_at timestamptz not null default now(),unique(source_key,hash)
);
create table if not exists public.academic_source_claims (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.academic_import_batches(id),source_key text not null references public.academic_source_documents(source_key),
 report_ref text not null,page integer,claim_kind text not null,payload jsonb not null,review_status text not null default 'PENDING' check(review_status in('PENDING','APPROVED','REJECTED')),created_at timestamptz not null default now(),unique(batch_id,report_ref)
);
alter table public.institution_config alter column grading_scale set default '{}'::jsonb;
alter table public.institution_config add column if not exists grading_source_status text not null default 'UNVERIFIED' check(grading_source_status in ('UNVERIFIED','VERIFIED'));
alter table public.feed_posts drop constraint feed_posts_title_check;
alter table public.feed_posts add constraint feed_posts_title_check check(char_length(title) between 1 and 180);
alter table public.feed_posts drop constraint feed_posts_summary_check;
alter table public.feed_posts add constraint feed_posts_summary_check check(char_length(summary) between 1 and 500);
commit;
