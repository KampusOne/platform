begin;
alter table public.payment_attempts drop constraint payment_attempts_resource_type_check;
alter table public.payment_attempts add constraint payment_attempts_resource_type_check check(resource_type in ('STORE_ORDER','TUTORIAL_BOOKING','TUTORIAL_PURCHASE'));
alter table app_private.verified_paystack_receipts drop constraint verified_paystack_receipts_purpose_check;
alter table app_private.verified_paystack_receipts add constraint verified_paystack_receipts_purpose_check check(purpose in ('STORE_ORDER','RIDER_COMMISSION','TUTORIAL_BOOKING','TUTORIAL_PURCHASE','KIRA_SUBSCRIPTION'));
create table app_private.material_checkout_quotes(
  id uuid primary key,university_id uuid not null references public.universities(id) on delete restrict,
  student_user_id uuid not null references public.users(id) on delete restrict,
  resource_id uuid not null references public.tutorial_resources(id) on delete restrict,
  tutor_user_id uuid not null references public.users(id) on delete restrict,
  media_object_id uuid not null references public.media_objects(id) on delete restrict,
  policy_id uuid not null references app_private.commerce_fee_policies(id) on delete restrict,
  request_id uuid not null,title text not null,base_kobo integer not null check(base_kobo>0),
  pricing jsonb not null check(jsonb_typeof(pricing)='object'),
  created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',
  unique(student_user_id,request_id)
);
create trigger material_quotes_append_only before update or delete on app_private.material_checkout_quotes
  for each row execute function app_private.prevent_append_only_mutation();
create table app_private.tutorial_material_purchases(
  id uuid primary key references app_private.material_checkout_quotes(id) on delete restrict,
  university_id uuid not null references public.universities(id) on delete restrict,
  student_user_id uuid not null references public.users(id) on delete restrict,
  resource_id uuid not null references public.tutorial_resources(id) on delete restrict,
  tutor_user_id uuid not null references public.users(id) on delete restrict,
  media_object_id uuid not null references public.media_objects(id) on delete restrict,
  title text not null,listed_kobo integer not null check(listed_kobo>0),amount_kobo integer not null check(amount_kobo>0 and amount_kobo<=listed_kobo),
  seller_net_kobo integer not null check(seller_net_kobo>=0 and seller_net_kobo<=amount_kobo),
  status text not null default 'PENDING_PAYMENT' check(status in ('PENDING_PAYMENT','PAID','CANCELLED','DISPUTED','REFUNDED')),
  earnings_state text not null default 'NOT_EARNED' check(earnings_state in ('NOT_EARNED','PENDING','AVAILABLE','REVERSED')),
  provider_reference text unique references app_private.verified_paystack_receipts(provider_reference) on delete restrict,
  created_at timestamptz not null default now(),payment_expires_at timestamptz not null default now()+interval '30 minutes',
  paid_at timestamptz,release_at timestamptz
);
create unique index tutorial_material_owned_purchase on app_private.tutorial_material_purchases(student_user_id,resource_id) where status in ('PENDING_PAYMENT','PAID','DISPUTED');
create index tutorial_material_history on app_private.tutorial_material_purchases(student_user_id,university_id,created_at desc,id desc);
alter table public.disputes add column tutorial_purchase_id uuid references app_private.tutorial_material_purchases(id) on delete restrict;
alter table public.disputes drop constraint disputes_check;
alter table public.disputes add constraint disputes_check check((tutorial_booking_id is not null)::integer+(order_id is not null)::integer+(tutorial_purchase_id is not null)::integer=1);
create unique index material_one_open_dispute on public.disputes(tutorial_purchase_id) where status in ('OPEN','UNDER_REVIEW');

