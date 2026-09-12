begin;

-- Phase 3 remains dark until the application binding and reviewed migration proof
-- are both enabled. This migration makes the future Store and Logistics paths
-- safe to exercise without choosing commercial policy values prematurely.

alter table public.vendor_products
  add column if not exists submitted_at timestamptz,
  add column if not exists moderation_note text,
  add column if not exists listing_revision integer not null default 1,
  add column if not exists moderated_revision integer,
  add column if not exists preparation_minutes integer not null default 60,
  add column if not exists package_weight_grams integer,
  add column if not exists package_length_cm numeric(7,2),
  add column if not exists package_width_cm numeric(7,2),
  add column if not exists package_height_cm numeric(7,2),
  add column if not exists bicycle_delivery_eligible boolean not null default false;

-- Listings published by the earlier preview were never through a product review
-- queue. Keep them out of future discovery until an operator reviews them.
update public.vendor_products
set status = 'NEEDS_CORRECTION',
    submitted_at = coalesce(submitted_at, updated_at, created_at),
    moderation_note = coalesce(
      moderation_note,
      'Requires Phase 3 product moderation before publication.'
    ),
    updated_at = now()
where status = 'PUBLISHED'
  and (
    reviewed_by_user_id is null
    or reviewed_at is null
    or moderated_revision is distinct from listing_revision
    or category_id is null
    or package_weight_grams is null
    or package_length_cm is null
    or package_width_cm is null
    or package_height_cm is null
    or bicycle_delivery_eligible = false
  );

alter table public.vendor_products drop constraint if exists vendor_products_status_check;
alter table public.vendor_products add constraint vendor_products_status_check
  check (status in (
    'DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION', 'PUBLISHED',
    'PAUSED', 'REJECTED', 'ARCHIVED'
  ));
alter table public.vendor_products drop constraint if exists vendor_products_listing_revision_check;
alter table public.vendor_products add constraint vendor_products_listing_revision_check
  check (listing_revision > 0 and (moderated_revision is null or moderated_revision > 0));
alter table public.vendor_products drop constraint if exists vendor_products_preparation_minutes_check;
alter table public.vendor_products add constraint vendor_products_preparation_minutes_check
  check (preparation_minutes between 10 and 1440);
alter table public.vendor_products drop constraint if exists vendor_products_package_weight_check;
alter table public.vendor_products add constraint vendor_products_package_weight_check
  check (package_weight_grams is null or package_weight_grams between 1 and 50000);
alter table public.vendor_products drop constraint if exists vendor_products_package_dimensions_check;
alter table public.vendor_products add constraint vendor_products_package_dimensions_check
  check (
    (package_length_cm is null and package_width_cm is null and package_height_cm is null)
    or (
      package_length_cm between 1 and 200
      and package_width_cm between 1 and 200
      and package_height_cm between 1 and 200
    )
  );
alter table public.vendor_products drop constraint if exists vendor_products_submitted_state_check;
alter table public.vendor_products add constraint vendor_products_submitted_state_check
  check (status not in ('SUBMITTED', 'NEEDS_CORRECTION', 'REJECTED') or submitted_at is not null);
alter table public.vendor_products drop constraint if exists vendor_products_moderation_note_check;
alter table public.vendor_products add constraint vendor_products_moderation_note_check
  check (
    status not in ('NEEDS_CORRECTION', 'REJECTED')
    or char_length(trim(coalesce(moderation_note, ''))) between 3 and 2000
  );
alter table public.vendor_products drop constraint if exists vendor_products_publication_review_check;
alter table public.vendor_products add constraint vendor_products_publication_review_check
  check (
    status <> 'PUBLISHED'
    or (
      reviewed_by_user_id is not null
      and reviewed_at is not null
      and moderated_revision = listing_revision
      and category_id is not null
      and package_weight_grams is not null
      and package_length_cm is not null
      and package_width_cm is not null
      and package_height_cm is not null
      and bicycle_delivery_eligible = true
    )
  );

