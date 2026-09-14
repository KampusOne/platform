begin;

-- Additive migration. Existing accounts, orders and journal entries are retained.
alter table public.users add column if not exists supabase_user_id uuid unique;
alter table public.profiles add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.profiles alter column first_name type varchar(60), alter column last_name type varchar(60), alter column display_name type varchar(121), alter column biography type varchar(300);
alter table public.feed_posts add column if not exists client_request_id uuid;
create unique index if not exists feed_author_request_idx on public.feed_posts(author_user_id,client_request_id) where client_request_id is not null;

create table if not exists public.institution_config (
  institution_id uuid primary key references public.universities(id),
  status text not null default 'PREPARING' check (status in ('CATALOGUED','PREPARING','LIVE','PAUSED')),
  timezone text not null default 'Africa/Lagos',
  grading_scale jsonb not null default '{"A":5,"B":4,"C":3,"D":2,"E":1,"F":0}',
  map_config jsonb not null default '{}',
  source_url text,
  updated_at timestamptz not null default now()
);
insert into public.institution_config (institution_id, status)
select id, case when slug = 'uniben' then 'LIVE' else 'PREPARING' end from public.universities
on conflict do nothing;

create table if not exists public.media_objects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id),
  institution_id uuid references public.universities(id),
  kind text not null check (kind in ('avatar','cover','product','post','resource','kyc','support')),
  object_key text not null unique,
  content_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  original_name text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists media_owner_idx on public.media_objects(owner_user_id, created_at desc);

