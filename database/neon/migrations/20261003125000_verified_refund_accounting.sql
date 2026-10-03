begin;

-- Separate from legacy commerce_refunds: no backfill invents a price snapshot or
-- provider receipt for historical orders. Only an already verified receipt qualifies.
create table app_private.verified_refund_requests(
  id uuid primary key,university_id uuid not null references public.universities(id),
  original_reference text not null references app_private.verified_paystack_receipts(provider_reference),
  resource_type text not null check(resource_type in('STORE_ORDER','TUTORIAL_BOOKING','TUTORIAL_PURCHASE','KIRA_SUBSCRIPTION')),
  resource_id uuid not null,buyer_user_id uuid not null references public.users(id),
  request_id uuid not null,requested_by uuid not null references public.users(id),
  original_snapshot jsonb not null check(jsonb_typeof(original_snapshot)='object'),
  currency text not null default 'NGN' check(currency='NGN'),
  original_principal_kobo bigint not null check(original_principal_kobo>0),
  customer_refund_kobo bigint not null check(customer_refund_kobo>0 and customer_refund_kobo<=original_principal_kobo),
  original_collection_fee_kobo bigint not null check(original_collection_fee_kobo>=0),
  collection_fee_treatment text not null default 'NON_REFUNDABLE' check(collection_fee_treatment='NON_REFUNDABLE'),
  collection_fee_returned_kobo bigint not null default 0 check(collection_fee_returned_kobo=0),
  refund_processing_fee_kobo bigint check(refund_processing_fee_kobo>=0),
  fee_policy_source text not null default 'https://support.paystack.com/en/articles/2127106',
  seller_reversal_kobo bigint not null check(seller_reversal_kobo>=0),
  commission_reversal_kobo bigint not null check(commission_reversal_kobo>=0),
  delivery_refund_kobo bigint not null default 0 check(delivery_refund_kobo=0),
  delivery_treatment text not null check(delivery_treatment in('NONE','REQUIRES_REVIEW')),
  accounting_mode text not null check(accounting_mode in('FULL_UNEARNED_NO_DELIVERY_V1','MANUAL_REVIEW')),
  status text not null check(status in('REQUESTED','REQUIRES_REVIEW','APPROVED','PROVIDER_PENDING','FAILED','SUCCEEDED','CANCELLED')),
  reason text not null check(char_length(reason) between 10 and 1000),review_reason text,
  approved_by uuid references public.users(id),review_note text check(review_note is null or char_length(review_note) between 10 and 2000),
  provider_refund_id text unique check(provider_refund_id is null or provider_refund_id ~ '^[1-9][0-9]{0,19}$'),
  provider_status text,journal_id uuid references public.ledger_transactions(id),
  requested_at timestamptz not null default now(),approved_at timestamptz,completed_at timestamptz,
  unique(requested_by,request_id),
  check(status not in('APPROVED','PROVIDER_PENDING','FAILED','SUCCEEDED') or (approved_by is not null and approved_at is not null and review_note is not null)),
  check(status not in('PROVIDER_PENDING','FAILED','SUCCEEDED') or provider_refund_id is not null),
  check(status<>'SUCCEEDED' or (journal_id is not null and completed_at is not null and provider_status='processed')),
  check(status<>'CANCELLED' or (provider_refund_id is null and journal_id is null))
);
create unique index verified_refund_one_original on app_private.verified_refund_requests(original_reference) where status<>'CANCELLED';
create index verified_refund_review_queue on app_private.verified_refund_requests(university_id,status,requested_at);
create table app_private.verified_refund_events(
  id bigint generated always as identity primary key,
  refund_id uuid not null references app_private.verified_refund_requests(id),
  status text not null,actor_user_id uuid references public.users(id),
  provider_status text,metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),unique(refund_id,provider_status)
);
create trigger verified_refund_events_append_only before update or delete on app_private.verified_refund_events
  for each row execute function app_private.prevent_append_only_mutation();

