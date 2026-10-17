begin;
set local lock_timeout='5s';
alter table public.delivery_jobs drop constraint delivery_jobs_financial_version_check;
alter table public.delivery_jobs add constraint delivery_jobs_financial_version_check check(financial_version in('CAMPUS_FARE_V1','CAMPUS_FARE_V2','CAMPUS_FARE_V3'));
alter table public.delivery_jobs drop constraint delivery_jobs_campus_fare_check;
alter table public.delivery_jobs add constraint delivery_jobs_campus_fare_check check(financial_version is null or
(fare_kobo is not null and rider_earning_kobo is not null and fare_basis is not null and route_distance_metres between 0 and 100000 and
((financial_version='CAMPUS_FARE_V1' and fare_kobo=least(45000,30000+ceil(greatest(0,route_distance_metres-1000)::numeric/1000)::integer*5000) and rider_earning_kobo=fare_kobo*9/10)
or(financial_version='CAMPUS_FARE_V2' and fare_kobo=least(50000,30000+ceil(greatest(0,route_distance_metres-1000)::numeric/1000)::integer*5000) and rider_earning_kobo=fare_kobo)
or(financial_version='CAMPUS_FARE_V3' and fare_kobo between 50000 and 150000 and fare_kobo%5000=0 and rider_earning_kobo=fare_kobo))));
create function app_private.validate_campus_fare_snapshot()returns trigger language plpgsql set search_path='' as $$begin
 if new.financial_version='CAMPUS_FARE_V3' and not exists(select 1 from app_private.store_checkout_quotes q join app_private.order_price_snapshots p on p.quote_id=q.id where p.order_id=new.order_id and q.university_id=new.university_id and (q.fare->>'fareKobo')::integer=new.fare_kobo and (q.fare->>'riderNetKobo')::integer=new.rider_earning_kobo and (q.fare->>'routeMetres')::integer=new.route_distance_metres)then raise exception 'RIDER_FARE_SNAPSHOT_MISMATCH';end if;
 return new;end;$$;
create trigger delivery_fare_snapshot_guard before insert or update on public.delivery_jobs for each row execute function app_private.validate_campus_fare_snapshot();
revoke all on function app_private.validate_campus_fare_snapshot() from public;

