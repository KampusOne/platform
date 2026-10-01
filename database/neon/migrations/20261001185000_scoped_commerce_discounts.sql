begin;
alter table app_private.discount_codes drop constraint if exists discount_codes_scope_check;
alter table app_private.discount_codes add constraint discount_codes_scope_check check(scope in('KIRA','STORE','RIDER','TUTORIAL','MATERIAL'));
alter table app_private.discount_codes add column if not exists budget_kobo bigint not null default 2000000000 check(budget_kobo between 1 and 2000000000);
create or replace function app_private.guard_discount_reservation() returns trigger language plpgsql set search_path='' as $$
declare discount app_private.discount_codes%rowtype;spent bigint;
begin
 select * into discount from app_private.discount_codes where id=NEW.discount_id for update;
 if not discount.active or now()<discount.starts_at or now()>=discount.ends_at or NEW.scope<>discount.scope or not exists(select 1 from public.profiles where user_id=NEW.user_id and university_id=discount.institution_id and deleted_at is null) then raise exception 'DISCOUNT_UNAVAILABLE';end if;
 if (select count(*) from app_private.discount_redemptions where discount_id=discount.id and (redeemed_at is not null or expires_at>now()))>=discount.max_uses or (select count(*) from app_private.discount_redemptions where discount_id=discount.id and user_id=NEW.user_id and (redeemed_at is not null or expires_at>now()))>=discount.per_user_limit then raise exception 'DISCOUNT_EXHAUSTED';end if;
 select coalesce(sum(discount_kobo),0) into spent from app_private.discount_redemptions where discount_id=discount.id and (redeemed_at is not null or expires_at>now());
 if spent+NEW.discount_kobo>discount.budget_kobo then raise exception 'DISCOUNT_BUDGET_EXHAUSTED';end if;
 return NEW;
end $$;
create or replace trigger discount_reservation_guard before insert on app_private.discount_redemptions for each row execute function app_private.guard_discount_reservation();
create or replace function app_private.reserve_commerce_discount(p_id uuid,p_user uuid,p_uni uuid,p_scope text,p_code text,p_base bigint,p_expires timestamptz)
returns bigint language plpgsql set search_path='' as $$
declare discount app_private.discount_codes%rowtype;savings bigint;
begin
 if coalesce(p_code,'')='' then return 0;end if;
 select * into discount from app_private.discount_codes where institution_id=p_uni and code=p_code and scope=p_scope for update;
 if not found then raise exception 'DISCOUNT_UNAVAILABLE';end if;
 savings=floor(p_base*discount.percent/100.0)::bigint;
 if savings<=0 then raise exception 'DISCOUNT_INAPPLICABLE';end if;
 insert into app_private.discount_redemptions(purchase_id,discount_id,user_id,scope,discount_kobo,expires_at) values(p_id,discount.id,p_user,p_scope,savings,p_expires);
 return savings;
end $$;
create or replace function app_private.create_discounted_store_quote(p_id uuid,p_uni uuid,p_user uuid,p_vendor uuid,p_policy uuid,p_request uuid,p_payload jsonb,p_items jsonb,p_price jsonb,p_fare jsonb,p_code text)
returns app_private.store_checkout_quotes language plpgsql set search_path='' as $$
declare saved app_private.store_checkout_quotes%rowtype;savings bigint;scope text;base bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('discount-store:'||p_user::text||':'||p_request::text,0));
 select * into saved from app_private.store_checkout_quotes where buyer_user_id=p_user and request_id=p_request;
 if found then if saved.request_payload is distinct from p_payload then raise exception 'DISCOUNT_REQUEST_CONFLICT';end if;return saved;end if;
 if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) then raise exception 'BUYER_TENANT_MISMATCH';end if;
 if coalesce(p_code,'')<>'' then
  select d.scope into scope from app_private.discount_codes d where institution_id=p_uni and code=p_code and d.scope in('STORE','RIDER');
  if scope is null then raise exception 'DISCOUNT_UNAVAILABLE';end if;
  base=case scope when 'RIDER' then (p_price->>'fareKobo')::bigint-(p_price->>'cashDueKobo')::bigint else (p_price->>'listedItemsKobo')::bigint-(p_price->>'discountKobo')::bigint end;
  savings=app_private.reserve_commerce_discount(p_id,p_user,p_uni,scope,p_code,base,now()+interval '15 minutes');
  if (p_price->>'payableKobo')::bigint<=savings then raise exception 'DISCOUNT_INAPPLICABLE';end if;
  p_price=p_price||jsonb_build_object('discountKobo',(p_price->>'discountKobo')::bigint+savings,'payableKobo',(p_price->>'payableKobo')::bigint-savings,'totalKobo',(p_price->>'totalKobo')::bigint-savings,'couponKobo',savings,'couponCode',p_code,'couponScope',scope);
 end if;
 insert into app_private.store_checkout_quotes(id,university_id,buyer_user_id,vendor_profile_id,policy_id,request_id,request_payload,items,pricing,fare)
 values(p_id,p_uni,p_user,p_vendor,p_policy,p_request,p_payload,p_items,p_price,p_fare) returning * into saved;
 return saved;
