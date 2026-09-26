begin;
alter table public.tutorial_bookings add column buyer_fee_kobo integer not null default 0 check(buyer_fee_kobo>=0),
  add column commission_kobo integer not null default 0 check(commission_kobo>=0),
  add column fee_snapshot jsonb not null default '{}'::jsonb,
  add column tutor_net_kobo integer generated always as (amount_kobo-buyer_fee_kobo-commission_kobo) stored;
alter table public.orders add column buyer_fee_kobo integer not null default 0 check(buyer_fee_kobo>=0),
  add column fee_snapshot jsonb not null default '{}'::jsonb;
alter table public.orders alter column total_kobo set expression as (subtotal_kobo+delivery_fee_kobo+buyer_fee_kobo);
alter table public.delivery_jobs add column commission_kobo integer not null default 0 check(commission_kobo>=0),
  add column fee_snapshot jsonb not null default '{}'::jsonb;
alter table public.payout_requests add column fee_kobo bigint not null default 0 check(fee_kobo>=0 and fee_kobo<amount_kobo),
  add column fee_snapshot jsonb not null default '{}'::jsonb,
  add column net_kobo bigint generated always as(amount_kobo-fee_kobo) stored;

create function app_private.snapshot_booking_fees() returns trigger language plpgsql set search_path='' as $$
declare commission jsonb; buyer jsonb;
begin
  if new.amount_kobo>0 then
    commission:=app_private.quote_fee(new.university_id,'TUTOR_COMMISSION',new.amount_kobo);
    buyer:=app_private.quote_fee(new.university_id,'BUYER_SERVICE',new.amount_kobo);
    if (commission->>'feeKobo')::integer>new.amount_kobo then raise exception 'INVALID_COMMISSION'; end if;
    new.buyer_fee_kobo:=(buyer->>'feeKobo')::integer;
    new.commission_kobo:=(commission->>'feeKobo')::integer;
    new.fee_snapshot:=jsonb_build_object('commission',commission,'buyer',buyer);
    new.amount_kobo:=new.amount_kobo+new.buyer_fee_kobo;
  end if;
  return new;
end $$;
create trigger booking_fee_snapshot before insert on public.tutorial_bookings for each row execute function app_private.snapshot_booking_fees();

create function app_private.price_store_order(p_id uuid) returns void language plpgsql set search_path='' as $$
declare o public.orders%rowtype; delivery jsonb; buyer jsonb; commission jsonb; gross integer;
begin
  select * into o from public.orders where id=p_id for update;
  if o.status<>'PENDING_PAYMENT' or o.fee_snapshot<>'{}'::jsonb then raise exception 'ORDER_ALREADY_PRICED'; end if;
  -- Zone fallback is explicit and versioned when no trusted route distance exists.
  delivery:=app_private.quote_fee(o.university_id,'DELIVERY',0,o.delivery_zone_id,null);
  gross:=(delivery->>'feeKobo')::integer;
  buyer:=app_private.quote_fee(o.university_id,'BUYER_SERVICE',o.subtotal_kobo);
  commission:=app_private.quote_fee(o.university_id,'RIDER_COMMISSION',gross);
  if (commission->>'feeKobo')::integer>gross then raise exception 'INVALID_COMMISSION'; end if;
  update public.orders set delivery_fee_kobo=gross,buyer_fee_kobo=(buyer->>'feeKobo')::integer,
    pricing_formula_version=delivery->>'version',fee_snapshot=jsonb_build_object('delivery',delivery,'buyer',buyer,'rider',commission) where id=p_id;
  update public.delivery_jobs set rider_earning_kobo=gross-(commission->>'feeKobo')::integer,
    commission_kobo=(commission->>'feeKobo')::integer,earning_formula_version=commission->>'version',fee_snapshot=jsonb_build_object('delivery',delivery,'commission',commission) where order_id=p_id;
end $$;

create function app_private.settle_commerce_payment(p_reference text,p_amount bigint,p_currency text) returns text language plpgsql set search_path='' as $$
declare a public.payment_attempts%rowtype; b public.tutorial_bookings%rowtype; o public.orders%rowtype;
  total bigint; net bigint; commission bigint:=0; buyer bigint:=0; delivery bigint:=0;
  institution uuid; agent uuid; code text; txn uuid; reason text; allowed boolean;
