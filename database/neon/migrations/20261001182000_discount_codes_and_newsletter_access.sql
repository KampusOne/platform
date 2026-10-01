begin;
create table if not exists app_private.discount_codes(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.universities(id),code text not null check(code~'^[A-Z0-9_-]{3,32}$'),
 scope text not null check(scope in('KIRA','STORE','TUTORIAL','MATERIAL')),percent integer not null check(percent between 1 and 90),
 starts_at timestamptz not null default now(),ends_at timestamptz not null,max_uses integer not null check(max_uses between 1 and 100000),
 per_user_limit integer not null default 1 check(per_user_limit between 1 and 20),active boolean not null default true,created_by uuid not null references public.users(id),
 created_at timestamptz not null default now(),unique(institution_id,code),check(ends_at>starts_at)
);
create table if not exists app_private.discount_redemptions(
 purchase_id uuid primary key,discount_id uuid not null references app_private.discount_codes(id),user_id uuid not null references public.users(id),scope text not null,
 discount_kobo bigint not null check(discount_kobo>0),expires_at timestamptz not null,redeemed_at timestamptz,created_at timestamptz not null default now()
);
create index if not exists discount_redemption_usage on app_private.discount_redemptions(discount_id,user_id);
alter table app_private.discount_codes enable row level security;
alter table app_private.discount_redemptions enable row level security;
alter table app_private.kira_checkouts add column if not exists discount_id uuid references app_private.discount_codes(id);
alter table app_private.kira_checkouts add column if not exists listed_amount_kobo integer not null default 600000;
alter table app_private.kira_checkouts drop constraint if exists kira_checkouts_amount_kobo_check;
alter table app_private.kira_checkouts add constraint kira_checkouts_amount_kobo_check check(amount_kobo between 60000 and 600000);
create or replace function app_private.guard_kira_checkout() returns trigger language plpgsql set search_path='' as $$
begin
 if(new.id,new.user_id,new.university_id,new.plan_id,new.request_id,new.provider_reference,new.amount_kobo,new.discount_id,new.listed_amount_kobo) is distinct from
 (old.id,old.user_id,old.university_id,old.plan_id,old.request_id,old.provider_reference,old.amount_kobo,old.discount_id,old.listed_amount_kobo) or (old.status='PAID' and new.status<>'PAID') then raise exception 'KIRA_CHECKOUT_SNAPSHOT_IMMUTABLE';end if;return new;
end $$;
create or replace function app_private.create_discounted_kira_checkout(p_id uuid,p_user uuid,p_uni uuid,p_request uuid,p_reference text,p_code text)
returns app_private.kira_checkouts language plpgsql set search_path='' as $$
declare existing app_private.kira_checkouts; plan uuid; discount app_private.discount_codes; savings integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||p_user::text,0));
 select * into existing from app_private.kira_checkouts where user_id=p_user and request_id=p_request;
 if found then
  if coalesce((select code from app_private.discount_codes where id=existing.discount_id),'')<>coalesce(p_code,'') then raise exception 'DISCOUNT_REQUEST_CONFLICT';end if;
  return existing;
 end if;
 if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) then raise exception 'BUYER_TENANT_MISMATCH';end if;
 if exists(select 1 from app_private.ai_subscriptions where user_id=p_user and status='ACTIVE' and current_period_end>now()+interval '7 days') then raise exception 'KIRA_ALREADY_ACTIVE';end if;
 select plan_id into plan from app_private.active_kira_price_plans where university_id=p_uni;if plan is null then raise exception 'KIRA_PLAN_UNAVAILABLE';end if;
 update app_private.kira_checkouts set status='EXPIRED' where user_id=p_user and status in('CREATED','INITIALIZED') and expires_at<=now();
 select * into existing from app_private.kira_checkouts k where k.user_id=p_user and k.university_id=p_uni and k.status in('CREATED','INITIALIZED') and coalesce((select code from app_private.discount_codes where id=k.discount_id),'')=coalesce(p_code,'') order by created_at desc limit 1;
 if found then return existing;end if;
 if exists(select 1 from app_private.kira_checkouts where user_id=p_user and status in('CREATED','INITIALIZED')) then raise exception 'KIRA_CHECKOUT_ALREADY_ACTIVE';end if;
 if coalesce(p_code,'')<>'' then
  select * into discount from app_private.discount_codes where institution_id=p_uni and code=p_code and scope='KIRA' and active and now()>=starts_at and now()<ends_at for update;
  if not found then raise exception 'DISCOUNT_UNAVAILABLE';end if;
  if (select count(*) from app_private.discount_redemptions where discount_id=discount.id and (redeemed_at is not null or expires_at>now()))>=discount.max_uses or
    (select count(*) from app_private.discount_redemptions where discount_id=discount.id and user_id=p_user and (redeemed_at is not null or expires_at>now()))>=discount.per_user_limit then raise exception 'DISCOUNT_EXHAUSTED';end if;
  savings=600000*discount.percent/100;
 end if;
 insert into app_private.kira_checkouts(id,user_id,university_id,plan_id,request_id,provider_reference,amount_kobo,discount_id) values(p_id,p_user,p_uni,plan,p_request,p_reference,600000-savings,discount.id) returning * into existing;
 if savings>0 then insert into app_private.discount_redemptions(purchase_id,discount_id,user_id,scope,discount_kobo,expires_at) values(p_id,discount.id,p_user,'KIRA',savings,existing.expires_at);end if;
 return existing;
