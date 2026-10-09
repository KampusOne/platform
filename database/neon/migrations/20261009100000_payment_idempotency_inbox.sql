-- Durable, fail-closed outgoing Paystack initialization and incoming webhook replay guards.
-- Deploy before enabling the matching Worker. No existing finance rows are rewritten.
begin;

create table if not exists app_private.payment_initialization_claims (
  provider_reference text primary key
    check (provider_reference ~ '^[A-Za-z0-9_.-]{1,100}$'),
  amount_kobo bigint not null check (amount_kobo > 0),
  state text not null default 'IN_PROGRESS'
    check (state in ('IN_PROGRESS','READY','UNCERTAIN')),
  authorization_url text,
  access_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'READY' or (
    (authorization_url is not null and authorization_url like 'https://%' and access_code is not null and char_length(access_code) > 0)
  ))
);

-- Only the first caller may call Paystack for a reference. A crashed/unknown
-- call must never be silently retried with a different reference.
create or replace function app_private.claim_payment_initialization(
  p_reference text, p_amount_kobo bigint
) returns table (claim_state text, authorization_url text, access_code text)
language plpgsql set search_path = '' as $$
declare
  inserted boolean := false;
  saved app_private.payment_initialization_claims%rowtype;
begin
  if p_reference is null or p_reference !~ '^[A-Za-z0-9_.-]{1,100}$'
     or p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'INVALID_PAYMENT_INITIALIZATION';
  end if;
  insert into app_private.payment_initialization_claims(provider_reference,amount_kobo)
    values (p_reference,p_amount_kobo)
    on conflict (provider_reference) do nothing
    returning true into inserted;
  if coalesce(inserted,false) then
    return query select 'CLAIMED'::text,null::text,null::text;
    return;
  end if;
  select * into saved from app_private.payment_initialization_claims
    where provider_reference=p_reference for update;
  if saved.amount_kobo is distinct from p_amount_kobo then
    raise exception 'PAYMENT_INITIALIZATION_AMOUNT_CHANGED';
  end if;
  -- A lease timeout is a *review* condition, not permission for a second
  -- provider POST: the original response could have been lost.
  if saved.state='IN_PROGRESS' and saved.created_at < now()-interval '2 minutes' then
    update app_private.payment_initialization_claims
      set state='UNCERTAIN',updated_at=now()
      where provider_reference=p_reference;
    saved.state := 'UNCERTAIN';
  end if;
  return query select saved.state,saved.authorization_url,saved.access_code;
end; $$;

create or replace function app_private.finish_payment_initialization(
  p_reference text,p_state text,p_authorization_url text default null,
  p_access_code text default null
) returns boolean language plpgsql set search_path = '' as $$
declare saved app_private.payment_initialization_claims%rowtype;
begin
  if p_state not in ('READY','UNCERTAIN') or p_reference is null then
    raise exception 'INVALID_PAYMENT_INITIALIZATION_RESULT';
  end if;
  if p_state='READY' and
    (p_authorization_url is null or p_authorization_url !~ '^https://'
     or nullif(p_access_code,'') is null) then
    raise exception 'INCOMPLETE_PROVIDER_INITIALIZATION';
  end if;
  select * into saved from app_private.payment_initialization_claims
    where provider_reference=p_reference for update;
  if not found then raise exception 'PAYMENT_INITIALIZATION_NOT_CLAIMED'; end if;
  if saved.state='READY' then
    if p_state='READY' and
      (saved.authorization_url,saved.access_code) =
      (p_authorization_url,p_access_code) then return true; end if;
    raise exception 'PAYMENT_INITIALIZATION_ALREADY_COMPLETED';
  end if;
  if saved.state='UNCERTAIN' and p_state='READY' then
    -- Never convert an expired/crashed attempt into a new provider request.
    -- A verified late callback settles the original financial resource.
    raise exception 'PAYMENT_INITIALIZATION_REQUIRES_REVIEW';
  end if;
  update app_private.payment_initialization_claims
    set state=p_state,authorization_url=case when p_state='READY' then p_authorization_url else null end,
        access_code=case when p_state='READY' then p_access_code else null end,
        updated_at=now()
    where provider_reference=p_reference;
  return true;
end; $$;


