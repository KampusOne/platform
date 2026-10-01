begin;

-- New orders can use a store pickup, vendor delivery, or a posted rider request.
-- Existing orders retain the rider workflow and their original financial totals.
alter table public.orders add column if not exists fulfilment_mode text not null default 'RIDER'
  check (fulfilment_mode in ('PICKUP','VENDOR_DELIVERY','RIDER'));
alter table public.vendor_storefronts
  add column if not exists pickup_enabled boolean not null default true,
  add column if not exists self_delivery_enabled boolean not null default false;
alter table public.order_delivery_snapshots
  add column if not exists pickup_location text,
  add column if not exists pickup_instructions text;
alter table public.delivery_jobs add column if not exists request_posted_at timestamptz;
update public.delivery_jobs set request_posted_at=coalesce(reserved_at,created_at)
  where request_posted_at is null and status in ('AVAILABLE','RESERVED','PICKED_UP','DELIVERED');

create table if not exists app_private.store_order_handoffs (
  order_id uuid primary key,
  university_id uuid not null references public.universities(id) on delete restrict,
  code_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null default now()+interval '7 days',
  confirmed_at timestamptz,
  foreign key(order_id,university_id) references public.orders(id,university_id) on delete restrict
);

create or replace function app_private.create_store_order_v3(
  p_order_id uuid, p_university_id uuid, p_buyer_user_id uuid, p_vendor_profile_id uuid,
  p_fulfilment_mode text, p_delivery_zone_id uuid,
  p_recipient_name text, p_recipient_phone_e164 text, p_delivery_location text,
  p_delivery_landmark text, p_delivery_latitude numeric, p_delivery_longitude numeric,
  p_delivery_note text, p_items jsonb, p_pickup_code_hash text, p_delivery_code_hash text
) returns table(id uuid,subtotal_kobo integer,delivery_fee_kobo integer,total_kobo integer)
language plpgsql set search_path='' as $$
declare
  storefront public.vendor_storefronts%rowtype;
  requested_count integer; valid_count integer; subtotal integer; fee integer:=0;
