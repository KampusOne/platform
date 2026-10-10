begin;
-- BACHS cutover: immutable provider evidence, separate clearing, unchanged legacy receipts.


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
        when x.code in ('PAYSTACK_CLEARING','BACHS_CLEARING','RIDER_COMMISSION_RECEIVABLE') then 'ASSET'
        when x.code in ('RIDER_PENDING','RIDER_AVAILABLE','RIDER_PAYOUT_RESERVED','VENDOR_PENDING','VENDOR_AVAILABLE','VENDOR_PAYOUT_RESERVED','TUTOR_PENDING','TUTOR_AVAILABLE','TUTOR_PAYOUT_RESERVED','DELIVERY_LIABILITY','PAYMENT_SUSPENSE','STATUTORY_DUTY_ACCRUAL','PAYOUT_DUTY_RESERVED') then 'LIABILITY'
        when x.code in ('PLATFORM_COMMISSION','KIRA_SUBSCRIPTION_REVENUE','PAYOUT_COST_RECOVERY') then 'REVENUE'
        when x.code in('PROCESSING_EXPENSE','PROMOTION_EXPENSE','STATUTORY_DUTY_EXPENSE') then 'EXPENSE' else null end or
      (x.code like 'RIDER_%' or x.code like 'VENDOR_%' or x.code like 'TUTOR_%' or x.code='PAYOUT_DUTY_RESERVED') is distinct from (x.owner is not null)
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


create table app_private.verified_bachs_receipts (
 provider_reference text primary key references app_private.bachs_checkout_quotes(provider_reference),
 university_id uuid not null references public.universities(id), purpose text not null,
 resource_id uuid not null, amount_kobo bigint not null check(amount_kobo>0), provider_fee_kobo bigint not null check(provider_fee_kobo>=0 and provider_fee_kobo<amount_kobo),
 paid_at timestamptz not null, journal_id uuid not null references public.ledger_transactions(id), recorded_at timestamptz not null default now()
);
create trigger verified_bachs_receipts_immutable before update or delete on app_private.verified_bachs_receipts for each row execute function app_private.prevent_append_only_mutation();

-- Preserve every legacy receipt and use a provider-neutral evidence parent for
-- Kira's entitlement FK. Each registry row must reference real provider evidence.
create table app_private.verified_collection_receipts (
 provider_reference text primary key,
 provider text not null check(provider in ('PAYSTACK','BACHS')),
 paystack_reference text unique references app_private.verified_paystack_receipts(provider_reference) on delete restrict,
 bachs_reference text unique references app_private.verified_bachs_receipts(provider_reference) on delete restrict,
 check((provider='PAYSTACK' and paystack_reference is not null and paystack_reference=provider_reference and bachs_reference is null)
    or (provider='BACHS' and bachs_reference is not null and bachs_reference=provider_reference and paystack_reference is null))
);
insert into app_private.verified_collection_receipts(provider_reference,provider,paystack_reference)
 select provider_reference,'PAYSTACK',provider_reference from app_private.verified_paystack_receipts;
create trigger verified_collection_receipts_immutable before update or delete on app_private.verified_collection_receipts for each row execute function app_private.prevent_append_only_mutation();
create function app_private.register_verified_collection_receipt() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_schema<>'app_private' then raise exception 'INVALID_COLLECTION_EVIDENCE_SOURCE';end if;
 if tg_table_name='verified_paystack_receipts' then
  insert into app_private.verified_collection_receipts(provider_reference,provider,paystack_reference) values(new.provider_reference,'PAYSTACK',new.provider_reference);
 elsif tg_table_name='verified_bachs_receipts' then
  insert into app_private.verified_collection_receipts(provider_reference,provider,bachs_reference) values(new.provider_reference,'BACHS',new.provider_reference);
 else raise exception 'INVALID_COLLECTION_EVIDENCE_SOURCE';end if;
 return new;
