begin;

-- New paid bookings opt in; old/free bookings are not repriced or backfilled.
alter table public.tutorial_bookings add column pricing_formula_version text check(pricing_formula_version='INCLUSIVE_V1');
create table app_private.tutorial_booking_prices(
  booking_id uuid primary key references public.tutorial_bookings(id) on delete restrict,
  university_id uuid not null references public.universities(id) on delete restrict,
  student_user_id uuid not null references public.users(id) on delete restrict,
  tutor_user_id uuid not null references public.users(id) on delete restrict,
  listing_id uuid not null,availability_window_id uuid not null,
  request_id uuid not null,policy_id uuid not null references app_private.commerce_fee_policies(id) on delete restrict,
  base_kobo integer not null check(base_kobo>0),listed_kobo integer not null check(listed_kobo>=base_kobo),
  payable_kobo integer not null check(payable_kobo>0 and payable_kobo<=listed_kobo),
  seller_net_kobo integer not null check(seller_net_kobo>=0 and seller_net_kobo<=base_kobo),
  estimated_processing_kobo integer not null check(estimated_processing_kobo>=0),
  created_at timestamptz not null default now(),unique(student_user_id,request_id)
);
create trigger tutorial_booking_prices_append_only before update or delete on app_private.tutorial_booking_prices
  for each row execute function app_private.prevent_append_only_mutation();
create table app_private.tutorial_settlements(
  booking_id uuid primary key references app_private.tutorial_booking_prices(booking_id) on delete restrict,
  provider_reference text not null unique references app_private.verified_paystack_receipts(provider_reference) on delete restrict,
  journal_id uuid not null references public.ledger_transactions(id) on delete restrict,
  settled_at timestamptz not null default now()
);
create trigger tutorial_settlements_append_only before update or delete on app_private.tutorial_settlements
  for each row execute function app_private.prevent_append_only_mutation();

create function app_private.create_priced_tutorial_booking(
  p_id uuid,p_uni uuid,p_user uuid,p_listing uuid,p_window uuid,p_request uuid,p_policy uuid,p_base integer,p_price jsonb
) returns table(id uuid,amount_kobo integer,status text) language plpgsql set search_path='' as $$
declare previous app_private.tutorial_booking_prices%rowtype; selected_listing public.tutorial_listings%rowtype;
  tutor_user uuid; created record;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutorial-checkout:'||p_user::text||':'||p_request::text,0));
  select * into previous from app_private.tutorial_booking_prices where student_user_id=p_user and request_id=p_request;
  if found then
    if (previous.university_id,previous.listing_id,previous.availability_window_id) is distinct from(p_uni,p_listing,p_window) then raise exception 'QUOTE_REQUEST_CONFLICT'; end if;
    return query select b.id,b.amount_kobo,b.status from public.tutorial_bookings b where b.id=previous.booking_id; return;
  end if;
  if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) or
    not exists(select 1 from app_private.commerce_fee_policies cp where cp.id=p_policy and cp.university_id=p_uni and cp.kind='TUTORIAL') then raise exception 'TUTORIAL_UNAVAILABLE'; end if;
  select l.* into selected_listing from public.tutorial_listings l where l.id=p_listing and l.university_id=p_uni and l.status='PUBLISHED'
    and l.review_status='APPROVED' and not l.is_demo and l.deleted_at is null for update;
  if not found then raise exception 'TUTORIAL_UNAVAILABLE'; end if;
  select a.user_id into tutor_user from public.agent_profiles a where a.id=selected_listing.tutor_profile_id and a.university_id=p_uni and a.agent_type='TUTOR' and a.status='ACTIVE';
  if tutor_user is null then raise exception 'TUTORIAL_UNAVAILABLE'; end if;
  if selected_listing.price_kobo is distinct from p_base or p_base<=0 then raise exception 'QUOTE_PRICE_CHANGED'; end if;
  if (p_price->>'baseKobo')::integer is distinct from p_base or (p_price->>'fareKobo')::integer is distinct from 0 or
    (p_price->>'payableKobo')::integer<=0 or (p_price->>'payableKobo')::integer>(p_price->>'listedItemsKobo')::integer then raise exception 'INVALID_QUOTE'; end if;
  select * into created from app_private.create_tutorial_booking(p_id,p_uni,p_listing,p_window,p_user);
  update public.tutorial_bookings set amount_kobo=(p_price->>'payableKobo')::integer,pricing_formula_version='INCLUSIVE_V1' where tutorial_bookings.id=p_id;
  insert into app_private.tutorial_booking_prices(booking_id,university_id,student_user_id,tutor_user_id,listing_id,availability_window_id,
    request_id,policy_id,base_kobo,listed_kobo,payable_kobo,seller_net_kobo,estimated_processing_kobo)
  values(p_id,p_uni,p_user,tutor_user,p_listing,p_window,p_request,p_policy,p_base,(p_price->>'listedItemsKobo')::integer,
    (p_price->>'payableKobo')::integer,(p_price->>'sellerNetKobo')::integer,(p_price->>'estimatedProcessingKobo')::integer);
  return query select b.id,b.amount_kobo,b.status from public.tutorial_bookings b where b.id=p_id;
