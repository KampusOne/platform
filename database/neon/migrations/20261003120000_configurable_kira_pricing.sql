begin;
-- A new approval changes only the active pointer. Existing price plans, payment
-- intents, receipts and paid months retain their original financial snapshots.
alter table app_private.kira_price_plans
  add column listed_amount_kobo integer not null default 600000,
  add column discount_percent integer not null default 0,
  drop constraint kira_price_plans_amount_kobo_check,
  drop constraint kira_price_plans_estimated_processing_kobo_check,
  add constraint kira_price_plans_listed_range check(listed_amount_kobo between 100000 and 100000000),
  add constraint kira_price_plans_discount_range check(discount_percent between 0 and 90),
  add constraint kira_price_plans_offer_amount check(amount_kobo=listed_amount_kobo-(listed_amount_kobo::bigint*discount_percent/100)),
  add constraint kira_price_plans_processing_net check(estimated_processing_kobo>=0 and estimated_processing_kobo<amount_kobo);
alter table app_private.kira_checkouts
  add column offer_discount_percent integer not null default 0,
  drop constraint kira_checkouts_amount_kobo_check,
  add constraint kira_checkouts_amount_range check(amount_kobo between 10000 and 100000000 and listed_amount_kobo>=amount_kobo),
  add constraint kira_checkouts_offer_discount_range check(offer_discount_percent between 0 and 90);

create or replace function app_private.guard_kira_checkout() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.user_id,new.university_id,new.plan_id,new.request_id,new.provider_reference,new.amount_kobo,new.discount_id,new.listed_amount_kobo,new.offer_discount_percent) is distinct from
     (old.id,old.user_id,old.university_id,old.plan_id,old.request_id,old.provider_reference,old.amount_kobo,old.discount_id,old.listed_amount_kobo,old.offer_discount_percent)
     or (old.status='PAID' and new.status<>'PAID') then raise exception 'KIRA_CHECKOUT_SNAPSHOT_IMMUTABLE'; end if;
  return new;
end $$;

create or replace function app_private.create_discounted_kira_checkout(p_id uuid,p_user uuid,p_uni uuid,p_request uuid,p_reference text,p_code text)
returns app_private.kira_checkouts language plpgsql set search_path='' as $$
declare existing app_private.kira_checkouts; plan app_private.kira_price_plans; discount app_private.discount_codes; savings integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||p_user::text,0));
  select * into existing from app_private.kira_checkouts where user_id=p_user and request_id=p_request;
  if found then
    if existing.university_id<>p_uni then raise exception 'BUYER_TENANT_MISMATCH'; end if;
    if coalesce((select code from app_private.discount_codes where id=existing.discount_id),'')<>coalesce(p_code,'') then raise exception 'DISCOUNT_REQUEST_CONFLICT'; end if;
    return existing;
  end if;
  if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) then raise exception 'BUYER_TENANT_MISMATCH'; end if;
  if exists(select 1 from app_private.ai_subscriptions where user_id=p_user and status='ACTIVE' and current_period_end>now()+interval '7 days') then raise exception 'KIRA_ALREADY_ACTIVE'; end if;
  select p.* into plan from app_private.active_kira_price_plans a join app_private.kira_price_plans p on p.id=a.plan_id and p.university_id=a.university_id where a.university_id=p_uni;
  if not found then raise exception 'KIRA_PLAN_UNAVAILABLE'; end if;
  update app_private.kira_checkouts set status='EXPIRED' where user_id=p_user and status in('CREATED','INITIALIZED') and expires_at<=now();
  select * into existing from app_private.kira_checkouts k where k.user_id=p_user and k.university_id=p_uni and k.status in('CREATED','INITIALIZED')
    and coalesce((select code from app_private.discount_codes where id=k.discount_id),'')=coalesce(p_code,'') order by created_at desc limit 1;
  if found then return existing; end if;
  if exists(select 1 from app_private.kira_checkouts where user_id=p_user and status in('CREATED','INITIALIZED')) then raise exception 'KIRA_CHECKOUT_ALREADY_ACTIVE'; end if;
  if coalesce(p_code,'')<>'' then
    if plan.discount_percent>0 then raise exception 'DISCOUNT_CANNOT_COMBINE'; end if;
    select * into discount from app_private.discount_codes where institution_id=p_uni and code=p_code and scope='KIRA' and active and now()>=starts_at and now()<ends_at for update;
    if not found then raise exception 'DISCOUNT_UNAVAILABLE'; end if;
    if (select count(*) from app_private.discount_redemptions where discount_id=discount.id and (redeemed_at is not null or expires_at>now()))>=discount.max_uses or
       (select count(*) from app_private.discount_redemptions where discount_id=discount.id and user_id=p_user and (redeemed_at is not null or expires_at>now()))>=discount.per_user_limit then raise exception 'DISCOUNT_EXHAUSTED'; end if;
    savings=(plan.amount_kobo::bigint*discount.percent/100)::integer;
  end if;
  insert into app_private.kira_checkouts(id,user_id,university_id,plan_id,request_id,provider_reference,amount_kobo,listed_amount_kobo,offer_discount_percent,discount_id)
    values(p_id,p_user,p_uni,plan.id,p_request,p_reference,plan.amount_kobo-savings,plan.listed_amount_kobo,plan.discount_percent,discount.id) returning * into existing;
  if savings>0 then insert into app_private.discount_redemptions(purchase_id,discount_id,user_id,scope,discount_kobo,expires_at)
    values(p_id,discount.id,p_user,'KIRA',savings,existing.expires_at); end if;
  return existing;
end $$;

-- The older entry point uses the same active-price and locking rules.
create or replace function app_private.create_kira_checkout(p_id uuid,p_user uuid,p_uni uuid,p_request uuid,p_reference text)
returns app_private.kira_checkouts language sql set search_path='' as $$
  select app_private.create_discounted_kira_checkout(p_id,p_user,p_uni,p_request,p_reference,'');
$$;
revoke all on function app_private.guard_kira_checkout(),app_private.create_kira_checkout(uuid,uuid,uuid,uuid,text),app_private.create_discounted_kira_checkout(uuid,uuid,uuid,uuid,text,text) from public;
commit;
