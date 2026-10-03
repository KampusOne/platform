begin;
-- Existing approvals, checkout amounts and paid periods remain Pro snapshots.
alter table app_private.kira_price_plans
  add column tier text not null default 'pro' check(tier in ('standard','pro')),
  add column plan_name text not null default 'Kira Pro',
  add column billing_period text not null default 'MONTHLY' check(billing_period='MONTHLY'),
  add column available boolean not null default true,
  add column active_status boolean not null default true,
  add column offer_active boolean not null default true,
  add column offer_starts_at timestamptz,
  add column offer_ends_at timestamptz,
  add column included_capabilities jsonb not null default '["Ask Kira","Study tools","Academic imports"]'::jsonb,
  add column limits jsonb not null default '{"studyPerMonth":100,"chatPerWindow":60,"importsPerWeek":30}'::jsonb,
  add column model_access text not null default 'pro' check(model_access in ('standard','pro')),
  add column feature_flags jsonb not null default '{}'::jsonb,
  drop constraint kira_price_plans_listed_range,
  drop constraint kira_price_plans_processing_net,
  add constraint kira_plan_listed_range check((tier='standard' and listed_amount_kobo=0) or listed_amount_kobo between 100000 and 100000000),
  add constraint kira_plan_processing_net check(estimated_processing_kobo>=0 and ((amount_kobo=0 and estimated_processing_kobo=0) or estimated_processing_kobo<amount_kobo)),
  add constraint kira_plan_free_discount check(listed_amount_kobo>0 or discount_percent=0),
  add constraint kira_plan_schedule check(offer_starts_at is null or offer_ends_at is null or offer_ends_at>offer_starts_at),
  add constraint kira_plan_model_tier check(model_access=tier),
  add constraint kira_plan_capabilities_shape check(jsonb_typeof(included_capabilities)='array' and jsonb_typeof(limits)='object' and jsonb_typeof(feature_flags)='object');
alter table app_private.active_kira_price_plans
  add column tier text not null default 'pro' check(tier in ('standard','pro')),
  drop constraint active_kira_price_plans_pkey,
  add primary key(university_id,tier);
alter table app_private.kira_price_plans add unique(id,university_id,tier);
alter table app_private.active_kira_price_plans add foreign key(plan_id,university_id,tier) references app_private.kira_price_plans(id,university_id,tier);
alter table app_private.ai_subscriptions add column tier text not null default 'pro' check(tier in ('standard','pro'));
alter table app_private.kira_billing_periods add column tier text not null default 'pro' check(tier in ('standard','pro'));
alter table app_private.kira_checkouts add column tier text not null default 'pro' check(tier in ('standard','pro'));

-- Free Standard is an explicit separate product; migration never makes it paid.
with seeded as (
  insert into app_private.kira_price_plans(id,university_id,version,tier,plan_name,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url,model_access,limits,included_capabilities,offer_active)
  select gen_random_uuid(),a.university_id,'2026-10-03-free-standard','standard','Kira Standard',0,0,0,p.collection,0,p.approved_by,
    'Preserve the existing free Standard core experience. A later explicit admin approval is required to configure a paid Standard plan.',p.source_url,'standard',
    '{"studyTrials":5,"chatPerWindow":15,"importsPerWeek":5}'::jsonb,'["Ask Kira","Manual academic tools","Standard study trials"]'::jsonb,false
  from app_private.active_kira_price_plans a join app_private.kira_price_plans p on p.id=a.plan_id where a.tier='pro'
  returning id,university_id,tier
) insert into app_private.active_kira_price_plans(university_id,tier,plan_id) select university_id,tier,id from seeded;

