begin;

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

-- The connected project contains a database hook helper that should never be callable
-- through client roles. The hook can continue to run internally without these grants.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  short_name text not null check (char_length(short_name) between 2 and 24),
  status text not null default 'setup' check (status in ('setup', 'active', 'paused', 'archived')),
  timezone text not null default 'Africa/Lagos',
  country_code text not null default 'NG' check (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  locality text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, slug),
  unique (institution_id, id)
);

create table public.faculties (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  code text not null check (char_length(code) between 2 and 20),
  name text not null check (char_length(name) between 2 and 140),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  unique (institution_id, id)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  faculty_id uuid not null,
  code text not null check (char_length(code) between 2 and 20),
  name text not null check (char_length(name) between 2 and 140),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  unique (institution_id, id),
  foreign key (institution_id, faculty_id)
    references public.faculties(institution_id, id)
    on delete restrict
);

create table public.programmes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  department_id uuid not null,
  code text not null check (char_length(code) between 2 and 24),
  name text not null check (char_length(name) between 2 and 160),
  award text not null check (char_length(award) between 2 and 60),
  duration_years smallint not null check (duration_years between 1 and 8),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  unique (institution_id, id),
  foreign key (institution_id, department_id)
    references public.departments(institution_id, id)
    on delete restrict
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Student' check (char_length(display_name) between 1 and 80),
  avatar_path text,
  active_institution_id uuid references public.institutions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.institution_memberships (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_type text not null check (member_type in ('student', 'staff', 'agent', 'ambassador', 'alumni')),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'revoked')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, user_id),
  unique (institution_id, id)
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (
    role in (
      'platform_operator',
      'institution_admin',
      'academic_admin',
      'verification_agent',
      'support_agent',
      'course_rep'
    )
  ),
  assigned_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (role = 'platform_operator' and institution_id is null)
    or (role <> 'platform_operator' and institution_id is not null)
  )
);

create unique index role_assignments_scoped_unique
  on public.role_assignments (user_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), role);

create table public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  membership_id uuid not null,
  programme_id uuid not null,
  matriculation_number text,
  entry_year smallint not null check (entry_year between 1980 and 2200),
  current_level smallint not null check (current_level between 100 and 900),
  verification_tier smallint not null default 0 check (verification_tier between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id),
  unique nulls not distinct (institution_id, matriculation_number),
  foreign key (institution_id, membership_id)
    references public.institution_memberships(institution_id, id)
    on delete cascade,
  foreign key (institution_id, programme_id)
    references public.programmes(institution_id, id)
    on delete restrict
);

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  code text not null check (char_length(code) between 2 and 30),
  name text not null check (char_length(name) between 2 and 80),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'current', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (institution_id, code),
  unique (institution_id, id)
);

create unique index one_current_term_per_institution
  on public.academic_terms (institution_id)
  where status = 'current';

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  department_id uuid not null,
  code text not null check (char_length(code) between 2 and 24),
  title text not null check (char_length(title) between 2 and 180),
  units numeric(3,1) not null check (units > 0 and units <= 30),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  unique (institution_id, id),
  foreign key (institution_id, department_id)
    references public.departments(institution_id, id)
    on delete restrict
);

create table public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  term_id uuid not null,
  course_id uuid not null,
  section text not null default 'default' check (char_length(section) between 1 and 40),
  status text not null default 'draft' check (status in ('draft', 'published', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, course_id, section),
  unique (institution_id, id),
  foreign key (institution_id, term_id)
    references public.academic_terms(institution_id, id)
    on delete cascade,
  foreign key (institution_id, course_id)
    references public.courses(institution_id, id)
    on delete restrict
);

create table public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  offering_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'dropped', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offering_id, user_id),
  foreign key (institution_id, offering_id)
    references public.course_offerings(institution_id, id)
    on delete cascade
);