begin
  select * into a from public.payment_attempts where provider_reference=p_reference for update;
  if not found then
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='UNKNOWN_REFERENCE',updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'requires_review';
  end if;
  if a.status='SUCCEEDED' then return 'already_processed'; end if;
  if a.resource_type='TUTORIAL_BOOKING' then
    select * into b from public.tutorial_bookings where id=a.resource_id for update;
    total:=b.amount_kobo;net:=b.tutor_net_kobo;commission:=b.commission_kobo;buyer:=b.buyer_fee_kobo;institution:=b.university_id;code:='TUTOR_PAYABLE';
    allowed:=b.status='PENDING_PAYMENT' and b.payment_expires_at>now();
    select p.user_id into agent from public.tutorial_listings l join public.agent_profiles p on p.id=l.tutor_profile_id where l.id=b.listing_id;
  elsif a.resource_type='STORE_ORDER' then
    select * into o from public.orders where id=a.resource_id for update;
    total:=o.total_kobo;net:=o.subtotal_kobo;buyer:=o.buyer_fee_kobo;delivery:=o.delivery_fee_kobo;institution:=o.university_id;code:='VENDOR_PAYABLE';
    allowed:=o.status='PENDING_PAYMENT' and o.pricing_formula_version<>'UNCONFIGURED'
      and exists(select 1 from public.inventory_reservations where order_id=o.id and status='HELD' and expires_at>now());
    select user_id into agent from public.agent_profiles where id=o.vendor_profile_id;
  else return app_private.settle_tutor_purchase(p_reference,p_amount,p_currency);
  end if;
  if p_amount is distinct from total or p_currency is distinct from 'NGN' then reason:='AMOUNT_OR_CURRENCY_MISMATCH';
  elsif not coalesce(allowed,false) or a.status not in ('CREATED','INITIALIZED') then reason:='PAYMENT_AFTER_EXPIRY_OR_CANCELLATION'; end if;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=a.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',resource_type=a.resource_type,resource_id=a.resource_id,review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'requires_review';
  end if;
  insert into public.ledger_accounts(university_id,account_code,account_type) values
    (institution,'PAYSTACK_CLEARING','ASSET'),(institution,'PLATFORM_COMMISSION','REVENUE'),(institution,'SERVICE_FEE_REVENUE','REVENUE'),(institution,'DELIVERY_REVENUE','REVENUE') on conflict do nothing;
  insert into public.ledger_accounts(university_id,owner_user_id,account_code,account_type) values(institution,agent,code,'LIABILITY') on conflict do nothing;
  insert into public.ledger_transactions(university_id,reference_type,reference_id,idempotency_key,description)
    values(institution,a.resource_type,a.resource_id::text,'paystack:'||p_reference,'Confirmed payment with immutable checkout fees') returning id into txn;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'DEBIT',total from public.ledger_accounts where university_id=institution and account_code='PAYSTACK_CLEARING' and owner_user_id is null;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'CREDIT',net from public.ledger_accounts where university_id=institution and account_code=code and owner_user_id=agent and net>0;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,accounts.id,'CREDIT',fees.amount from public.ledger_accounts accounts
      join (values('PLATFORM_COMMISSION',commission),('SERVICE_FEE_REVENUE',buyer),('DELIVERY_REVENUE',delivery)) fees(code,amount) on fees.code=accounts.account_code
      where accounts.university_id=institution and accounts.owner_user_id is null and fees.amount>0;
  if a.resource_type='TUTORIAL_BOOKING' then
    update public.tutorial_bookings set status='CONFIRMED',updated_at=now() where id=b.id;
  else
    update public.orders set status='PAID',updated_at=now() where id=o.id;
    update public.delivery_jobs set status='AVAILABLE',updated_at=now() where order_id=o.id and status='PAYMENT_PENDING';
    update public.inventory_reservations set status='CONVERTED' where order_id=o.id and status='HELD';
  end if;
  update public.payment_attempts set status='SUCCEEDED',completed_at=now(),updated_at=now() where id=a.id;
  update public.payment_provider_events set state='PROCESSED',resource_type=a.resource_type,resource_id=a.resource_id,processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'processed';