create table app_private.kira_subscription_quotes(
  id uuid primary key,user_id uuid not null references public.users(id),university_id uuid not null references public.universities(id),
  request_id uuid not null,plan_id uuid not null references app_private.kira_price_plans(id),tier text not null check(tier in ('standard','pro')),
  plan_version text not null,listed_amount_kobo integer not null,amount_kobo integer not null check(amount_kobo between 10000 and 100000000),
  offer_discount_percent integer not null check(offer_discount_percent between 0 and 90),coupon_discount_percent integer not null check(coupon_discount_percent between 0 and 90),
  discount_id uuid references app_private.discount_codes(id),discount_code text not null default '',
  estimated_processing_kobo integer not null check(estimated_processing_kobo>=0),collection jsonb not null,
  created_at timestamptz not null default now(),expires_at timestamptz not null,
  unique(user_id,request_id),check(expires_at>created_at),check(listed_amount_kobo>=amount_kobo),
  check(offer_discount_percent=0 or coupon_discount_percent=0),
  check(amount_kobo=listed_amount_kobo-(listed_amount_kobo::bigint*(offer_discount_percent+coupon_discount_percent)/100))
);
create trigger kira_subscription_quotes_append_only before update or delete on app_private.kira_subscription_quotes for each row execute function app_private.prevent_append_only_mutation();
alter table app_private.kira_subscription_quotes enable row level security;
alter table app_private.kira_checkouts add column quote_id uuid unique references app_private.kira_subscription_quotes(id);

create function app_private.kira_effective_discount(p app_private.kira_price_plans,p_at timestamptz default now()) returns integer language sql stable set search_path='' as $$
  select case when p.offer_active and (p.offer_starts_at is null or p_at>=p.offer_starts_at) and (p.offer_ends_at is null or p_at<p.offer_ends_at) then p.discount_percent else 0 end;
$$;
create function app_private.quote_kira_subscription(p_id uuid,p_user uuid,p_uni uuid,p_request uuid,p_tier text,p_code text)
returns app_private.kira_subscription_quotes language plpgsql set search_path='' as $$
declare q app_private.kira_subscription_quotes; p app_private.kira_price_plans; d app_private.discount_codes;
  offer integer; coupon integer:=0; amount integer; expiry timestamptz:=now()+interval '10 minutes'; fee bigint; normalized text:=upper(trim(coalesce(p_code,'')));
begin
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||p_user::text,0));
  select * into q from app_private.kira_subscription_quotes where user_id=p_user and request_id=p_request;
  if found then
    if (q.university_id,q.tier,q.discount_code) is distinct from (p_uni,p_tier,normalized) then raise exception 'KIRA_QUOTE_REQUEST_CONFLICT'; end if;
    if q.expires_at<=now() then raise exception 'KIRA_QUOTE_EXPIRED'; end if;
    return q;
  end if;
  if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) then raise exception 'BUYER_TENANT_MISMATCH'; end if;
  select p0.* into p from app_private.active_kira_price_plans a join app_private.kira_price_plans p0 on p0.id=a.plan_id and p0.university_id=a.university_id and p0.tier=a.tier where a.university_id=p_uni and a.tier=p_tier;
  if not found or not p.available or not p.active_status then raise exception 'KIRA_PLAN_UNAVAILABLE'; end if;
  if p.listed_amount_kobo=0 then raise exception 'KIRA_STANDARD_FREE'; end if;
  offer=app_private.kira_effective_discount(p);
  -- The quote ends before the next scheduled change; a coupon cannot leak over
  -- the start of an automatic offer or combine with an active offer.
  if p.offer_active and p.offer_starts_at>now() then expiry=least(expiry,p.offer_starts_at); end if;
  if p.offer_active and p.offer_ends_at>now() then expiry=least(expiry,p.offer_ends_at); end if;
  if normalized<>'' then
    if offer>0 then raise exception 'DISCOUNT_CANNOT_COMBINE'; end if;
    select * into d from app_private.discount_codes where institution_id=p_uni and code=normalized and scope='KIRA' and active and now()>=starts_at and now()<ends_at for update;
    if not found then raise exception 'DISCOUNT_UNAVAILABLE'; end if;
    if (select count(*) from app_private.discount_redemptions where discount_id=d.id and (redeemed_at is not null or expires_at>now()))>=d.max_uses or
      (select count(*) from app_private.discount_redemptions where discount_id=d.id and user_id=p_user and (redeemed_at is not null or expires_at>now()))>=d.per_user_limit then raise exception 'DISCOUNT_EXHAUSTED'; end if;
    coupon=d.percent;expiry=least(expiry,d.ends_at);
  end if;
  amount=p.listed_amount_kobo-(p.listed_amount_kobo::bigint*(offer+coupon)/100)::integer;
  fee=ceil(amount::numeric*coalesce((p.collection->>'basisPoints')::integer,0)/10000)+case when amount<coalesce((p.collection->>'flatWaivedBelowKobo')::integer,0) then 0 else coalesce((p.collection->>'flatKobo')::integer,0) end;
  if p.collection->>'capKobo' is not null then fee=least(fee,(p.collection->>'capKobo')::bigint); end if;
  insert into app_private.kira_subscription_quotes(id,user_id,university_id,request_id,plan_id,tier,plan_version,listed_amount_kobo,amount_kobo,offer_discount_percent,coupon_discount_percent,discount_id,discount_code,estimated_processing_kobo,collection,expires_at)
    values(p_id,p_user,p_uni,p_request,p.id,p_tier,p.version,p.listed_amount_kobo,amount,offer,coupon,d.id,normalized,fee,p.collection,expiry) returning * into q;
  if coupon>0 then insert into app_private.discount_redemptions(purchase_id,discount_id,user_id,scope,discount_kobo,expires_at) values(q.id,d.id,p_user,'KIRA',q.listed_amount_kobo-q.amount_kobo,q.expires_at); end if;
  return q;
