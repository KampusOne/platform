begin;

alter table public.agent_applications
  add column if not exists legal_name text,
  add column if not exists address_text text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists kyc_status text not null default 'NOT_STARTED',
  add column if not exists kyc_provider text,
  add column if not exists kyc_reference text,
  add column if not exists bank_status text not null default 'NOT_STARTED',
  add column if not exists bank_provider text,
  add column if not exists bank_recipient_code text,
  add column if not exists bank_account_name text,
  add column if not exists bank_account_last4 char(4);

alter table public.agent_applications drop constraint if exists agent_applications_kyc_status_check;
alter table public.agent_applications add constraint agent_applications_kyc_status_check
  check (kyc_status in ('NOT_STARTED', 'PENDING', 'VERIFIED', 'MANUALLY_VERIFIED', 'REJECTED'));
alter table public.agent_applications drop constraint if exists agent_applications_bank_status_check;
alter table public.agent_applications add constraint agent_applications_bank_status_check
  check (bank_status in ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED'));

create table if not exists public.tutorial_availability_windows (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.tutorial_listings(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 500),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (listing_id, starts_at)
);

alter table public.tutorial_bookings
  add column if not exists availability_window_id uuid references public.tutorial_availability_windows(id) on delete set null,
  add column if not exists payment_expires_at timestamptz not null default (now() + interval '30 minutes'),
  add column if not exists student_confirmed_at timestamptz,
  add column if not exists tutor_confirmed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists dispute_deadline timestamptz,
  add column if not exists earnings_state text not null default 'NOT_EARNED';

alter table public.tutorial_bookings drop constraint if exists tutorial_bookings_earnings_state_check;
alter table public.tutorial_bookings add constraint tutorial_bookings_earnings_state_check
  check (earnings_state in ('NOT_EARNED', 'PENDING', 'AVAILABLE', 'RESERVED', 'PAID', 'REVERSED'));

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RESTRICTED', 'PROHIBITED')),
  listing_rules text,
  created_by_user_id uuid references public.users(id) on delete set null,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, name)
);

alter table public.vendor_products
  add column if not exists category_id uuid references public.product_categories(id) on delete restrict,
  add column if not exists reviewed_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.orders
  add column if not exists delivery_zone_id uuid references public.delivery_zones(id) on delete restrict,
  add column if not exists completed_at timestamptz,
  add column if not exists earnings_state text not null default 'NOT_EARNED';