end $$;

create function app_private.journal_rider_earning() returns trigger language plpgsql set search_path='' as $$
declare rider uuid; txn uuid;
begin
  if new.status='DELIVERED' and old.status<>'DELIVERED' and new.fee_snapshot<>'{}'::jsonb and new.rider_earning_kobo>0 then
    select user_id into rider from public.agent_profiles where id=new.rider_profile_id;
    if rider is null then raise exception 'RIDER_REQUIRED'; end if;
    insert into public.ledger_accounts(university_id,owner_user_id,account_code,account_type) values(new.university_id,rider,'RIDER_PAYABLE','LIABILITY') on conflict do nothing;
    insert into public.ledger_accounts(university_id,account_code,account_type) values(new.university_id,'DELIVERY_REVENUE','REVENUE') on conflict do nothing;
    insert into public.ledger_transactions(university_id,reference_type,reference_id,idempotency_key,description)
      values(new.university_id,'DELIVERY_EARNING',new.id::text,'delivery-earned:'||new.id,'Verified delivery, net of versioned rider commission') returning id into txn;
    insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
      select txn,id,'DEBIT',new.rider_earning_kobo from public.ledger_accounts where university_id=new.university_id and owner_user_id is null and account_code='DELIVERY_REVENUE';
    insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
      select txn,id,'CREDIT',new.rider_earning_kobo from public.ledger_accounts where university_id=new.university_id and owner_user_id=rider and account_code='RIDER_PAYABLE';
  end if;
  return new;
end $$;
create trigger rider_earning_journal after update of status on public.delivery_jobs for each row execute function app_private.journal_rider_earning();

create function app_private.snapshot_payout_fee() returns trigger language plpgsql set search_path='' as $$
begin
  new.fee_snapshot:=app_private.quote_fee(new.university_id,'WITHDRAWAL',new.amount_kobo);
  new.fee_kobo:=(new.fee_snapshot->>'feeKobo')::bigint;
  if new.fee_kobo>=new.amount_kobo then raise exception 'PAYOUT_FEE_EXCEEDS_AMOUNT'; end if;
  return new;
end $$;
create trigger payout_fee_snapshot before insert on public.payout_requests for each row execute function app_private.snapshot_payout_fee();
create function app_private.journal_payout() returns trigger language plpgsql set search_path='' as $$
declare agent uuid; code text; txn uuid; event text;
begin
  if new.fee_snapshot='{}'::jsonb then return new; end if;
  if tg_op='INSERT' then event:='RESERVE';
  elsif new.status='PAID' and old.status<>'PAID' then event:='PAID';
  elsif new.status='REJECTED' and old.status<>'REJECTED' then event:='REVERSE';
  else return new; end if;
  select user_id,agent_type::text||'_PAYABLE' into agent,code from public.agent_profiles where id=new.agent_profile_id;
  insert into public.ledger_accounts(university_id,owner_user_id,account_code,account_type) values(new.university_id,agent,code,'LIABILITY'),(new.university_id,agent,'PAYOUT_RESERVED','LIABILITY') on conflict do nothing;
  insert into public.ledger_accounts(university_id,account_code,account_type) values(new.university_id,'PAYOUT_CLEARING','ASSET'),(new.university_id,'WITHDRAWAL_FEE_REVENUE','REVENUE') on conflict do nothing;
  insert into public.ledger_transactions(university_id,reference_type,reference_id,idempotency_key,description)
    values(new.university_id,'PAYOUT_'||event,new.id::text,'payout:'||event||':'||new.id,'Withdrawal '||event||' with saved fee version') returning id into txn;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'DEBIT',new.amount_kobo from public.ledger_accounts where university_id=new.university_id and owner_user_id=agent and account_code=case when event='RESERVE' then code else 'PAYOUT_RESERVED' end;
  if event='PAID' then
    insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
      select txn,id,'CREDIT',new.net_kobo from public.ledger_accounts where university_id=new.university_id and owner_user_id is null and account_code='PAYOUT_CLEARING';
    insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
      select txn,id,'CREDIT',new.fee_kobo from public.ledger_accounts where university_id=new.university_id and owner_user_id is null and account_code='WITHDRAWAL_FEE_REVENUE' and new.fee_kobo>0;
  else
    insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
      select txn,id,'CREDIT',new.amount_kobo from public.ledger_accounts where university_id=new.university_id and owner_user_id=agent and account_code=case when event='RESERVE' then 'PAYOUT_RESERVED' else code end;
  end if;
  return new;
