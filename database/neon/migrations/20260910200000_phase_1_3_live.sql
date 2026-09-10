begin;

create extension if not exists pgcrypto;
create schema if not exists app_private;

-- Preserve identities created by the earlier v1.2 API. The old schema remains
-- untouched so the import is reversible and can be reconciled before cleanup.
do $$
begin
  if to_regclass('kampusone_v12."User"') is not null then
    execute $import_users$
      insert into public.users (
        id, email, password_hash, roles, status, email_verified_at,
        created_at, updated_at, last_login_at
      )
      select
        legacy.id,
        lower(legacy.email),
        legacy."passwordHash",
        array['STUDENT'::"UserRole"],
        case legacy."accountStatus"::text
          when 'SUSPENDED' then 'SUSPENDED'::"AccountStatus"
          when 'DISABLED' then 'DEACTIVATED'::"AccountStatus"
          else 'ACTIVE'::"AccountStatus"
        end,
        legacy."emailVerifiedAt",
        legacy."createdAt",
        legacy."updatedAt",
        legacy."lastSuccessfulLoginAt"
      from kampusone_v12."User" legacy
      where legacy."passwordHash" like '$argon2id$%'
      on conflict (id) do nothing
    $import_users$;

    execute $import_profiles$
      insert into public.profiles (
        id, user_id, username, display_name, first_name, last_name,
        onboarding_step, created_at, updated_at
      )
      select
        gen_random_uuid(),
        legacy.id,
        left(regexp_replace(split_part(lower(legacy.email), '@', 1), '[^a-z0-9_]', '', 'g'), 23)
          || '_' || left(legacy.id::text, 6),
        'Student',
        null,
        null,
        case when legacy."emailVerifiedAt" is null then 'EMAIL_VERIFICATION' else 'PROFILE' end,
        legacy."createdAt",
        legacy."updatedAt"
      from kampusone_v12."User" legacy
      where exists (select 1 from public.users imported_user where imported_user.id = legacy.id)
      on conflict (user_id) do nothing
    $import_profiles$;
  end if;
end;
$$;

alter table public.refresh_tokens
  add column if not exists device_label text,
  add column if not exists last_used_at timestamptz,
  add column if not exists ip_address inet,
  add column if not exists user_agent text;

create index if not exists refresh_tokens_active_lookup_idx
  on public.refresh_tokens (user_id, expires_at)
  where revoked_at is null;

create index if not exists verification_tokens_active_lookup_idx
  on public.verification_tokens (user_id, type, expires_at)
  where used_at is null;

create table if not exists app_private.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references public.users(id) on delete set null,
  university_id uuid references public.universities(id) on delete set null,
  action text not null check (char_length(action) between 3 and 120),
  target_type text not null check (char_length(target_type) between 2 and 80),
  target_id text,
  request_id text,
  outcome text not null check (outcome in ('succeeded', 'denied', 'failed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists audit_events_scope_time_idx
  on app_private.audit_events (university_id, occurred_at desc);

create or replace function app_private.prevent_append_only_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists audit_events_append_only on app_private.audit_events;
create trigger audit_events_append_only
before update or delete on app_private.audit_events
for each row execute function app_private.prevent_append_only_mutation();

create table if not exists public.operator_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  university_id uuid references public.universities(id) on delete cascade,
  role text not null check (role in (
    'PLATFORM_ADMIN', 'INSTITUTION_ADMIN', 'CONTENT_EDITOR',
    'VERIFICATION_REVIEWER', 'SUPPORT', 'FINANCE_REVIEWER'
  )),
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique nulls not distinct (user_id, university_id, role),
  check ((role = 'PLATFORM_ADMIN' and university_id is null) or role <> 'PLATFORM_ADMIN')
);

create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  course_code text check (char_length(course_code) <= 24),
  venue text check (char_length(venue) <= 160),
  lecturer text check (char_length(lecturer) <= 120),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  reminder_minutes smallint not null default 15 check (reminder_minutes between 0 and 240),
  reminder_enabled boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (user_id, day_of_week, starts_at, title)
);