create function app_private.create_material_purchase(p_quote uuid,p_user uuid,p_uni uuid)
returns app_private.tutorial_material_purchases language plpgsql set search_path='' as $$
declare quote app_private.material_checkout_quotes%rowtype; purchase app_private.tutorial_material_purchases%rowtype; resource public.tutorial_resources%rowtype;
begin
  select * into quote from app_private.material_checkout_quotes where id=p_quote and student_user_id=p_user and university_id=p_uni for update;
  if not found then raise exception 'QUOTE_UNAVAILABLE'; end if;
  select * into purchase from app_private.tutorial_material_purchases where id=p_quote;
  if found then return purchase; end if;
  if quote.expires_at<=now() then raise exception 'QUOTE_EXPIRED'; end if;
  select * into resource from public.tutorial_resources where id=quote.resource_id and university_id=p_uni and access_model='PAID' and status='PUBLISHED' and not is_demo and deleted_at is null for update;
  if not found or not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) or
    not exists(select 1 from public.agent_profiles where user_id=quote.tutor_user_id and id=resource.tutor_profile_id and university_id=p_uni and status='ACTIVE' and agent_type='TUTOR') then raise exception 'MATERIAL_UNAVAILABLE'; end if;
  if resource.price_kobo is distinct from quote.base_kobo or resource.media_object_id is distinct from quote.media_object_id then raise exception 'QUOTE_PRICE_CHANGED'; end if;
  update app_private.tutorial_material_purchases set status='CANCELLED' where student_user_id=p_user and resource_id=quote.resource_id and status='PENDING_PAYMENT' and payment_expires_at<=now();
  select * into purchase from app_private.tutorial_material_purchases where student_user_id=p_user and resource_id=quote.resource_id and status in ('PENDING_PAYMENT','PAID','DISPUTED');
  if found then return purchase; end if;
  insert into app_private.tutorial_material_purchases(id,university_id,student_user_id,resource_id,tutor_user_id,media_object_id,title,listed_kobo,amount_kobo,seller_net_kobo)
    values(quote.id,p_uni,p_user,quote.resource_id,quote.tutor_user_id,quote.media_object_id,quote.title,(quote.pricing->>'listedItemsKobo')::integer,(quote.pricing->>'payableKobo')::integer,(quote.pricing->>'sellerNetKobo')::integer) returning * into purchase;
  return purchase;
end; $$;
create function app_private.prepare_material_payment(p_id uuid,p_purchase uuid,p_user uuid,p_uni uuid,p_request text,p_reference text)
returns public.payment_attempts language plpgsql set search_path='' as $$
declare purchase app_private.tutorial_material_purchases%rowtype; attempt public.payment_attempts%rowtype;
begin
  select * into purchase from app_private.tutorial_material_purchases where id=p_purchase and student_user_id=p_user and university_id=p_uni for update;
  if not found or purchase.status<>'PENDING_PAYMENT' or purchase.payment_expires_at<=now() then raise exception 'PAYMENT_NOT_PENDING'; end if;
  select * into attempt from public.payment_attempts where resource_type='TUTORIAL_PURCHASE' and resource_id=p_purchase and status in ('CREATED','INITIALIZED','REQUIRES_REVIEW') order by created_at desc limit 1;
  if found then return attempt; end if;
  insert into public.payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key)
    values(p_id,p_user,p_uni,'TUTORIAL_PURCHASE',p_purchase,p_reference,purchase.amount_kobo,'material-'||p_request) returning * into attempt;
  return attempt;
end; $$;
create function app_private.record_material_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare attempt public.payment_attempts%rowtype; purchase app_private.tutorial_material_purchases%rowtype; lines jsonb; reason text;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_PURCHASE';
  if not found then return 'UNKNOWN'; end if;
  select * into purchase from app_private.tutorial_material_purchases where id=attempt.resource_id for update;
  if not found then return 'UNKNOWN'; end if;
  perform app_private.record_verified_paystack_receipt(purchase.university_id,p_reference,'TUTORIAL_PURCHASE',purchase.id,p_amount,p_fee,p_paid_at);
  if purchase.provider_reference=p_reference then return 'ALREADY_PAID'; end if;
  reason=case when purchase.provider_reference is not null then 'SECOND_SUCCESSFUL_PAYMENT'
    when(attempt.university_id,attempt.user_id,attempt.amount_kobo) is distinct from(purchase.university_id,purchase.student_user_id,purchase.amount_kobo)
      or purchase.status<>'PENDING_PAYMENT' or purchase.payment_expires_at<=now() or attempt.status not in ('CREATED','INITIALIZED') or p_amount<>purchase.amount_kobo then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount));
  if purchase.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',purchase.tutor_user_id,'direction','CREDIT','amount',purchase.seller_net_kobo)); end if;
  if p_amount>purchase.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',p_amount-purchase.seller_net_kobo)); end if;
  perform app_private.post_finance_journal(purchase.university_id,'TUTORIAL_PURCHASE',purchase.id::text,'material-payment:'||p_reference,'Verified inclusive learning material purchase',lines);
  update app_private.tutorial_material_purchases set status='PAID',earnings_state='PENDING',provider_reference=p_reference,paid_at=p_paid_at,release_at=now()+interval '7 days' where id=purchase.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $$;