end $$;
create trigger payout_journal after insert or update of status on public.payout_requests for each row execute function app_private.journal_payout();

create function app_private.keep_commerce_price() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='tutorial_purchases' and (new.price_kobo,new.buyer_fee_kobo,new.commission_kobo,new.fee_snapshot) is distinct from (old.price_kobo,old.buyer_fee_kobo,old.commission_kobo,old.fee_snapshot) then raise exception 'PURCHASE_PRICE_IMMUTABLE';

  end if;
  return new;
end $$;
create trigger tutor_purchase_price_immutable before update on public.tutorial_purchases for each row execute function app_private.keep_commerce_price();
-- Separate record types cannot share typed NEW-field expressions safely.
create function app_private.keep_booking_price() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.amount_kobo,new.buyer_fee_kobo,new.commission_kobo,new.fee_snapshot) is distinct from (old.amount_kobo,old.buyer_fee_kobo,old.commission_kobo,old.fee_snapshot) then raise exception 'BOOKING_PRICE_IMMUTABLE'; end if;
  return new;
end $$;
create trigger booking_price_immutable before update on public.tutorial_bookings for each row execute function app_private.keep_booking_price();
revoke all on function app_private.snapshot_booking_fees(),app_private.price_store_order(uuid),app_private.settle_commerce_payment(text,bigint,text),app_private.journal_rider_earning(),app_private.snapshot_payout_fee(),app_private.journal_payout(),app_private.keep_commerce_price(),app_private.keep_booking_price() from public;