end $$;

create function app_private.create_quoted_kira_checkout(p_user uuid,p_uni uuid,p_request uuid,p_reference text,p_quote uuid,p_tier text,p_expected integer)
returns app_private.kira_checkouts language plpgsql set search_path='' as $$
declare k app_private.kira_checkouts; q app_private.kira_subscription_quotes; p app_private.kira_price_plans;
begin
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||p_user::text,0));
  select * into k from app_private.kira_checkouts where user_id=p_user and request_id=p_request;
  if found then
    if (k.university_id,k.quote_id,k.tier,k.amount_kobo) is distinct from (p_uni,p_quote,p_tier,p_expected) then raise exception 'KIRA_QUOTE_REQUEST_CONFLICT'; end if;
    if k.expires_at<=now() and k.status in ('CREATED','INITIALIZED') then raise exception 'KIRA_QUOTE_EXPIRED'; end if;
    if k.status<>'CREATED' then return k; end if;
  end if;
  if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) then raise exception 'BUYER_TENANT_MISMATCH'; end if;
  select * into q from app_private.kira_subscription_quotes where id=p_quote and user_id=p_user and university_id=p_uni and tier=p_tier;
  if not found then raise exception 'KIRA_QUOTE_UNAVAILABLE'; end if;
  if q.expires_at<=now() then raise exception 'KIRA_QUOTE_EXPIRED'; end if;
  if q.amount_kobo<>p_expected then raise exception 'KIRA_PRICE_CHANGED'; end if;
  select p0.* into p from app_private.active_kira_price_plans a join app_private.kira_price_plans p0 on p0.id=a.plan_id where a.university_id=p_uni and a.tier=p_tier;
  if not found or not p.available or not p.active_status or p.id<>q.plan_id or app_private.kira_effective_discount(p)<>q.offer_discount_percent then raise exception 'KIRA_PRICE_CHANGED'; end if;
  if q.discount_id is not null and not exists(select 1 from app_private.discount_codes where id=q.discount_id and active and now()>=starts_at and now()<ends_at and percent=q.coupon_discount_percent) then raise exception 'KIRA_PRICE_CHANGED'; end if;
  if exists(select 1 from app_private.ai_subscriptions where user_id=p_user and status='ACTIVE' and current_period_end>now()+interval '7 days') then raise exception 'KIRA_ALREADY_ACTIVE'; end if;
  if k.id is not null then return k; end if;
  update app_private.kira_checkouts set status='EXPIRED' where user_id=p_user and status in ('CREATED','INITIALIZED') and expires_at<=now();
  if exists(select 1 from app_private.kira_checkouts where user_id=p_user and status in ('CREATED','INITIALIZED')) then raise exception 'KIRA_CHECKOUT_ALREADY_ACTIVE'; end if;
  insert into app_private.kira_checkouts(id,user_id,university_id,plan_id,tier,request_id,provider_reference,quote_id,amount_kobo,listed_amount_kobo,offer_discount_percent,discount_id,expires_at)
    values(q.id,p_user,p_uni,q.plan_id,q.tier,p_request,p_reference,q.id,q.amount_kobo,q.listed_amount_kobo,q.offer_discount_percent,q.discount_id,q.expires_at) returning * into k;
  return k;
