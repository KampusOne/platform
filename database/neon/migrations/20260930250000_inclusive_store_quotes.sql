begin;

-- Approval creates a new immutable version. No store or tutor commission is invented or seeded.
create table app_private.commerce_fee_policies(
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  kind text not null check(kind in ('STORE','TUTORIAL')),
  version text not null check(char_length(version) between 3 and 80),
  buyer_basis_points integer not null check(buyer_basis_points between 0 and 9999),
  buyer_flat_per_item_kobo integer not null check(buyer_flat_per_item_kobo between 0 and 10000000),
  seller_commission_basis_points integer not null check(seller_commission_basis_points between 0 and 9999),
  collection jsonb not null check(jsonb_typeof(collection)='object'),
  checkout_savings boolean not null default true,
  allow_processor_subsidy boolean not null default false,
  source_url text not null,
  approval_note text not null check(char_length(approval_note) between 10 and 2000),
  approved_by uuid not null references public.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  unique(university_id,kind,version),unique(id,university_id,kind)
);
create trigger commerce_fee_policies_append_only before update or delete on app_private.commerce_fee_policies
  for each row execute function app_private.prevent_append_only_mutation();
create table app_private.active_commerce_fee_policies(
  university_id uuid not null,kind text not null,policy_id uuid not null,
  primary key(university_id,kind),
  foreign key(policy_id,university_id,kind) references app_private.commerce_fee_policies(id,university_id,kind) on delete restrict
);
alter table public.delivery_zones add column if not exists route_distance_metres integer check(route_distance_metres between 0 and 100000);

create table app_private.store_checkout_quotes(
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  buyer_user_id uuid not null references public.users(id) on delete restrict,
  vendor_profile_id uuid not null references public.agent_profiles(id) on delete restrict,
  policy_id uuid not null references app_private.commerce_fee_policies(id) on delete restrict,
  request_id uuid not null,
  request_payload jsonb not null,
  items jsonb not null check(jsonb_typeof(items)='array'),
  pricing jsonb not null check(jsonb_typeof(pricing)='object'),
  fare jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  unique(buyer_user_id,request_id)
);
create trigger store_checkout_quotes_append_only before update or delete on app_private.store_checkout_quotes
  for each row execute function app_private.prevent_append_only_mutation();
create table app_private.order_price_snapshots(
  order_id uuid primary key,
  university_id uuid not null,
  quote_id uuid not null unique references app_private.store_checkout_quotes(id) on delete restrict,
  base_kobo bigint not null check(base_kobo>=0),
  listed_items_kobo bigint not null check(listed_items_kobo>=0),
  discount_kobo bigint not null check(discount_kobo>=0),
  seller_net_kobo bigint not null check(seller_net_kobo>=0),
  payable_kobo bigint not null check(payable_kobo>0),
  cash_due_kobo integer not null check(cash_due_kobo>=0),
  created_at timestamptz not null default now(),
  foreign key(order_id,university_id) references public.orders(id,university_id) on delete restrict
);
create trigger order_price_snapshots_append_only before update or delete on app_private.order_price_snapshots
  for each row execute function app_private.prevent_append_only_mutation();

create function app_private.create_priced_store_order(p_quote uuid,p_buyer uuid,p_uni uuid,p_pickup_hash text,p_delivery_hash text)
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
      fare_payment_method=coalesce(payload->>'deliveryPaymentMethod','IN_APP'),route_distance_metres=(quote.fare->>'routeMetres')::integer,fare_basis='CAMPUS_ZONE'
      where order_id=p_quote;
  end if;
  return query select o.id,o.status,o.subtotal_kobo,o.delivery_fee_kobo,o.total_kobo,s.payable_kobo,s.cash_due_kobo
    from public.orders o join app_private.order_price_snapshots s on s.order_id=o.id where o.id=p_quote;
end; $$;