create table public.timetable_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  offering_id uuid,
  owner_user_id uuid references auth.users(id) on delete cascade,
  source text not null check (source in ('institution', 'course', 'personal')),
  event_type text not null check (event_type in ('class', 'exam', 'deadline', 'meeting', 'personal')),
  title text not null check (char_length(title) between 1 and 160),
  venue_name text check (char_length(venue_name) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'moved', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (
    (source = 'personal' and owner_user_id is not null)
    or (source <> 'personal' and owner_user_id is null)
  ),
  foreign key (institution_id, offering_id)
    references public.course_offerings(institution_id, id)
    on delete cascade
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  enabled boolean not null default false,
  client_visible boolean not null default false,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index feature_flags_scoped_unique
  on public.feature_flags (coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table app_private.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  institution_id uuid references public.institutions(id) on delete set null,
  action text not null check (char_length(action) between 3 and 120),
  target_type text not null check (char_length(target_type) between 2 and 80),
  target_id text,
  request_id text,
  outcome text not null check (outcome in ('succeeded', 'denied', 'failed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table app_private.provider_controls (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  provider text not null check (char_length(provider) between 2 and 60),
  feature text not null check (char_length(feature) between 2 and 80),
  enabled boolean not null default false,
  per_user_daily_limit integer check (per_user_daily_limit is null or per_user_daily_limit >= 0),
  global_daily_limit integer check (global_daily_limit is null or global_daily_limit >= 0),
  alert_at_percent smallint not null default 70 check (alert_at_percent between 1 and 100),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create unique index provider_controls_scoped_unique
  on app_private.provider_controls (
    coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
    provider,
    feature
  );

create table app_private.usage_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  institution_id uuid references public.institutions(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  feature text not null,
  units numeric(16,4) not null check (units >= 0),
  unit_name text not null,
  outcome text not null check (outcome in ('succeeded', 'rejected', 'failed', 'degraded')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  request_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table app_private.idempotency_records (
  scope text not null,
  key text not null,
  request_hash text not null,
  response_status smallint,
  response_body jsonb,
  locked_until timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (scope, key),
  check (expires_at > created_at)
);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.is_active_member(target_institution_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.institution_memberships membership
    where membership.institution_id = target_institution_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  );
$$;

create or replace function app_private.has_any_role(target_institution_id uuid, accepted_roles text[], target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments assignment
    where assignment.user_id = target_user_id
      and assignment.role = any(accepted_roles)
      and (assignment.expires_at is null or assignment.expires_at > now())
      and (
        (assignment.role = 'platform_operator' and assignment.institution_id is null)
        or assignment.institution_id = target_institution_id
      )
  );
$$;

create or replace function app_private.is_enrolled(target_offering_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_enrollments enrollment
    where enrollment.offering_id = target_offering_id
      and enrollment.user_id = target_user_id
      and enrollment.status = 'active'
  );
$$;

create or replace function app_private.ensure_active_institution_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active_institution_id is not null
    and not app_private.is_active_member(new.active_institution_id, new.id)
  then
    raise exception 'Active institution must be an active membership';
  end if;
  return new;
end;
$$;

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(requested_name, 'Student'), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function app_private.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;
revoke all on function app_private.is_active_member(uuid, uuid) from public, anon;
revoke all on function app_private.has_any_role(uuid, text[], uuid) from public, anon;
revoke all on function app_private.is_enrolled(uuid, uuid) from public, anon;
revoke all on function app_private.ensure_active_institution_membership() from public, anon, authenticated;
revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;
revoke all on function app_private.prevent_append_only_mutation() from public, anon, authenticated;

grant usage on schema app_private to authenticated;
grant execute on function app_private.is_active_member(uuid, uuid) to authenticated;
grant execute on function app_private.has_any_role(uuid, text[], uuid) to authenticated;
grant execute on function app_private.is_enrolled(uuid, uuid) to authenticated;

create trigger profiles_updated_at before update on public.profiles
for each row execute function app_private.set_updated_at();
create trigger profiles_active_institution before insert or update of active_institution_id on public.profiles
for each row execute function app_private.ensure_active_institution_membership();
create trigger memberships_updated_at before update on public.institution_memberships
for each row execute function app_private.set_updated_at();
create trigger institutions_updated_at before update on public.institutions
for each row execute function app_private.set_updated_at();
create trigger campuses_updated_at before update on public.campuses
for each row execute function app_private.set_updated_at();
create trigger faculties_updated_at before update on public.faculties
for each row execute function app_private.set_updated_at();
create trigger departments_updated_at before update on public.departments
for each row execute function app_private.set_updated_at();
create trigger programmes_updated_at before update on public.programmes
for each row execute function app_private.set_updated_at();
create trigger student_profiles_updated_at before update on public.student_profiles
for each row execute function app_private.set_updated_at();
create trigger academic_terms_updated_at before update on public.academic_terms
for each row execute function app_private.set_updated_at();
create trigger courses_updated_at before update on public.courses
for each row execute function app_private.set_updated_at();
create trigger course_offerings_updated_at before update on public.course_offerings
for each row execute function app_private.set_updated_at();
create trigger course_enrollments_updated_at before update on public.course_enrollments
for each row execute function app_private.set_updated_at();
create trigger timetable_events_updated_at before update on public.timetable_events
for each row execute function app_private.set_updated_at();
create trigger feature_flags_updated_at before update on public.feature_flags
for each row execute function app_private.set_updated_at();

create trigger auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();

create trigger audit_events_append_only
before update or delete on app_private.audit_events
for each row execute function app_private.prevent_append_only_mutation();
create trigger usage_events_append_only
before update or delete on app_private.usage_events
for each row execute function app_private.prevent_append_only_mutation();

create index memberships_user_status_idx
  on public.institution_memberships (user_id, status, institution_id);
create index role_assignments_lookup_idx
  on public.role_assignments (user_id, institution_id, role, expires_at);
create index student_profiles_programme_idx
  on public.student_profiles (institution_id, programme_id);
create index course_offerings_term_idx
  on public.course_offerings (institution_id, term_id, status);
create index course_enrollments_user_idx
  on public.course_enrollments (user_id, status, offering_id);
create index timetable_events_window_idx
  on public.timetable_events (institution_id, starts_at, ends_at)
  where status <> 'cancelled';
create index timetable_events_owner_idx
  on public.timetable_events (owner_user_id, starts_at)
  where source = 'personal';
create index audit_events_institution_time_idx
  on app_private.audit_events (institution_id, occurred_at desc);
create index usage_events_provider_time_idx
  on app_private.usage_events (provider, feature, occurred_at desc);
create index idempotency_records_expiry_idx
  on app_private.idempotency_records (expires_at);

alter table public.institutions enable row level security;
alter table public.campuses enable row level security;
alter table public.faculties enable row level security;
alter table public.departments enable row level security;
alter table public.programmes enable row level security;
alter table public.profiles enable row level security;
alter table public.institution_memberships enable row level security;
alter table public.role_assignments enable row level security;
alter table public.student_profiles enable row level security;
alter table public.academic_terms enable row level security;
alter table public.courses enable row level security;
alter table public.course_offerings enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.timetable_events enable row level security;
alter table public.feature_flags enable row level security;

alter table public.institutions force row level security;
alter table public.campuses force row level security;
alter table public.faculties force row level security;
alter table public.departments force row level security;
alter table public.programmes force row level security;
alter table public.profiles force row level security;
alter table public.institution_memberships force row level security;
alter table public.role_assignments force row level security;
alter table public.student_profiles force row level security;
alter table public.academic_terms force row level security;
alter table public.courses force row level security;
alter table public.course_offerings force row level security;
alter table public.course_enrollments force row level security;
alter table public.timetable_events force row level security;
alter table public.feature_flags force row level security;

create policy institutions_read on public.institutions
for select to authenticated
using (
  status = 'active'
  or app_private.is_active_member(id)
  or app_private.has_any_role(id, array['platform_operator', 'institution_admin'])
);

create policy campuses_member_read on public.campuses
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy faculties_member_read on public.faculties
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy departments_member_read on public.departments
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy programmes_member_read on public.programmes
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy profiles_self_read on public.profiles
for select to authenticated
using (id = auth.uid());

create policy profiles_self_update on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy memberships_self_read on public.institution_memberships
for select to authenticated
using (user_id = auth.uid());

create policy role_assignments_self_read on public.role_assignments
for select to authenticated
using (user_id = auth.uid());

create policy student_profiles_self_read on public.student_profiles
for select to authenticated
using (
  exists (
    select 1
    from public.institution_memberships membership
    where membership.id = student_profiles.membership_id
      and membership.user_id = auth.uid()
  )
);

create policy academic_terms_member_read on public.academic_terms
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy courses_member_read on public.courses
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy course_offerings_member_read on public.course_offerings
for select to authenticated
using (app_private.is_active_member(institution_id));

create policy course_enrollments_self_read on public.course_enrollments
for select to authenticated
using (user_id = auth.uid());

create policy timetable_events_relevant_read on public.timetable_events
for select to authenticated
using (
  app_private.is_active_member(institution_id)
  and (
    owner_user_id = auth.uid()
    or source = 'institution'
    or (source = 'course' and app_private.is_enrolled(offering_id))
  )
);

create policy timetable_events_personal_insert on public.timetable_events
for insert to authenticated
with check (
  source = 'personal'
  and owner_user_id = auth.uid()
  and offering_id is null
  and app_private.is_active_member(institution_id)
);

create policy timetable_events_personal_update on public.timetable_events
for update to authenticated
using (source = 'personal' and owner_user_id = auth.uid())
with check (
  source = 'personal'
  and owner_user_id = auth.uid()
  and offering_id is null
  and app_private.is_active_member(institution_id)
);

create policy timetable_events_personal_delete on public.timetable_events
for delete to authenticated
using (source = 'personal' and owner_user_id = auth.uid());

create policy feature_flags_visible_read on public.feature_flags
for select to authenticated
using (
  client_visible
  and (
    institution_id is null
    or app_private.is_active_member(institution_id)
  )
);

revoke all on table public.institutions from anon, authenticated;
revoke all on table public.campuses from anon, authenticated;
revoke all on table public.faculties from anon, authenticated;
revoke all on table public.departments from anon, authenticated;
revoke all on table public.programmes from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.institution_memberships from anon, authenticated;
revoke all on table public.role_assignments from anon, authenticated;
revoke all on table public.student_profiles from anon, authenticated;
revoke all on table public.academic_terms from anon, authenticated;
revoke all on table public.courses from anon, authenticated;
revoke all on table public.course_offerings from anon, authenticated;
revoke all on table public.course_enrollments from anon, authenticated;
revoke all on table public.timetable_events from anon, authenticated;
revoke all on table public.feature_flags from anon, authenticated;

grant select on table public.institutions to authenticated;
grant select on table public.campuses to authenticated;
grant select on table public.faculties to authenticated;
grant select on table public.departments to authenticated;
grant select on table public.programmes to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_path, active_institution_id) on table public.profiles to authenticated;
grant select on table public.institution_memberships to authenticated;
grant select on table public.role_assignments to authenticated;
grant select on table public.student_profiles to authenticated;
grant select on table public.academic_terms to authenticated;
grant select on table public.courses to authenticated;
grant select on table public.course_offerings to authenticated;
grant select on table public.course_enrollments to authenticated;
grant select, insert, update, delete on table public.timetable_events to authenticated;
grant select on table public.feature_flags to authenticated;

alter table app_private.audit_events enable row level security;
alter table app_private.provider_controls enable row level security;
alter table app_private.usage_events enable row level security;
alter table app_private.idempotency_records enable row level security;

comment on schema app_private is 'Server-only operational data; never expose through the Supabase Data API.';
comment on table public.role_assignments is 'Trusted authorization assignments. Never derive these roles from user-editable metadata.';
comment on table public.feature_flags is 'Feature availability. Sensitive provider and spend controls remain in app_private.provider_controls.';
comment on table app_private.audit_events is 'Append-only security and operator audit trail.';
comment on table app_private.provider_controls is 'Fail-closed provider kill switches and quota configuration.';

commit;