end $$;
create or replace function app_private.create_discounted_tutorial_booking(p_id uuid,p_uni uuid,p_user uuid,p_listing uuid,p_window uuid,p_request uuid,p_policy uuid,p_base integer,p_price jsonb,p_code text)
returns table(id uuid,amount_kobo integer,status text) language plpgsql set search_path='' as $$
declare previous app_private.tutorial_booking_prices%rowtype; savings bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('tutorial-checkout:'||p_user::text||':'||p_request::text,0));
 select * into previous from app_private.tutorial_booking_prices where student_user_id=p_user and request_id=p_request;
 if found then
  if (previous.university_id,previous.listing_id,previous.availability_window_id) is distinct from(p_uni,p_listing,p_window) or coalesce((select d.code from app_private.discount_redemptions r join app_private.discount_codes d on d.id=r.discount_id where r.purchase_id=previous.booking_id),'')<>coalesce(p_code,'') then raise exception 'DISCOUNT_REQUEST_CONFLICT';end if;
  return query select b.id,b.amount_kobo,b.status from public.tutorial_bookings b where b.id=previous.booking_id;return;
 end if;
 savings=app_private.reserve_commerce_discount(p_id,p_user,p_uni,'TUTORIAL',p_code,(p_price->>'payableKobo')::bigint,now()+interval '15 minutes');
 if savings>0 then p_price=p_price||jsonb_build_object('payableKobo',(p_price->>'payableKobo')::bigint-savings,'discountKobo',(p_price->>'discountKobo')::bigint+savings);end if;
 return query select * from app_private.create_priced_tutorial_booking(p_id,p_uni,p_user,p_listing,p_window,p_request,p_policy,p_base,p_price);
end $$;
create or replace function app_private.redeem_commerce_discount() returns trigger language plpgsql set search_path='' as $$
begin
 if NEW.status='SUCCEEDED' and OLD.status is distinct from NEW.status then update app_private.discount_redemptions set redeemed_at=coalesce(NEW.completed_at,now()) where purchase_id=NEW.resource_id and redeemed_at is null;end if;return NEW;
end $$;
create or replace trigger commerce_discount_paid after update on public.payment_attempts for each row execute function app_private.redeem_commerce_discount();
revoke all on function app_private.reserve_commerce_discount(uuid,uuid,uuid,text,text,bigint,timestamptz),app_private.create_discounted_store_quote(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,text),app_private.create_discounted_tutorial_booking(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text) from public;

-- Supplier earnings remain intact. Any funded shortfall is an explicit expense.
create or replace function app_private.post_finance_journal(
  p_uni uuid,p_type text,p_reference text,p_key text,p_description text,p_lines jsonb
) returns uuid language plpgsql set search_path='' as $$
declare transaction_id uuid; previous public.ledger_transactions%rowtype; line jsonb; account_id uuid;
  payload jsonb; count_lines integer; difference numeric;
