begin;

-- Legacy rides are deliberately not backfilled into the new financial system.
-- Only a verified, priced order may opt a job into CAMPUS_FARE_V1.
alter table public.delivery_jobs
  add column if not exists fare_kobo integer,
  add column if not exists fare_payment_method text not null default 'IN_APP' check(fare_payment_method in ('IN_APP','CASH')),
  add column if not exists route_distance_metres integer,
  add column if not exists fare_basis text check(fare_basis in ('ROAD_ROUTE','CAMPUS_ZONE')),
  add column if not exists financial_version text check(financial_version='CAMPUS_FARE_V1'),
  add constraint delivery_jobs_campus_fare_check check(financial_version is null or
    (fare_kobo is not null and rider_earning_kobo is not null and fare_basis is not null
      and route_distance_metres is not null and route_distance_metres between 0 and 100000
      and fare_kobo=least(45000,30000+ceil(greatest(0,route_distance_metres-1000)::numeric/1000)::integer*5000)
      and rider_earning_kobo=fare_kobo*9/10));

alter table public.ledger_transactions add column if not exists journal_payload jsonb;

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
        when x.code in ('PAYSTACK_CLEARING','RIDER_COMMISSION_RECEIVABLE') then 'ASSET'
        when x.code in ('RIDER_PENDING','RIDER_AVAILABLE','RIDER_PAYOUT_RESERVED','VENDOR_PENDING','VENDOR_AVAILABLE','TUTOR_PENDING','TUTOR_AVAILABLE','DELIVERY_LIABILITY','PAYMENT_SUSPENSE') then 'LIABILITY'
        when x.code in ('PLATFORM_COMMISSION','KIRA_SUBSCRIPTION_REVENUE') then 'REVENUE'
        when x.code='PROCESSING_EXPENSE' then 'EXPENSE' else null end or
      (x.code like 'RIDER_%' or x.code like 'VENDOR_%' or x.code like 'TUTOR_%') is distinct from (x.owner is not null)
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

create or replace function app_private.check_finance_journal() returns trigger language plpgsql set search_path='' as $$
declare payload jsonb; line_count integer; difference numeric; target uuid;
begin
  target=(to_jsonb(new)->>case when tg_table_name='ledger_lines' then 'transaction_id' else 'id' end)::uuid;
  select journal_payload into payload from public.ledger_transactions where id=target;
  if payload is null then return null; end if;
  select count(*),sum(case when direction='DEBIT' then amount_kobo else -amount_kobo end)
    into line_count,difference from public.ledger_lines where transaction_id=target;
  if line_count<>jsonb_array_length(payload->'lines') or difference is distinct from 0 then raise exception 'UNBALANCED_JOURNAL'; end if;
  return null;
end; $$;
create constraint trigger finance_journal_lines_balanced after insert on public.ledger_lines
  deferrable initially deferred for each row execute function app_private.check_finance_journal();
create constraint trigger finance_journal_transaction_balanced after insert on public.ledger_transactions
  deferrable initially deferred for each row execute function app_private.check_finance_journal();
create trigger finance_ledger_transactions_append_only before update or delete on public.ledger_transactions
  for each row execute function app_private.prevent_append_only_mutation();
create trigger finance_ledger_lines_append_only before update or delete on public.ledger_lines
  for each row execute function app_private.prevent_append_only_mutation();

create or replace function app_private.finance_balance(p_uni uuid,p_user uuid,p_code text)
returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(case when (a.account_type='ASSET' and l.direction='DEBIT') or
    (a.account_type<>'ASSET' and l.direction='CREDIT') then l.amount_kobo else -l.amount_kobo end),0)::bigint
  from public.ledger_accounts a join public.ledger_lines l on l.account_id=a.id
  where a.university_id=p_uni and a.owner_user_id is not distinct from p_user and a.account_code=p_code;
$$;