end; $$;

create function app_private.record_priced_tutorial_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
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
  journal=app_private.post_finance_journal(price.university_id,'TUTORIAL_BOOKING',booking.id::text,'tutorial-payment:'||p_reference,'Verified inclusive tutorial payment',lines);
  insert into app_private.tutorial_settlements(booking_id,provider_reference,journal_id) values(booking.id,p_reference,journal);
  update public.tutorial_bookings set status='CONFIRMED',provider_reference=p_reference,updated_at=now() where id=booking.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $$;

create function app_private.guard_priced_tutorial() returns trigger language plpgsql set search_path='' as $$
declare price app_private.tutorial_booking_prices%rowtype;
begin
  select * into price from app_private.tutorial_booking_prices where booking_id=old.id;
  if not found then return new; end if;
  if(new.university_id,new.student_user_id,new.listing_id,new.availability_window_id,new.amount_kobo,new.pricing_formula_version) is distinct from
    (old.university_id,old.student_user_id,old.listing_id,old.availability_window_id,old.amount_kobo,old.pricing_formula_version) then raise exception 'BOOKING_PRICE_IMMUTABLE'; end if;
  if new.earnings_state='AVAILABLE' and old.earnings_state in ('PENDING','RESERVED') then
    if new.status<>'COMPLETED' or new.completed_at is null or new.completed_at>now()-interval '48 hours' or
      exists(select 1 from public.disputes where tutorial_booking_id=new.id and status in ('OPEN','UNDER_REVIEW')) or
      not exists(select 1 from app_private.tutorial_settlements where booking_id=new.id) then raise exception 'EARNINGS_NOT_ELIGIBLE'; end if;
    if price.seller_net_kobo>0 then perform app_private.post_finance_journal(new.university_id,'TUTORIAL_BOOKING',new.id::text,'tutorial-release:'||new.id::text,'Release verified tutor earnings after the dispute window',jsonb_build_array(
      jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',price.tutor_user_id,'direction','DEBIT','amount',price.seller_net_kobo),
      jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',price.tutor_user_id,'direction','CREDIT','amount',price.seller_net_kobo))); end if;
  end if;
  return new;
end; $$;
create trigger priced_tutorial_guard before update on public.tutorial_bookings for each row execute function app_private.guard_priced_tutorial();
revoke all on app_private.tutorial_booking_prices,app_private.tutorial_settlements from public;
revoke all on function app_private.create_priced_tutorial_booking(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb),
  app_private.record_priced_tutorial_receipt(text,bigint,bigint,timestamptz),app_private.guard_priced_tutorial() from public;
commit;