create table if not exists public.account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  institution_id uuid references public.universities(id),
  kind text not null check (kind in ('SUSPENDED','BANNED')),
  reason text not null check (char_length(reason) between 3 and 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references public.users(id),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists restrictions_active_idx on public.account_restrictions(user_id, starts_at desc) where revoked_at is null;

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  institution_id uuid references public.universities(id),
  category text not null check (category in ('ACCOUNT','ORDER','TUTORIAL','DELIVERY','PAYMENT','SAFETY','CONTENT','APPEAL','PRIVACY')),
  subject text not null check (char_length(subject) between 3 and 160),
  body text not null check (char_length(body) between 5 and 4000),
  status text not null default 'OPEN' check (status in ('OPEN','IN_REVIEW','RESOLVED')),
  reply text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists support_scope_idx on public.support_requests(institution_id, status, created_at desc);
create index if not exists support_owner_idx on public.support_requests(user_id, created_at desc);

create table if not exists public.in_app_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  institution_id uuid references public.universities(id),
  title text not null, body text not null, path text, read_at timestamptz,
  dedupe_key text unique, created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.in_app_notifications(user_id, created_at desc);
create table if not exists app_private.notification_outbox (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  channel text not null check (channel in ('EMAIL','PUSH')), subject text not null, body text not null,
  dedupe_key text not null unique, attempts integer not null default 0,
  state text not null default 'PENDING' check (state in ('PENDING','PROCESSING','SENT','FAILED')),
  next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index if not exists outbox_pending_idx on app_private.notification_outbox(next_attempt_at) where state in ('PENDING','PROCESSING');

create table if not exists public.course_drafts (
  user_id uuid not null references public.users(id), institution_id uuid not null references public.universities(id),
  course_code text not null, title text not null, units numeric(4,1) check (units > 0 and units <= 30),
  grade text, updated_at timestamptz not null default now(), primary key (user_id, course_code)
);
create table if not exists public.student_alarms (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  institution_id uuid references public.universities(id), timetable_entry_id uuid references public.timetable_entries(id),
  label text not null check (char_length(label) between 1 and 120),
  time time not null, days smallint[] not null default '{}',
  enabled boolean not null default true, sound text not null default 'default',
  vibration boolean not null default true, snooze_minutes integer not null default 5 check (snooze_minutes between 1 and 30),
  updated_at timestamptz not null default now(),
  unique (user_id, timetable_entry_id), check (days <@ array[0,1,2,3,4,5,6]::smallint[])
);
create index if not exists alarms_owner_idx on public.student_alarms(user_id);
create table if not exists public.user_streaks (
  user_id uuid primary key references public.users(id), current_days integer not null default 0 check (current_days >= 0),
  longest_days integer not null default 0 check (longest_days >= 0), last_day date,
  goal_days integer not null default 7 check (goal_days between 1 and 365), updated_at timestamptz not null default now()
);
create or replace function app_private.check_in_streak(target_user uuid)
returns setof public.user_streaks language sql set search_path = '' as $$
  insert into public.user_streaks(user_id, current_days, longest_days, last_day)
  values(target_user, 1, 1, (now() at time zone 'Africa/Lagos')::date)
  on conflict (user_id) do update set
    current_days = case when user_streaks.last_day = excluded.last_day then user_streaks.current_days
      when user_streaks.last_day = excluded.last_day - 1 then user_streaks.current_days + 1 else 1 end,
    longest_days = greatest(user_streaks.longest_days, case when user_streaks.last_day = excluded.last_day then user_streaks.current_days
      when user_streaks.last_day = excluded.last_day - 1 then user_streaks.current_days + 1 else 1 end),
    last_day = excluded.last_day, updated_at = now()
  returning *;
$$;

create table if not exists public.agent_application_details (
  application_id uuid primary key references public.agent_applications(id),
  birth_date date not null, is_student boolean not null,
  matric_number text, department text, business_name text, business_address text,
  identity_document_id uuid not null references public.media_objects(id),
  portrait_document_id uuid not null references public.media_objects(id),
  student_document_id uuid references public.media_objects(id),
  guardian_name text, guardian_phone text, guardian_email text, guardian_relationship text,
  guardian_consent_at timestamptz, guardian_reviewed_by uuid references public.users(id),
  guardian_evidence text, terms_version text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.agent_trials (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.users(id),
  institution_id uuid not null references public.universities(id),
  claimed_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '10 months'),
  revoked_at timestamptz, revoked_by uuid references public.users(id), reason text,
  check (expires_at > claimed_at)
);
create index if not exists trials_scope_expiry_idx on public.agent_trials(institution_id, expires_at);

create table if not exists public.institution_guidelines (
  id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.universities(id),
  department_id uuid references public.departments(id), title text not null,
  body text not null, source_url text, status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by uuid not null references public.users(id), published_by uuid references public.users(id),
  published_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists guidelines_scope_idx on public.institution_guidelines(institution_id, department_id, status);

create table if not exists public.cohort_communities (
  id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.universities(id),
  department_id uuid not null references public.departments(id), admission_year integer not null,
  name text not null, level_code text not null, rep_user_id uuid references public.users(id),
  archived_at timestamptz, created_at timestamptz not null default now(),
  unique (institution_id, department_id, admission_year), unique (id, institution_id)
);
create table if not exists public.community_members (
  community_id uuid not null references public.cohort_communities(id), user_id uuid not null references public.users(id),
  verified_at timestamptz, verified_by uuid references public.users(id), joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members(user_id, community_id);
create table if not exists public.community_elections (
  id uuid primary key default gen_random_uuid(), community_id uuid not null references public.cohort_communities(id),
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','CLOSED','TIED','CANCELLED')),
  winner_user_id uuid references public.users(id), created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(), check (ends_at > starts_at)
);
create unique index if not exists elections_one_open_idx on public.community_elections(community_id) where status = 'SCHEDULED';
create table if not exists public.community_candidates (
  election_id uuid not null references public.community_elections(id), user_id uuid not null references public.users(id),
  created_at timestamptz not null default now(), primary key (election_id, user_id)
);
create table if not exists app_private.community_votes (
  election_id uuid not null references public.community_elections(id), voter_id uuid not null references public.users(id),
  candidate_id uuid not null, created_at timestamptz not null default now(), primary key (election_id, voter_id),
  foreign key(election_id, candidate_id) references public.community_candidates(election_id, user_id)
);
create index if not exists votes_tally_idx on app_private.community_votes(election_id, candidate_id);
create table if not exists public.community_announcements (
  id uuid primary key default gen_random_uuid(), community_id uuid not null references public.cohort_communities(id),
  author_id uuid not null references public.users(id), title text not null, body text not null,
  created_at timestamptz not null default now()
);
create index if not exists announcements_community_idx on public.community_announcements(community_id, created_at desc);
create table if not exists public.community_rep_transfers (
  id uuid primary key default gen_random_uuid(), community_id uuid not null references public.cohort_communities(id),
  from_user_id uuid not null references public.users(id), to_user_id uuid not null references public.users(id),
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','APPROVED','CANCELLED')),
  created_at timestamptz not null default now(), approved_by uuid references public.users(id)
);

-- No exposed data API. The Worker is the only data boundary.
do $$ declare t text; begin
  foreach t in array array['institution_config','media_objects','account_restrictions','support_requests','in_app_notifications',
    'course_drafts','student_alarms','user_streaks','agent_application_details','agent_trials','institution_guidelines',
    'cohort_communities','community_members','community_elections','community_candidates','community_announcements','community_rep_transfers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
  end loop;
end $$;
revoke all on app_private.community_votes, app_private.notification_outbox from public;
revoke all on function app_private.check_in_streak(uuid) from public;
commit;
