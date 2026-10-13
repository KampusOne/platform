begin;
-- Real campus coverage; per-order fare always comes from a mapped route.
alter table public.delivery_zones add column campus_id uuid references public.institution_campuses(id);
create index delivery_zone_campus on public.delivery_zones(university_id,campus_id) where active;
insert into public.delivery_zones(university_id,campus_id,name,base_fee_kobo,active,earning_formula_version)
 select c.institution_id,c.id,c.name,30000,true,'CAMPUS_FARE_V2' from public.institution_campuses c
 where c.status='PUBLISHED' and exists(select 1 from app_private.active_commerce_fee_policies a where a.university_id=c.institution_id and a.kind='STORE')
 and not exists(select 1 from public.delivery_zones z where z.university_id=c.institution_id and z.campus_id=c.id and z.active);
-- Old ride snapshots retain the 300–450 tariff and original commission.
-- New rides earn the full 300–500 fare; new agent commission applies on payout.
alter table public.delivery_jobs drop constraint delivery_jobs_financial_version_check;
alter table public.delivery_jobs add constraint delivery_jobs_financial_version_check check(financial_version in('CAMPUS_FARE_V1','CAMPUS_FARE_V2'));
alter table public.delivery_jobs drop constraint delivery_jobs_campus_fare_check;
alter table public.delivery_jobs add constraint delivery_jobs_campus_fare_check check(financial_version is null or
 (fare_kobo is not null and rider_earning_kobo is not null and fare_basis is not null and route_distance_metres between 0 and 100000 and
 ((financial_version='CAMPUS_FARE_V1' and fare_kobo=least(45000,30000+ceil(greatest(0,route_distance_metres-1000)::numeric/1000)::integer*5000) and rider_earning_kobo=fare_kobo*9/10)
 or (financial_version='CAMPUS_FARE_V2' and fare_kobo=least(50000,30000+ceil(greatest(0,route_distance_metres-1000)::numeric/1000)::integer*5000) and rider_earning_kobo=fare_kobo))));

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
        case when p_fulfilment_mode='PICKUP' then coalesce(nullif(trim(storefront.pickup_location),''),'Pickup from '||storefront.display_name) else trim(p_delivery_location) end,
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

create or replace function app_private.create_priced_store_order(p_quote uuid,p_buyer uuid,p_uni uuid,p_pickup_hash text,p_delivery_hash text)
returns table(id uuid,status text,subtotal_kobo integer,delivery_fee_kobo integer,total_kobo integer,payable_kobo bigint,cash_due_kobo integer)
language plpgsql set search_path='' as $$
declare quote app_private.store_checkout_quotes%rowtype; price jsonb; payload jsonb; valid_count integer; base bigint; listed bigint;
begin
  select * into quote from app_private.store_checkout_quotes where store_checkout_quotes.id=p_quote
    and buyer_user_id=p_buyer and university_id=p_uni;
  if not found then raise exception 'PRICE_QUOTE_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-quote:'||p_quote::text,0));
  if exists(select 1 from public.orders o where o.id=p_quote and o.buyer_user_id=p_buyer and o.university_id=p_uni) then
    return query select o.id,o.status,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo,s.payable_kobo,s.cash_due_kobo
      from public.orders o join app_private.order_price_snapshots s on s.order_id=o.id where o.id=p_quote; return;
  end if;
  if quote.expires_at<=now() then raise exception 'PRICE_QUOTE_EXPIRED'; end if;
  perform 1 from public.vendor_products p join jsonb_to_recordset(quote.items) x(product_id uuid) on x.product_id=p.id order by p.id for update of p;
  select count(*)::integer,sum(p.price_kobo*x.quantity),sum(x.customer_unit_kobo*x.quantity) into valid_count,base,listed
    from public.vendor_products p join jsonb_to_recordset(quote.items) x(product_id uuid,quantity integer,base_kobo integer,customer_unit_kobo integer) on x.product_id=p.id
    where p.vendor_profile_id=quote.vendor_profile_id and p.university_id=p_uni and p.price_kobo=x.base_kobo;
  if valid_count<>jsonb_array_length(quote.items) then raise exception 'PRODUCT_PRICE_CHANGED'; end if;
  price=quote.pricing; payload=quote.request_payload;
  if base is distinct from (price->>'baseKobo')::bigint or listed is distinct from (price->>'listedItemsKobo')::bigint or
    (price->>'totalKobo')::bigint is distinct from ((price->>'payableKobo')::bigint+(price->>'cashDueKobo')::bigint) or
    (price->>'totalKobo')::bigint>listed+(price->>'fareKobo')::bigint or (price->>'discountKobo')::bigint<0 then raise exception 'INVALID_PRICE_SNAPSHOT'; end if;
  perform * from app_private.create_store_order_v3(p_quote,p_uni,p_buyer,quote.vendor_profile_id,
    payload->>'fulfilmentMode',(payload->>'deliveryZoneId')::uuid,payload->>'recipientName',payload->>'recipientPhoneE164',
    payload->>'deliveryLocation',payload->>'deliveryLandmark',(payload->>'deliveryLatitude')::numeric,(payload->>'deliveryLongitude')::numeric,
    payload->>'deliveryNote',quote.items,p_pickup_hash,p_delivery_hash);
  update public.orders set subtotal_kobo=(listed-(price->>'discountKobo')::bigint)::integer,
    delivery_fee_kobo=(price->>'fareKobo')::integer,pricing_formula_version='INCLUSIVE_V1' where orders.id=p_quote;
  update public.order_items i set unit_price_kobo=x.customer_unit_kobo from jsonb_to_recordset(quote.items) x(product_id uuid,customer_unit_kobo integer)
    where i.order_id=p_quote and i.product_id=x.product_id;
  insert into app_private.order_price_snapshots(order_id,university_id,quote_id,base_kobo,listed_items_kobo,discount_kobo,seller_net_kobo,payable_kobo,cash_due_kobo)
    values(p_quote,p_uni,p_quote,base,listed,(price->>'discountKobo')::bigint,(price->>'sellerNetKobo')::bigint,(price->>'payableKobo')::bigint,(price->>'cashDueKobo')::integer);
  if payload->>'fulfilmentMode'='RIDER' then
    update public.delivery_jobs set fare_kobo=(price->>'fareKobo')::integer,
      rider_earning_kobo=(quote.fare->>'riderNetKobo')::integer,earning_formula_version=case when quote.fare->>'tariffVersion'='campus-300-500-v2' then 'CAMPUS_FARE_V2' else 'CAMPUS_FARE_V1' end,financial_version=case when quote.fare->>'tariffVersion'='campus-300-500-v2' then 'CAMPUS_FARE_V2' else 'CAMPUS_FARE_V1' end,
      fare_payment_method=coalesce(payload->>'deliveryPaymentMethod','IN_APP'),route_distance_metres=(quote.fare->>'routeMetres')::integer,fare_basis=case when quote.fare->>'distanceBasis'='OSM_BICYCLE_NETWORK'then 'ROAD_ROUTE'else 'CAMPUS_ZONE'end
      where order_id=p_quote;
  end if;
  return query select o.id,o.status,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo,s.payable_kobo,s.cash_due_kobo
    from public.orders o join app_private.order_price_snapshots s on s.order_id=o.id where o.id=p_quote;