create or replace function app_private.guard_product_material_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.name,
    new.description,
    new.category,
    new.category_id,
    new.price_kobo,
    new.image_url,
    new.preparation_minutes,
    new.package_weight_grams,
    new.package_length_cm,
    new.package_width_cm,
    new.package_height_cm,
    new.bicycle_delivery_eligible
  ) is distinct from row(
    old.name,
    old.description,
    old.category,
    old.category_id,
    old.price_kobo,
    old.image_url,
    old.preparation_minutes,
    old.package_weight_grams,
    old.package_length_cm,
    old.package_width_cm,
    old.package_height_cm,
    old.bicycle_delivery_eligible
  ) then
    new.listing_revision := old.listing_revision + 1;
    new.reviewed_by_user_id := null;
    new.reviewed_at := null;
    new.moderated_revision := null;

    if old.status in ('PUBLISHED', 'PAUSED') then
      new.status := 'NEEDS_CORRECTION';
      new.submitted_at := coalesce(old.submitted_at, now());
      new.moderation_note := 'Material listing changes require a new product review.';
    elsif old.status = 'SUBMITTED' then
      new.status := 'DRAFT';
      new.submitted_at := null;
      new.moderation_note := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists vendor_products_guard_material_change on public.vendor_products;
create trigger vendor_products_guard_material_change
before update on public.vendor_products
for each row execute function app_private.guard_product_material_change();

create unique index if not exists agent_profiles_id_university_uidx
  on public.agent_profiles (id, university_id);
create unique index if not exists vendor_products_id_university_uidx
  on public.vendor_products (id, university_id);
create unique index if not exists orders_id_university_uidx
  on public.orders (id, university_id);
create unique index if not exists product_categories_id_university_uidx
  on public.product_categories (id, university_id);
create unique index if not exists delivery_zones_id_university_uidx
  on public.delivery_zones (id, university_id);

do $tenant_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_products_vendor_tenant_fkey'
      and conrelid = 'public.vendor_products'::regclass
  ) then
    alter table public.vendor_products
      add constraint vendor_products_vendor_tenant_fkey
      foreign key (vendor_profile_id, university_id)
      references public.agent_profiles(id, university_id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_products_category_tenant_fkey'
      and conrelid = 'public.vendor_products'::regclass
  ) then
    alter table public.vendor_products
      add constraint vendor_products_category_tenant_fkey
      foreign key (category_id, university_id)
      references public.product_categories(id, university_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_vendor_tenant_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_vendor_tenant_fkey
      foreign key (vendor_profile_id, university_id)
      references public.agent_profiles(id, university_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_delivery_zone_tenant_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_zone_tenant_fkey
      foreign key (delivery_zone_id, university_id)
      references public.delivery_zones(id, university_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_jobs_order_tenant_fkey'
      and conrelid = 'public.delivery_jobs'::regclass
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_order_tenant_fkey
      foreign key (order_id, university_id)
      references public.orders(id, university_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_jobs_zone_tenant_fkey'
      and conrelid = 'public.delivery_jobs'::regclass
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_zone_tenant_fkey
      foreign key (zone_id, university_id)
      references public.delivery_zones(id, university_id) on delete restrict;
  end if;
end;
$tenant_constraints$;

create table if not exists public.vendor_storefronts (
  vendor_profile_id uuid primary key,
  university_id uuid not null references public.universities(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 120),
  description text check (description is null or char_length(description) between 10 and 2000),
  contact_phone_e164 text check (
    contact_phone_e164 is null or contact_phone_e164 ~ '^\+234[789][0-9]{9}$'
  ),
  pickup_location text check (
    pickup_location is null or char_length(pickup_location) between 5 and 500
  ),
  pickup_instructions text check (
    pickup_instructions is null or char_length(pickup_instructions) <= 1000
  ),
  opening_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(opening_hours) = 'object'),
  default_preparation_minutes integer not null default 60
    check (default_preparation_minutes between 10 and 1440),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'NEEDS_CORRECTION', 'SUSPENDED')),
  submitted_at timestamptz,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vendor_profile_id, university_id)
    references public.agent_profiles(id, university_id) on delete cascade,
  check (
    status <> 'APPROVED'
    or (
      submitted_at is not null
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and contact_phone_e164 is not null
      and pickup_location is not null
    )
  )
);

create index if not exists vendor_storefronts_review_queue_idx
  on public.vendor_storefronts (university_id, status, submitted_at);

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  product_id uuid not null,
  storage_key text not null check (char_length(storage_key) between 3 and 500),
  public_url text check (public_url is null or char_length(public_url) between 8 and 2000),
  media_type text not null default 'IMAGE' check (media_type in ('IMAGE')),
  status text not null default 'UPLOADING'
    check (status in ('UPLOADING', 'READY', 'REJECTED', 'ARCHIVED')),
  position smallint not null default 0 check (position between 0 and 9),
  width_px integer check (width_px is null or width_px > 0),
  height_px integer check (height_px is null or height_px > 0),
  byte_size integer check (byte_size is null or byte_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, university_id)
    references public.vendor_products(id, university_id) on delete cascade,
  unique (product_id, position),
  unique (storage_key)
);