create function app_private.record_priced_store_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare attempt public.payment_attempts%rowtype; selected_order public.orders%rowtype; price app_private.order_price_snapshots%rowtype;
  seller_user uuid; journal uuid; lines jsonb; gross_margin bigint; digital_fare integer;
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
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  if attempt.university_id is distinct from selected_order.university_id or attempt.user_id<>selected_order.buyer_user_id or
    selected_order.status<>'PENDING_PAYMENT' or attempt.status not in ('CREATED','INITIALIZED') or
    not exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='HELD' and expires_at>now()) or
    p_amount<>price.payable_kobo or p_amount<>attempt.amount_kobo or p_fee<0 or p_paid_at is null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now()
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select user_id into seller_user from public.agent_profiles where id=selected_order.vendor_profile_id;
  digital_fare=selected_order.delivery_fee_kobo-price.cash_due_kobo;
  gross_margin=p_amount-price.seller_net_kobo-digital_fare;
  if gross_margin<0 then raise exception 'INVALID_SETTLEMENT_MARGIN'; end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',seller_user,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if digital_fare>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','CREDIT','amount',digital_fare)); end if;
  if gross_margin>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',gross_margin)); end if;
  journal=app_private.post_finance_journal(selected_order.university_id,'STORE_ORDER',selected_order.id::text,'priced-payment:'||p_reference,'Verified inclusive store checkout',lines);
  insert into app_private.commerce_settlements(order_id,university_id,provider_reference,amount_kobo,seller_net_kobo,digital_fare_kobo,cash_fare_kobo,provider_fee_kobo,journal_id)
    values(selected_order.id,selected_order.university_id,p_reference,p_amount,price.seller_net_kobo,digital_fare,price.cash_due_kobo,p_fee,journal);
  update public.orders set status='PAID',updated_at=now() where id=selected_order.id;
  update public.inventory_reservations set status='CONVERTED' where order_id=selected_order.id and status='HELD';
  update public.delivery_jobs set status='AVAILABLE',updated_at=now() where order_id=selected_order.id and status='PAYMENT_PENDING';
  update public.payment_attempts set status='SUCCEEDED',completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now()
    where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $$;

create function app_private.release_priced_store_earnings() returns trigger language plpgsql set search_path='' as $$
declare price app_private.order_price_snapshots%rowtype; owner uuid;
begin
  if new.pricing_formula_version<>'INCLUSIVE_V1' or new.earnings_state<>'AVAILABLE' or old.earnings_state not in ('PENDING','RESERVED') then return new; end if;
  if new.status<>'DELIVERED' or new.completed_at is null or new.completed_at>now()-interval '48 hours' or exists(select 1 from public.disputes where order_id=new.id and status in ('OPEN','UNDER_REVIEW')) then raise exception 'STORE_EARNINGS_NOT_ELIGIBLE'; end if;
  select * into price from app_private.order_price_snapshots where order_id=new.id;
  if not exists(select 1 from app_private.commerce_settlements where order_id=new.id) then raise exception 'STORE_PAYMENT_UNVERIFIED'; end if;
  select user_id into owner from public.agent_profiles where id=new.vendor_profile_id;
  if price.seller_net_kobo>0 then perform app_private.post_finance_journal(new.university_id,'STORE_ORDER',new.id::text,'store-release:'||new.id::text,'Release verified vendor earnings after the dispute window',jsonb_build_array(
    jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',owner,'direction','DEBIT','amount',price.seller_net_kobo),
    jsonb_build_object('code','VENDOR_AVAILABLE','type','LIABILITY','owner',owner,'direction','CREDIT','amount',price.seller_net_kobo))); end if;
  return new;
end; $$;
create trigger priced_store_earnings_release before update on public.orders for each row execute function app_private.release_priced_store_earnings();

revoke all on app_private.commerce_fee_policies,app_private.active_commerce_fee_policies,app_private.store_checkout_quotes,app_private.order_price_snapshots from public;
revoke all on function app_private.create_priced_store_order(uuid,uuid,uuid,text,text),app_private.record_priced_store_receipt(text,bigint,bigint,timestamptz) from public;
commit;