create index if not exists timetable_user_day_idx
  on public.timetable_entries (user_id, day_of_week, starts_at)
  where status = 'ACTIVE';

create table if not exists public.gpa_terms (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  session_label text not null check (char_length(session_label) between 4 and 24),
  semester smallint not null check (semester in (1, 2, 3)),
  level_code text not null check (char_length(level_code) between 3 and 12),
  gpa numeric(4,3),
  earned_units numeric(6,2) not null default 0,
  quality_points numeric(8,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session_label, semester)
);

create table if not exists public.gpa_results (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.gpa_terms(id) on delete cascade,
  course_code text not null check (char_length(course_code) between 2 and 24),
  course_title text not null check (char_length(course_title) between 2 and 180),
  units numeric(3,1) not null check (units > 0 and units <= 30),
  grade text not null check (char_length(grade) between 1 and 3),
  grade_point numeric(3,2) not null check (grade_point between 0 and 7),
  created_at timestamptz not null default now(),
  unique (term_id, course_code)
);

create table if not exists public.content_sources (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  source_url text,
  verified boolean not null default false,
  owner_user_id uuid references public.users(id) on delete set null,
  review_due_at timestamptz,
  created_at timestamptz not null default now(),
  unique (university_id, name)
);

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  source_id uuid not null references public.content_sources(id) on delete restrict,
  author_user_id uuid references public.users(id) on delete set null,
  category text not null check (category in ('UPDATE', 'EVENT', 'SPORTS', 'OPPORTUNITY', 'EMERGENCY')),
  title text not null check (char_length(title) between 4 and 180),
  summary text not null check (char_length(summary) between 4 and 500),
  body text not null,
  image_url text,
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED')),
  urgent boolean not null default false,
  sponsored boolean not null default false,
  published_at timestamptz,
  scheduled_for timestamptz,
  correction_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feed_posts_scope_published_idx
  on public.feed_posts (university_id, published_at desc)
  where status in ('PUBLISHED', 'CORRECTED');

create table if not exists public.feed_bookmarks (
  user_id uuid not null references public.users(id) on delete cascade,
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.campus_places (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  category text not null check (category in ('ACADEMIC', 'SERVICE', 'TRANSPORT', 'HOSTEL', 'FOOD', 'HEALTH', 'SPORT')),
  description text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  accessibility_notes text,
  image_url text,
  source_id uuid references public.content_sources(id) on delete set null,
  verified_at timestamptz,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, name)
);

create table if not exists public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  agent_type text not null check (agent_type in ('TUTOR', 'VENDOR', 'RIDER')),
  display_name text not null check (char_length(display_name) between 2 and 120),
  phone_e164 text not null check (char_length(phone_e164) between 8 and 20),
  statement text not null check (char_length(statement) between 20 and 1000),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'SUBMITTED' check (status in ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'NEEDS_CORRECTION', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  reviewer_user_id uuid references public.users(id) on delete set null,
  review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (university_id, user_id, agent_type)
);

create index if not exists agent_applications_review_queue_idx
  on public.agent_applications (university_id, status, submitted_at);

create table if not exists public.agent_profiles (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  application_id uuid not null references public.agent_applications(id) on delete restrict,
  agent_type text not null check (agent_type in ('TUTOR', 'VENDOR', 'RIDER')),
  display_name text not null,
  biography text,
  verified_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, user_id, agent_type)
);