alter table public.orders
  add column if not exists pricing_formula_version text not null default 'legacy-v1';

alter table public.orders drop constraint if exists orders_pricing_formula_version_check;
alter table public.orders add constraint orders_pricing_formula_version_check
  check (char_length(pricing_formula_version) between 3 and 80);

update public.orders
set pricing_formula_version = 'UNCONFIGURED', updated_at = now()
where status = 'PENDING_PAYMENT';

create table if not exists public.order_delivery_snapshots (
  order_id uuid primary key,
  university_id uuid not null references public.universities(id) on delete restrict,
  recipient_name text not null check (char_length(recipient_name) between 2 and 120),
  recipient_phone_e164 text not null check (recipient_phone_e164 ~ '^\+234[789][0-9]{9}$'),
  delivery_location text not null check (char_length(delivery_location) between 5 and 500),
  delivery_landmark text check (
    delivery_landmark is null or char_length(delivery_landmark) between 2 and 200
  ),
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  created_at timestamptz not null default now(),
  foreign key (order_id, university_id)
    references public.orders(id, university_id) on delete restrict,
  check ((latitude is null) = (longitude is null))
);

create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  university_id uuid not null references public.universities(id) on delete restrict,
  order_id uuid not null,
  previous_status text,
  status text not null check (char_length(status) between 2 and 50),
  source text not null default 'DATABASE'
    check (source in ('DATABASE', 'SYSTEM', 'BUYER', 'VENDOR', 'RIDER', 'OPERATOR', 'PAYMENT')),
  actor_user_id uuid references public.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (order_id, university_id)
    references public.orders(id, university_id) on delete restrict
);

create index if not exists order_status_events_timeline_idx
  on public.order_status_events (order_id, occurred_at, id);

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  order_id uuid not null,
  product_id uuid not null,
  buyer_user_id uuid not null references public.users(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) between 3 and 1000),
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED', 'UNDER_REVIEW', 'HIDDEN_BY_MODERATION')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, university_id)
    references public.orders(id, university_id) on delete restrict,
  foreign key (product_id, university_id)
    references public.vendor_products(id, university_id) on delete restrict,
  unique (order_id, product_id)
);

create index if not exists product_reviews_product_idx
  on public.product_reviews (product_id, status, created_at desc);

create table if not exists public.commerce_refunds (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  order_id uuid not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  amount_kobo bigint not null check (amount_kobo > 0),
  reason text not null check (char_length(reason) between 10 and 1000),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  provider text,
  provider_reference text,
  formula_version text not null default 'UNCONFIGURED'
    check (char_length(formula_version) between 3 and 80),
  ledger_transaction_id uuid references public.ledger_transactions(id) on delete restrict,
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (order_id, university_id)
    references public.orders(id, university_id) on delete restrict
);

create unique index if not exists commerce_refunds_provider_reference_uidx
  on public.commerce_refunds (provider, provider_reference)
  where provider_reference is not null;
create unique index if not exists commerce_refunds_id_university_uidx
  on public.commerce_refunds (id, university_id);
create index if not exists commerce_refunds_review_queue_idx
  on public.commerce_refunds (university_id, status, requested_at);

