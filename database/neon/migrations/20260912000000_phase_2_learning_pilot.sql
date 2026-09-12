begin;

-- Phase 2 is a tutorial pilot, independent from the store and logistics
-- release gates. Demo records are explicitly labelled and can be withdrawn
-- without deleting bookings, reviews, payment evidence, or audit history.
alter table public.tutorial_listings
  add column if not exists publisher_name text,
  add column if not exists location_text text,
  add column if not exists cancellation_cutoff_hours smallint not null default 2,
  add column if not exists review_status text not null default 'DRAFT',
  add column if not exists review_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_key text,
  add column if not exists deleted_at timestamptz;

alter table public.tutorial_listings alter column tutor_profile_id drop not null;
alter table public.tutorial_listings drop constraint if exists tutorial_listings_status_check;
alter table public.tutorial_listings add constraint tutorial_listings_status_check
  check (status in ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'PAUSED', 'REJECTED', 'ARCHIVED'));
alter table public.tutorial_listings drop constraint if exists tutorial_listings_review_status_check;
alter table public.tutorial_listings add constraint tutorial_listings_review_status_check
  check (review_status in ('DRAFT', 'PENDING', 'APPROVED', 'NEEDS_CORRECTION', 'REJECTED'));
alter table public.tutorial_listings drop constraint if exists tutorial_listings_cancellation_cutoff_check;
alter table public.tutorial_listings add constraint tutorial_listings_cancellation_cutoff_check
  check (cancellation_cutoff_hours between 0 and 168);
alter table public.tutorial_listings drop constraint if exists tutorial_listings_owner_check;
alter table public.tutorial_listings add constraint tutorial_listings_owner_check
  check (
    (is_demo and tutor_profile_id is null and publisher_name is not null)
    or (not is_demo and tutor_profile_id is not null)
  );

update public.tutorial_listings
set review_status = case when status = 'PUBLISHED' then 'APPROVED' else review_status end,
    publisher_name = coalesce(publisher_name, (
      select profiles.display_name from public.agent_profiles profiles
      where profiles.id = tutorial_listings.tutor_profile_id
    ));

create unique index if not exists tutorial_listings_demo_key_unique
  on public.tutorial_listings (university_id, demo_key)
  where demo_key is not null;
create index if not exists tutorial_listings_phase2_discovery_idx
  on public.tutorial_listings (university_id, status, updated_at desc)
  where deleted_at is null;