-- Provider payout initiation and OTP finalization need a separate durable
-- claim, not just a unique payout reference and ledger reservation.
create table if not exists app_private.paystack_transfer_operation_claims (
  operation text not null check (operation in ('INIT','FINALIZE')),
  provider_reference text not null check (provider_reference ~ '^[a-z0-9_-]{16,50}$'),
  amount_kobo bigint not null check (amount_kobo > 0),
  sealed_target text not null check (char_length(sealed_target) between 4 and 120),
  state text not null default 'IN_PROGRESS'
    check (state in ('IN_PROGRESS','READY','UNCERTAIN')),
  provider_status text,
  transfer_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(operation,provider_reference),
  check (state <> 'READY' or
    (provider_status is not null and transfer_code is not null
      and transfer_code ~ '^TRF_[A-Za-z0-9]+$'))
);

create or replace function app_private.claim_paystack_transfer_operation(
  p_operation text,p_reference text,p_amount bigint,p_target text
) returns table(claim_state text,provider_status text,transfer_code text)
language plpgsql set search_path='' as $$
declare inserted boolean:=false; saved app_private.paystack_transfer_operation_claims%rowtype;
begin
  if p_operation is null or p_operation not in ('INIT','FINALIZE')
     or p_reference is null or p_reference !~ '^[a-z0-9_-]{16,50}$'
     or p_amount is null or p_amount<=0 or p_target is null
     or char_length(p_target) not between 4 and 120 then
    raise exception 'INVALID_TRANSFER_CLAIM';
  end if;
  insert into app_private.paystack_transfer_operation_claims(
    operation,provider_reference,amount_kobo,sealed_target
  ) values(p_operation,p_reference,p_amount,p_target)
  on conflict do nothing returning true into inserted;
  if coalesce(inserted,false) then
    return query select 'CLAIMED'::text,null::text,null::text;
    return;
  end if;
  select * into saved from app_private.paystack_transfer_operation_claims
    where operation=p_operation and provider_reference=p_reference for update;
  if (saved.amount_kobo,saved.sealed_target) is distinct from(p_amount,p_target) then
    raise exception 'TRANSFER_REPLAY_DETAILS_CHANGED';
  end if;
  if saved.state='IN_PROGRESS' and saved.created_at<now()-interval '2 minutes' then
    update app_private.paystack_transfer_operation_claims
      set state='UNCERTAIN',updated_at=now()
      where operation=p_operation and provider_reference=p_reference;
    saved.state:='UNCERTAIN';
  end if;
  return query select saved.state,saved.provider_status,saved.transfer_code;
end; $$;

create or replace function app_private.finish_paystack_transfer_operation(
  p_operation text,p_reference text,p_state text,
  p_provider_status text default null,p_transfer_code text default null
) returns boolean language plpgsql set search_path='' as $$
declare saved app_private.paystack_transfer_operation_claims%rowtype;
begin
  if p_operation is null or p_operation not in ('INIT','FINALIZE')
      or p_state is null or p_state not in ('READY','UNCERTAIN') then
    raise exception 'INVALID_TRANSFER_CLAIM_RESULT';
  end if;
  if p_state='READY' and
    (nullif(p_provider_status,'') is null or p_transfer_code is null
      or p_transfer_code !~ '^TRF_[A-Za-z0-9]+$') then
    raise exception 'INCOMPLETE_PROVIDER_TRANSFER';
  end if;
  select * into saved from app_private.paystack_transfer_operation_claims
    where operation=p_operation and provider_reference=p_reference for update;
  if not found then raise exception 'TRANSFER_NOT_CLAIMED'; end if;
  if saved.state='READY' then
    if p_state='READY' and
      (saved.provider_status,saved.transfer_code)=(p_provider_status,p_transfer_code) then
      return true;
    end if;
    raise exception 'TRANSFER_OPERATION_ALREADY_COMPLETED';
  end if;
  if saved.state='UNCERTAIN' and p_state='READY' then
    raise exception 'TRANSFER_OPERATION_REQUIRES_REVIEW';
  end if;
  update app_private.paystack_transfer_operation_claims
    set state=p_state,
      provider_status=case when p_state='READY' then p_provider_status else null end,
      transfer_code=case when p_state='READY' then p_transfer_code else null end,
      updated_at=now()
    where operation=p_operation and provider_reference=p_reference;
  return true;
