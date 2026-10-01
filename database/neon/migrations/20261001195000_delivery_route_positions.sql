begin;
alter table public.vendor_storefronts add column if not exists pickup_place_id uuid;
alter table public.vendor_storefronts add constraint storefront_pickup_place_scope foreign key(pickup_place_id,university_id) references public.campus_places(id,university_id);
create table app_private.agent_route_positions(
 agent_profile_id uuid primary key references public.agent_profiles(id),institution_id uuid not null references public.universities(id),
 latitude numeric(9,6) not null check(latitude between -90 and 90),longitude numeric(9,6) not null check(longitude between -180 and 180),
 accuracy_metres numeric not null check(accuracy_metres between 0 and 50),captured_at timestamptz not null,updated_at timestamptz not null default now()
);
alter table app_private.agent_route_positions enable row level security;
revoke all on app_private.agent_route_positions from public;
-- A new pickup point is a material storefront change and requires re-review.
create or replace function app_private.guard_storefront_material_change() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.display_name,new.description,new.contact_phone_e164,new.pickup_location,new.pickup_instructions,new.opening_hours,new.default_preparation_minutes,new.pickup_place_id)
 is distinct from row(old.display_name,old.description,old.contact_phone_e164,old.pickup_location,old.pickup_instructions,old.opening_hours,old.default_preparation_minutes,old.pickup_place_id) then
  new.listing_revision=old.listing_revision+1;new.reviewed_by_user_id=null;new.reviewed_at=null;new.moderated_revision=null;
  if old.status='APPROVED' then new.status='NEEDS_CORRECTION';new.submitted_at=coalesce(old.submitted_at,now());new.review_note='Material storefront changes require a new review.';
  elsif old.status='SUBMITTED' then new.status='DRAFT';new.submitted_at=null;new.review_note=null;end if;
 end if;return new;
end $$;
DO $priced_route$BEGIN
 if to_regprocedure('app_private.create_priced_store_order(uuid,uuid,uuid,text,text)') is not null then
 EXECUTE $replacement$create or replace function app_private.create_priced_store_order(p_quote uuid,p_buyer uuid,p_uni uuid,p_pickup_hash text,p_delivery_hash text)
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
      rider_earning_kobo=(quote.fare->>'riderNetKobo')::integer,earning_formula_version='CAMPUS_FARE_V1',financial_version='CAMPUS_FARE_V1',
      fare_payment_method=coalesce(payload->>'deliveryPaymentMethod','IN_APP'),route_distance_metres=(quote.fare->>'routeMetres')::integer,fare_basis=case when quote.fare->>'distanceBasis'='OSM_BICYCLE_NETWORK'then 'ROAD_ROUTE'else 'CAMPUS_ZONE'end
      where order_id=p_quote;
  end if;
  return query select o.id,o.status,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo,s.payable_kobo,s.cash_due_kobo
    from public.orders o join app_private.order_price_snapshots s on s.order_id=o.id where o.id=p_quote;
end; $$;

$replacement$;
 end if;
END $priced_route$;

commit;