begin
  if p_fulfilment_mode not in ('PICKUP','VENDOR_DELIVERY','RIDER') then
    raise exception using errcode='22023',message='INVALID_FULFILMENT_MODE';
  end if;
  perform 1 from public.profiles where user_id=p_buyer_user_id
    and university_id=p_university_id and deleted_at is null;
  if not found then raise exception using errcode='P0001',message='BUYER_TENANT_MISMATCH'; end if;
  select s.* into storefront from public.vendor_storefronts s
    join public.agent_profiles a on a.id=s.vendor_profile_id and a.university_id=s.university_id
    where s.vendor_profile_id=p_vendor_profile_id and s.university_id=p_university_id
      and s.status='APPROVED' and a.status='ACTIVE' and a.agent_type='VENDOR'
    for share of s,a;
  if not found then raise exception using errcode='P0001',message='VENDOR_STOREFRONT_UNAVAILABLE'; end if;
  if (p_fulfilment_mode='PICKUP' and not storefront.pickup_enabled) or
    (p_fulfilment_mode='VENDOR_DELIVERY' and not storefront.self_delivery_enabled) then
    raise exception using errcode='P0001',message='FULFILMENT_MODE_UNAVAILABLE';
  end if;

    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
      raise exception using errcode='22023',message='INVALID_ITEMS';
    end if;
    select count(*),count(distinct x.product_id) into requested_count,valid_count
      from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer);
    if requested_count<>valid_count then raise exception using errcode='22023',message='DUPLICATE_ITEMS'; end if;
    perform p.id from public.vendor_products p
      join jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer) on x.product_id=p.id
      where p.university_id=p_university_id and p.vendor_profile_id=p_vendor_profile_id
      order by p.id for update of p;
    select count(*)::integer,coalesce(sum(p.price_kobo*x.quantity),0)::integer
      into valid_count,subtotal from public.vendor_products p
      join jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer) on x.product_id=p.id
      join public.product_categories c on c.id=p.category_id and c.university_id=p.university_id and c.status='APPROVED'
      where p.university_id=p_university_id and p.vendor_profile_id=p_vendor_profile_id
        and p.status='PUBLISHED' and x.quantity between 1 and 100 and p.stock_quantity>=x.quantity;
    if valid_count<>requested_count then raise exception using errcode='P0001',message='PRODUCT_UNAVAILABLE_OR_STOCK_LOW'; end if;
    if p_fulfilment_mode='RIDER' then
      select z.base_fee_kobo into fee from public.delivery_zones z
        where z.id=p_delivery_zone_id and z.university_id=p_university_id and z.active;
      if not found then raise exception using errcode='P0002',message='DELIVERY_ZONE_UNAVAILABLE'; end if;
    end if;
    insert into public.orders(id,university_id,buyer_user_id,vendor_profile_id,fulfilment_mode,
      delivery_zone_id,subtotal_kobo,delivery_fee_kobo,delivery_note,pricing_formula_version)
      values(p_order_id,p_university_id,p_buyer_user_id,p_vendor_profile_id,p_fulfilment_mode,
        case when p_fulfilment_mode='RIDER' then p_delivery_zone_id else null end,
        subtotal,fee,p_delivery_note,'UNCONFIGURED');
    insert into public.order_items(order_id,product_id,quantity,unit_price_kobo)
      select p_order_id,p.id,x.quantity,p.price_kobo from public.vendor_products p
      join jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer) on x.product_id=p.id;
    update public.vendor_products p set stock_quantity=p.stock_quantity-x.quantity,updated_at=now()
      from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer) where p.id=x.product_id;
    insert into public.inventory_reservations(order_id,product_id,quantity,expires_at)
      select p_order_id,x.product_id,x.quantity,now()+interval '30 minutes'
      from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer);
    insert into public.order_delivery_snapshots(order_id,university_id,recipient_name,recipient_phone_e164,
      delivery_location,delivery_landmark,latitude,longitude,pickup_location,pickup_instructions)
      values(p_order_id,p_university_id,trim(p_recipient_name),trim(p_recipient_phone_e164),
        case when p_fulfilment_mode='PICKUP' then storefront.pickup_location else trim(p_delivery_location) end,
        case when p_fulfilment_mode='PICKUP' then null else nullif(trim(p_delivery_landmark),'') end,
        case when p_fulfilment_mode='PICKUP' then null else p_delivery_latitude end,
        case when p_fulfilment_mode='PICKUP' then null else p_delivery_longitude end,
        storefront.pickup_location,storefront.pickup_instructions);
    if p_fulfilment_mode='RIDER' then
      insert into public.delivery_jobs(university_id,order_id,zone_id,status,pickup_code_hash,delivery_code_hash,code_expires_at)
        values(p_university_id,p_order_id,p_delivery_zone_id,'PAYMENT_PENDING',p_pickup_code_hash,p_delivery_code_hash,now()+interval '7 days');
    else
      insert into app_private.store_order_handoffs(order_id,university_id,code_hash)
        values(p_order_id,p_university_id,p_delivery_code_hash);
    end if;
  return query select o.id,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo
    from public.orders o where o.id=p_order_id;
end;
$$;