create function app_private.refund_original_snapshot(p_reference text)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.verified_paystack_receipts%rowtype; price jsonb; allocation uuid; buyer uuid;
begin
 select * into r from app_private.verified_paystack_receipts where provider_reference=p_reference;
 if not found then raise exception 'REFUND_ORIGINAL_VERIFIED_RECEIPT_REQUIRED';end if;
 if r.purpose='STORE_ORDER' then
  select jsonb_build_object('price',to_jsonb(p),'quote',to_jsonb(q)),o.buyer_user_id,s.journal_id into price,buyer,allocation
  from app_private.order_price_snapshots p join app_private.store_checkout_quotes q on q.id=p.quote_id
  join public.orders o on o.id=p.order_id join app_private.commerce_settlements s on s.order_id=o.id and s.provider_reference=p_reference
  where p.order_id=r.resource_id and p.university_id=r.university_id and p.payable_kobo=r.amount_kobo;
 elsif r.purpose='TUTORIAL_BOOKING' then
  select to_jsonb(p),p.student_user_id,s.journal_id into price,buyer,allocation
  from app_private.tutorial_booking_prices p join app_private.tutorial_settlements s on s.booking_id=p.booking_id and s.provider_reference=p_reference
  where p.booking_id=r.resource_id and p.university_id=r.university_id and p.payable_kobo=r.amount_kobo;
 elsif r.purpose='TUTORIAL_PURCHASE' then
  select to_jsonb(q),p.student_user_id,t.id into price,buyer,allocation
  from app_private.material_checkout_quotes q join app_private.tutorial_material_purchases p on p.id=q.id
  join public.ledger_transactions t on t.idempotency_key='material-payment:'||p_reference
  where p.id=r.resource_id and p.provider_reference=p_reference and p.university_id=r.university_id and p.amount_kobo=r.amount_kobo;
 elsif r.purpose='KIRA_SUBSCRIPTION' then
  select jsonb_build_object('plan',to_jsonb(p),'checkoutId',c.id,'amountKobo',c.amount_kobo,'planId',c.plan_id),c.user_id,b.journal_id into price,buyer,allocation
  from app_private.kira_checkouts c join app_private.kira_price_plans p on p.id=c.plan_id
  join app_private.kira_billing_periods b on b.checkout_id=c.id and b.provider_reference=p_reference
  where c.id=r.resource_id and c.university_id=r.university_id and c.amount_kobo=r.amount_kobo;
 else raise exception 'REFUND_UNSUPPORTED_PAYMENT';end if;
 if price is null or allocation is null or buyer is null then raise exception 'REFUND_ORIGINAL_PRICE_SNAPSHOT_REQUIRED';end if;
 return jsonb_build_object('receipt',to_jsonb(r),'pricing',price,'buyerUserId',buyer,'allocationJournalId',allocation,
   'allocation',(select journal_payload from public.ledger_transactions where id=allocation));
end $$;

-- Lock the original purchase, and only allow reversing credits that remain pending.
-- Delivery/cash, partial, released earnings and Kira entitlement changes need a
-- separate approved policy. The request retains evidence for manual finance review.
create function app_private.refund_accounting_review_reason(p_reference text,p_amount bigint)
returns text language plpgsql set search_path='' as $$
declare r app_private.verified_paystack_receipts%rowtype; state text; earnings text; fare bigint;
begin
 select * into r from app_private.verified_paystack_receipts where provider_reference=p_reference;
 if p_amount<>r.amount_kobo then return 'PARTIAL_REFUND_POLICY_REQUIRED';end if;
 if r.purpose='KIRA_SUBSCRIPTION' then return 'KIRA_ENTITLEMENT_REFUND_POLICY_REQUIRED';end if;
 if r.purpose='STORE_ORDER' then
  select status,earnings_state,delivery_fee_kobo into state,earnings,fare from public.orders where id=r.resource_id for update;
  if fare<>0 or exists(select 1 from app_private.order_price_snapshots where order_id=r.resource_id and cash_due_kobo<>0) then return 'DELIVERY_REFUND_POLICY_REQUIRED';end if;
  if state<>'PAID' then return 'PURCHASE_FULFILMENT_REVIEW_REQUIRED';end if;
 elsif r.purpose='TUTORIAL_BOOKING' then
  select status,earnings_state into state,earnings from public.tutorial_bookings where id=r.resource_id for update;
  if state<>'CONFIRMED' then return 'PURCHASE_FULFILMENT_REVIEW_REQUIRED';end if;
 elsif r.purpose='TUTORIAL_PURCHASE' then
  select status,earnings_state into state,earnings from app_private.tutorial_material_purchases where id=r.resource_id for update;
  if state<>'PAID' then return 'PURCHASE_FULFILMENT_REVIEW_REQUIRED';end if;
 else return 'REFUND_UNSUPPORTED_PAYMENT';end if;
 if earnings is null or earnings not in('NOT_EARNED','PENDING') or exists(
  select 1 from public.ledger_transactions where reference_id=r.resource_id::text and
  idempotency_key in('store-release:'||r.resource_id::text,'tutorial-release:'||r.resource_id::text,'material-release:'||r.resource_id::text)
 ) then return 'SELLER_EARNINGS_REVERSAL_POLICY_REQUIRED';end if;
 return null;