alter table public.orders drop constraint if exists orders_earnings_state_check;
alter table public.orders add constraint orders_earnings_state_check
  check (earnings_state in ('NOT_EARNED', 'PENDING', 'AVAILABLE', 'RESERVED', 'PAID', 'REVERSED'));

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.vendor_products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'HELD' check (status in ('HELD', 'CONVERTED', 'RELEASED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

alter table public.delivery_jobs drop constraint if exists delivery_jobs_status_check;
alter table public.delivery_jobs add constraint delivery_jobs_status_check
  check (status in ('PAYMENT_PENDING', 'AVAILABLE', 'RESERVED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED'));
alter table public.delivery_jobs
  add column if not exists code_expires_at timestamptz not null default (now() + interval '7 days'),
  add column if not exists pickup_code_attempts integer not null default 0,
  add column if not exists delivery_code_attempts integer not null default 0,
  add column if not exists rider_earning_kobo integer not null default 0 check (rider_earning_kobo >= 0),
  add column if not exists earning_formula_version text not null default 'manual-v1',
  add column if not exists earnings_state text not null default 'NOT_EARNED';

alter table public.delivery_jobs drop constraint if exists delivery_jobs_earnings_state_check;
alter table public.delivery_jobs add constraint delivery_jobs_earnings_state_check
  check (earnings_state in ('NOT_EARNED', 'PENDING', 'AVAILABLE', 'RESERVED', 'PAID', 'REVERSED'));

create table if not exists public.rider_presence (
  rider_profile_id uuid primary key references public.agent_profiles(id) on delete cascade,
  online boolean not null default false,
  capacity_status text not null default 'AVAILABLE' check (capacity_status in ('AVAILABLE', 'AT_CAPACITY', 'PAUSED')),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.disputes
  add column if not exists category text not null default 'OTHER',
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists resolution_code text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  agent_profile_id uuid not null references public.agent_profiles(id) on delete restrict,
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'IN_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED', 'CANCELLED')),
  provider_reference text,
  reviewer_user_id uuid references public.users(id) on delete set null,
  review_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists payout_requests_review_queue_idx
  on public.payout_requests (university_id, status, requested_at);

create or replace function app_private.create_tutorial_booking(
  p_booking_id uuid,
  p_university_id uuid,
  p_listing_id uuid,
  p_student_user_id uuid,
  p_scheduled_for timestamptz
) returns table (id uuid, amount_kobo integer)
language plpgsql
set search_path = ''
as $$
declare
  selected public.tutorial_listings%rowtype;
  active_count integer;
begin
  select * into selected from public.tutorial_listings listings
  where listings.id = p_listing_id and listings.university_id = p_university_id
    and listings.status = 'PUBLISHED'
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'TUTORIAL_UNAVAILABLE'; end if;

  select count(*)::integer into active_count from public.tutorial_bookings bookings
  where bookings.listing_id = selected.id and (
    bookings.status in ('CONFIRMED', 'COMPLETED') or
    (bookings.status = 'PENDING_PAYMENT' and bookings.payment_expires_at > now())
  );
  if active_count >= selected.capacity then raise exception using errcode = 'P0001', message = 'TUTORIAL_FULL'; end if;

  insert into public.tutorial_bookings (
    id, university_id, listing_id, student_user_id, amount_kobo, scheduled_for, payment_expires_at
  ) values (
    p_booking_id, p_university_id, selected.id, p_student_user_id, selected.price_kobo,
    p_scheduled_for, now() + interval '30 minutes'
  );
  return query select p_booking_id, selected.price_kobo;
end;
$$;

create or replace function app_private.create_store_order(
  p_order_id uuid,
  p_university_id uuid,
  p_buyer_user_id uuid,
  p_vendor_profile_id uuid,
  p_delivery_zone_id uuid,
  p_delivery_note text,
  p_items jsonb,
  p_pickup_code_hash text,
  p_delivery_code_hash text
) returns table (id uuid, subtotal_kobo integer, delivery_fee_kobo integer, total_kobo integer)
language plpgsql
set search_path = ''
as $$
declare
  requested_count integer;
  valid_count integer;
  subtotal integer;
  fee integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_ITEMS';
  end if;
  select count(*), count(distinct requested.product_id)
    into requested_count, valid_count
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer);
  if requested_count <> valid_count then raise exception using errcode = '22023', message = 'DUPLICATE_ITEMS'; end if;

  perform products.id
  from public.vendor_products products
  join jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    on requested.product_id = products.id
  where products.university_id = p_university_id and products.vendor_profile_id = p_vendor_profile_id
  order by products.id for update of products;

  select count(*)::integer, coalesce(sum(products.price_kobo * requested.quantity), 0)::integer
    into valid_count, subtotal
  from public.vendor_products products
  join jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    on requested.product_id = products.id
  join public.agent_profiles vendors on vendors.id = products.vendor_profile_id and vendors.status = 'ACTIVE'
  join public.product_categories categories on categories.id = products.category_id and categories.status = 'APPROVED'
  where products.university_id = p_university_id and products.vendor_profile_id = p_vendor_profile_id
    and products.status = 'PUBLISHED' and requested.quantity between 1 and 100
    and products.stock_quantity >= requested.quantity;
  if valid_count <> requested_count then raise exception using errcode = 'P0001', message = 'PRODUCT_UNAVAILABLE_OR_STOCK_LOW'; end if;

  select zones.base_fee_kobo into fee from public.delivery_zones zones
  where zones.id = p_delivery_zone_id and zones.university_id = p_university_id and zones.active = true;
  if not found then raise exception using errcode = 'P0002', message = 'DELIVERY_ZONE_UNAVAILABLE'; end if;

  insert into public.orders (
    id, university_id, buyer_user_id, vendor_profile_id, delivery_zone_id,
    subtotal_kobo, delivery_fee_kobo, delivery_note
  ) values (p_order_id, p_university_id, p_buyer_user_id, p_vendor_profile_id, p_delivery_zone_id, subtotal, fee, p_delivery_note);

  insert into public.order_items (id, order_id, product_id, quantity, unit_price_kobo)
  select gen_random_uuid(), p_order_id, products.id, requested.quantity, products.price_kobo
  from public.vendor_products products
  join jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer) on requested.product_id = products.id;

  update public.vendor_products products set stock_quantity = products.stock_quantity - requested.quantity, updated_at = now()
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
  where products.id = requested.product_id;

  insert into public.inventory_reservations (order_id, product_id, quantity, expires_at)
  select p_order_id, requested.product_id, requested.quantity, now() + interval '30 minutes'
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer);

  insert into public.delivery_jobs (
    university_id, order_id, zone_id, status, pickup_code_hash, delivery_code_hash, code_expires_at
  ) values (
    p_university_id, p_order_id, p_delivery_zone_id, 'PAYMENT_PENDING', p_pickup_code_hash, p_delivery_code_hash,
    now() + interval '7 days'
  );

  return query select p_order_id, subtotal, fee, subtotal + fee;
end;
$$;

update public.release_phases set requirements =
  '["Transactional email sender and production secrets", "Named UNIBEN content owners and accuracy review", "Closed student acceptance test and rollback owner"]'::jsonb,
  updated_at = now() where phase_key = 'phase-1';
update public.release_phases set requirements =
  '["Layered KYC provider or approved manual pilot policy", "Paystack marketplace and payout approval", "Tutor cancellation, dispute and payout policy", "Reconciled pilot transaction evidence"]'::jsonb,
  updated_at = now() where phase_key = 'phase-2';
update public.release_phases set requirements =
  '["Approved vendor category catalogue", "Rider safety, insurance and incident policy", "Delivery zone and fee schedule", "Pickup/delivery code acceptance test", "Settlement and refund approval"]'::jsonb,
  updated_at = now() where phase_key = 'phase-3';

commit;