end $$;

create or replace function app_private.guard_kira_checkout() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.user_id,new.university_id,new.plan_id,new.request_id,new.provider_reference,new.amount_kobo,new.discount_id,new.listed_amount_kobo,new.offer_discount_percent,new.tier,new.quote_id) is distinct from
     (old.id,old.user_id,old.university_id,old.plan_id,old.request_id,old.provider_reference,old.amount_kobo,old.discount_id,old.listed_amount_kobo,old.offer_discount_percent,old.tier,old.quote_id)
    or (old.status='PAID' and new.status<>'PAID') then raise exception 'KIRA_CHECKOUT_SNAPSHOT_IMMUTABLE'; end if;
  return new;
end $$;
-- Existing private callers remain Pro, but all newly created payments still use
-- the same persisted pricing and coupon reservation path.
create or replace function app_private.create_discounted_kira_checkout(p_id uuid,p_user uuid,p_uni uuid,p_request uuid,p_reference text,p_code text)
returns app_private.kira_checkouts language plpgsql set search_path='' as $$
declare q app_private.kira_subscription_quotes; k app_private.kira_checkouts;
begin
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||p_user::text,0));
  select * into k from app_private.kira_checkouts where user_id=p_user and request_id=p_request;
  if found then
    if k.university_id<>p_uni or coalesce((select code from app_private.discount_codes where id=k.discount_id),'')<>upper(trim(coalesce(p_code,''))) then raise exception 'KIRA_QUOTE_REQUEST_CONFLICT'; end if;
    return k;
  end if;
  q=app_private.quote_kira_subscription(p_id,p_user,p_uni,p_request,'pro',p_code);
  return app_private.create_quoted_kira_checkout(p_user,p_uni,p_request,p_reference,q.id,'pro',q.amount_kobo);
end $$;

create or replace function app_private.record_kira_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare checkout app_private.kira_checkouts; period_start timestamptz; period_end timestamptz; journal uuid;
begin
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference;
  if not found then return 'UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||checkout.user_id::text,0));
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference for update;
  perform app_private.record_verified_paystack_receipt(checkout.university_id,p_reference,'KIRA_SUBSCRIPTION',checkout.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.kira_billing_periods where checkout_id=checkout.id) then return 'ALREADY_PAID'; end if;
  if p_amount<>checkout.amount_kobo or checkout.status not in ('CREATED','INITIALIZED') or checkout.expires_at<=now() then
    update app_private.kira_checkouts set status='REQUIRES_REVIEW' where id=checkout.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select greatest(now(),case when status='ACTIVE' then current_period_end else now() end) into period_start from app_private.ai_subscriptions where user_id=checkout.user_id;
  period_start=coalesce(period_start,now());period_end=period_start+interval '1 month';
  journal=app_private.post_finance_journal(checkout.university_id,'KIRA_SUBSCRIPTION',checkout.id::text,'kira-payment:'||p_reference,'Verified monthly Kira '||checkout.tier||' access',jsonb_build_array(
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount),jsonb_build_object('code','KIRA_SUBSCRIPTION_REVENUE','type','REVENUE','direction','CREDIT','amount',p_amount)));
  insert into app_private.kira_billing_periods(checkout_id,user_id,starts_at,ends_at,provider_reference,journal_id,tier) values(checkout.id,checkout.user_id,period_start,period_end,p_reference,journal,checkout.tier);
  insert into app_private.ai_subscriptions(user_id,status,current_period_end,billing_reference,tier) values(checkout.user_id,'ACTIVE',period_end,p_reference,checkout.tier)
    on conflict(user_id) do update set status='ACTIVE',current_period_end=excluded.current_period_end,billing_reference=excluded.billing_reference,tier=excluded.tier,updated_at=now();
  update app_private.kira_checkouts set status='PAID',paid_at=p_paid_at where id=checkout.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end $$;
revoke all on app_private.kira_subscription_quotes from public;
revoke all on function app_private.kira_effective_discount(app_private.kira_price_plans,timestamptz),app_private.quote_kira_subscription(uuid,uuid,uuid,uuid,text,text),app_private.create_quoted_kira_checkout(uuid,uuid,uuid,text,uuid,text,integer) from public;
commit;
