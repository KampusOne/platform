begin;
create table app_private.kira_price_plans(
  id uuid primary key,university_id uuid not null references public.universities(id) on delete restrict,
  version text not null check(char_length(version) between 3 and 80),
  amount_kobo integer not null default 600000 check(amount_kobo=600000),
  collection jsonb not null check(jsonb_typeof(collection)='object'),
  estimated_processing_kobo integer not null check(estimated_processing_kobo between 0 and 599999),
  approved_by uuid not null references public.users(id) on delete restrict,approval_note text not null,
  source_url text not null,approved_at timestamptz not null default now(),unique(university_id,version),unique(id,university_id)
);
create trigger kira_price_plans_append_only before update or delete on app_private.kira_price_plans
  for each row execute function app_private.prevent_append_only_mutation();
create table app_private.active_kira_price_plans(
  university_id uuid primary key,plan_id uuid not null,
  foreign key(plan_id,university_id) references app_private.kira_price_plans(id,university_id) on delete restrict
);
create table app_private.kira_checkouts(
  id uuid primary key,user_id uuid not null references public.users(id) on delete restrict,
  university_id uuid not null references public.universities(id) on delete restrict,
  plan_id uuid not null references app_private.kira_price_plans(id) on delete restrict,
  request_id uuid not null,provider_reference text not null unique,
  amount_kobo integer not null default 600000 check(amount_kobo=600000),
  status text not null default 'CREATED' check(status in ('CREATED','INITIALIZED','PAID','FAILED','EXPIRED','REQUIRES_REVIEW')),
  authorization_url text,access_code text,created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 minutes',paid_at timestamptz,
  unique(user_id,request_id)
);
create unique index kira_one_active_checkout on app_private.kira_checkouts(user_id) where status in ('CREATED','INITIALIZED');
create table app_private.kira_billing_periods(
  checkout_id uuid primary key references app_private.kira_checkouts(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),
  provider_reference text not null unique references app_private.verified_paystack_receipts(provider_reference) on delete restrict,
  journal_id uuid not null references public.ledger_transactions(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create trigger kira_billing_periods_append_only before update or delete on app_private.kira_billing_periods
  for each row execute function app_private.prevent_append_only_mutation();
create function app_private.guard_kira_checkout() returns trigger language plpgsql set search_path='' as $$
begin
  if(new.id,new.user_id,new.university_id,new.plan_id,new.request_id,new.provider_reference,new.amount_kobo) is distinct from
    (old.id,old.user_id,old.university_id,old.plan_id,old.request_id,old.provider_reference,old.amount_kobo) or
    (old.status='PAID' and new.status<>'PAID') then raise exception 'CHECKOUT_SNAPSHOT_IMMUTABLE'; end if;
  return new;
end; $$;
create trigger kira_checkout_snapshot_guard before update on app_private.kira_checkouts for each row execute function app_private.guard_kira_checkout();
create function app_private.create_kira_checkout(p_id uuid,p_user uuid,p_uni uuid,p_request uuid,p_reference text)
returns app_private.kira_checkouts language plpgsql set search_path='' as $$
declare existing app_private.kira_checkouts%rowtype; plan uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||p_user::text,0));
  select * into existing from app_private.kira_checkouts where user_id=p_user and request_id=p_request;
  if found then return existing; end if;
  if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) then raise exception 'BUYER_TENANT_MISMATCH'; end if;
  if exists(select 1 from app_private.ai_subscriptions where user_id=p_user and status='ACTIVE' and current_period_end>now()+interval '7 days') then raise exception 'KIRA_ALREADY_ACTIVE'; end if;
  select plan_id into plan from app_private.active_kira_price_plans where university_id=p_uni;
  if plan is null then raise exception 'KIRA_PLAN_UNAVAILABLE'; end if;
  update app_private.kira_checkouts set status='EXPIRED' where user_id=p_user and status in ('CREATED','INITIALIZED') and expires_at<=now();
  select * into existing from app_private.kira_checkouts where user_id=p_user and status in ('CREATED','INITIALIZED');
  if found then return existing; end if;
  insert into app_private.kira_checkouts(id,user_id,university_id,plan_id,request_id,provider_reference)
    values(p_id,p_user,p_uni,plan,p_request,p_reference) returning * into existing;
  return existing;
end; $$;
create function app_private.record_kira_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare checkout app_private.kira_checkouts%rowtype; period_start timestamptz; period_end timestamptz; journal uuid;
begin
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference;
  if not found then return 'UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||checkout.user_id::text,0));
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference for update;
  perform app_private.record_verified_paystack_receipt(checkout.university_id,p_reference,'KIRA_SUBSCRIPTION',checkout.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.kira_billing_periods where checkout_id=checkout.id) then return 'ALREADY_PAID'; end if;
  if p_amount<>checkout.amount_kobo or checkout.status not in ('CREATED','INITIALIZED') or checkout.expires_at<=now() then
    update app_private.kira_checkouts set status='REQUIRES_REVIEW' where id=checkout.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now()
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select greatest(now(),case when status='ACTIVE' then current_period_end else now() end) into period_start from app_private.ai_subscriptions where user_id=checkout.user_id;
  period_start=coalesce(period_start,now());period_end=period_start+interval '1 month';
  journal=app_private.post_finance_journal(checkout.university_id,'KIRA_SUBSCRIPTION',checkout.id::text,'kira-payment:'||p_reference,'Verified fixed-price monthly Kira access',jsonb_build_array(
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount),
    jsonb_build_object('code','KIRA_SUBSCRIPTION_REVENUE','type','REVENUE','direction','CREDIT','amount',p_amount)));
  insert into app_private.kira_billing_periods(checkout_id,user_id,starts_at,ends_at,provider_reference,journal_id)
    values(checkout.id,checkout.user_id,period_start,period_end,p_reference,journal);
  insert into app_private.ai_subscriptions(user_id,status,current_period_end,billing_reference)
    values(checkout.user_id,'ACTIVE',period_end,p_reference) on conflict(user_id) do update
      set status='ACTIVE',current_period_end=excluded.current_period_end,billing_reference=excluded.billing_reference,updated_at=now();
  update app_private.kira_checkouts set status='PAID',paid_at=p_paid_at where id=checkout.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $$;
revoke all on app_private.kira_price_plans,app_private.active_kira_price_plans,app_private.kira_checkouts,app_private.kira_billing_periods from public;
revoke all on function app_private.create_kira_checkout(uuid,uuid,uuid,uuid,text),app_private.record_kira_receipt(text,bigint,bigint,timestamptz),app_private.guard_kira_checkout() from public;
commit;