CREATE OR REPLACE FUNCTION app_private.create_store_order_v3(p_order_id uuid, p_university_id uuid, p_buyer_user_id uuid, p_vendor_profile_id uuid, p_fulfilment_mode text, p_delivery_zone_id uuid, p_recipient_name text, p_recipient_phone_e164 text, p_delivery_location text, p_delivery_landmark text, p_delivery_latitude numeric, p_delivery_longitude numeric, p_delivery_note text, p_items jsonb, p_pickup_code_hash text, p_delivery_code_hash text)
 RETURNS TABLE(id uuid, subtotal_kobo integer, delivery_fee_kobo integer, total_kobo integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if (p_fulfilment_mode='PICKUP' and not storefront.pickup_enabled and not exists(select 1 from app_private.store_checkout_quotes q where q.id=p_order_id and q.buyer_user_id=p_buyer_user_id and q.request_payload->>'pickupPointName' in(select name from public.commerce_pickup_hubs where university_id=p_university_id))) or
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
      where p.university_id=p_university_id and (p.vendor_profile_id=p_vendor_profile_id or exists(select 1 from app_private.store_checkout_quotes q where q.id=p_order_id and q.buyer_user_id=p_buyer_user_id and q.university_id=p_university_id and q.vendor_profile_id=p_vendor_profile_id and q.items=p_items))
      order by p.id for update of p;
    select count(*)::integer,coalesce(sum(p.price_kobo*x.quantity),0)::integer
      into valid_count,subtotal from public.vendor_products p
      join jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer) on x.product_id=p.id
      join public.product_categories c on c.id=p.category_id and c.university_id=p.university_id and c.status='APPROVED'
      where p.university_id=p_university_id and (p.vendor_profile_id=p_vendor_profile_id or exists(select 1 from app_private.store_checkout_quotes q where q.id=p_order_id and q.buyer_user_id=p_buyer_user_id and q.university_id=p_university_id and q.vendor_profile_id=p_vendor_profile_id and q.items=p_items))
        and exists(select 1 from public.agent_profiles owner join public.vendor_storefronts own_store on own_store.vendor_profile_id=owner.id and own_store.university_id=owner.university_id where owner.id=p.vendor_profile_id and owner.university_id=p_university_id and owner.agent_type='VENDOR' and owner.status='ACTIVE' and own_store.status='APPROVED')
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
        case when p_fulfilment_mode='PICKUP' then coalesce((select nullif(q.request_payload->>'pickupPointName','') from app_private.store_checkout_quotes q where q.id=p_order_id and q.buyer_user_id=p_buyer_user_id),nullif(trim(storefront.pickup_location),''),'Pickup from '||storefront.display_name) else trim(p_delivery_location) end,
        case when p_fulfilment_mode='PICKUP' then null else nullif(trim(p_delivery_landmark),'') end,
        case when p_fulfilment_mode='PICKUP' then null else p_delivery_latitude end,
        case when p_fulfilment_mode='PICKUP' then null else p_delivery_longitude end,
        coalesce((select nullif(q.request_payload->>'pickupPointName','') from app_private.store_checkout_quotes q where q.id=p_order_id and p_fulfilment_mode='PICKUP'),storefront.pickup_location),storefront.pickup_instructions);
    if p_fulfilment_mode='RIDER' then
      insert into public.delivery_jobs(university_id,order_id,zone_id,status,pickup_code_hash,delivery_code_hash,code_expires_at)
        values(p_university_id,p_order_id,p_delivery_zone_id,'PAYMENT_PENDING',p_pickup_code_hash,p_delivery_code_hash,now()+interval '7 days');
    end if;
      insert into app_private.store_order_handoffs(order_id,university_id,code_hash)
        values(p_order_id,p_university_id,p_delivery_code_hash);
  return query select o.id,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo
    from public.orders o where o.id=p_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.create_priced_store_order(p_quote uuid, p_buyer uuid, p_uni uuid, p_pickup_hash text, p_delivery_hash text)
 RETURNS TABLE(id uuid, status text, subtotal_kobo integer, delivery_fee_kobo integer, total_kobo integer, payable_kobo bigint, cash_due_kobo integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    where p.university_id=p_uni and p.price_kobo=x.base_kobo;
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

  with grouped as(
    select p.vendor_profile_id,a.user_id,sum(x.base_kobo::bigint*x.quantity) as amount,
      sum(x.customer_unit_kobo::bigint*x.quantity) as listed_amount
    from jsonb_to_recordset(quote.items) x(product_id uuid,quantity integer,base_kobo bigint,customer_unit_kobo bigint)
    join public.vendor_products p on p.id=x.product_id join public.agent_profiles a on a.id=p.vendor_profile_id
    group by p.vendor_profile_id,a.user_id
  ), weighted as(select *,case when base>0 then floor((price->>'sellerNetKobo')::numeric*amount/base)::bigint else 0 end as portion,row_number()over(order by vendor_profile_id) as position from grouped)
  insert into app_private.order_vendor_allocations(order_id,vendor_profile_id,vendor_user_id,seller_net_kobo,listed_items_kobo)
    select p_quote,vendor_profile_id,user_id,portion+case when position=1 then (price->>'sellerNetKobo')::bigint-sum(portion)over() else 0 end,weighted.listed_amount from weighted;
  if payload->>'fulfilmentMode'='RIDER' then
    update public.delivery_jobs set fare_kobo=(price->>'fareKobo')::integer,
      rider_earning_kobo=(quote.fare->>'riderNetKobo')::integer,earning_formula_version=case when quote.fare->>'tariffVersion'='campus-distance-load-500-1500-v3' then 'CAMPUS_FARE_V3' when quote.fare->>'tariffVersion'='campus-300-500-v2' then 'CAMPUS_FARE_V2' else 'CAMPUS_FARE_V1' end,financial_version=case when quote.fare->>'tariffVersion'='campus-distance-load-500-1500-v3' then 'CAMPUS_FARE_V3' when quote.fare->>'tariffVersion'='campus-300-500-v2' then 'CAMPUS_FARE_V2' else 'CAMPUS_FARE_V1' end,
      fare_payment_method=coalesce(payload->>'deliveryPaymentMethod','IN_APP'),route_distance_metres=(quote.fare->>'routeMetres')::integer,fare_basis=case when quote.fare->>'distanceBasis'='OSM_BICYCLE_NETWORK'then 'ROAD_ROUTE'else 'CAMPUS_ZONE'end
      where order_id=p_quote;
  end if;
  return query select o.id,o.status,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo,s.payable_kobo,s.cash_due_kobo
    from public.orders o join app_private.order_price_snapshots s on s.order_id=o.id where o.id=p_quote;
end; $function$;

CREATE OR REPLACE FUNCTION app_private.record_priced_store_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; selected_order public.orders%rowtype; price app_private.order_price_snapshots%rowtype;
  seller_user uuid; journal uuid; lines jsonb; gross_margin bigint; digital_fare integer; principal bigint; recoverable boolean:=false; restock boolean:=false; reservation record; allocation record;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='STORE_ORDER';
  if not found then return 'UNKNOWN'; end if;
  select * into selected_order from public.orders where id=attempt.resource_id and pricing_formula_version='INCLUSIVE_V1' for update;
  if not found then return 'LEGACY'; end if;
  select * into price from app_private.order_price_snapshots where order_id=selected_order.id;
  if not found then raise exception 'PRICE_SNAPSHOT_MISSING'; end if;
  perform app_private.record_verified_paystack_receipt(selected_order.university_id,p_reference,'STORE_ORDER',selected_order.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.commerce_settlements where order_id=selected_order.id) then
    if exists(select 1 from app_private.commerce_settlements where order_id=selected_order.id and provider_reference=p_reference and amount_kobo=p_amount and provider_fee_kobo=p_fee) then return 'ALREADY_PAID'; end if;
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='SECOND_SUCCESSFUL_PAYMENT',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='SECOND_SUCCESSFUL_PAYMENT',updated_at=now()
      where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  -- Paid time, not webhook arrival time, establishes the original reservation.
  perform 1 from public.inventory_reservations where order_id=selected_order.id order by product_id for update;
  recoverable=selected_order.status in ('PENDING_PAYMENT','CANCELLED') and selected_order.cancelled_by_user_id is null
    and p_paid_at>=attempt.created_at and p_paid_at<=now()+interval '5 minutes'
    and exists(select 1 from public.inventory_reservations where order_id=selected_order.id)
    and not exists(select 1 from app_private.audit_events where target_id=selected_order.id::text
      and action='order.cancelled' and outcome='succeeded')
    and not exists(select 1 from public.inventory_reservations where order_id=selected_order.id
      and (status not in ('HELD','RELEASED') or p_paid_at>expires_at))
    and not exists(select 1 from public.order_status_events where order_id=selected_order.id
      and status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED','DISPUTED','REFUNDED'));
  if attempt.university_id is distinct from selected_order.university_id or attempt.user_id<>selected_order.buyer_user_id or
    (selected_order.status<>'PENDING_PAYMENT' and not recoverable) or attempt.status not in ('CREATED','INITIALIZED','REQUIRES_REVIEW') or
    (not recoverable and not exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='HELD' and expires_at>now())) or
    not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,price.payable_kobo) or attempt.amount_kobo<>price.payable_kobo or p_fee<0 or p_paid_at is null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now()
      where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  restock=recoverable and exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='RELEASED');
  if restock then
    perform 1 from public.vendor_products where id in (select product_id from public.inventory_reservations where order_id=selected_order.id and status='RELEASED') order by id for update;
    if exists(select 1 from public.inventory_reservations r join public.vendor_products p on p.id=r.product_id where r.order_id=selected_order.id and r.status='RELEASED' and p.stock_quantity<r.quantity) then
      update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAID_ORDER_STOCK_UNAVAILABLE',updated_at=now() where id=attempt.id;
      update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAID_ORDER_STOCK_UNAVAILABLE',updated_at=now() where provider_reference=p_reference;
      return 'REQUIRES_REVIEW';
    end if;
    for reservation in select * from public.inventory_reservations where order_id=selected_order.id and status='RELEASED' order by product_id loop
      update public.vendor_products set stock_quantity=stock_quantity-reservation.quantity,updated_at=now() where id=reservation.product_id;
    end loop;
  end if;
  select user_id into seller_user from public.agent_profiles where id=selected_order.vendor_profile_id;
  digital_fare=selected_order.delivery_fee_kobo-price.cash_due_kobo;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  gross_margin=principal-price.seller_net_kobo-digital_fare;
  if gross_margin<0 and not exists(select 1 from app_private.discount_redemptions where purchase_id=selected_order.id and discount_kobo>=-gross_margin) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if exists(select 1 from app_private.order_vendor_allocations where order_id=selected_order.id) then
    lines=lines||coalesce((select jsonb_agg(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',vendor_user_id,'direction','CREDIT','amount',seller_net_kobo) order by vendor_profile_id) from app_private.order_vendor_allocations where order_id=selected_order.id and seller_net_kobo>0),'[]'::jsonb);
  elsif price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',seller_user,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if digital_fare>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','CREDIT','amount',digital_fare)); end if;
  if gross_margin>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',gross_margin)); end if;
  if gross_margin<0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',-gross_margin));end if;
  journal=app_private.post_finance_journal(selected_order.university_id,'STORE_ORDER',selected_order.id::text,'priced-payment:'||p_reference,'Verified inclusive store checkout',lines);
  insert into app_private.commerce_settlements(order_id,university_id,provider_reference,amount_kobo,seller_net_kobo,digital_fare_kobo,cash_fare_kobo,provider_fee_kobo,journal_id)
    values(selected_order.id,selected_order.university_id,p_reference,p_amount,price.seller_net_kobo,digital_fare,price.cash_due_kobo,p_fee,journal);
  update public.orders set status='PAID',earnings_state='PENDING',provider_reference=coalesce(provider_reference,p_reference),updated_at=now() where id=selected_order.id;
  update public.inventory_reservations set status='CONVERTED' where order_id=selected_order.id and (status='HELD' or (recoverable and status='RELEASED'));
  update public.delivery_jobs set status='AVAILABLE',updated_at=now() where order_id=selected_order.id and (status='PAYMENT_PENDING' or (recoverable and status='CANCELLED'));
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=p_paid_at,updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now()
    where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
  for allocation in select * from app_private.order_vendor_allocations where order_id=selected_order.id and vendor_profile_id<>selected_order.vendor_profile_id loop
    perform app_private.queue_commerce_notice(allocation.vendor_user_id,selected_order.university_id,selected_order.buyer_user_id,'New paid order','A student has paid for your items in a combined order. Prepare your items for CampusOne.','/vendor-orders','commerce:paid:STORE_ORDER:'||selected_order.id::text||':seller:'||allocation.vendor_profile_id::text);
  end loop;
  return 'PAID';
end; $function$;


create or replace function app_private.release_priced_store_earnings() returns trigger language plpgsql set search_path='' as $$
declare price app_private.order_price_snapshots%rowtype; owner uuid; allocation record; lines jsonb:='[]';
begin
  if new.pricing_formula_version<>'INCLUSIVE_V1' then return new;end if;
  if new.status='DELIVERED' and old.status<>'DELIVERED' then new.completed_at=coalesce(new.completed_at,now());new.earnings_state='AVAILABLE';end if;
  if new.earnings_state<>'AVAILABLE' or old.earnings_state not in('PENDING','RESERVED','NOT_EARNED') then return new;end if;
  if new.status<>'DELIVERED' or new.completed_at is null or exists(select 1 from public.disputes where order_id=new.id and status in('OPEN','UNDER_REVIEW')) then raise exception 'STORE_EARNINGS_NOT_ELIGIBLE';end if;
  select * into price from app_private.order_price_snapshots where order_id=new.id;
  if not exists(select 1 from app_private.commerce_settlements where order_id=new.id) then raise exception 'STORE_PAYMENT_UNVERIFIED';end if;
  if exists(select 1 from app_private.order_vendor_allocations where order_id=new.id) then
    for allocation in select * from app_private.order_vendor_allocations where order_id=new.id and seller_net_kobo>0 order by vendor_profile_id loop
      if allocation.vendor_profile_id<>new.vendor_profile_id then
       perform app_private.queue_commerce_notice(allocation.vendor_user_id,new.university_id,new.buyer_user_id,'Earnings available','Your items were delivered. Your share is now available in Earnings.','/earnings','commerce:cleared:STORE_ORDER:'||new.id::text||':seller:'||allocation.vendor_profile_id::text);
      end if;
      lines=lines||jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',allocation.vendor_user_id,'direction','DEBIT','amount',allocation.seller_net_kobo),jsonb_build_object('code','VENDOR_AVAILABLE','type','LIABILITY','owner',allocation.vendor_user_id,'direction','CREDIT','amount',allocation.seller_net_kobo));
    end loop;
  else
    select user_id into owner from public.agent_profiles where id=new.vendor_profile_id;
    if price.seller_net_kobo>0 then lines=jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',owner,'direction','DEBIT','amount',price.seller_net_kobo),jsonb_build_object('code','VENDOR_AVAILABLE','type','LIABILITY','owner',owner,'direction','CREDIT','amount',price.seller_net_kobo));end if;
  end if;
  if jsonb_array_length(lines)>0 then perform app_private.post_finance_journal(new.university_id,'STORE_ORDER',new.id::text,'store-release:'||new.id::text,'Verified delivery: release each vendor allocation',lines);end if;
  return new;
end;$$;

revoke all on function app_private.create_store_order_v3(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,numeric,numeric,text,jsonb,text,text),app_private.create_priced_store_order(uuid,uuid,uuid,text,text),app_private.record_priced_store_receipt(text,bigint,bigint,timestamptz),app_private.release_priced_store_earnings() from public;
create or replace function app_private.reserve_delivery_job_before_commissions(p_job_id uuid,p_rider_profile_id uuid)
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
      and j.request_posted_at is not null and o.status='READY' for update of o;
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


create or replace function app_private.coordinate_campus_order(p_order uuid,p_scope uuid,p_action text,p_code_hash text)
returns text language plpgsql set search_path='' as $$
declare o public.orders%rowtype; j public.delivery_jobs%rowtype; h app_private.store_order_handoffs%rowtype;
begin
 select * into o from public.orders where id=p_order and (p_scope is null or university_id=p_scope) for update;
 if not found then return 'INVALID_STATE';end if;
 if not exists(select 1 from app_private.commerce_settlements where order_id=p_order) then return 'INVALID_STATE';end if;
 if exists(select 1 from public.disputes where order_id=p_order and status in('OPEN','UNDER_REVIEW')) then return 'INVALID_STATE';end if;
 select * into j from public.delivery_jobs where order_id=p_order for update;
 if p_action='READY' then
  if o.status='READY' then return 'OK';end if;
  if o.status not in('PAID','ACCEPTED') then return 'INVALID_STATE';end if;
  update app_private.order_vendor_allocations set status='READY',ready_at=coalesce(ready_at,now()) where order_id=p_order;
  update public.orders set status='READY',updated_at=now() where id=p_order;
 elsif p_action='SEND_TO_RIDERS' then
  if o.status<>'READY' or o.fulfilment_mode<>'RIDER' or j.status<>'AVAILABLE' then return 'INVALID_STATE';end if;
  update public.delivery_jobs set request_posted_at=coalesce(request_posted_at,now()),updated_at=now() where id=j.id;
 elsif p_action='CAMPUS_DISPATCH' then
  if o.status<>'READY' or o.fulfilment_mode<>'RIDER' or j.status<>'AVAILABLE' then return 'INVALID_STATE';end if;
  -- No rider earns a fare when the campus team performs this handoff.
  update public.delivery_jobs set status='CANCELLED',updated_at=now() where id=j.id;
  update public.orders set status='IN_DELIVERY',updated_at=now() where id=p_order;
 elsif p_action='COMPLETE' then
  if not ((o.fulfilment_mode='PICKUP' and o.status='READY') or(o.status='IN_DELIVERY' and (j.id is null or j.status='CANCELLED'))) then return 'INVALID_STATE';end if;
  select * into h from app_private.store_order_handoffs where order_id=p_order for update;
  if not found or p_code_hash is null then return 'INVALID_STATE';end if;
  if h.attempts>=5 or h.expires_at<=now() then return 'LOCKED';end if;
  if h.code_hash<>p_code_hash then
   update app_private.store_order_handoffs set attempts=attempts+1 where order_id=p_order;
   return case when h.attempts+1>=5 then 'LOCKED' else 'INCORRECT' end;
  end if;
  update app_private.store_order_handoffs set confirmed_at=now() where order_id=p_order;
  update public.orders set status='DELIVERED',completed_at=now(),earnings_state='PENDING',updated_at=now() where id=p_order;
 else return 'INVALID_STATE';end if;
 return 'OK';
end;$$;
revoke all on function app_private.coordinate_campus_order(uuid,uuid,text,text),app_private.reserve_delivery_job_before_commissions(uuid,uuid) from public;
create function app_private.guard_vendor_allocation()returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or (new.order_id,new.vendor_profile_id,new.vendor_user_id,new.seller_net_kobo,new.listed_items_kobo) is distinct from(old.order_id,old.vendor_profile_id,old.vendor_user_id,old.seller_net_kobo,old.listed_items_kobo)then raise exception 'VENDOR_ALLOCATION_IMMUTABLE';end if;return new;end;$$;
create trigger vendor_allocation_immutable before update or delete on app_private.order_vendor_allocations for each row execute function app_private.guard_vendor_allocation();
revoke all on function app_private.guard_vendor_allocation()from public;
create function app_private.enforce_agent_withdrawal_minimum()returns trigger language plpgsql set search_path='' as $$begin
 if new.amount_kobo<(case when new.agent_type='RIDER'then 200000 else 500000 end) then raise exception 'PAYOUT_BELOW_MINIMUM';end if;return new;end;$$;
create trigger agent_withdrawal_business_minimum before insert on app_private.agent_payout_quotes for each row execute function app_private.enforce_agent_withdrawal_minimum();
revoke all on function app_private.enforce_agent_withdrawal_minimum()from public;
commit;
