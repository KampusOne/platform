begin;

-- Policies are append-only. A later effective version supersedes an older one;
-- every checkout retains the exact calculation it accepted. No guessed rates.
create table public.fee_rules (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.universities(id),
  fee_type text not null check(fee_type in ('TUTOR_COMMISSION','BUYER_SERVICE','WITHDRAWAL','RIDER_COMMISSION','DELIVERY')),
  version text not null check(length(version) between 3 and 80),
  effective_at timestamptz not null,
  flat_kobo integer not null check(flat_kobo between 0 and 10000000),
  basis_points integer not null check(basis_points between 0 and 10000),
  minimum_kobo integer not null default 0 check(minimum_kobo >= 0),
  maximum_kobo integer check(maximum_kobo >= minimum_kobo),
  zone_id uuid references public.delivery_zones(id),
  bands jsonb not null default '[]'::jsonb check(jsonb_typeof(bands)='array'),
  created_by uuid not null references public.users(id),
  reason text not null check(length(reason) between 10 and 1000),
  created_at timestamptz not null default now(),
  unique(institution_id,fee_type,version)
);
create unique index fee_rules_effective_idx on public.fee_rules(institution_id,fee_type,coalesce(zone_id,'00000000-0000-0000-0000-000000000000'::uuid),effective_at);
create function app_private.keep_fee_rule() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'FEE_RULE_IMMUTABLE'; end $$;
create trigger fee_rule_immutable before update or delete on public.fee_rules for each row execute function app_private.keep_fee_rule();