create table if not exists public.tutorial_listings (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  tutor_profile_id uuid not null references public.agent_profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  course_code text not null check (char_length(course_code) between 2 and 24),
  title text not null check (char_length(title) between 3 and 160),
  description text not null check (char_length(description) between 20 and 2000),
  format text not null check (format in ('IN_PERSON', 'ONLINE', 'HYBRID')),
  price_kobo integer not null check (price_kobo >= 0),
  capacity integer not null check (capacity between 1 and 500),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutorial_listings_discovery_idx
  on public.tutorial_listings (university_id, course_code, status);

create table if not exists public.tutorial_bookings (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  listing_id uuid not null references public.tutorial_listings(id) on delete restrict,
  student_user_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'PENDING_PAYMENT' check (status in ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED')),
  amount_kobo integer not null check (amount_kobo >= 0),
  provider_reference text,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_products (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  vendor_profile_id uuid not null references public.agent_profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  description text not null check (char_length(description) between 10 and 2000),
  category text not null check (char_length(category) between 2 and 80),
  price_kobo integer not null check (price_kobo >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  image_url text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_products_discovery_idx
  on public.vendor_products (university_id, category, status);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  buyer_user_id uuid not null references public.users(id) on delete restrict,
  vendor_profile_id uuid not null references public.agent_profiles(id) on delete restrict,
  status text not null default 'PENDING_PAYMENT' check (status in ('PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'READY', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'DISPUTED')),
  subtotal_kobo integer not null check (subtotal_kobo >= 0),
  delivery_fee_kobo integer not null default 0 check (delivery_fee_kobo >= 0),
  total_kobo integer generated always as (subtotal_kobo + delivery_fee_kobo) stored,
  provider_reference text,
  delivery_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.vendor_products(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 100),
  unit_price_kobo integer not null check (unit_price_kobo >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  base_fee_kobo integer not null check (base_fee_kobo >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (university_id, name)
);

create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  zone_id uuid not null references public.delivery_zones(id) on delete restrict,
  rider_profile_id uuid references public.agent_profiles(id) on delete set null,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'RESERVED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED')),
  pickup_code_hash text not null,
  delivery_code_hash text not null,
  reserved_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_jobs_queue_idx
  on public.delivery_jobs (university_id, status, created_at);

create table if not exists public.delivery_events (
  id bigint generated always as identity primary key,
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 80),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz not null default now()
);

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  opened_by_user_id uuid not null references public.users(id) on delete restrict,
  tutorial_booking_id uuid references public.tutorial_bookings(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 1000),
  status text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED')),
  assigned_to_user_id uuid references public.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((tutorial_booking_id is not null)::int + (order_id is not null)::int = 1)
);

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  university_id uuid references public.universities(id) on delete cascade,
  owner_user_id uuid references public.users(id) on delete restrict,
  account_code text not null check (char_length(account_code) between 3 and 80),
  account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY')),
  currency char(3) not null default 'NGN',
  created_at timestamptz not null default now(),
  unique nulls not distinct (university_id, owner_user_id, account_code)
);

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  university_id uuid references public.universities(id) on delete restrict,
  reference_type text not null check (char_length(reference_type) between 3 and 50),
  reference_id text not null,
  idempotency_key text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_lines (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  amount_kobo bigint not null check (amount_kobo > 0),
  created_at timestamptz not null default now()
);

create or replace function app_private.validate_balanced_ledger_transaction(target_transaction_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(sum(case when direction = 'DEBIT' then amount_kobo else -amount_kobo end), 0) = 0
  from public.ledger_lines
  where transaction_id = target_transaction_id;
$$;

create table if not exists public.release_phases (
  phase_key text primary key,
  title text not null,
  status text not null check (status in ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'READY', 'LIVE')),
  summary text not null,
  requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements) = 'array'),
  updated_at timestamptz not null default now()
);

insert into public.release_phases (phase_key, title, status, summary, requirements)
values
  ('phase-1', 'Student utility alpha', 'IN_PROGRESS', 'Authentication, onboarding, Today, Feed, Campus, timetable, GPA and operator CMS.', '["Resend API key and verified sender", "Cloudflare Worker production secrets", "Named UNIBEN content owners"]'::jsonb),
  ('phase-2', 'Tutorial pilot', 'IN_PROGRESS', 'Tutor applications, review, listings, bookings, earnings and disputes.', '["KYC provider decision", "Paystack marketplace approval", "Pilot tutor reviewers"]'::jsonb),
  ('phase-3', 'Store and bicycle logistics beta', 'IN_PROGRESS', 'Vendor catalogue, orders, rider applications, zones and delivery handoff codes.', '["Vendor category policy", "Rider insurance and safety policy", "Payment settlement approval"]'::jsonb)
on conflict (phase_key) do update
set title = excluded.title,
    status = excluded.status,
    summary = excluded.summary,
    requirements = excluded.requirements,
    updated_at = now();

commit;