create table if not exists public.tutorial_resources (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  tutor_profile_id uuid references public.agent_profiles(id) on delete set null,
  listing_id uuid references public.tutorial_listings(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  course_code text not null check (char_length(course_code) between 2 and 24),
  title text not null check (char_length(title) between 3 and 180),
  description text not null check (char_length(description) between 10 and 2000),
  resource_type text not null check (resource_type in ('PAST_QUESTION', 'NOTE', 'PDF', 'AUDIOBOOK')),
  access_model text not null default 'FREE' check (access_model in ('FREE', 'BOOKING_INCLUDED', 'PAID')),
  price_kobo integer not null default 0 check (price_kobo >= 0),
  level_code text check (level_code is null or char_length(level_code) between 3 and 20),
  batch_label text check (batch_label is null or char_length(batch_label) between 2 and 60),
  publisher_name text not null check (char_length(publisher_name) between 2 and 120),
  publisher_verified boolean not null default false,
  preview_text text check (preview_text is null or char_length(preview_text) <= 5000),
  file_url text,
  page_count integer check (page_count is null or page_count > 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  download_count integer not null default 0 check (download_count >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'ARCHIVED')),
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  is_demo boolean not null default false,
  demo_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (not publisher_verified or tutor_profile_id is not null),
  check (not is_demo or demo_key is not null)
);

create unique index if not exists tutorial_resources_demo_key_unique
  on public.tutorial_resources (university_id, demo_key)
  where demo_key is not null;
create index if not exists tutorial_resources_discovery_idx
  on public.tutorial_resources (university_id, resource_type, updated_at desc)
  where status = 'PUBLISHED' and deleted_at is null;

create table if not exists public.tutorial_reviews (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  booking_id uuid not null unique references public.tutorial_bookings(id) on delete restrict,
  listing_id uuid not null references public.tutorial_listings(id) on delete restrict,
  student_user_id uuid not null references public.users(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) between 3 and 1000),
  status text not null default 'PUBLISHED' check (status in ('PUBLISHED', 'HIDDEN', 'REMOVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutorial_reviews_listing_idx
  on public.tutorial_reviews (listing_id, created_at desc)
  where status = 'PUBLISHED';

alter table public.tutorial_bookings
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists no_show_reported_at timestamptz,
  add column if not exists no_show_reported_by_user_id uuid references public.users(id) on delete set null;
alter table public.tutorial_bookings drop constraint if exists tutorial_bookings_status_check;
alter table public.tutorial_bookings add constraint tutorial_bookings_status_check
  check (status in ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'REFUNDED', 'DISPUTED'));

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  university_id uuid references public.universities(id) on delete restrict,
  resource_type text not null check (resource_type in ('TUTORIAL_BOOKING', 'STORE_ORDER')),
  resource_id uuid not null,
  provider text not null default 'PAYSTACK' check (provider in ('PAYSTACK')),
  provider_reference text not null unique,
  amount_kobo integer not null check (amount_kobo > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  status text not null default 'CREATED' check (status in ('CREATED', 'INITIALIZED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REQUIRES_REVIEW')),
  authorization_url text,
  access_code text,
  initialized_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_type, resource_id, idempotency_key)
);

create index if not exists payment_attempts_resource_idx
  on public.payment_attempts (resource_type, resource_id, created_at desc);
create unique index if not exists payment_attempts_one_live_checkout
  on public.payment_attempts (resource_type, resource_id)
  where status in ('CREATED', 'INITIALIZED');

-- If an address was registered but never verified, a later registrant may
-- stage new credentials. Nothing changes until the mailbox holder proves
-- ownership with the token attached to this record.
create table if not exists app_private.pending_registrations (
  user_id uuid primary key references public.users(id) on delete cascade,
  verification_token_id uuid not null unique references public.verification_tokens(id) on delete cascade,
  password_hash text not null,
  first_name text not null,
  last_name text not null,
  display_name text not null,
  legal_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create or replace function app_private.check_and_consume_email_verification(
  p_token_id uuid,
  p_token_hash text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  selected public.verification_tokens%rowtype;
  pending app_private.pending_registrations%rowtype;
begin
  select tokens.* into selected
  from public.verification_tokens tokens
  where tokens.id = p_token_id and tokens.type::text = 'EMAIL_VERIFICATION'
  for update;

  if not found then return 'INVALID'; end if;
  if selected.used_at is not null then return 'USED'; end if;
  if selected.expires_at <= now() then return 'EXPIRED'; end if;
  if selected.attempts >= 5 then return 'LOCKED'; end if;

  if selected.token_hash is distinct from p_token_hash then
    update public.verification_tokens set attempts = attempts + 1 where id = selected.id;
    if selected.attempts + 1 >= 5 then return 'LOCKED'; end if;
    return 'INCORRECT';
  end if;

  select staged.* into pending
  from app_private.pending_registrations staged
  where staged.user_id = selected.user_id
    and staged.verification_token_id = selected.id
    and staged.expires_at > now()
  for update;

  update public.verification_tokens
  set used_at = coalesce(used_at, now())
  where user_id = selected.user_id and type::text = 'EMAIL_VERIFICATION' and used_at is null;

  update public.users
  set email_verified_at = coalesce(email_verified_at, now()),
      password_hash = case when pending.user_id is not null then pending.password_hash else password_hash end,
      updated_at = now()
  where id = selected.user_id;

  update public.profiles
  set first_name = case when pending.user_id is not null then pending.first_name else first_name end,
      last_name = case when pending.user_id is not null then pending.last_name else last_name end,
      display_name = case when pending.user_id is not null then pending.display_name else display_name end,
      onboarding_step = 'PROFILE',
      updated_at = now()
  where user_id = selected.user_id;

  if pending.user_id is not null then
    insert into public.legal_acceptances (id, user_id, document, version)
    values
      (gen_random_uuid(), selected.user_id, 'TERMS_OF_SERVICE'::public."LegalDocument", pending.legal_version),
      (gen_random_uuid(), selected.user_id, 'PRIVACY_POLICY'::public."LegalDocument", pending.legal_version)
    on conflict do nothing;
    delete from app_private.pending_registrations where user_id = selected.user_id;
  end if;

  return 'VERIFIED';
end;
$$;

revoke all on function app_private.check_and_consume_email_verification(uuid, text) from public;

drop function if exists app_private.create_tutorial_booking(uuid, uuid, uuid, uuid, uuid);
create or replace function app_private.create_tutorial_booking(
  p_booking_id uuid,
  p_university_id uuid,
  p_listing_id uuid,
  p_availability_window_id uuid,
  p_student_user_id uuid
) returns table (id uuid, amount_kobo integer, scheduled_for timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  selected_listing public.tutorial_listings%rowtype;
  selected_window public.tutorial_availability_windows%rowtype;
  active_count integer;
begin
  select * into selected_listing from public.tutorial_listings listings
  where listings.id = p_listing_id and listings.university_id = p_university_id
    and listings.status = 'PUBLISHED' and listings.review_status = 'APPROVED'
    and listings.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TUTORIAL_UNAVAILABLE';
  end if;

  select * into selected_window from public.tutorial_availability_windows windows
  where windows.id = p_availability_window_id and windows.listing_id = selected_listing.id
    and windows.status = 'OPEN' and windows.starts_at > now()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TUTORIAL_WINDOW_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.tutorial_bookings bookings
    where bookings.availability_window_id = selected_window.id
      and bookings.student_user_id = p_student_user_id
      and (
        bookings.status in ('CONFIRMED', 'COMPLETED') or
        (bookings.status = 'PENDING_PAYMENT' and bookings.payment_expires_at > now())
      )
  ) then
    raise exception using errcode = 'P0001', message = 'TUTORIAL_ALREADY_BOOKED';
  end if;

  select count(*)::integer into active_count
  from public.tutorial_bookings bookings
  where bookings.availability_window_id = selected_window.id and (
    bookings.status in ('CONFIRMED', 'COMPLETED') or
    (bookings.status = 'PENDING_PAYMENT' and bookings.payment_expires_at > now())
  );
  if active_count >= least(selected_window.capacity, selected_listing.capacity) then
    raise exception using errcode = 'P0001', message = 'TUTORIAL_FULL';
  end if;

  insert into public.tutorial_bookings (
    id, university_id, listing_id, availability_window_id, student_user_id,
    status, amount_kobo, scheduled_for, payment_expires_at
  ) values (
    p_booking_id, p_university_id, selected_listing.id, selected_window.id,
    p_student_user_id,
    case when selected_listing.price_kobo = 0 then 'CONFIRMED' else 'PENDING_PAYMENT' end,
    selected_listing.price_kobo, selected_window.starts_at,
    now() + interval '30 minutes'
  );

  return query select p_booking_id, selected_listing.price_kobo, selected_window.starts_at;
end;
$$;

revoke all on function app_private.create_tutorial_booking(uuid, uuid, uuid, uuid, uuid) from public;

create or replace function app_private.seed_tutorial_demo(
  p_university_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  listing_count integer;
  resource_count integer;
begin
  if not exists (
    select 1 from public.universities universities
    where universities.id = p_university_id and universities.deleted_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'UNIVERSITY_NOT_FOUND';
  end if;

  insert into public.tutorial_listings (
    id, university_id, tutor_profile_id, publisher_name, course_code, title,
    description, format, price_kobo, capacity, location_text,
    cancellation_cutoff_hours, status, review_status, reviewed_at,
    reviewed_by_user_id, is_demo, demo_key, deleted_at, updated_at
  )
  select gen_random_uuid(), p_university_id, null, source.publisher_name,
    source.course_code, source.title, source.description, source.format,
    0, source.capacity, source.location_text, 0, 'PUBLISHED', 'APPROVED',
    now(), p_actor_user_id, true, source.demo_key, null, now()
  from (values
    ('demo-chm102-clinic', 'KampusOne Demo Tutor', 'CHM102', 'Organic chemistry problem clinic',
      'Work through functional groups, nomenclature and likely exam questions with a small study group.', 'ONLINE', 12, 'Online study room'),
    ('demo-mat111-focus', 'KampusOne Demo Tutor', 'MAT111', 'Calculus focus room',
      'A guided differentiation and limits revision session with worked examples and time for questions.', 'IN_PERSON', 10, 'Main Library study area'),
    ('demo-csc101-python', 'KampusOne Demo Tutor', 'CSC101', 'Python foundations lab',
      'Build confidence with variables, conditions, loops and short practice problems in one friendly session.', 'HYBRID', 16, 'Computer laboratory / online'),
    ('demo-phy101-mechanics', 'KampusOne Demo Tutor', 'PHY101', 'Mechanics revision lab',
      'Review motion, forces and energy using clear diagrams and past-question style examples.', 'ONLINE', 14, 'Online study room')
  ) as source(demo_key, publisher_name, course_code, title, description, format, capacity, location_text)
  on conflict (university_id, demo_key) where demo_key is not null do update set
    publisher_name = excluded.publisher_name,
    course_code = excluded.course_code,
    title = excluded.title,
    description = excluded.description,
    format = excluded.format,
    price_kobo = 0,
    capacity = excluded.capacity,
    location_text = excluded.location_text,
    status = 'PUBLISHED',
    review_status = 'APPROVED',
    review_note = null,
    reviewed_at = now(),
    reviewed_by_user_id = p_actor_user_id,
    is_demo = true,
    deleted_at = null,
    updated_at = now();

  update public.tutorial_availability_windows windows
  set status = 'CANCELLED', updated_at = now()
  where windows.listing_id in (
    select listings.id from public.tutorial_listings listings
    where listings.university_id = p_university_id and listings.is_demo
  ) and windows.starts_at > now();

  insert into public.tutorial_availability_windows (
    id, listing_id, starts_at, ends_at, capacity, status, updated_at
  )
  select gen_random_uuid(), listings.id,
    date_trunc('day', now()) + schedule.start_offset,
    date_trunc('day', now()) + schedule.end_offset,
    listings.capacity, 'OPEN', now()
  from public.tutorial_listings listings
  join (values
    ('demo-chm102-clinic', interval '2 days 16 hours', interval '2 days 17 hours 30 minutes'),
    ('demo-mat111-focus', interval '3 days 11 hours', interval '3 days 12 hours 30 minutes'),
    ('demo-csc101-python', interval '4 days 15 hours', interval '4 days 17 hours'),
    ('demo-phy101-mechanics', interval '5 days 17 hours', interval '5 days 18 hours 30 minutes')
  ) as schedule(demo_key, start_offset, end_offset)
    on schedule.demo_key = listings.demo_key
  where listings.university_id = p_university_id and listings.is_demo
    and listings.deleted_at is null
  on conflict (listing_id, starts_at) do update set
    ends_at = excluded.ends_at,
    capacity = excluded.capacity,
    status = 'OPEN',
    updated_at = now();

  insert into public.tutorial_resources (
    id, university_id, course_code, title, description, resource_type,
    access_model, price_kobo, level_code, batch_label, publisher_name,
    publisher_verified, preview_text, page_count, duration_seconds,
    status, reviewed_at, reviewed_by_user_id, is_demo, demo_key,
    deleted_at, updated_at
  )
  select gen_random_uuid(), p_university_id, source.course_code, source.title,
    source.description, source.resource_type, 'FREE', 0, source.level_code,
    source.batch_label, source.publisher_name, false, source.preview_text,
    source.page_count, source.duration_seconds, 'PUBLISHED', now(),
    p_actor_user_id, true, source.demo_key, null, now()
  from (values
    ('demo-resource-chm102', 'CHM102', 'CHM102 revision questions',
      'A short practice set covering functional groups and reaction patterns.', 'PAST_QUESTION', '100 Level', '2024/2025', 'KampusOne Demo Library',
      'Preview: Name the functional group in each compound, then predict the major product for the two sample reactions. Answers are discussed in the tutorial clinic.', 8, null),
    ('demo-resource-mat111', 'MAT111', 'Differentiation notes',
      'Concise rules, worked examples and a quick self-check.', 'NOTE', '100 Level', '2024/2025', 'KampusOne Demo Library',
      'Preview: Start with the power rule, then combine it with product, quotient and chain rules. Each worked example highlights the first decision to make.', 12, null),
    ('demo-resource-csc101', 'CSC101', 'Python starter guide',
      'A beginner-friendly guide to variables, control flow and small programs.', 'PDF', '100 Level', '2024/2025', 'KampusOne Demo Library',
      'Preview: A Python program is a sequence of readable instructions. This guide begins with values and names, then moves into decisions and repetition.', 18, null),
    ('demo-resource-phy101', 'PHY101', 'Motion in 18 minutes',
      'An audio revision companion for displacement, velocity and acceleration.', 'AUDIOBOOK', '100 Level', '2024/2025', 'KampusOne Demo Library',
      'Preview transcript: Motion becomes easier when you separate position, change in position, and the rate of that change. We will connect each idea to one graph.', null, 1080),
    ('demo-resource-gst111', 'GST111', 'Academic writing checklist',
      'A one-page checklist for clearer assignments and citations.', 'NOTE', '100 Level', 'All batches', 'KampusOne Demo Library',
      'Preview: State the point, support it with evidence, connect it to the question, and cite the source consistently. Read the paragraph aloud before submitting.', 1, null)
  ) as source(demo_key, course_code, title, description, resource_type, level_code, batch_label, publisher_name, preview_text, page_count, duration_seconds)
  on conflict (university_id, demo_key) where demo_key is not null do update set
    course_code = excluded.course_code,
    title = excluded.title,
    description = excluded.description,
    resource_type = excluded.resource_type,
    access_model = 'FREE',
    price_kobo = 0,
    level_code = excluded.level_code,
    batch_label = excluded.batch_label,
    publisher_name = excluded.publisher_name,
    publisher_verified = false,
    preview_text = excluded.preview_text,
    page_count = excluded.page_count,
    duration_seconds = excluded.duration_seconds,
    status = 'PUBLISHED',
    review_note = null,
    reviewed_at = now(),
    reviewed_by_user_id = p_actor_user_id,
    is_demo = true,
    deleted_at = null,
    updated_at = now();

  select count(*)::integer into listing_count
  from public.tutorial_listings listings
  where listings.university_id = p_university_id and listings.is_demo and listings.deleted_at is null;
  select count(*)::integer into resource_count
  from public.tutorial_resources resources
  where resources.university_id = p_university_id and resources.is_demo and resources.deleted_at is null;

  return jsonb_build_object('listings', listing_count, 'resources', resource_count);
end;
$$;

create or replace function app_private.remove_tutorial_demo(
  p_university_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  listing_count integer;
  resource_count integer;
  booking_count integer;
begin
  update public.tutorial_bookings bookings
  set status = 'CANCELLED',
      cancellation_reason = 'Demo catalogue removed by an administrator.',
      cancelled_at = now(),
      cancelled_by_user_id = p_actor_user_id,
      earnings_state = 'NOT_EARNED',
      updated_at = now()
  where bookings.listing_id in (
    select listings.id from public.tutorial_listings listings
    where listings.university_id = p_university_id and listings.is_demo
  ) and bookings.status in ('PENDING_PAYMENT', 'CONFIRMED')
    and coalesce(bookings.scheduled_for, now() + interval '1 second') > now();
  get diagnostics booking_count = row_count;

  update public.tutorial_availability_windows windows
  set status = 'CANCELLED', updated_at = now()
  where windows.listing_id in (
    select listings.id from public.tutorial_listings listings
    where listings.university_id = p_university_id and listings.is_demo
  ) and windows.status = 'OPEN';

  update public.tutorial_listings listings
  set status = 'ARCHIVED', deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where listings.university_id = p_university_id and listings.is_demo and listings.deleted_at is null;
  get diagnostics listing_count = row_count;

  update public.tutorial_resources resources
  set status = 'ARCHIVED', deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where resources.university_id = p_university_id and resources.is_demo and resources.deleted_at is null;
  get diagnostics resource_count = row_count;

  return jsonb_build_object(
    'listings', listing_count,
    'resources', resource_count,
    'cancelledBookings', booking_count
  );
end;
$$;

revoke all on function app_private.seed_tutorial_demo(uuid, uuid) from public;
revoke all on function app_private.remove_tutorial_demo(uuid, uuid) from public;

update public.release_phases
set summary = 'Controlled free tutorial pilot with moderated listings, learning resources, bookings, completion, reviews, disputes and removable demo content.',
    requirements = '["Approve the manual tutor-review policy", "Name the pilot support owner", "Approve tutorial cancellation and no-show rules", "Provide storage only when real files are uploaded", "Keep live payments off until Paystack reconciliation is accepted"]'::jsonb,
    updated_at = now()
where phase_key = 'phase-2';

commit;