begin
  if p_uni is null or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_JOURNAL'; end if;
  select count(*),sum(case when x.direction='DEBIT' then x.amount else -x.amount end)
    into count_lines,difference from jsonb_to_recordset(p_lines) x(code text,type text,owner uuid,direction text,amount bigint);
  if count_lines<2 or difference<>0 or exists(select 1 from jsonb_to_recordset(p_lines)
    x(code text,type text,owner uuid,direction text,amount bigint) where
      x.code is null or x.type is null or x.direction is null or x.amount is null or x.amount<=0 or x.direction not in ('DEBIT','CREDIT') or
      x.type is distinct from case
        when x.code in ('PAYSTACK_CLEARING','RIDER_COMMISSION_RECEIVABLE') then 'ASSET'
        when x.code in ('RIDER_PENDING','RIDER_AVAILABLE','RIDER_PAYOUT_RESERVED','VENDOR_PENDING','VENDOR_AVAILABLE','VENDOR_PAYOUT_RESERVED','TUTOR_PENDING','TUTOR_AVAILABLE','TUTOR_PAYOUT_RESERVED','DELIVERY_LIABILITY','PAYMENT_SUSPENSE') then 'LIABILITY'
        when x.code in ('PLATFORM_COMMISSION','KIRA_SUBSCRIPTION_REVENUE','PAYOUT_COST_RECOVERY') then 'REVENUE'
        when x.code in('PROCESSING_EXPENSE','PROMOTION_EXPENSE') then 'EXPENSE' else null end or
      (x.code like 'RIDER_%' or x.code like 'VENDOR_%' or x.code like 'TUTOR_%') is distinct from (x.owner is not null)
    ) then raise exception 'INVALID_JOURNAL'; end if;
  payload=jsonb_build_object('universityId',p_uni,'type',p_type,'reference',p_reference,'description',p_description,'lines',p_lines);
  perform pg_advisory_xact_lock(hashtextextended('journal:'||p_key,0));
  select * into previous from public.ledger_transactions where idempotency_key=p_key;
  if found then
    if previous.journal_payload is distinct from payload then raise exception 'JOURNAL_IDEMPOTENCY_CONFLICT'; end if;
    return previous.id;
  end if;
  insert into public.ledger_transactions(university_id,reference_type,reference_id,idempotency_key,description,journal_payload)
    values(p_uni,p_type,p_reference,p_key,p_description,payload) returning id into transaction_id;
  for line in select value from jsonb_array_elements(p_lines) loop
    insert into public.ledger_accounts(university_id,owner_user_id,account_code,account_type)
      values(p_uni,(line->>'owner')::uuid,line->>'code',line->>'type') on conflict do nothing;
    select id into account_id from public.ledger_accounts where university_id=p_uni
      and owner_user_id is not distinct from (line->>'owner')::uuid and account_code=line->>'code'
      and account_type=line->>'type' and currency='NGN';
    if account_id is null then raise exception 'JOURNAL_ACCOUNT_MISMATCH'; end if;
    insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
      values(transaction_id,account_id,line->>'direction',(line->>'amount')::bigint);
  end loop;
  return transaction_id;
end; $$;
create or replace function app_private.record_priced_store_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
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
  if gross_margin<0 and not exists(select 1 from app_private.discount_redemptions where purchase_id=selected_order.id and discount_kobo>=-gross_margin) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',seller_user,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if digital_fare>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','CREDIT','amount',digital_fare)); end if;
  if gross_margin>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',gross_margin)); end if;
  if gross_margin<0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',-gross_margin));end if;
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
create or replace function app_private.record_priced_tutorial_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare attempt public.payment_attempts%rowtype; booking public.tutorial_bookings%rowtype; price app_private.tutorial_booking_prices%rowtype;
  lines jsonb; journal uuid; reason text;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_BOOKING';
  if not found then return 'UNKNOWN'; end if;
  select * into booking from public.tutorial_bookings where tutorial_bookings.id=attempt.resource_id for update;
  select * into price from app_private.tutorial_booking_prices where booking_id=booking.id;
  if not found then return 'LEGACY'; end if;
  perform app_private.record_verified_paystack_receipt(price.university_id,p_reference,'TUTORIAL_BOOKING',booking.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.tutorial_settlements where booking_id=booking.id and provider_reference=p_reference) then return 'ALREADY_PAID'; end if;
  reason=case when exists(select 1 from app_private.tutorial_settlements where booking_id=booking.id) then 'SECOND_SUCCESSFUL_PAYMENT'
    when (attempt.university_id,attempt.user_id,attempt.amount_kobo) is distinct from(price.university_id,price.student_user_id,price.payable_kobo::bigint)
      or booking.status<>'PENDING_PAYMENT' or booking.payment_expires_at<=now() or attempt.status not in ('CREATED','INITIALIZED')
      or p_amount<>price.payable_kobo then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',price.tutor_user_id,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if p_amount>price.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',p_amount-price.seller_net_kobo)); end if;
  if p_amount<price.seller_net_kobo then
    if not exists(select 1 from app_private.discount_redemptions where purchase_id=booking.id and discount_kobo>=price.seller_net_kobo-p_amount) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
    lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',price.seller_net_kobo-p_amount));
  end if;
  journal=app_private.post_finance_journal(price.university_id,'TUTORIAL_BOOKING',booking.id::text,'tutorial-payment:'||p_reference,'Verified inclusive tutorial payment',lines);
  insert into app_private.tutorial_settlements(booking_id,provider_reference,journal_id) values(booking.id,p_reference,journal);
  update public.tutorial_bookings set status='CONFIRMED',provider_reference=p_reference,updated_at=now() where id=booking.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $$;
commit;