end $$;

create function app_private.create_verified_refund_request(p_id uuid,p_uni uuid,p_actor uuid,p_request uuid,p_reference text,p_amount bigint,p_reason text)
returns app_private.verified_refund_requests language plpgsql set search_path='' as $$
declare saved app_private.verified_refund_requests%rowtype; snapshot jsonb; r app_private.verified_paystack_receipts%rowtype; review text; seller bigint; commission bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('refund-original:'||p_reference,0));
 select * into saved from app_private.verified_refund_requests where requested_by=p_actor and request_id=p_request;
 if found then
  if(saved.university_id,saved.original_reference,saved.customer_refund_kobo,saved.reason) is distinct from(p_uni,p_reference,p_amount,p_reason) then raise exception 'REFUND_IDEMPOTENCY_CONFLICT';end if;
  return saved;
 end if;
 snapshot=app_private.refund_original_snapshot(p_reference);
 select * into r from app_private.verified_paystack_receipts where provider_reference=p_reference;
 if r.university_id<>p_uni then raise exception 'REFUND_TENANT_MISMATCH';end if;
 if p_amount is null or p_amount<=0 or p_amount>r.amount_kobo then raise exception 'REFUND_AMOUNT_INVALID';end if;
 review=app_private.refund_accounting_review_reason(p_reference,p_amount);
 if snapshot->'allocation' is null or snapshot->'allocation'='null'::jsonb then review='ORIGINAL_JOURNAL_REVIEW_REQUIRED';end if;
 select coalesce(sum(case when x.code in('VENDOR_PENDING','TUTOR_PENDING') and x.direction='CREDIT' then x.amount else 0 end),0),
   coalesce(sum(case when x.code='PLATFORM_COMMISSION' and x.direction='CREDIT' then x.amount else 0 end),0)
 into seller,commission from jsonb_to_recordset(coalesce(snapshot->'allocation'->'lines','[]'::jsonb)) x(code text,direction text,amount bigint);
 insert into app_private.verified_refund_requests(id,university_id,original_reference,resource_type,resource_id,buyer_user_id,request_id,requested_by,original_snapshot,
  original_principal_kobo,customer_refund_kobo,original_collection_fee_kobo,seller_reversal_kobo,commission_reversal_kobo,delivery_treatment,accounting_mode,status,reason,review_reason)
 values(p_id,p_uni,p_reference,r.purpose,r.resource_id,(snapshot->>'buyerUserId')::uuid,p_request,p_actor,snapshot,r.amount_kobo,p_amount,r.provider_fee_kobo,
  case when review is null then seller else 0 end,case when review is null then commission else 0 end,
  case when review='DELIVERY_REFUND_POLICY_REQUIRED' then 'REQUIRES_REVIEW' else 'NONE' end,
  case when review is null then 'FULL_UNEARNED_NO_DELIVERY_V1' else 'MANUAL_REVIEW' end,case when review is null then 'REQUESTED' else 'REQUIRES_REVIEW' end,p_reason,review) returning * into saved;
 insert into app_private.verified_refund_events(refund_id,status,actor_user_id,metadata) values(saved.id,saved.status,p_actor,jsonb_build_object('reviewReason',review));
 return saved;
end $$;

create function app_private.approve_verified_refund(p_id uuid,p_uni uuid,p_actor uuid,p_note text)
returns text language plpgsql set search_path='' as $$
declare r app_private.verified_refund_requests%rowtype; review text;
begin
 select * into r from app_private.verified_refund_requests where id=p_id and university_id=p_uni for update;
 if not found then raise exception 'REFUND_NOT_FOUND';end if;
 if r.buyer_user_id=p_actor or r.requested_by=p_actor then raise exception 'REFUND_INDEPENDENT_REVIEW_REQUIRED';end if;
 if r.status='APPROVED' then return r.status;end if;
 if r.status<>'REQUESTED' or r.accounting_mode<>'FULL_UNEARNED_NO_DELIVERY_V1' then raise exception 'REFUND_MANUAL_POLICY_REVIEW_REQUIRED';end if;
 if r.original_snapshot is distinct from app_private.refund_original_snapshot(r.original_reference) then raise exception 'REFUND_SNAPSHOT_CHANGED';end if;
 review=app_private.refund_accounting_review_reason(r.original_reference,r.customer_refund_kobo);
 if review is not null then raise exception 'REFUND_PURCHASE_STATE_CHANGED';end if;
 update app_private.verified_refund_requests set status='APPROVED',approved_by=p_actor,approved_at=now(),review_note=p_note where id=p_id;
 insert into app_private.verified_refund_events(refund_id,status,actor_user_id) values(p_id,'APPROVED',p_actor);
 return 'APPROVED';