end; $$;

create or replace function app_private.settle_rider_finance() returns trigger language plpgsql set search_path='' as $$
declare rider_user uuid; receipt app_private.commerce_settlements%rowtype; commission integer; journal uuid;
begin
  if old.financial_version is not null and (new.fare_kobo,new.fare_payment_method,new.rider_earning_kobo,new.financial_version,new.route_distance_metres,new.fare_basis)
    is distinct from (old.fare_kobo,old.fare_payment_method,old.rider_earning_kobo,old.financial_version,old.route_distance_metres,old.fare_basis) then
    raise exception 'RIDER_QUOTE_IMMUTABLE'; end if;
  if new.financial_version is null then return new; end if;
  if new.status='DELIVERED' and old.status is distinct from 'DELIVERED' then
    select user_id into rider_user from public.agent_profiles where id=new.rider_profile_id
      and university_id=new.university_id and agent_type='RIDER';
    if rider_user is null then raise exception 'RIDER_SETTLEMENT_OWNER_MISSING'; end if;
    perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||rider_user::text,0));
    select * into receipt from app_private.commerce_settlements where order_id=new.order_id and university_id=new.university_id;
    if not found or (new.fare_payment_method='CASH' and receipt.cash_fare_kobo<>new.fare_kobo) or
      (new.fare_payment_method='IN_APP' and receipt.digital_fare_kobo<>new.fare_kobo) then raise exception 'RIDER_ORDER_PAYMENT_UNVERIFIED'; end if;
    commission=new.fare_kobo-new.rider_earning_kobo;
    if new.fare_payment_method='CASH' then
      if commission>0 then insert into app_private.rider_cash_commissions(job_id,university_id,rider_profile_id,rider_user_id,fare_kobo,commission_kobo)
        values(new.id,new.university_id,new.rider_profile_id,rider_user,new.fare_kobo,commission);
      journal=app_private.post_finance_journal(new.university_id,'RIDER_COMMISSION',new.id::text,'rider-cash:'||new.id::text,
        'Commission on a cash fare held by the rider',jsonb_build_array(
          jsonb_build_object('code','RIDER_COMMISSION_RECEIVABLE','type','ASSET','owner',rider_user,'direction','DEBIT','amount',commission),
          jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',commission)));
      end if;new.earnings_state='NOT_EARNED'; -- Physical cash is not an in-app payout balance.
    else
      journal=app_private.post_finance_journal(new.university_id,'DELIVERY_JOB',new.id::text,'rider-digital:'||new.id::text,
        'Completed digital fare split between rider and platform',jsonb_build_array(
          jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','DEBIT','amount',new.fare_kobo),
          jsonb_build_object('code','RIDER_PENDING','type','LIABILITY','owner',rider_user,'direction','CREDIT','amount',new.rider_earning_kobo),
          jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',commission)));
    end if;
    perform app_private.offset_rider_commissions(rider_user,new.university_id);
  elsif new.earnings_state='AVAILABLE' and old.earnings_state='PENDING' and new.status='DELIVERED' and new.fare_payment_method='IN_APP' then
    if new.delivered_at>now()-interval '48 hours' or exists(select 1 from public.disputes d
      where d.order_id=new.order_id and d.status in ('OPEN','UNDER_REVIEW')) then raise exception 'RIDER_EARNINGS_NOT_ELIGIBLE'; end if;
    select user_id into rider_user from public.agent_profiles where id=new.rider_profile_id;
    perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||rider_user::text,0));
    journal=app_private.post_finance_journal(new.university_id,'DELIVERY_JOB',new.id::text,'rider-release:'||new.id::text,
      'Release completed rider earnings after the dispute window',jsonb_build_array(
        jsonb_build_object('code','RIDER_PENDING','type','LIABILITY','owner',rider_user,'direction','DEBIT','amount',new.rider_earning_kobo),
        jsonb_build_object('code','RIDER_AVAILABLE','type','LIABILITY','owner',rider_user,'direction','CREDIT','amount',new.rider_earning_kobo)));
    perform app_private.offset_rider_commissions(rider_user,new.university_id);
  end if;
  return new;
end; $$;
commit;