create table if not exists public.commerce_refund_events (
  id bigint generated always as identity primary key,
  university_id uuid not null references public.universities(id) on delete restrict,
  refund_id uuid not null,
  previous_status text check (
    previous_status is null
    or previous_status in ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  status text not null
    check (status in ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  actor_user_id uuid references public.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (refund_id, university_id)
    references public.commerce_refunds(id, university_id) on delete restrict
);

create index if not exists commerce_refund_events_timeline_idx
  on public.commerce_refund_events (refund_id, occurred_at, id);
create index if not exists commerce_refund_events_tenant_idx
  on public.commerce_refund_events (university_id, occurred_at, id);

alter table public.delivery_zones
  add column if not exists operating_hours jsonb not null default '{}'::jsonb,
  add column if not exists max_package_weight_grams integer,
  add column if not exists max_package_dimension_cm numeric(7,2),
  add column if not exists rider_earning_kobo integer,
  add column if not exists earning_formula_version text not null default 'UNCONFIGURED',
  add column if not exists reservation_timeout_minutes integer not null default 10,
  add column if not exists updated_at timestamptz not null default now();

alter table public.delivery_zones drop constraint if exists delivery_zones_operating_hours_check;
alter table public.delivery_zones add constraint delivery_zones_operating_hours_check
  check (jsonb_typeof(operating_hours) = 'object');
alter table public.delivery_zones drop constraint if exists delivery_zones_package_policy_check;
alter table public.delivery_zones add constraint delivery_zones_package_policy_check
  check (
    (max_package_weight_grams is null or max_package_weight_grams between 1 and 50000)
    and (max_package_dimension_cm is null or max_package_dimension_cm between 1 and 200)
  );
alter table public.delivery_zones drop constraint if exists delivery_zones_rider_earning_check;
alter table public.delivery_zones add constraint delivery_zones_rider_earning_check
  check (rider_earning_kobo is null or rider_earning_kobo >= 0);
alter table public.delivery_zones drop constraint if exists delivery_zones_formula_version_check;
alter table public.delivery_zones add constraint delivery_zones_formula_version_check
  check (char_length(earning_formula_version) between 3 and 80);
alter table public.delivery_zones drop constraint if exists delivery_zones_reservation_timeout_check;
alter table public.delivery_zones add constraint delivery_zones_reservation_timeout_check
  check (reservation_timeout_minutes between 2 and 60);

alter table public.delivery_jobs
  add column if not exists reservation_expires_at timestamptz;

create or replace function app_private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'IMMUTABLE_RECORD';
end;
$$;

drop trigger if exists order_delivery_snapshots_immutable on public.order_delivery_snapshots;
create trigger order_delivery_snapshots_immutable
before update or delete on public.order_delivery_snapshots
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists order_status_events_immutable on public.order_status_events;
create trigger order_status_events_immutable
before update or delete on public.order_status_events
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists commerce_refunds_no_delete on public.commerce_refunds;
create trigger commerce_refunds_no_delete
before delete on public.commerce_refunds
for each row execute function app_private.reject_immutable_mutation();

drop trigger if exists commerce_refund_events_immutable on public.commerce_refund_events;
create trigger commerce_refund_events_immutable
before update or delete on public.commerce_refund_events
for each row execute function app_private.reject_immutable_mutation();

create or replace function app_private.capture_order_status_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (
      university_id, order_id, previous_status, status, source, occurred_at
    ) values (
      new.university_id, new.id, null, new.status, 'DATABASE', new.created_at
    );
  elsif new.status is distinct from old.status then
    insert into public.order_status_events (
      university_id, order_id, previous_status, status, source
    ) values (
      new.university_id, new.id, old.status, new.status, 'DATABASE'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_capture_status_event on public.orders;
create trigger orders_capture_status_event
after insert or update of status on public.orders
for each row execute function app_private.capture_order_status_event();

insert into public.order_status_events (
  university_id, order_id, previous_status, status, source, metadata, occurred_at
)
select orders.university_id, orders.id, null, orders.status, 'SYSTEM',
  '{"backfilled":true}'::jsonb, orders.created_at
from public.orders orders
where not exists (
  select 1 from public.order_status_events events where events.order_id = orders.id
);

create or replace function app_private.capture_refund_status_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.commerce_refund_events (
      university_id, refund_id, previous_status, status
    ) values (new.university_id, new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.commerce_refund_events (
      university_id, refund_id, previous_status, status
    ) values (new.university_id, new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_refunds_capture_status_event on public.commerce_refunds;
create trigger commerce_refunds_capture_status_event
after insert or update of status on public.commerce_refunds
for each row execute function app_private.capture_refund_status_event();

create or replace function app_private.create_store_order_v2(
  p_order_id uuid,
  p_university_id uuid,
  p_buyer_user_id uuid,
  p_vendor_profile_id uuid,
  p_delivery_zone_id uuid,
  p_recipient_name text,
  p_recipient_phone_e164 text,
  p_delivery_location text,
  p_delivery_landmark text,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric,
  p_delivery_note text,
  p_items jsonb,
  p_pickup_code_hash text,
  p_delivery_code_hash text
)
returns table (
  id uuid,
  subtotal_kobo integer,
  delivery_fee_kobo integer,
  total_kobo integer
)
language plpgsql
set search_path = ''
as $$
declare
  created_order record;
begin
  perform 1
  from public.profiles profiles
  where profiles.user_id = p_buyer_user_id
    and profiles.university_id = p_university_id
    and profiles.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'BUYER_TENANT_MISMATCH';
  end if;

  perform 1
  from public.vendor_storefronts storefronts
  join public.agent_profiles profiles
    on profiles.id = storefronts.vendor_profile_id
    and profiles.university_id = storefronts.university_id
  where storefronts.vendor_profile_id = p_vendor_profile_id
    and storefronts.university_id = p_university_id
    and storefronts.status = 'APPROVED'
    and profiles.agent_type = 'VENDOR'
    and profiles.status = 'ACTIVE';
  if not found then
    raise exception using errcode = 'P0001', message = 'VENDOR_STOREFRONT_UNAVAILABLE';
  end if;

  select * into created_order
  from app_private.create_store_order(
    p_order_id,
    p_university_id,
    p_buyer_user_id,
    p_vendor_profile_id,
    p_delivery_zone_id,
    p_delivery_note,
    p_items,
    p_pickup_code_hash,
    p_delivery_code_hash
  );

  insert into public.order_delivery_snapshots (
    order_id,
    university_id,
    recipient_name,
    recipient_phone_e164,
    delivery_location,
    delivery_landmark,
    latitude,
    longitude
  ) values (
    p_order_id,
    p_university_id,
    trim(p_recipient_name),
    trim(p_recipient_phone_e164),
    trim(p_delivery_location),
    nullif(trim(p_delivery_landmark), ''),
    p_delivery_latitude,
    p_delivery_longitude
  );

  update public.orders
  set pricing_formula_version = 'UNCONFIGURED'
  where orders.id = p_order_id;

  return query select
    created_order.id,
    created_order.subtotal_kobo,
    created_order.delivery_fee_kobo,
    created_order.total_kobo;
end;
$$;

create or replace function app_private.create_product_review(
  p_review_id uuid,
  p_order_id uuid,
  p_product_id uuid,
  p_buyer_user_id uuid,
  p_rating smallint,
  p_body text
)
returns table (id uuid, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  purchase record;
begin
  select orders.university_id into purchase
  from public.orders orders
  join public.order_items items
    on items.order_id = orders.id and items.product_id = p_product_id
  where orders.id = p_order_id
    and orders.buyer_user_id = p_buyer_user_id
    and orders.status = 'DELIVERED'
  for key share of orders;

  if not found then
    raise exception using errcode = 'P0002', message = 'VERIFIED_PURCHASE_REQUIRED';
  end if;

  return query
  insert into public.product_reviews (
    id, university_id, order_id, product_id, buyer_user_id, rating, body
  ) values (
    p_review_id, purchase.university_id, p_order_id, p_product_id,
    p_buyer_user_id, p_rating, p_body
  )
  on conflict (order_id, product_id) do nothing
  returning product_reviews.id, product_reviews.university_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_ALREADY_REVIEWED';
  end if;
end;
$$;

revoke all on table
  public.vendor_storefronts,
  public.product_media,
  public.order_delivery_snapshots,
  public.order_status_events,
  public.product_reviews,
  public.commerce_refunds,
  public.commerce_refund_events
from public;

revoke all on function app_private.reject_immutable_mutation() from public;
revoke all on function app_private.capture_order_status_event() from public;
revoke all on function app_private.capture_refund_status_event() from public;
revoke all on function app_private.guard_product_material_change() from public;
revoke all on function app_private.create_store_order_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  numeric, numeric, text, jsonb, text, text
) from public;
revoke all on function app_private.create_product_review(
  uuid, uuid, uuid, uuid, smallint, text
) from public;
revoke all on function app_private.create_store_order(
  uuid, uuid, uuid, uuid, uuid, text, jsonb, text, text
) from public;

update public.release_phases
set status = 'IN_PROGRESS',
    summary = 'Controlled UNIBEN Store and bicycle-logistics beta with moderated products, immutable delivery snapshots and auditable fulfilment.',
    requirements = '["Approved product and vendor policy", "Approved delivery zones, hours and bicycle package limits", "Rider safety and incident policy", "Versioned commission, refund and payout policy", "Paystack test reconciliation", "Reviewed Phase 3 migration proof", "Named UNIBEN pilot cohort"]'::jsonb,
    updated_at = now()
where phase_key = 'phase-3';

commit;