end $$;
create trigger register_paystack_collection_receipt after insert on app_private.verified_paystack_receipts for each row execute function app_private.register_verified_collection_receipt();
create trigger register_bachs_collection_receipt after insert on app_private.verified_bachs_receipts for each row execute function app_private.register_verified_collection_receipt();
-- Replace the FK atomically after its complete legacy backfill. No payment or
-- billing row is removed, and the replacement still requires verified evidence.
alter table app_private.kira_billing_periods
 drop constraint kira_billing_periods_provider_reference_fkey,
 add constraint kira_billing_periods_provider_reference_fkey foreign key(provider_reference) references app_private.verified_collection_receipts(provider_reference) on delete restrict;
alter table app_private.verified_collection_receipts enable row level security;
revoke all on app_private.verified_collection_receipts from public;
revoke all on function app_private.register_verified_collection_receipt() from public;

create function app_private.record_verified_bachs_receipt(p_uni uuid,p_reference text,p_purpose text,p_resource uuid,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns uuid language plpgsql set search_path='' as $$
declare q app_private.bachs_checkout_quotes; r app_private.bachs_pricing_receipts; previous app_private.verified_bachs_receipts; journal uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('provider-receipt:'||p_reference,0));
 select * into q from app_private.bachs_checkout_quotes where provider_reference=p_reference;
 select * into r from app_private.bachs_pricing_receipts where quote_id=q.id;
 if q.id is null or r.quote_id is null or (q.university_id,q.resource_type,q.resource_id,r.amount_kobo,r.actual_fee_kobo,r.paid_at) is distinct from (p_uni,p_purpose,p_resource,p_amount,p_fee,p_paid_at)
 then raise exception 'BACHS_VERIFIED_RECEIPT_REQUIRED'; end if;
 select * into previous from app_private.verified_bachs_receipts where provider_reference=p_reference;
 if found then
  if (previous.university_id,previous.purpose,previous.resource_id,previous.amount_kobo,previous.provider_fee_kobo,previous.paid_at) is distinct from (p_uni,p_purpose,p_resource,p_amount,p_fee,p_paid_at) then raise exception 'RECEIPT_IDEMPOTENCY_CONFLICT';end if;
  return previous.journal_id;
 end if;
 journal=app_private.post_finance_journal(p_uni,p_purpose,p_resource::text,'provider-receipt:'||p_reference,'Verified BACHS funds awaiting allocation',jsonb_build_array(
  jsonb_build_object('code','BACHS_CLEARING','type','ASSET','direction','DEBIT','amount',p_amount),
  jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','CREDIT','amount',p_amount)));
 if p_fee>0 then perform app_private.post_finance_journal(p_uni,p_purpose,p_resource::text,'provider-processing:'||p_reference,'Actual BACHS processing expense',jsonb_build_array(
  jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',p_fee),
  jsonb_build_object('code','BACHS_CLEARING','type','ASSET','direction','CREDIT','amount',p_fee)));end if;
 insert into app_private.verified_bachs_receipts(provider_reference,university_id,purpose,resource_id,amount_kobo,provider_fee_kobo,paid_at,journal_id) values(p_reference,p_uni,p_purpose,p_resource,p_amount,p_fee,p_paid_at,journal);
 insert into public.payment_provider_events(provider,provider_reference,event_type,amount_kobo,resource_type,resource_id) values('BACHS',p_reference,'checkout.completed',p_amount,p_purpose,p_resource) on conflict(provider,provider_reference) do nothing;
 return journal;
end $$;


create or replace function app_private.record_verified_paystack_receipt(p_uni uuid,p_reference text,p_purpose text,p_resource uuid,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns uuid language plpgsql set search_path='' as $$
declare previous app_private.verified_paystack_receipts%rowtype; journal uuid;
begin
  if p_reference like 'K1-B-%' then return app_private.record_verified_bachs_receipt(p_uni,p_reference,p_purpose,p_resource,p_amount,p_fee,p_paid_at);end if;
  perform pg_advisory_xact_lock(hashtextextended('provider-receipt:'||p_reference,0));
  select * into previous from app_private.verified_paystack_receipts where provider_reference=p_reference;
  if found then
    if (previous.university_id,previous.purpose,previous.resource_id,previous.amount_kobo,previous.provider_fee_kobo)
      is distinct from (p_uni,p_purpose,p_resource,p_amount,p_fee) then raise exception 'RECEIPT_IDEMPOTENCY_CONFLICT'; end if;
    return previous.journal_id;
  end if;
  if p_amount<=0 or p_fee<0 or p_paid_at is null then raise exception 'INVALID_PROVIDER_RECEIPT'; end if;
  journal=app_private.post_finance_journal(p_uni,p_purpose,p_resource::text,'provider-receipt:'||p_reference,'Verified provider funds awaiting allocation',jsonb_build_array(
    jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','DEBIT','amount',p_amount),
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','CREDIT','amount',p_amount)));
  if p_fee>0 then perform app_private.post_finance_journal(p_uni,p_purpose,p_resource::text,'provider-processing:'||p_reference,'Actual provider processing expense',jsonb_build_array(
    jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',p_fee),
    jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',p_fee))); end if;
  insert into app_private.verified_paystack_receipts(provider_reference,university_id,purpose,resource_id,amount_kobo,provider_fee_kobo,paid_at,journal_id)
    values(p_reference,p_uni,p_purpose,p_resource,p_amount,p_fee,p_paid_at,journal);
  insert into public.payment_provider_events(provider,provider_reference,event_type,amount_kobo,resource_type,resource_id)
    values('PAYSTACK',p_reference,'charge.success',p_amount,p_purpose,p_resource) on conflict(provider,provider_reference) do nothing;
  return journal;
end; $$;

create or replace function app_private.collection_settlement_principal(p_ref text,p_gross bigint,p_fee bigint)
returns bigint language sql stable set search_path='' as $$
 select case when p_ref like 'K1-B-%' then (select r.amount_kobo from app_private.verified_bachs_receipts r where r.provider_reference=p_ref and r.amount_kobo=p_gross and r.provider_fee_kobo=p_fee) else (select case when q.provider_fee_mode='CUSTOMER_PASSTHROUGH' then p_gross-p_fee else p_gross end
 from app_private.collection_payment_pricing q
 where q.provider_reference=p_ref and p_gross>0 and p_fee>=0 and p_fee<p_gross
 and (case when q.provider_fee_mode='CUSTOMER_PASSTHROUGH' then p_gross-p_fee else p_gross end)=q.provider_initialized_amount_kobo
 and not exists(select 1 from app_private.collection_receipt_contexts c where c.provider_reference=p_ref
   and (c.pricing_match_state='MISMATCH' or c.amount_kobo<>p_gross or c.actual_provider_fee_kobo<>p_fee
     or (c.requested_amount_kobo is not null and c.requested_amount_kobo<>q.provider_initialized_amount_kobo)))) end
$$;

create or replace function app_private.recover_customer_processing_fee(p_ref text,p_gross bigint,p_fee bigint)
returns bigint language plpgsql set search_path='' as $$
declare q app_private.collection_payment_pricing; principal bigint;
begin
 if p_ref like 'K1-B-%' then
  select amount_kobo into principal from app_private.verified_bachs_receipts where provider_reference=p_ref and amount_kobo=p_gross and provider_fee_kobo=p_fee;
  if principal is null then raise exception 'BACHS_VERIFIED_RECEIPT_REQUIRED';end if;return principal;
 end if;
 select * into q from app_private.collection_payment_pricing where provider_reference=p_ref;
 principal=app_private.collection_settlement_principal(p_ref,p_gross,p_fee);
 if principal is null then raise exception 'PAYMENT_SUBTOTAL_MISMATCH';end if;
 if q.provider_fee_mode='CUSTOMER_PASSTHROUGH' and p_fee>0 then
  if not exists(select 1 from app_private.verified_paystack_receipts where provider_reference=p_ref
   and amount_kobo=p_gross and provider_fee_kobo=p_fee and university_id=q.university_id
   and purpose=q.purpose and resource_id=q.resource_id) then raise exception 'VERIFIED_RECEIPT_REQUIRED';end if;
  perform app_private.post_finance_journal(q.university_id,q.purpose,q.resource_id::text,
   'provider-processing-recovery:'||p_ref,'Customer-paid provider processing fee',jsonb_build_array(
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_fee),
    jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','CREDIT','amount',p_fee)));
 end if;
 return principal;
end $$;


create or replace function app_private.collection_paid_price_matches(p_ref text,p_gross bigint,p_fee bigint,p_quote bigint)
returns boolean language sql stable set search_path='' as $$
 select case when p_ref like 'K1-B-%' then exists(select 1 from app_private.bachs_checkout_quotes q join app_private.verified_bachs_receipts r on r.provider_reference=q.provider_reference and r.university_id=q.university_id and r.purpose=q.resource_type and r.resource_id=q.resource_id join app_private.bachs_pricing_receipts evidence on evidence.quote_id=q.id and not evidence.variance_alert where q.provider_reference=p_ref and r.amount_kobo=p_gross and r.provider_fee_kobo=p_fee and p_gross=p_quote and (q.quote->>'finalCustomerAmountKobo')::bigint=p_quote)
 else exists(select 1 from app_private.collection_payment_pricing q where q.provider_reference=p_ref and q.final_customer_amount_kobo=p_quote and app_private.collection_settlement_principal(p_ref,p_gross,p_fee) is not null) end
$$;


CREATE OR REPLACE FUNCTION app_private.record_priced_store_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; selected_order public.orders%rowtype; price app_private.order_price_snapshots%rowtype;
  seller_user uuid; journal uuid; lines jsonb; gross_margin bigint; digital_fare integer; principal bigint;
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
  if attempt.university_id is distinct from selected_order.university_id or attempt.user_id<>selected_order.buyer_user_id or
    selected_order.status<>'PENDING_PAYMENT' or attempt.status not in ('CREATED','INITIALIZED') or
    not exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='HELD' and expires_at>now()) or
    not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,price.payable_kobo) or attempt.amount_kobo<>price.payable_kobo or p_fee<0 or p_paid_at is null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now()
      where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select user_id into seller_user from public.agent_profiles where id=selected_order.vendor_profile_id;
  digital_fare=selected_order.delivery_fee_kobo-price.cash_due_kobo;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  gross_margin=principal-price.seller_net_kobo-digital_fare;
  if gross_margin<0 and not exists(select 1 from app_private.discount_redemptions where purchase_id=selected_order.id and discount_kobo>=-gross_margin) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
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
    where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.record_priced_tutorial_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; booking public.tutorial_bookings%rowtype; price app_private.tutorial_booking_prices%rowtype;
  lines jsonb; journal uuid; reason text; principal bigint;
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
      or not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,price.payable_kobo) then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',price.tutor_user_id,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if principal>price.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',principal-price.seller_net_kobo)); end if;
  if principal<price.seller_net_kobo then
    if not exists(select 1 from app_private.discount_redemptions where purchase_id=booking.id and discount_kobo>=price.seller_net_kobo-principal) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
    lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',price.seller_net_kobo-principal));
  end if;
  journal=app_private.post_finance_journal(price.university_id,'TUTORIAL_BOOKING',booking.id::text,'tutorial-payment:'||p_reference,'Verified inclusive tutorial payment',lines);
  insert into app_private.tutorial_settlements(booking_id,provider_reference,journal_id) values(booking.id,p_reference,journal);
  update public.tutorial_bookings set status='CONFIRMED',provider_reference=p_reference,updated_at=now() where id=booking.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.record_material_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; purchase app_private.tutorial_material_purchases%rowtype; lines jsonb; reason text; principal bigint;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_PURCHASE';
  if not found then return 'UNKNOWN'; end if;
  select * into purchase from app_private.tutorial_material_purchases where id=attempt.resource_id for update;
  if not found then return 'UNKNOWN'; end if;
  perform app_private.record_verified_paystack_receipt(purchase.university_id,p_reference,'TUTORIAL_PURCHASE',purchase.id,p_amount,p_fee,p_paid_at);
  if purchase.provider_reference=p_reference then return 'ALREADY_PAID'; end if;
  reason=case when purchase.provider_reference is not null then 'SECOND_SUCCESSFUL_PAYMENT'
    when(attempt.university_id,attempt.user_id,attempt.amount_kobo) is distinct from(purchase.university_id,purchase.student_user_id,purchase.amount_kobo)
      or purchase.status<>'PENDING_PAYMENT' or purchase.payment_expires_at<=now() or attempt.status not in ('CREATED','INITIALIZED') or not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,purchase.amount_kobo) then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if purchase.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',purchase.tutor_user_id,'direction','CREDIT','amount',purchase.seller_net_kobo)); end if;
  if principal>purchase.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',principal-purchase.seller_net_kobo)); end if;
  if principal<purchase.seller_net_kobo then
    if not exists(select 1 from app_private.discount_redemptions where purchase_id=purchase.id and discount_kobo>=purchase.seller_net_kobo-principal) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
    lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',purchase.seller_net_kobo-principal));
  end if;
  perform app_private.post_finance_journal(purchase.university_id,'TUTORIAL_PURCHASE',purchase.id::text,'material-payment:'||p_reference,'Verified inclusive learning material purchase',lines);
  update app_private.tutorial_material_purchases set status='PAID',earnings_state='PENDING',provider_reference=p_reference,paid_at=p_paid_at,release_at=now()+interval '7 days' where id=purchase.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.guard_material_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if(new.id,new.university_id,new.student_user_id,new.resource_id,new.tutor_user_id,new.media_object_id,new.title,new.listed_kobo,new.amount_kobo,new.seller_net_kobo) is distinct from
    (old.id,old.university_id,old.student_user_id,old.resource_id,old.tutor_user_id,old.media_object_id,old.title,old.listed_kobo,old.amount_kobo,old.seller_net_kobo) then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE'; end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE'; end if;
  if new.status='PAID' and not exists(select 1 from (select university_id,purpose,resource_id,provider_reference,amount_kobo,provider_fee_kobo from app_private.verified_paystack_receipts union all select university_id,purpose,resource_id,provider_reference,amount_kobo,provider_fee_kobo from app_private.verified_bachs_receipts) receipts where provider_reference=new.provider_reference and
    university_id=new.university_id and purpose='TUTORIAL_PURCHASE' and resource_id=new.id and app_private.collection_paid_price_matches(new.provider_reference,amount_kobo,provider_fee_kobo,new.amount_kobo)) then raise exception 'VERIFIED_RECEIPT_REQUIRED'; end if;
  if new.earnings_state='AVAILABLE' and old.earnings_state='PENDING' then
    if new.status<>'PAID' or new.release_at is null or new.release_at>now() or new.provider_reference is null or
      exists(select 1 from public.disputes where tutorial_purchase_id=new.id and status in ('OPEN','UNDER_REVIEW')) then raise exception 'EARNINGS_NOT_ELIGIBLE'; end if;
    if new.seller_net_kobo>0 then perform app_private.post_finance_journal(new.university_id,'TUTORIAL_PURCHASE',new.id::text,'material-release:'||new.id::text,'Release learning material earnings after the dispute window',jsonb_build_array(
      jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',new.tutor_user_id,'direction','DEBIT','amount',new.seller_net_kobo),
      jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',new.tutor_user_id,'direction','CREDIT','amount',new.seller_net_kobo))); end if;
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.record_kira_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare checkout app_private.kira_checkouts; period_start timestamptz; period_end timestamptz; journal uuid; principal bigint;
begin
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference;
  if not found then return 'UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||checkout.user_id::text,0));
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference for update;
  perform app_private.record_verified_paystack_receipt(checkout.university_id,p_reference,'KIRA_SUBSCRIPTION',checkout.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.kira_billing_periods where checkout_id=checkout.id) then return 'ALREADY_PAID'; end if;
  if not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,checkout.amount_kobo) or checkout.status not in ('CREATED','INITIALIZED','EXPIRED')
   or p_paid_at is null or p_paid_at<checkout.created_at or p_paid_at>checkout.expires_at then
    update app_private.kira_checkouts set status='REQUIRES_REVIEW' where id=checkout.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select greatest(now(),case when status='ACTIVE' then current_period_end else now() end) into period_start from app_private.ai_subscriptions where user_id=checkout.user_id;
  period_start=coalesce(period_start,now());period_end=period_start+interval '1 month';
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  journal=app_private.post_finance_journal(checkout.university_id,'KIRA_SUBSCRIPTION',checkout.id::text,'kira-payment:'||p_reference,'Verified monthly Kira '||checkout.tier||' access',jsonb_build_array(
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal),jsonb_build_object('code','KIRA_SUBSCRIPTION_REVENUE','type','REVENUE','direction','CREDIT','amount',principal)));
  insert into app_private.kira_billing_periods(checkout_id,user_id,starts_at,ends_at,provider_reference,journal_id,tier) values(checkout.id,checkout.user_id,period_start,period_end,p_reference,journal,checkout.tier);
  insert into app_private.ai_subscriptions(user_id,status,current_period_end,billing_reference,tier) values(checkout.user_id,'ACTIVE',period_end,p_reference,checkout.tier)
    on conflict(user_id) do update set status='ACTIVE',current_period_end=excluded.current_period_end,billing_reference=excluded.billing_reference,tier=excluded.tier,updated_at=now();
  update app_private.kira_checkouts set status='PAID',paid_at=p_paid_at where id=checkout.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
  return 'PAID';
end $function$
;


create function app_private.bachs_purchase_intent(p_reference text)
returns table("userId" uuid,"universityId" uuid,"resourceType" text,"resourceId" uuid,"amountKobo" bigint,snapshot jsonb,"expiresAt" timestamptz)
language sql stable set search_path='' as $$
 select k.user_id,k.university_id,'KIRA_SUBSCRIPTION',k.id,k.amount_kobo::bigint,jsonb_build_object('resourceType','KIRA_SUBSCRIPTION','resourceId',k.id,'planId',k.plan_id,'tier',k.tier,'amountKobo',k.amount_kobo,'quoteId',k.quote_id),k.expires_at
 from app_private.kira_checkouts k where k.provider_reference=p_reference and k.status in('CREATED','INITIALIZED')
 union all
 select a.user_id,a.university_id,a.resource_type,a.resource_id,a.amount_kobo,jsonb_build_object('resourceType',a.resource_type,'resourceId',a.resource_id,'amountKobo',a.amount_kobo,'price',coalesce(to_jsonb(os),to_jsonb(tp),to_jsonb(mp))),
 case when a.resource_type='STORE_ORDER' then (select min(expires_at) from public.inventory_reservations where order_id=a.resource_id and status='HELD') when a.resource_type='TUTORIAL_BOOKING' then (select payment_expires_at from public.tutorial_bookings where id=a.resource_id) else mp.payment_expires_at end
 from public.payment_attempts a left join app_private.order_price_snapshots os on a.resource_type='STORE_ORDER' and os.order_id=a.resource_id
 left join app_private.tutorial_booking_prices tp on a.resource_type='TUTORIAL_BOOKING' and tp.booking_id=a.resource_id
 left join app_private.tutorial_material_purchases mp on a.resource_type='TUTORIAL_PURCHASE' and mp.id=a.resource_id
 where a.provider_reference=p_reference and a.status in('CREATED','INITIALIZED') and (os.order_id is not null or tp.booking_id is not null or mp.id is not null)
$$;


create table if not exists app_private.bachs_webhook_inbox (
  provider text not null check (provider in ('BACHS')),
  event_type text not null check (event_type ~ '^[a-z._]{3,80}$'),
  provider_reference text not null check (provider_reference ~ '^[A-Za-z0-9_.-]{1,100}$'),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'PROCESSING'
    check (state in ('PROCESSING','RETRYABLE','PROCESSED','REQUIRES_REVIEW')),
  claim_token uuid,
  claimed_until timestamptz,
  attempts integer not null default 1 check (attempts between 1 and 100000),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(provider,event_type,provider_reference,body_sha256)
);
create index if not exists bachs_webhook_inbox_retries_idx
  on app_private.bachs_webhook_inbox(state,updated_at)
  where state in ('RETRYABLE','REQUIRES_REVIEW');

create or replace function app_private.claim_bachs_webhook(
  p_provider text,p_event text,p_reference text,p_hash text,p_token uuid
) returns text language plpgsql set search_path='' as $$
declare inserted boolean := false; saved app_private.bachs_webhook_inbox%rowtype;
begin
  if p_provider<>'BACHS' or p_event is null or p_event !~ '^[a-z._]{3,80}$'
    or p_reference is null or p_reference !~ '^[A-Za-z0-9_.-]{1,100}$'
    or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_token is null then
    raise exception 'INVALID_PROVIDER_WEBHOOK';
  end if;
  insert into app_private.bachs_webhook_inbox(
    provider,event_type,provider_reference,body_sha256,claim_token,claimed_until
  ) values (p_provider,p_event,p_reference,p_hash,p_token,now()+interval '2 minutes')
  on conflict do nothing returning true into inserted;
  if coalesce(inserted,false) then return 'CLAIMED'; end if;
  select * into saved from app_private.bachs_webhook_inbox
    where provider=p_provider and event_type=p_event
      and provider_reference=p_reference and body_sha256=p_hash for update;
  if saved.state='PROCESSED' then return 'DUPLICATE'; end if;
  if saved.state='REQUIRES_REVIEW' then return 'REQUIRES_REVIEW'; end if;
  if saved.state='PROCESSING' and saved.claimed_until>now() then return 'BUSY'; end if;
  update app_private.bachs_webhook_inbox
     set state='PROCESSING',claim_token=p_token,claimed_until=now()+interval '2 minutes',
         attempts=attempts+1,updated_at=now(),review_reason=null
   where provider=p_provider and event_type=p_event
     and provider_reference=p_reference and body_sha256=p_hash;
  return 'CLAIMED';
end; $$;

create or replace function app_private.finish_bachs_webhook(
  p_provider text,p_event text,p_reference text,p_hash text,p_token uuid,
  p_state text,p_reason text default null
) returns boolean language plpgsql set search_path='' as $$
declare modified integer;
begin
  if p_state not in ('RETRYABLE','PROCESSED','REQUIRES_REVIEW') then
    raise exception 'INVALID_PROVIDER_WEBHOOK_RESULT';
  end if;
  update app_private.bachs_webhook_inbox
     set state=p_state,claim_token=null,claimed_until=null,review_reason=p_reason,updated_at=now()
   where provider=p_provider and event_type=p_event
     and provider_reference=p_reference and body_sha256=p_hash
     and claim_token=p_token and state='PROCESSING';
  get diagnostics modified=row_count;
  return modified=1;
end; $$;




create function app_private.bachs_collection_ready(p_uni uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from app_private.bachs_fee_profiles p where p.university_id=p_uni and p.context='CHECKOUT_BANK_TRANSFER' and p.status='APPROVED' and p.effective_from<=now() and (p.effective_to is null or p.effective_to>now()) and not exists(select 1 from app_private.bachs_fee_profiles newer where newer.university_id=p.university_id and newer.context=p.context and newer.effective_from<=now() and (newer.effective_from,newer.approved_at,newer.id)>(p.effective_from,p.approved_at,p.id)))
$$;
revoke all on function app_private.bachs_collection_ready(uuid) from public;

-- Operator requested BACHS activation on 2026-10-10. Retain the campus's existing
-- finance-policy actor and append a provider-specific profile; do not rewrite it.
insert into app_private.bachs_fee_profiles(university_id,version,context,collection,status,effective_from,source_url,variance_tolerance_kobo,approval_note,eligibility_evidence,approved_by)
select p.university_id,'BACHS_NGN_CHECKOUT_20261010','CHECKOUT_BANK_TRANSFER','{"basisPoints":150,"flatKobo":0,"flatWaivedBelowKobo":0,"capKobo":200000}'::jsonb,'APPROVED',now(),'https://docs.bachs.io/for-you/fees',100,
 'Operator requested BACHS checkout activation with this release; existing campus finance-policy actor retained.',
 'Live API settings checked 2026-10-10: NGN_BANK_TRANSFER enabled, fee_preference org_pays. Official NGN checkout fee 1.5 percent capped at NGN 2000.',p.approved_by
from (select distinct on(university_id) university_id,approved_by from app_private.payment_fee_profiles where status='APPROVED' and transaction_class='LOCAL_COLLECTION' order by university_id,approved_at desc) p
on conflict(university_id,context,version) do nothing;
revoke all on app_private.verified_bachs_receipts,app_private.bachs_webhook_inbox from public;
revoke all on function app_private.record_verified_bachs_receipt(uuid,text,text,uuid,bigint,bigint,timestamptz) from public;
revoke all on function app_private.bachs_purchase_intent(text) from public;
revoke all on function app_private.claim_bachs_webhook(text,text,text,text,uuid) from public;
revoke all on function app_private.finish_bachs_webhook(text,text,text,text,uuid,text,text) from public;
commit;