end; $$;

create table if not exists app_private.provider_webhook_inbox (
  provider text not null check (provider in ('PAYSTACK')),
  event_type text not null check (event_type ~ '^[a-z._]{3,80}$'),
  provider_reference text not null check (provider_reference ~ '^[A-Za-z0-9_.-]{1,100}$'),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'PROCESSING'
    check (state in ('PROCESSING','RETRYABLE','PROCESSED','REQUIRES_REVIEW')),
  claim_token uuid,
  claimed_until timestamptz,
  attempts integer not null default 1 check (attempts between 1 and 100000),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(provider,event_type,provider_reference,body_sha256)
);
create index if not exists provider_webhook_inbox_retries_idx
  on app_private.provider_webhook_inbox(state,updated_at)
  where state in ('RETRYABLE','REQUIRES_REVIEW');

create or replace function app_private.claim_provider_webhook(
  p_provider text,p_event text,p_reference text,p_hash text,p_token uuid
) returns text language plpgsql set search_path='' as $$
declare inserted boolean := false; saved app_private.provider_webhook_inbox%rowtype;
begin
  if p_provider<>'PAYSTACK' or p_event is null or p_event !~ '^[a-z._]{3,80}$'
    or p_reference is null or p_reference !~ '^[A-Za-z0-9_.-]{1,100}$'
    or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_token is null then
    raise exception 'INVALID_PROVIDER_WEBHOOK';
  end if;
  insert into app_private.provider_webhook_inbox(
    provider,event_type,provider_reference,body_sha256,claim_token,claimed_until
  ) values (p_provider,p_event,p_reference,p_hash,p_token,now()+interval '2 minutes')
  on conflict do nothing returning true into inserted;
  if coalesce(inserted,false) then return 'CLAIMED'; end if;
  select * into saved from app_private.provider_webhook_inbox
    where provider=p_provider and event_type=p_event
      and provider_reference=p_reference and body_sha256=p_hash for update;
  if saved.state='PROCESSED' then return 'DUPLICATE'; end if;
  if saved.state='REQUIRES_REVIEW' then return 'REQUIRES_REVIEW'; end if;
  if saved.state='PROCESSING' and saved.claimed_until>now() then return 'BUSY'; end if;
  update app_private.provider_webhook_inbox
     set state='PROCESSING',claim_token=p_token,claimed_until=now()+interval '2 minutes',
         attempts=attempts+1,updated_at=now(),review_reason=null
   where provider=p_provider and event_type=p_event
     and provider_reference=p_reference and body_sha256=p_hash;
  return 'CLAIMED';
end; $$;

create or replace function app_private.finish_provider_webhook(
  p_provider text,p_event text,p_reference text,p_hash text,p_token uuid,
  p_state text,p_reason text default null
) returns boolean language plpgsql set search_path='' as $$
declare modified integer;
begin
  if p_state not in ('RETRYABLE','PROCESSED','REQUIRES_REVIEW') then
    raise exception 'INVALID_PROVIDER_WEBHOOK_RESULT';
  end if;
  update app_private.provider_webhook_inbox
     set state=p_state,claim_token=null,claimed_until=null,review_reason=p_reason,updated_at=now()
   where provider=p_provider and event_type=p_event
     and provider_reference=p_reference and body_sha256=p_hash
     and claim_token=p_token and state='PROCESSING';
  get diagnostics modified=row_count;
  return modified=1;
end; $$;

revoke all on app_private.payment_initialization_claims from public;
revoke all on app_private.provider_webhook_inbox from public;
revoke all on app_private.paystack_transfer_operation_claims from public;
revoke all on function app_private.claim_payment_initialization(text,bigint) from public;
revoke all on function app_private.finish_payment_initialization(text,text,text,text) from public;
revoke all on function app_private.claim_paystack_transfer_operation(text,text,bigint,text) from public;
revoke all on function app_private.finish_paystack_transfer_operation(text,text,text,text,text) from public;
revoke all on function app_private.claim_provider_webhook(text,text,text,text,uuid) from public;
revoke all on function app_private.finish_provider_webhook(text,text,text,text,uuid,text,text) from public;

commit;