end $$;
create or replace function app_private.redeem_kira_discount() returns trigger language plpgsql set search_path='' as $$
begin if NEW.status='PAID' and OLD.status is distinct from NEW.status then update app_private.discount_redemptions set redeemed_at=NEW.paid_at where purchase_id=NEW.id and redeemed_at is null;end if;return NEW;end $$;
create or replace trigger kira_discount_paid after update on app_private.kira_checkouts for each row execute function app_private.redeem_kira_discount();
-- Explicit existing account IDs, verified from production. A copied name cannot acquire access.
insert into app_private.managed_publishers(user_id,institution_id,all_universities,active,daily_limit,reviewed_by,reason)
select p.user_id,p.university_id,false,true,4,owner.id,'Authorised by owner for the October 1 correction release, complaint 97.' from public.profiles p cross join public.users owner where p.user_id='7bf5d47d-1c36-49ff-b66c-392bc4e91484' and p.username='kampusone_newsletter' and p.deleted_at is null and lower(owner.email)='igiehongideon864@gmail.com' and owner.deleted_at is null on conflict(user_id) do update set active=true,reviewed_by=excluded.reviewed_by,reason=excluded.reason,updated_at=now();
insert into app_private.publishing_capabilities(user_id,institution_id,capability,granted_by,reason)
select p.user_id,p.university_id,v.capability,owner.id,'Authorised October 1 correction release, complaint 97.' from public.profiles p cross join public.users owner cross join(values('POLL'),('QA'),('ANONYMOUS_QA'))v(capability) where p.user_id='7bf5d47d-1c36-49ff-b66c-392bc4e91484' and p.username='kampusone_newsletter' and p.deleted_at is null and lower(owner.email)='igiehongideon864@gmail.com' and owner.deleted_at is null on conflict(user_id,institution_id,capability) do update set revoked_at=null,reason=excluded.reason,granted_by=excluded.granted_by;
insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata)
select owner.id,p.university_id,'publisher.release-access.granted','user',p.user_id::text,'succeeded','{"complaint":97,"release":"2026-10-01"}'::jsonb from public.profiles p cross join public.users owner where p.user_id='7bf5d47d-1c36-49ff-b66c-392bc4e91484' and lower(owner.email)='igiehongideon864@gmail.com' and not exists(select 1 from app_private.audit_events where action='publisher.release-access.granted' and target_id=p.user_id::text and metadata->>'release'='2026-10-01');
revoke all on app_private.discount_codes,app_private.discount_redemptions from public;
revoke all on function app_private.create_discounted_kira_checkout(uuid,uuid,uuid,uuid,text,text) from public;
commit;