create function app_private.quote_fee(p_institution uuid,p_type text,p_basis bigint,p_zone uuid default null,p_distance integer default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare r public.fee_rules%rowtype; fee bigint; band jsonb; flat bigint;
begin
  if p_basis < 0 or p_basis > 10000000000 or p_distance < 0 then raise exception 'INVALID_FEE_BASIS'; end if;
  select * into r from public.fee_rules where institution_id=p_institution and fee_type=p_type
    and effective_at<=now() and (zone_id is null or zone_id=p_zone)
    order by (zone_id is not null) desc,effective_at desc limit 1;
  if not found then raise exception 'FEE_POLICY_UNCONFIGURED:%',p_type; end if;
  flat:=r.flat_kobo;
  if p_type='DELIVERY' and p_distance is not null and jsonb_array_length(r.bands)>0 then
    select b into band from jsonb_array_elements(r.bands) b
      where p_distance >= (b->>'fromMetres')::integer
        and (b->>'toMetres' is null or p_distance < (b->>'toMetres')::integer) limit 1;
    if band is null then raise exception 'DELIVERY_DISTANCE_UNSUPPORTED'; end if;
    flat:=(band->>'feeKobo')::bigint;
  end if;
  fee:=greatest(r.minimum_kobo,flat+(p_basis*r.basis_points+5000)/10000);
  if r.maximum_kobo is not null then fee:=least(fee,r.maximum_kobo); end if;
  return jsonb_build_object('ruleId',r.id,'version',r.version,'type',p_type,'basisKobo',p_basis,
    'feeKobo',fee,'basisPoints',r.basis_points,'flatKobo',flat,'effectiveAt',r.effective_at,
    'distanceMetres',p_distance,'source',case when p_type='DELIVERY' and p_distance is null then 'ZONE_FALLBACK' else 'RULE' end);
end $$;

alter table public.tutorial_listings add column package_days integer check(package_days between 1 and 366);
create table public.tutorial_purchases (
  id uuid primary key,
  institution_id uuid not null references public.universities(id),
  student_user_id uuid not null references public.users(id),
  tutor_profile_id uuid not null references public.agent_profiles(id),
  resource_id uuid references public.tutorial_resources(id),
  listing_id uuid references public.tutorial_listings(id),
  title text not null,
  package_days integer check(package_days between 1 and 366),
  status text not null default 'PENDING_PAYMENT' check(status in ('PENDING_PAYMENT','PAID','EXPIRED','DISPUTED','REFUNDED','REVOKED')),
  price_kobo integer not null check(price_kobo >= 0),
  buyer_fee_kobo integer not null check(buyer_fee_kobo >= 0),
  commission_kobo integer not null check(commission_kobo between 0 and price_kobo),
  amount_kobo integer generated always as (price_kobo+buyer_fee_kobo) stored,
  tutor_net_kobo integer generated always as (price_kobo-commission_kobo) stored,
  fee_snapshot jsonb not null,
  payment_expires_at timestamptz not null default now()+interval '30 minutes',
  access_starts_at timestamptz,
  access_ends_at timestamptz,
  paid_at timestamptz,
  release_at timestamptz,
  earnings_state text not null default 'NOT_EARNED' check(earnings_state in ('NOT_EARNED','PENDING','AVAILABLE','RESERVED','REVERSED')),
  dispute_reason text check(length(dispute_reason) between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((resource_id is not null and listing_id is null and package_days is null) or (resource_id is null and listing_id is not null and package_days is not null)),
  check(access_ends_at is null or access_ends_at > access_starts_at)
);
create index tutorial_purchases_owner_idx on public.tutorial_purchases(student_user_id,created_at desc);
create index tutorial_purchases_access_idx on public.tutorial_purchases(student_user_id,tutor_profile_id,access_ends_at) where status='PAID';
create unique index tutorial_purchases_pending_resource_idx on public.tutorial_purchases(student_user_id,resource_id) where status='PENDING_PAYMENT';
create unique index tutorial_purchases_pending_package_idx on public.tutorial_purchases(student_user_id,listing_id) where status='PENDING_PAYMENT';
alter table public.payment_attempts drop constraint payment_attempts_resource_type_check;
alter table public.payment_attempts add constraint payment_attempts_resource_type_check check(resource_type in ('TUTORIAL_BOOKING','STORE_ORDER','TUTORIAL_PURCHASE'));

create function app_private.tutor_quote(p_institution uuid,p_student uuid,p_resource uuid,p_listing uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare price integer; title text; tutor uuid; days integer; commission jsonb; buyer jsonb;
begin
  if (p_resource is null)=(p_listing is null) then raise exception 'TUTOR_PRODUCT_UNAVAILABLE'; end if;
  if p_resource is not null then
    select r.price_kobo,r.title,r.tutor_profile_id into price,title,tutor from public.tutorial_resources r
      join public.agent_profiles a on a.id=r.tutor_profile_id and a.status='ACTIVE' and a.agent_type='TUTOR'
      join public.media_objects m on m.id=r.media_object_id and m.owner_user_id=a.user_id and m.deleted_at is null and m.kind='resource'
      where r.id=p_resource and r.university_id=p_institution and r.status='PUBLISHED' and r.access_model='PAID'
        and not r.is_demo and r.deleted_at is null and a.user_id<>p_student;
  else
    select l.price_kobo,l.title,l.tutor_profile_id,l.package_days into price,title,tutor,days from public.tutorial_listings l
      join public.agent_profiles a on a.id=l.tutor_profile_id and a.status='ACTIVE' and a.agent_type='TUTOR'
      where l.id=p_listing and l.university_id=p_institution and l.status='PUBLISHED' and l.review_status='APPROVED'
        and not l.is_demo and l.deleted_at is null and l.package_days is not null and a.user_id<>p_student;
  end if;
  if tutor is null then raise exception 'TUTOR_PRODUCT_UNAVAILABLE'; end if;
  if price=0 then
    commission:=jsonb_build_object('feeKobo',0,'version','FREE'); buyer:=commission;
  else
    commission:=app_private.quote_fee(p_institution,'TUTOR_COMMISSION',price);
    buyer:=app_private.quote_fee(p_institution,'BUYER_SERVICE',price);
  end if;
  if (commission->>'feeKobo')::integer > price then raise exception 'INVALID_COMMISSION'; end if;
  return jsonb_build_object('title',title,'tutorProfileId',tutor,'packageDays',days,'priceKobo',price,
    'buyerFeeKobo',(buyer->>'feeKobo')::integer,'commissionKobo',(commission->>'feeKobo')::integer,
    'amountKobo',price+(buyer->>'feeKobo')::integer,'fees',jsonb_build_object('commission',commission,'buyer',buyer));
end $$;

create function app_private.activate_tutor_purchase(p_id uuid) returns void language plpgsql set search_path='' as $$
declare p public.tutorial_purchases%rowtype; starts timestamptz; ends timestamptz;
begin
  select * into p from public.tutorial_purchases where id=p_id for update;
  if p.status<>'PENDING_PAYMENT' then return; end if;
  -- Serializes renewals of the same relationship, including different packages.
  perform 1 from public.agent_profiles where id=p.tutor_profile_id for update;
  starts:=now();
  if p.package_days is not null then
    select greatest(now(),coalesce(max(access_ends_at),now())) into starts from public.tutorial_purchases
      where student_user_id=p.student_user_id and tutor_profile_id=p.tutor_profile_id and status='PAID' and listing_id is not null;
    ends:=starts+make_interval(days=>p.package_days);
  end if;
  update public.tutorial_purchases set status='PAID',paid_at=now(),access_starts_at=starts,access_ends_at=ends,
    release_at=coalesce(ends,now())+interval '7 days',earnings_state=case when p.price_kobo=0 then 'NOT_EARNED' else 'PENDING' end,updated_at=now() where id=p_id;
end $$;

create function app_private.create_tutor_purchase(p_id uuid,p_institution uuid,p_student uuid,p_resource uuid,p_listing uuid,p_expected jsonb)
returns public.tutorial_purchases language plpgsql set search_path='' as $$
declare q jsonb; existing public.tutorial_purchases%rowtype;
begin
  perform 1 from public.profiles where user_id=p_student and university_id=p_institution and deleted_at is null for update;
  if not found then raise exception 'BUYER_TENANT_MISMATCH'; end if;
  select * into existing from public.tutorial_purchases where id=p_id;
  if found then
    if existing.student_user_id<>p_student or existing.resource_id is distinct from p_resource or existing.listing_id is distinct from p_listing then raise exception 'PURCHASE_ID_CONFLICT'; end if;
    return existing;
  end if;
  update public.tutorial_purchases set status='EXPIRED',updated_at=now() where student_user_id=p_student and status='PENDING_PAYMENT' and payment_expires_at<=now();
  select * into existing from public.tutorial_purchases where student_user_id=p_student and
    ((resource_id=p_resource and status in ('PAID','PENDING_PAYMENT')) or (listing_id=p_listing and status='PENDING_PAYMENT')) order by created_at desc limit 1;
  if found then return existing; end if;
  q:=app_private.tutor_quote(p_institution,p_student,p_resource,p_listing);
  if q is distinct from p_expected then raise exception 'PRICE_CHANGED'; end if;
  insert into public.tutorial_purchases(id,institution_id,student_user_id,tutor_profile_id,resource_id,listing_id,title,package_days,price_kobo,buyer_fee_kobo,commission_kobo,fee_snapshot)
    values(p_id,p_institution,p_student,(q->>'tutorProfileId')::uuid,p_resource,p_listing,q->>'title',(q->>'packageDays')::integer,
      (q->>'priceKobo')::integer,(q->>'buyerFeeKobo')::integer,(q->>'commissionKobo')::integer,q->'fees');
  if (q->>'amountKobo')::integer=0 then perform app_private.activate_tutor_purchase(p_id); end if;
  select * into existing from public.tutorial_purchases where id=p_id;
  return existing;
end $$;

create function app_private.settle_tutor_purchase(p_reference text,p_amount bigint,p_currency text) returns text language plpgsql set search_path='' as $$
declare a public.payment_attempts%rowtype; p public.tutorial_purchases%rowtype; txn uuid; tutor uuid; reason text;
begin
  select * into a from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_PURCHASE' for update;
  if not found then return 'not_a_tutor_purchase'; end if;
  select * into p from public.tutorial_purchases where id=a.resource_id for update;
  if a.status='SUCCEEDED' then return 'already_processed'; end if;
  if p_amount is distinct from p.amount_kobo::bigint or p_currency is distinct from 'NGN' then reason:='AMOUNT_OR_CURRENCY_MISMATCH';
  elsif p.status<>'PENDING_PAYMENT' or p.payment_expires_at<=now() or a.status not in ('CREATED','INITIALIZED') then reason:='PAYMENT_AFTER_EXPIRY_OR_CANCELLATION'; end if;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=a.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',resource_type='TUTORIAL_PURCHASE',resource_id=p.id,review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'requires_review';
  end if;
  select user_id into tutor from public.agent_profiles where id=p.tutor_profile_id;
  insert into public.ledger_accounts(university_id,account_code,account_type) values
    (p.institution_id,'PAYSTACK_CLEARING','ASSET'),(p.institution_id,'PLATFORM_COMMISSION','REVENUE'),(p.institution_id,'SERVICE_FEE_REVENUE','REVENUE') on conflict do nothing;
  insert into public.ledger_accounts(university_id,owner_user_id,account_code,account_type) values(p.institution_id,tutor,'TUTOR_PAYABLE','LIABILITY') on conflict do nothing;
  insert into public.ledger_transactions(university_id,reference_type,reference_id,idempotency_key,description)
    values(p.institution_id,'TUTORIAL_PURCHASE',p.id::text,'paystack:'||p_reference,'Tutor product purchase; immutable fee snapshot '||p.id::text) returning id into txn;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'DEBIT',p.amount_kobo from public.ledger_accounts where university_id=p.institution_id and account_code='PAYSTACK_CLEARING' and owner_user_id is null;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'CREDIT',p.tutor_net_kobo from public.ledger_accounts where university_id=p.institution_id and account_code='TUTOR_PAYABLE' and owner_user_id=tutor and p.tutor_net_kobo>0;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'CREDIT',p.commission_kobo from public.ledger_accounts where university_id=p.institution_id and account_code='PLATFORM_COMMISSION' and owner_user_id is null and p.commission_kobo>0;
  insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
    select txn,id,'CREDIT',p.buyer_fee_kobo from public.ledger_accounts where university_id=p.institution_id and account_code='SERVICE_FEE_REVENUE' and owner_user_id is null and p.buyer_fee_kobo>0;
  perform app_private.activate_tutor_purchase(p.id);
  update public.payment_attempts set status='SUCCEEDED',completed_at=now(),updated_at=now() where id=a.id;
  update public.payment_provider_events set state='PROCESSED',resource_type='TUTORIAL_PURCHASE',resource_id=p.id,processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'processed';
end $$;

create function app_private.tutor_access_end(p_student uuid,p_tutor uuid) returns timestamptz language sql stable set search_path='' as $$
  select max(ends_at) from (
    select p.access_ends_at ends_at from public.tutorial_purchases p join public.agent_profiles a on a.id=p.tutor_profile_id and a.status='ACTIVE'
      where p.student_user_id=p_student and a.user_id=p_tutor and p.status='PAID' and p.access_starts_at<=now() and p.access_ends_at>now()
    union all
    select w.ends_at from public.tutorial_bookings b join public.tutorial_listings l on l.id=b.listing_id
      join public.agent_profiles a on a.id=l.tutor_profile_id and a.status='ACTIVE'
      join public.tutorial_availability_windows w on w.id=b.availability_window_id
      where b.student_user_id=p_student and a.user_id=p_tutor and b.status in ('CONFIRMED','COMPLETED') and w.starts_at<=now() and w.ends_at>now()
  ) active
$$;
create function app_private.can_read_tutor_resource(p_user uuid,p_resource uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.tutorial_resources r where r.id=p_resource and r.status='PUBLISHED' and r.deleted_at is null and not r.is_demo and (
    r.access_model='FREE' or
    (r.access_model='PAID' and exists(select 1 from public.tutorial_purchases p where p.resource_id=r.id and p.student_user_id=p_user and p.status='PAID')) or
    (r.access_model='BOOKING_INCLUDED' and (
      exists(select 1 from public.tutorial_purchases p where p.listing_id=r.listing_id and p.student_user_id=p_user and p.status='PAID' and p.access_starts_at<=now() and p.access_ends_at>now()) or
      exists(select 1 from public.tutorial_bookings b join public.tutorial_availability_windows w on w.id=b.availability_window_id where b.listing_id=r.listing_id and b.student_user_id=p_user and b.status in ('CONFIRMED','COMPLETED') and w.starts_at<=now() and w.ends_at>now())
    ))))
$$;
alter table public.direct_threads add column kind text not null default 'GENERAL' check(kind in ('GENERAL','TUTOR'));
drop index public.direct_threads_pair_idx;
create unique index direct_threads_pair_idx on public.direct_threads(least(initiator_id,recipient_id),greatest(initiator_id,recipient_id)) where kind='GENERAL';
create unique index direct_threads_tutor_idx on public.direct_threads(initiator_id,recipient_id) where kind='TUTOR';
create function app_private.enforce_tutor_message() returns trigger language plpgsql set search_path='' as $$
declare t public.direct_threads%rowtype;
begin
  select * into t from public.direct_threads where id=new.thread_id;
  if t.kind='TUTOR' and app_private.tutor_access_end(t.initiator_id,t.recipient_id) is null then raise exception 'TUTOR_ACCESS_EXPIRED'; end if;
  return new;
end $$;
create trigger tutor_message_access before insert on public.direct_messages for each row execute function app_private.enforce_tutor_message();

alter table public.fee_rules enable row level security;
alter table public.tutorial_purchases enable row level security;
revoke all on public.fee_rules,public.tutorial_purchases from public;
revoke all on function app_private.quote_fee(uuid,text,bigint,uuid,integer),app_private.tutor_quote(uuid,uuid,uuid,uuid),app_private.activate_tutor_purchase(uuid),app_private.create_tutor_purchase(uuid,uuid,uuid,uuid,uuid,jsonb),app_private.settle_tutor_purchase(text,bigint,text),app_private.tutor_access_end(uuid,uuid),app_private.can_read_tutor_resource(uuid,uuid),app_private.keep_fee_rule(),app_private.enforce_tutor_message() from public;
commit;