create function app_private.guard_material_purchase() returns trigger language plpgsql set search_path='' as $$
begin
  if(new.id,new.university_id,new.student_user_id,new.resource_id,new.tutor_user_id,new.media_object_id,new.title,new.listed_kobo,new.amount_kobo,new.seller_net_kobo) is distinct from
    (old.id,old.university_id,old.student_user_id,old.resource_id,old.tutor_user_id,old.media_object_id,old.title,old.listed_kobo,old.amount_kobo,old.seller_net_kobo) then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE'; end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE'; end if;
  if new.status='PAID' and not exists(select 1 from app_private.verified_paystack_receipts where provider_reference=new.provider_reference and
    university_id=new.university_id and purpose='TUTORIAL_PURCHASE' and resource_id=new.id and amount_kobo=new.amount_kobo) then raise exception 'VERIFIED_RECEIPT_REQUIRED'; end if;
  if new.earnings_state='AVAILABLE' and old.earnings_state='PENDING' then
    if new.status<>'PAID' or new.release_at is null or new.release_at>now() or new.provider_reference is null or
      exists(select 1 from public.disputes where tutorial_purchase_id=new.id and status in ('OPEN','UNDER_REVIEW')) then raise exception 'EARNINGS_NOT_ELIGIBLE'; end if;
    if new.seller_net_kobo>0 then perform app_private.post_finance_journal(new.university_id,'TUTORIAL_PURCHASE',new.id::text,'material-release:'||new.id::text,'Release learning material earnings after the dispute window',jsonb_build_array(
      jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',new.tutor_user_id,'direction','DEBIT','amount',new.seller_net_kobo),
      jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',new.tutor_user_id,'direction','CREDIT','amount',new.seller_net_kobo))); end if;
  end if;
  return new;
end; $$;
create trigger material_purchase_snapshot_guard before update on app_private.tutorial_material_purchases for each row execute function app_private.guard_material_purchase();
create function app_private.release_due_material_earnings(p_uni uuid default null) returns integer language plpgsql set search_path='' as $$
declare purchase app_private.tutorial_material_purchases%rowtype; released integer:=0;
begin
  for purchase in select p.* from app_private.tutorial_material_purchases p where p.status='PAID' and p.earnings_state='PENDING' and p.release_at<=now()
    and(p_uni is null or p.university_id=p_uni) and not exists(select 1 from public.disputes where tutorial_purchase_id=p.id and status in ('OPEN','UNDER_REVIEW')) order by p.id limit 100 for update skip locked loop
    update app_private.tutorial_material_purchases set earnings_state='AVAILABLE' where id=purchase.id;released=released+1;
  end loop;
  return released;
end; $$;
create function app_private.open_material_dispute(p_id uuid,p_purchase uuid,p_user uuid,p_uni uuid,p_reason text) returns uuid language plpgsql set search_path='' as $$
declare purchase app_private.tutorial_material_purchases%rowtype; existing uuid;
begin
  select * into purchase from app_private.tutorial_material_purchases where id=p_purchase and student_user_id=p_user and university_id=p_uni for update;
  if not found then raise exception 'PURCHASE_UNAVAILABLE'; end if;
  select id into existing from public.disputes where tutorial_purchase_id=p_purchase and status in ('OPEN','UNDER_REVIEW');
  if found then return existing; end if;
  if purchase.status<>'PAID' or purchase.release_at<=now() or purchase.earnings_state<>'PENDING' then raise exception 'DISPUTE_WINDOW_CLOSED'; end if;
  insert into public.disputes(id,university_id,opened_by_user_id,tutorial_purchase_id,reason,category)values(p_id,p_uni,p_user,p_purchase,p_reason,'OTHER');
  update app_private.tutorial_material_purchases set status='DISPUTED' where id=p_purchase;
  return p_id;
end; $$;
revoke all on app_private.material_checkout_quotes,app_private.tutorial_material_purchases from public;
revoke all on function app_private.create_material_purchase(uuid,uuid,uuid),app_private.prepare_material_payment(uuid,uuid,uuid,uuid,text,text),app_private.record_material_receipt(text,bigint,bigint,timestamptz),
  app_private.guard_material_purchase(),app_private.release_due_material_earnings(uuid),app_private.open_material_dispute(uuid,uuid,uuid,uuid,text) from public;
commit;
