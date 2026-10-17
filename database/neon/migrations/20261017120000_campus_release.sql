begin;
set local lock_timeout='5s';
-- Role suspension is independent for each approved agent profile.
alter table public.agent_profiles add column if not exists suspension_ends_at timestamptz;
alter table public.agent_profiles add column if not exists suspension_reason text;

-- Half-star reviews retain the original 1..5 bounds.
do $$ begin
 if to_regclass('public.product_reviews') is not null then
  alter table public.product_reviews alter column rating type numeric(2,1) using rating::numeric;
  if not exists(select 1 from pg_constraint where conname='product_reviews_half_star_check' and conrelid='public.product_reviews'::regclass)then
  alter table public.product_reviews add constraint product_reviews_half_star_check check(rating*2=trunc(rating*2));end if;
 end if;
 if to_regclass('public.tutorial_reviews') is not null then
  alter table public.tutorial_reviews alter column rating type numeric(2,1) using rating::numeric;
  if not exists(select 1 from pg_constraint where conname='tutorial_reviews_half_star_check' and conrelid='public.tutorial_reviews'::regclass)then
  alter table public.tutorial_reviews add constraint tutorial_reviews_half_star_check check(rating*2=trunc(rating*2));end if;
 end if;
end;$$;

create table if not exists app_private.ai_document_pages (
  user_id uuid not null references public.users(id),
  media_id uuid not null references public.media_objects(id),
  page_number integer not null check(page_number between 1 and 300),
  content_hash text not null,
  status text not null check(status in ('PROCESSING','COMPLETED','FAILED')),
  extracted_text text,
  updated_at timestamptz not null default now(),
  primary key(user_id,media_id,page_number)
);
revoke all on app_private.ai_document_pages from public;

alter table public.tutorial_resources drop constraint if exists tutorial_resources_resource_type_check;
alter table public.tutorial_resources add constraint tutorial_resources_resource_type_check check(resource_type in('PDF','NOTE','PAST_QUESTION','AUDIOBOOK','VIDEO'));
alter table public.tutorial_resources add column if not exists cover_url text;
alter table public.tutorial_resources add column if not exists publish_fingerprint text;
alter table public.tutorial_resources add column if not exists subject text not null default 'General studies';
alter table public.tutorial_resources add column if not exists client_request_id uuid;
alter table public.tutorial_resources add column if not exists parts jsonb not null default '[]';
create unique index if not exists tutorial_resource_publish_request on public.tutorial_resources(tutor_profile_id,client_request_id) where client_request_id is not null;
create table if not exists public.learning_saves (
  user_id uuid not null references public.users(id),
  resource_id uuid not null references public.tutorial_resources(id),
  created_at timestamptz not null default now(),
  primary key(user_id,resource_id)
);
revoke all on public.learning_saves from public;

alter table public.direct_threads add column if not exists suspended_until timestamptz;
create table if not exists app_private.chat_contact_violations (
  message_id uuid primary key,
  thread_id uuid not null references public.direct_threads(id),
  actor_id uuid not null references public.users(id),
  content_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on app_private.chat_contact_violations from public;

-- This is a new policy value for future quotes; settled ledger entries and
-- previously accepted withdrawal quotes remain immutable.

do $$ declare policy record; new_id uuid; desired bigint; begin
 if to_regclass('app_private.payout_cost_policies') is null then return;end if;
 for policy in select p.* from app_private.active_payout_cost_policies a join app_private.payout_cost_policies p on p.id=a.policy_id loop
  desired=case when policy.agent_type='RIDER' then 200000 else 500000 end;
  if policy.minimum_withdrawal_kobo=desired then continue;end if;
  new_id=gen_random_uuid();
  insert into app_private.payout_cost_policies select (jsonb_populate_record(null::app_private.payout_cost_policies,to_jsonb(policy)||jsonb_build_object('id',new_id,'version',policy.version||'-minimum-20261017','minimum_withdrawal_kobo',desired,'approval_note','Campus release: minimum withdrawal updated by authorized product instruction; original cost and commission policy preserved.','approved_at',now()))).*;
  update app_private.active_payout_cost_policies set policy_id=new_id where university_id=policy.university_id and agent_type=policy.agent_type;
 end loop;
end; $$;

create table if not exists app_private.order_vendor_allocations(
 order_id uuid not null references public.orders(id),vendor_profile_id uuid not null references public.agent_profiles(id),
 vendor_user_id uuid not null references public.users(id),seller_net_kobo bigint not null check(seller_net_kobo>=0),
 listed_items_kobo bigint not null check(listed_items_kobo>=0),status text not null default 'PAID' check(status in('PAID','ACCEPTED','READY')),ready_at timestamptz,
 primary key(order_id,vendor_profile_id)
);
revoke all on app_private.order_vendor_allocations from public;
create table if not exists public.commerce_pickup_hubs(
 university_id uuid not null references public.universities(id),name text not null,position integer not null,
 primary key(university_id,name)
);
revoke all on public.commerce_pickup_hubs from public;
insert into public.commerce_pickup_hubs(university_id,name,position)
 select u.id,h.name,h.position from public.universities u cross join(values('Engineering',1),('June 12',2),('Anatomy back gate',3),('Main gate',4),('Ekosodin back gate',5))h(name,position)
 where u.slug='uniben' or lower(u.name)='university of benin' on conflict do nothing;
alter table if exists public.vendor_storefronts add column if not exists pickup_locations jsonb not null default '[]';


alter table public.student_groups add column if not exists cover_media_id uuid references public.media_objects(id);

create or replace function app_private.create_product_review(
  p_review_id uuid,
  p_order_id uuid,
  p_product_id uuid,
  p_buyer_user_id uuid,
  p_rating numeric,
  p_body text
)
returns table (id uuid, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  purchase record;
begin
  select orders.university_id into purchase
  from public.orders orders
  join public.order_items items
    on items.order_id = orders.id and items.product_id = p_product_id
  where orders.id = p_order_id
    and orders.buyer_user_id = p_buyer_user_id
    and orders.status = 'DELIVERED'
  for key share of orders;

  if not found then
    raise exception using errcode = 'P0002', message = 'VERIFIED_PURCHASE_REQUIRED';
  end if;

  return query
  insert into public.product_reviews (
    id, university_id, order_id, product_id, buyer_user_id, rating, body
  ) values (
    p_review_id, purchase.university_id, p_order_id, p_product_id,
    p_buyer_user_id, p_rating, p_body
  )
  on conflict (order_id, product_id) do nothing
  returning product_reviews.id, product_reviews.university_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_ALREADY_REVIEWED';
  end if;
end;
$$;

revoke all on function app_private.create_product_review(uuid,uuid,uuid,uuid,numeric,text)from public;

commit;