create table app_private.verified_paystack_receipts(
  provider_reference text primary key,
  university_id uuid not null references public.universities(id) on delete restrict,
  purpose text not null check(purpose in ('STORE_ORDER','RIDER_COMMISSION','TUTORIAL_BOOKING','KIRA_SUBSCRIPTION')),
  resource_id uuid not null,
  amount_kobo bigint not null check(amount_kobo>0),provider_fee_kobo bigint not null check(provider_fee_kobo>=0),
  paid_at timestamptz not null,
  journal_id uuid not null references public.ledger_transactions(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create trigger verified_paystack_receipts_append_only before update or delete on app_private.verified_paystack_receipts
  for each row execute function app_private.prevent_append_only_mutation();
create function app_private.record_verified_paystack_receipt(p_uni uuid,p_reference text,p_purpose text,p_resource uuid,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns uuid language plpgsql set search_path='' as $$
declare previous app_private.verified_paystack_receipts%rowtype; journal uuid;
begin
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

create table app_private.rider_cash_commissions(
  job_id uuid primary key references public.delivery_jobs(id) on delete restrict,
  university_id uuid not null references public.universities(id) on delete restrict,
  rider_profile_id uuid not null references public.agent_profiles(id) on delete restrict,
  rider_user_id uuid not null references public.users(id) on delete restrict,
  fare_kobo integer not null check(fare_kobo in (30000,35000,40000,45000)),
  commission_kobo integer not null check(commission_kobo=fare_kobo/10),
  created_at timestamptz not null default now()
);
create index rider_cash_commissions_owner on app_private.rider_cash_commissions(rider_user_id,university_id,created_at,job_id);
create table app_private.rider_commission_allocations(
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app_private.rider_cash_commissions(job_id) on delete restrict,
  amount_kobo bigint not null check(amount_kobo>0),
  source_type text not null check(source_type in ('PAYSTACK','EARNINGS_OFFSET')),
  source_id text not null,
  journal_id uuid not null references public.ledger_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(job_id,source_type,source_id)
);
create trigger rider_commissions_append_only before update or delete on app_private.rider_cash_commissions
  for each row execute function app_private.prevent_append_only_mutation();
create trigger rider_allocations_append_only before update or delete on app_private.rider_commission_allocations
  for each row execute function app_private.prevent_append_only_mutation();

create or replace function app_private.rider_unpaid_commissions(p_user uuid)
returns table(job_id uuid,university_id uuid,outstanding_kobo bigint,created_at timestamptz)
language sql stable set search_path='' as $$
  select c.job_id,c.university_id,c.commission_kobo-coalesce(sum(a.amount_kobo),0)::bigint,c.created_at
  from app_private.rider_cash_commissions c left join app_private.rider_commission_allocations a on a.job_id=c.job_id
  where c.rider_user_id=p_user group by c.job_id having c.commission_kobo>coalesce(sum(a.amount_kobo),0)
  order by c.created_at,c.job_id;
$$;

create or replace function app_private.offset_rider_commissions(p_user uuid,p_uni uuid)
returns bigint language plpgsql set search_path='' as $$
declare available bigint; used bigint:=0; allocation bigint; debt record; journal uuid; source text;
begin
  perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||p_user::text,0));
  available=app_private.finance_balance(p_uni,p_user,'RIDER_AVAILABLE');
  if available<=0 then return 0; end if;
  source=gen_random_uuid()::text;
  for debt in select * from app_private.rider_unpaid_commissions(p_user) where university_id=p_uni loop
    allocation=least(available,debt.outstanding_kobo);
    exit when allocation<=0;
    journal=app_private.post_finance_journal(p_uni,'RIDER_COMMISSION',debt.job_id::text,'rider-offset:'||source||':'||debt.job_id::text,
      'Available rider earnings offset a cash commission',jsonb_build_array(
        jsonb_build_object('code','RIDER_AVAILABLE','type','LIABILITY','owner',p_user,'direction','DEBIT','amount',allocation),
        jsonb_build_object('code','RIDER_COMMISSION_RECEIVABLE','type','ASSET','owner',p_user,'direction','CREDIT','amount',allocation)));
    insert into app_private.rider_commission_allocations(job_id,amount_kobo,source_type,source_id,journal_id)
      values(debt.job_id,allocation,'EARNINGS_OFFSET',source,journal);
    used=used+allocation; available=available-allocation;
  end loop;
  return used;
end; $$;

-- Immutable receipt attestation is populated only by the Worker after provider verification.
create table app_private.commerce_settlements(
  order_id uuid primary key,
  university_id uuid not null,
  provider_reference text not null unique,
  amount_kobo bigint not null check(amount_kobo>0),
  seller_net_kobo bigint not null check(seller_net_kobo>=0),
  digital_fare_kobo integer not null check(digital_fare_kobo>=0),
  cash_fare_kobo integer not null check(cash_fare_kobo>=0),
  provider_fee_kobo bigint not null check(provider_fee_kobo>=0),
  journal_id uuid not null references public.ledger_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(order_id,university_id) references public.orders(id,university_id) on delete restrict
);
create trigger commerce_settlements_append_only before update or delete on app_private.commerce_settlements
  for each row execute function app_private.prevent_append_only_mutation();

create or replace function app_private.settle_rider_finance() returns trigger language plpgsql set search_path='' as $$
declare rider_user uuid; receipt app_private.commerce_settlements%rowtype; commission integer; journal uuid;
begin
  if old.financial_version is not null and (new.fare_kobo,new.fare_payment_method,new.rider_earning_kobo,new.financial_version,new.route_distance_metres,new.fare_basis)
    is distinct from (old.fare_kobo,old.fare_payment_method,old.rider_earning_kobo,old.financial_version,old.route_distance_metres,old.fare_basis) then
    raise exception 'RIDER_QUOTE_IMMUTABLE'; end if;
  if new.financial_version is null then return new; end if;
  if new.status='DELIVERED' and old.status is distinct from 'DELIVERED' then
    select user_id into rider_user from public.agent_profiles where id=new.rider_profile_id
      and university_id=new.university_id and agent_type='RIDER';
    if rider_user is null then raise exception 'RIDER_SETTLEMENT_OWNER_MISSING'; end if;
    perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||rider_user::text,0));
    select * into receipt from app_private.commerce_settlements where order_id=new.order_id and university_id=new.university_id;
    if not found or (new.fare_payment_method='CASH' and receipt.cash_fare_kobo<>new.fare_kobo) or
      (new.fare_payment_method='IN_APP' and receipt.digital_fare_kobo<>new.fare_kobo) then raise exception 'RIDER_ORDER_PAYMENT_UNVERIFIED'; end if;
    commission=new.fare_kobo/10;
    if new.fare_payment_method='CASH' then
      insert into app_private.rider_cash_commissions(job_id,university_id,rider_profile_id,rider_user_id,fare_kobo,commission_kobo)
        values(new.id,new.university_id,new.rider_profile_id,rider_user,new.fare_kobo,commission);
      journal=app_private.post_finance_journal(new.university_id,'RIDER_COMMISSION',new.id::text,'rider-cash:'||new.id::text,
        'Commission on a cash fare held by the rider',jsonb_build_array(
          jsonb_build_object('code','RIDER_COMMISSION_RECEIVABLE','type','ASSET','owner',rider_user,'direction','DEBIT','amount',commission),
          jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',commission)));
      new.earnings_state='NOT_EARNED'; -- Physical cash is not an in-app payout balance.
    else
      journal=app_private.post_finance_journal(new.university_id,'DELIVERY_JOB',new.id::text,'rider-digital:'||new.id::text,
        'Completed digital fare split between rider and platform',jsonb_build_array(
          jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','DEBIT','amount',new.fare_kobo),
          jsonb_build_object('code','RIDER_PENDING','type','LIABILITY','owner',rider_user,'direction','CREDIT','amount',new.rider_earning_kobo),
          jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',commission)));
    end if;
    perform app_private.offset_rider_commissions(rider_user,new.university_id);
  elsif new.earnings_state='AVAILABLE' and old.earnings_state='PENDING' and new.status='DELIVERED' and new.fare_payment_method='IN_APP' then
    if new.delivered_at>now()-interval '48 hours' or exists(select 1 from public.disputes d
      where d.order_id=new.order_id and d.status in ('OPEN','UNDER_REVIEW')) then raise exception 'RIDER_EARNINGS_NOT_ELIGIBLE'; end if;
    select user_id into rider_user from public.agent_profiles where id=new.rider_profile_id;
    perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||rider_user::text,0));
    journal=app_private.post_finance_journal(new.university_id,'DELIVERY_JOB',new.id::text,'rider-release:'||new.id::text,
      'Release completed rider earnings after the dispute window',jsonb_build_array(
        jsonb_build_object('code','RIDER_PENDING','type','LIABILITY','owner',rider_user,'direction','DEBIT','amount',new.rider_earning_kobo),
        jsonb_build_object('code','RIDER_AVAILABLE','type','LIABILITY','owner',rider_user,'direction','CREDIT','amount',new.rider_earning_kobo)));
    perform app_private.offset_rider_commissions(rider_user,new.university_id);
  end if;
  return new;
end; $$;
create trigger rider_financial_settlement before update on public.delivery_jobs
  for each row execute function app_private.settle_rider_finance();

alter function app_private.reserve_delivery_job(uuid,uuid) rename to reserve_delivery_job_before_commissions;
create function app_private.reserve_delivery_job(p_job uuid,p_profile uuid)
returns table(id uuid,university_id uuid) language plpgsql set search_path='' as $$
declare owner uuid; campus uuid;
begin
  select user_id,agent_profiles.university_id into owner,campus from public.agent_profiles where agent_profiles.id=p_profile and status='ACTIVE' and agent_type='RIDER';
  if not found then raise exception 'RIDER_PROFILE_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||owner::text,0));
  perform app_private.offset_rider_commissions(owner,campus);
  if (select count(*) from app_private.rider_unpaid_commissions(owner))>=4 then raise exception 'RIDER_COMMISSION_LIMIT'; end if;
  if exists(select 1 from public.delivery_jobs j join public.agent_profiles a on a.id=j.rider_profile_id
    where a.user_id=owner and j.status in ('RESERVED','PICKED_UP')) then raise exception 'RIDER_AT_CAPACITY'; end if;
  return query select * from app_private.reserve_delivery_job_before_commissions(p_job,p_profile);
end; $$;

create table app_private.rider_commission_checkouts(
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete restrict,
  university_id uuid not null references public.universities(id) on delete restrict,
  rider_profile_id uuid not null references public.agent_profiles(id) on delete restrict,
  request_id uuid not null,
  amount_kobo bigint not null check(amount_kobo>0),
  charges jsonb not null check(jsonb_typeof(charges)='array'),
  provider_reference text not null unique,
  status text not null default 'CREATED' check(status in ('CREATED','INITIALIZED','PAID','FAILED','REQUIRES_REVIEW')),
  authorization_url text,access_code text,
  expires_at timestamptz not null default now()+interval '30 minutes',
  paid_at timestamptz,created_at timestamptz not null default now(),
  unique(user_id,request_id)
);
create unique index rider_commission_checkout_active on app_private.rider_commission_checkouts(user_id,university_id)
  where status in ('CREATED','INITIALIZED');

create function app_private.create_rider_commission_checkout(p_id uuid,p_profile uuid,p_user uuid,p_request uuid,p_reference text)
returns app_private.rider_commission_checkouts language plpgsql set search_path='' as $$
declare profile public.agent_profiles%rowtype; result app_private.rider_commission_checkouts%rowtype; charges jsonb; amount bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||p_user::text,0));
  select * into result from app_private.rider_commission_checkouts where user_id=p_user and request_id=p_request;
  if found then return result; end if;
  select * into profile from public.agent_profiles where id=p_profile and user_id=p_user and agent_type='RIDER' and status='ACTIVE';
  if not found then raise exception 'RIDER_PROFILE_UNAVAILABLE'; end if;
  perform app_private.offset_rider_commissions(p_user,profile.university_id);
  update app_private.rider_commission_checkouts set status='FAILED' where user_id=p_user and university_id=profile.university_id
    and status in ('CREATED','INITIALIZED') and expires_at<=now();
  select * into result from app_private.rider_commission_checkouts where user_id=p_user and university_id=profile.university_id and status in ('CREATED','INITIALIZED');
  if found then return result; end if;
  select jsonb_agg(jsonb_build_object('jobId',job_id,'amountKobo',outstanding_kobo) order by created_at,job_id),sum(outstanding_kobo)
    into charges,amount from app_private.rider_unpaid_commissions(p_user) where university_id=profile.university_id;
  if coalesce(amount,0)<=0 then raise exception 'RIDER_NO_COMMISSION_DUE'; end if;
  insert into app_private.rider_commission_checkouts(id,user_id,university_id,rider_profile_id,request_id,amount_kobo,charges,provider_reference)
    values(p_id,p_user,profile.university_id,p_profile,p_request,amount,charges,p_reference) returning * into result;
  return result;