create or replace function app_private.request_agent_payout(
  p_request_id uuid,
  p_agent_profile_id uuid,
  p_requested_by_user_id uuid,
  p_amount_kobo bigint
) returns table (id uuid, status text, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  selected_profile public.agent_profiles%rowtype;
  bank_state text;
  earned_amount bigint := 0;
  committed_amount bigint := 0;
begin
  if p_amount_kobo < 500000 then
    raise exception using errcode = 'P0001', message = 'PAYOUT_AMOUNT_TOO_SMALL';
  end if;

  select profiles.* into selected_profile
  from public.agent_profiles profiles
  where profiles.id = p_agent_profile_id
    and profiles.user_id = p_requested_by_user_id
    and profiles.status = 'ACTIVE'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAYOUT_PROFILE_UNAVAILABLE';
  end if;

  select applications.bank_status into bank_state
  from public.agent_applications applications
  where applications.id = selected_profile.application_id;

  if bank_state is distinct from 'VERIFIED' then
    raise exception using errcode = 'P0001', message = 'PAYOUT_ACCOUNT_UNVERIFIED';
  end if;

  if selected_profile.agent_type = 'TUTOR' then
    select coalesce(sum(bookings.tutor_net_kobo), 0)::bigint into earned_amount
    from public.tutorial_bookings bookings
    join public.tutorial_listings listings on listings.id = bookings.listing_id
    where listings.tutor_profile_id = selected_profile.id
      and bookings.earnings_state = 'AVAILABLE';
    earned_amount:=earned_amount+coalesce((select sum(p.tutor_net_kobo) from public.tutorial_purchases p where p.tutor_profile_id=selected_profile.id and p.status='PAID' and p.earnings_state='AVAILABLE'),0);
  elsif selected_profile.agent_type = 'VENDOR' then
    select coalesce(sum(orders.subtotal_kobo), 0)::bigint into earned_amount
    from public.orders orders
    where orders.vendor_profile_id = selected_profile.id
      and orders.earnings_state = 'AVAILABLE';
  elsif selected_profile.agent_type = 'RIDER' then
    select coalesce(sum(jobs.rider_earning_kobo), 0)::bigint into earned_amount
    from public.delivery_jobs jobs
    where jobs.rider_profile_id = selected_profile.id
      and jobs.earnings_state = 'AVAILABLE';
  end if;

  select coalesce(sum(requests.amount_kobo), 0)::bigint into committed_amount
  from public.payout_requests requests
  where requests.agent_profile_id = selected_profile.id
    and requests.status in ('REQUESTED', 'IN_REVIEW', 'APPROVED', 'PROCESSING', 'FAILED', 'PAID');

  if earned_amount - committed_amount < p_amount_kobo then
    raise exception using errcode = 'P0001', message = 'PAYOUT_BALANCE_INSUFFICIENT';
  end if;

  insert into public.payout_requests (
    id, university_id, agent_profile_id, requested_by_user_id, amount_kobo
  ) values (
    p_request_id, selected_profile.university_id, selected_profile.id,
    p_requested_by_user_id, p_amount_kobo
  );

  return query select p_request_id, 'REQUESTED'::text, selected_profile.university_id;
end;
$$;

revoke all on function app_private.request_agent_payout(uuid, uuid, uuid, bigint) from public;


create or replace function app_private.create_store_order_v3(
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

  perform app_private.price_store_order(p_order_id);

  return query select orders.id,orders.subtotal_kobo,orders.delivery_fee_kobo,orders.total_kobo from public.orders where orders.id=p_order_id;
end;
$$;
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

  return query select b.id,b.amount_kobo,b.scheduled_for from public.tutorial_bookings b where b.id=p_booking_id;
end;
$$;

create function app_private.request_agent_payout_v2(p_id uuid,p_profile uuid,p_user uuid,p_amount bigint,p_fee_rule uuid)
returns table(id uuid,status text,university_id uuid) language plpgsql set search_path='' as $$
declare institution uuid; fee jsonb; existing public.payout_requests%rowtype;
begin
  select * into existing from public.payout_requests where payout_requests.id=p_id;
  if found then
    if existing.requested_by_user_id<>p_user or existing.agent_profile_id<>p_profile or existing.amount_kobo<>p_amount then raise exception 'PAYOUT_ID_CONFLICT'; end if;
    return query select existing.id,existing.status,existing.university_id;return;
  end if;
  select p.university_id into institution from public.agent_profiles p where p.id=p_profile and p.user_id=p_user and p.status='ACTIVE' for update;
  if institution is null then raise exception 'PAYOUT_PROFILE_UNAVAILABLE'; end if;
  fee:=app_private.quote_fee(institution,'WITHDRAWAL',p_amount);
  if (fee->>'ruleId')::uuid is distinct from p_fee_rule then raise exception 'PRICE_CHANGED'; end if;
  return query select * from app_private.request_agent_payout(p_id,p_profile,p_user,p_amount);
end $$;
create function app_private.keep_order_price() returns trigger language plpgsql set search_path='' as $$
begin
  if old.fee_snapshot<>'{}'::jsonb and (new.subtotal_kobo,new.delivery_fee_kobo,new.buyer_fee_kobo,new.fee_snapshot) is distinct from (old.subtotal_kobo,old.delivery_fee_kobo,old.buyer_fee_kobo,old.fee_snapshot) then raise exception 'ORDER_PRICE_IMMUTABLE'; end if; return new;
end $$;
create trigger order_price_immutable before update on public.orders for each row execute function app_private.keep_order_price();
create function app_private.keep_payout_price() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.amount_kobo,new.fee_kobo,new.fee_snapshot,new.agent_profile_id,new.requested_by_user_id) is distinct from (old.amount_kobo,old.fee_kobo,old.fee_snapshot,old.agent_profile_id,old.requested_by_user_id) then raise exception 'PAYOUT_PRICE_IMMUTABLE'; end if; return new;
end $$;
create trigger payout_price_immutable before update on public.payout_requests for each row execute function app_private.keep_payout_price();
revoke all on function app_private.create_store_order_v3(uuid,uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,jsonb,text,text),app_private.request_agent_payout_v2(uuid,uuid,uuid,bigint,uuid),app_private.keep_order_price(),app_private.keep_payout_price() from public;

commit;