create or replace function app_private.post_vendor_rider_request(p_order_id uuid,p_vendor_user_id uuid,p_university_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare job_id uuid;
begin
  perform 1 from public.orders o join public.agent_profiles a on a.id=o.vendor_profile_id
    join public.vendor_storefronts s on s.vendor_profile_id=a.id and s.university_id=o.university_id
    where o.id=p_order_id and o.university_id=p_university_id and o.fulfilment_mode='RIDER'
      and o.status='READY' and a.user_id=p_vendor_user_id and a.status='ACTIVE'
      and a.agent_type='VENDOR' and s.status='APPROVED' for update of o;
  if not found then raise exception using errcode='P0001',message='ORDER_NOT_READY_FOR_RIDER'; end if;
  update public.delivery_jobs set request_posted_at=coalesce(request_posted_at,now()),updated_at=now()
    where order_id=p_order_id and university_id=p_university_id and status='AVAILABLE' returning id into job_id;
  if job_id is null then raise exception using errcode='P0001',message='DELIVERY_UNAVAILABLE'; end if;
  return job_id;
end;
$$;

create or replace function app_private.confirm_vendor_order_handoff(p_order_id uuid,p_vendor_user_id uuid,
  p_university_id uuid,p_code_hash text) returns text language plpgsql set search_path='' as $$
declare selected_order public.orders%rowtype; handoff app_private.store_order_handoffs%rowtype;
begin
  select o.* into selected_order from public.orders o join public.agent_profiles a on a.id=o.vendor_profile_id
    join public.vendor_storefronts s on s.vendor_profile_id=a.id and s.university_id=o.university_id
    where o.id=p_order_id and o.university_id=p_university_id and a.user_id=p_vendor_user_id
      and a.status='ACTIVE' and a.agent_type='VENDOR' and s.status='APPROVED' for update of o;
  if not found then return 'INVALID_STATE'; end if;
  if not ((selected_order.fulfilment_mode='PICKUP' and selected_order.status='READY') or
    (selected_order.fulfilment_mode='VENDOR_DELIVERY' and selected_order.status='IN_DELIVERY')) then return 'INVALID_STATE'; end if;
  select * into handoff from app_private.store_order_handoffs where order_id=p_order_id for update;
  if not found then return 'INVALID_STATE'; end if;
  if handoff.attempts>=5 or handoff.expires_at<=now() then return 'LOCKED'; end if;
  if handoff.code_hash<>p_code_hash then
    update app_private.store_order_handoffs set attempts=attempts+1 where order_id=p_order_id;
    if handoff.attempts+1>=5 then return 'LOCKED'; end if;
    return 'INCORRECT';
  end if;
  update app_private.store_order_handoffs set confirmed_at=now() where order_id=p_order_id;
  update public.orders set status='DELIVERED',completed_at=now(),earnings_state='PENDING',updated_at=now() where id=p_order_id;
  return 'DELIVERED';
end;
$$;

-- The row lock and availability predicate are both enforced here; UI hiding
-- alone must never make an unposted or already-claimed request claimable.
create or replace function app_private.reserve_delivery_job(p_job_id uuid,p_rider_profile_id uuid)
returns table(id uuid,university_id uuid) language plpgsql set search_path='' as $$
declare rider public.agent_profiles%rowtype; presence public.rider_presence%rowtype; job public.delivery_jobs%rowtype;
begin
  select * into rider from public.agent_profiles where agent_profiles.id=p_rider_profile_id and agent_type='RIDER' and status='ACTIVE';
  if not found then raise exception using errcode='P0002',message='RIDER_PROFILE_UNAVAILABLE'; end if;
  select * into presence from public.rider_presence where rider_profile_id=p_rider_profile_id for update;
  if not found or not presence.online or presence.capacity_status<>'AVAILABLE' then
    raise exception using errcode='P0001',message='RIDER_NOT_AVAILABLE'; end if;
  if exists(select 1 from public.delivery_jobs where rider_profile_id=p_rider_profile_id and status in ('RESERVED','PICKED_UP')) then
    raise exception using errcode='P0001',message='RIDER_AT_CAPACITY'; end if;
  perform 1 from public.orders o join public.delivery_jobs j on j.order_id=o.id
    where j.id=p_job_id and j.university_id=rider.university_id and j.status='AVAILABLE'
      and j.request_posted_at is not null and o.status in ('PAID','ACCEPTED','READY') for update of o;
  if not found then raise exception using errcode='P0001',message='DELIVERY_UNAVAILABLE'; end if;
  select j.* into job from public.delivery_jobs j
    where j.id=p_job_id and j.university_id=rider.university_id and j.status='AVAILABLE'
      and j.request_posted_at is not null for update of j;
  if not found then raise exception using errcode='P0001',message='DELIVERY_UNAVAILABLE'; end if;
  update public.delivery_jobs set rider_profile_id=p_rider_profile_id,status='RESERVED',reserved_at=now(),
    reservation_expires_at=now()+interval '10 minutes',updated_at=now() where delivery_jobs.id=job.id;
  update public.rider_presence set capacity_status='AT_CAPACITY',last_seen_at=now(),updated_at=now() where rider_profile_id=p_rider_profile_id;
  return query select job.id,job.university_id;
end;
$$;

revoke all on app_private.store_order_handoffs from public;
revoke all on function app_private.create_store_order_v3(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,numeric,numeric,text,jsonb,text,text) from public;
revoke all on function app_private.post_vendor_rider_request(uuid,uuid,uuid) from public;
revoke all on function app_private.confirm_vendor_order_handoff(uuid,uuid,uuid,text) from public;
revoke all on function app_private.reserve_delivery_job(uuid,uuid) from public;
commit;