end; $$;

create table app_private.rider_commission_receipts(
  checkout_id uuid primary key references app_private.rider_commission_checkouts(id) on delete restrict,
  provider_reference text not null unique,
  amount_kobo bigint not null check(amount_kobo>0),provider_fee_kobo bigint not null check(provider_fee_kobo>=0),
  journal_id uuid not null references public.ledger_transactions(id) on delete restrict,
  paid_at timestamptz not null
);
create trigger rider_receipts_append_only before update or delete on app_private.rider_commission_receipts
  for each row execute function app_private.prevent_append_only_mutation();

create function app_private.record_rider_commission_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare intent app_private.rider_commission_checkouts%rowtype; charge jsonb; outstanding bigint;
  allocated bigint:=0; allocation bigint; journal uuid; lines jsonb; fee_journal uuid;
begin
  select * into intent from app_private.rider_commission_checkouts where provider_reference=p_reference;
  if not found then return 'UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||intent.user_id::text,0));
  select * into intent from app_private.rider_commission_checkouts where id=intent.id for update;
  if intent.status='PAID' then
    if not exists(select 1 from app_private.rider_commission_receipts where checkout_id=intent.id and amount_kobo=p_amount and provider_fee_kobo=p_fee) then raise exception 'RECEIPT_IDEMPOTENCY_CONFLICT'; end if;
    return 'ALREADY_PAID';
  end if;
  perform app_private.record_verified_paystack_receipt(intent.university_id,p_reference,'RIDER_COMMISSION',intent.id,p_amount,p_fee,p_paid_at);
  if intent.amount_kobo<>p_amount then
    update app_private.rider_commission_checkouts set status='REQUIRES_REVIEW' where id=intent.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='AMOUNT_MISMATCH',updated_at=now()
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  for charge in select value from jsonb_array_elements(intent.charges) loop
    select outstanding_kobo into outstanding from app_private.rider_unpaid_commissions(intent.user_id)
      where job_id=(charge->>'jobId')::uuid and university_id=intent.university_id;
    allocation=least(coalesce(outstanding,0),(charge->>'amountKobo')::bigint);
    allocated=allocated+allocation;
  end loop;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount));
  if allocated>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','RIDER_COMMISSION_RECEIVABLE','type','ASSET','owner',intent.user_id,'direction','CREDIT','amount',allocated)); end if;
  if p_amount>allocated then lines=lines||jsonb_build_array(jsonb_build_object('code','RIDER_AVAILABLE','type','LIABILITY','owner',intent.user_id,'direction','CREDIT','amount',p_amount-allocated)); end if;
  journal=app_private.post_finance_journal(intent.university_id,'RIDER_COMMISSION',intent.id::text,'rider-repayment:'||p_reference,'Verified cash commission repayment',lines);
  for charge in select value from jsonb_array_elements(intent.charges) loop
    select outstanding_kobo into outstanding from app_private.rider_unpaid_commissions(intent.user_id) where job_id=(charge->>'jobId')::uuid;
    allocation=least(coalesce(outstanding,0),(charge->>'amountKobo')::bigint);
    if allocation>0 then insert into app_private.rider_commission_allocations(job_id,amount_kobo,source_type,source_id,journal_id)
      values((charge->>'jobId')::uuid,allocation,'PAYSTACK',p_reference,journal); end if;
  end loop;
  insert into app_private.rider_commission_receipts(checkout_id,provider_reference,amount_kobo,provider_fee_kobo,journal_id,paid_at)
    values(intent.id,p_reference,p_amount,p_fee,journal,p_paid_at);
  update app_private.rider_commission_checkouts set status='PAID',paid_at=p_paid_at where id=intent.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now()
    where provider='PAYSTACK' and provider_reference=p_reference;
  perform app_private.offset_rider_commissions(intent.user_id,intent.university_id);
  return 'PAID';
end; $$;

-- All access is through authenticated Worker routes. No client database access.
revoke all on app_private.rider_cash_commissions,app_private.rider_commission_allocations,app_private.commerce_settlements,
  app_private.rider_commission_checkouts,app_private.rider_commission_receipts,app_private.verified_paystack_receipts from public;
revoke all on function app_private.post_finance_journal(uuid,text,text,text,text,jsonb),app_private.finance_balance(uuid,uuid,text),
  app_private.rider_unpaid_commissions(uuid),app_private.offset_rider_commissions(uuid,uuid),
  app_private.create_rider_commission_checkout(uuid,uuid,uuid,uuid,text),app_private.record_rider_commission_receipt(text,bigint,bigint,timestamptz),
  app_private.record_verified_paystack_receipt(uuid,text,text,uuid,bigint,bigint,timestamptz),
  app_private.reserve_delivery_job(uuid,uuid),app_private.reserve_delivery_job_before_commissions(uuid,uuid) from public;
commit;