end $$;

create function app_private.bind_verified_refund_provider(p_id uuid,p_uni uuid,p_actor uuid,p_provider_id text,p_note text)
returns text language plpgsql set search_path='' as $$
declare r app_private.verified_refund_requests%rowtype;
begin
 select * into r from app_private.verified_refund_requests where id=p_id and university_id=p_uni for update;
 if not found then raise exception 'REFUND_NOT_FOUND';end if;
 if r.buyer_user_id=p_actor then raise exception 'REFUND_INDEPENDENT_REVIEW_REQUIRED';end if;
 if r.provider_refund_id=p_provider_id and r.status in('PROVIDER_PENDING','FAILED','SUCCEEDED') then return r.status;end if;
 if r.status<>'APPROVED' or r.provider_refund_id is not null then raise exception 'REFUND_NOT_APPROVED';end if;
 update app_private.verified_refund_requests set provider_refund_id=p_provider_id,status='PROVIDER_PENDING' where id=p_id;
 insert into app_private.verified_refund_events(refund_id,status,actor_user_id,metadata) values(p_id,'PROVIDER_PENDING',p_actor,jsonb_build_object('providerRefundId',p_provider_id,'note',p_note));
 return 'PROVIDER_PENDING';
end $$;

create function app_private.record_verified_refund(p_id uuid,p_uni uuid,p_actor uuid,p_provider_id text,p_reference text,p_currency text,p_amount bigint,p_status text,p_refunded_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare r app_private.verified_refund_requests%rowtype; lines jsonb; journal uuid; review text;
begin
 select * into r from app_private.verified_refund_requests where id=p_id and university_id=p_uni for update;
 if not found then raise exception 'REFUND_NOT_FOUND';end if;
 if(r.provider_refund_id,r.original_reference,r.currency,r.customer_refund_kobo) is distinct from(p_provider_id,p_reference,p_currency,p_amount) then raise exception 'REFUND_PROVIDER_SNAPSHOT_MISMATCH';end if;
 if r.buyer_user_id=p_actor then raise exception 'REFUND_INDEPENDENT_REVIEW_REQUIRED';end if;
 if r.original_snapshot is distinct from app_private.refund_original_snapshot(r.original_reference) then raise exception 'REFUND_SNAPSHOT_CHANGED';end if;
 if p_status not in('pending','processing','processed','failed','needs-attention') then raise exception 'REFUND_PROVIDER_STATUS_INVALID';end if;
 if r.status='SUCCEEDED' then
  if p_status<>'processed' or r.completed_at is distinct from p_refunded_at then raise exception 'REFUND_PROVIDER_STATE_CONFLICT';end if;
  return 'ALREADY_SUCCEEDED';
 end if;
 if r.status not in('PROVIDER_PENDING','FAILED') then raise exception 'REFUND_NOT_APPROVED';end if;
 insert into app_private.verified_refund_events(refund_id,status,actor_user_id,provider_status,metadata)
 values(p_id,case when p_status='processed' then 'SUCCEEDED' when p_status='failed' then 'FAILED' else 'PROVIDER_PENDING' end,p_actor,p_status,jsonb_build_object('providerRefundId',p_provider_id,'currency',p_currency,'amountKobo',p_amount,'refundedAt',p_refunded_at)) on conflict(refund_id,provider_status) do nothing;
 if p_status<>'processed' then
  update app_private.verified_refund_requests set provider_status=p_status,status=case when p_status='failed' then 'FAILED' else 'PROVIDER_PENDING' end where id=p_id;
  return case when p_status='failed' then 'FAILED' else 'PROVIDER_PENDING' end;
 end if;
 if p_refunded_at is null then raise exception 'REFUND_COMPLETION_REQUIRED';end if;
 review=app_private.refund_accounting_review_reason(r.original_reference,p_amount);
 if review is not null then raise exception 'REFUND_PURCHASE_STATE_CHANGED';end if;
 -- Reverse the immutable original allocation, preserving discounts/subsidies.
 -- PAYMENT_SUSPENSE's original debit becomes a credit to provider clearing.
 -- The original processing-expense journal is deliberately never reversed.
 select jsonb_agg(case when x->>'code'='PAYMENT_SUSPENSE' then
   jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',p_amount)
   else x||jsonb_build_object('direction',case when x->>'direction'='CREDIT' then 'DEBIT' else 'CREDIT' end) end)
 into lines from jsonb_array_elements(r.original_snapshot->'allocation'->'lines') x;
 journal=app_private.post_finance_journal(p_uni,'VERIFIED_REFUND',p_id::text,'verified-refund:'||p_provider_id,'Verified original principal refund; collection charges retained',lines);
 update app_private.verified_refund_requests set status='SUCCEEDED',provider_status=p_status,journal_id=journal,completed_at=p_refunded_at where id=p_id;
 if r.resource_type='STORE_ORDER' then update public.orders set status='REFUNDED',earnings_state='REVERSED',updated_at=now() where id=r.resource_id;
 elsif r.resource_type='TUTORIAL_BOOKING' then update public.tutorial_bookings set status='REFUNDED',earnings_state='REVERSED',updated_at=now() where id=r.resource_id;
 elsif r.resource_type='TUTORIAL_PURCHASE' then update app_private.tutorial_material_purchases set status='REFUNDED',earnings_state='REVERSED' where id=r.resource_id;end if;
 return 'SUCCEEDED';
end $$;

create function app_private.cancel_verified_refund(p_id uuid,p_uni uuid,p_actor uuid,p_note text)
returns text language plpgsql set search_path='' as $$
declare r app_private.verified_refund_requests%rowtype;
begin
 select * into r from app_private.verified_refund_requests where id=p_id and university_id=p_uni for update;
 if not found then raise exception 'REFUND_NOT_FOUND';end if;
 if r.status='CANCELLED' then return r.status;end if;
 if r.provider_refund_id is not null or r.status not in('REQUESTED','APPROVED','REQUIRES_REVIEW') then raise exception 'REFUND_PROVIDER_REVIEW_REQUIRED';end if;
 update app_private.verified_refund_requests set status='CANCELLED' where id=p_id;
 insert into app_private.verified_refund_events(refund_id,status,actor_user_id,metadata) values(p_id,'CANCELLED',p_actor,jsonb_build_object('note',p_note));
 return 'CANCELLED';
end $$;

create function app_private.guard_verified_refund_request() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'REFUND_APPEND_ONLY';end if;
 if (to_jsonb(new)-array['status','review_reason','approved_by','review_note','provider_refund_id','provider_status','journal_id','approved_at','completed_at']) is distinct from
    (to_jsonb(old)-array['status','review_reason','approved_by','review_note','provider_refund_id','provider_status','journal_id','approved_at','completed_at']) or
   (old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id) or
   (old.status in('SUCCEEDED','CANCELLED') and to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'REFUND_SNAPSHOT_IMMUTABLE';end if;
 return new;
end $$;
create trigger verified_refund_request_guard before update or delete on app_private.verified_refund_requests for each row execute function app_private.guard_verified_refund_request();

create function app_private.guard_refund_reserved_purchase() returns trigger language plpgsql set search_path='' as $$
declare kind text;
begin
 kind=case when tg_table_name='orders' then 'STORE_ORDER' when tg_table_name='tutorial_bookings' then 'TUTORIAL_BOOKING' else 'TUTORIAL_PURCHASE' end;
 if (new.status is distinct from old.status or new.earnings_state is distinct from old.earnings_state) and exists(
  select 1 from app_private.verified_refund_requests where resource_type=kind and resource_id=old.id and status not in('CANCELLED','SUCCEEDED')
 ) then raise exception 'PURCHASE_RESERVED_FOR_REFUND_REVIEW';end if;
 return new;
end $$;
create trigger a_refund_store_reservation before update on public.orders for each row execute function app_private.guard_refund_reserved_purchase();
create trigger a_refund_tutorial_reservation before update on public.tutorial_bookings for each row execute function app_private.guard_refund_reserved_purchase();
create trigger a_refund_material_reservation before update on app_private.tutorial_material_purchases for each row execute function app_private.guard_refund_reserved_purchase();

revoke all on app_private.verified_refund_requests,app_private.verified_refund_events from public;
revoke execute on all functions in schema app_private from public;
commit;
