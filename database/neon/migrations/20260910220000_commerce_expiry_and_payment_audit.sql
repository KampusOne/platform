begin;

create table if not exists public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_reference text not null,
  event_type text not null,
  amount_kobo bigint,
  state text not null default 'RECEIVED'
    check (state in ('RECEIVED', 'PROCESSED', 'REQUIRES_REVIEW')),
  resource_type text,
  resource_id uuid,
  review_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index if not exists payment_provider_events_review_idx
  on public.payment_provider_events (state, received_at)
  where state = 'REQUIRES_REVIEW';

create or replace function app_private.cancel_vendor_order(
  p_order_id uuid,
  p_vendor_user_id uuid
) returns table (order_id uuid, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  selected public.orders%rowtype;
begin
  select orders.* into selected
  from public.orders orders
  join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
  where orders.id = p_order_id and profiles.user_id = p_vendor_user_id
    and profiles.status = 'ACTIVE'
  for update of orders;

  if not found or selected.status <> 'PENDING_PAYMENT' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.vendor_products products
  set stock_quantity = products.stock_quantity + reservations.quantity,
      updated_at = now()
  from public.inventory_reservations reservations
  where reservations.order_id = selected.id
    and reservations.product_id = products.id
    and reservations.status = 'HELD';

  update public.inventory_reservations
  set status = 'RELEASED'
  where order_id = selected.id and status = 'HELD';

  update public.delivery_jobs
  set status = 'CANCELLED', updated_at = now()
  where order_id = selected.id and status = 'PAYMENT_PENDING';

  update public.orders
  set status = 'CANCELLED', updated_at = now()
  where id = selected.id and status = 'PENDING_PAYMENT';

  return query select selected.id, selected.university_id;
end;
$$;

create or replace function app_private.expire_stale_commerce()
returns table (
  reservations_released integer,
  orders_cancelled integer,
  bookings_cancelled integer
)
language plpgsql
set search_path = ''
as $$
declare
  reservation_record record;
  affected_order_ids uuid[] := array[]::uuid[];
begin
  reservations_released := 0;
  orders_cancelled := 0;
  bookings_cancelled := 0;

  for reservation_record in
    select reservations.id, reservations.order_id, reservations.product_id, reservations.quantity
    from public.inventory_reservations reservations
    join public.orders orders on orders.id = reservations.order_id
    where reservations.status = 'HELD' and reservations.expires_at <= now()
      and orders.status = 'PENDING_PAYMENT'
    order by reservations.id
    for update of reservations skip locked
  loop
    update public.vendor_products
    set stock_quantity = stock_quantity + reservation_record.quantity,
        updated_at = now()
    where id = reservation_record.product_id;

    update public.inventory_reservations
    set status = 'RELEASED'
    where id = reservation_record.id and status = 'HELD';

    if found then
      reservations_released := reservations_released + 1;
      affected_order_ids := array_append(affected_order_ids, reservation_record.order_id);
    end if;
  end loop;

  if cardinality(affected_order_ids) > 0 then
    update public.orders orders
    set status = 'CANCELLED', updated_at = now()
    where orders.id = any(affected_order_ids)
      and orders.status = 'PENDING_PAYMENT'
      and not exists (
        select 1 from public.inventory_reservations reservations
        where reservations.order_id = orders.id and reservations.status = 'HELD'
      );
    get diagnostics orders_cancelled = row_count;

    update public.delivery_jobs jobs
    set status = 'CANCELLED', updated_at = now()
    where jobs.order_id = any(affected_order_ids)
      and jobs.status = 'PAYMENT_PENDING';
  end if;

  update public.tutorial_bookings bookings
  set status = 'CANCELLED', updated_at = now()
  where bookings.status = 'PENDING_PAYMENT'
    and bookings.payment_expires_at <= now();
  get diagnostics bookings_cancelled = row_count;

  return next;
end;
$$;

update public.release_phases
set requirements = requirements ||
  '["Reviewed late-payment refund runbook and payment-anomaly owner"]'::jsonb,
  updated_at = now()
where phase_key = 'phase-3'
  and not requirements @> '["Reviewed late-payment refund runbook and payment-anomaly owner"]'::jsonb;

commit;
