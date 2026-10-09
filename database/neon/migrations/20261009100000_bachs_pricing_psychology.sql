begin;
-- Separate BACHS records: no legacy Paystack price, receipt or ledger is rewritten.
create table app_private.bachs_fee_profiles (
 id uuid primary key default gen_random_uuid(),
 university_id uuid not null references public.universities(id),
 version text not null check(char_length(version) between 3 and 120),
 context text not null check(context in ('CHECKOUT_BANK_TRANSFER','VIRTUAL_ACCOUNT_DEPOSIT','LOCAL_CARD','BANK_WITHDRAWAL')),
 collection jsonb not null check((jsonb_typeof(collection)='object' and collection ?& array['basisPoints','flatKobo','flatWaivedBelowKobo','capKobo']
  and (collection->>'basisPoints')::integer between 0 and 9999
  and (collection->>'flatKobo')::bigint between 0 and 2000000000
  and (collection->>'flatWaivedBelowKobo')::bigint between 0 and 2000000000
  and (collection->>'capKobo' is null or (collection->>'capKobo')::bigint between 0 and 2000000000)) is true),
 status text not null check(status in ('APPROVED','DISABLED')),
 effective_from timestamptz not null, effective_to timestamptz check(effective_to>effective_from),
 source_url text not null check(source_url ~ '^https://(docs\.|app\.)?bachs\.io(/|$)'),
 variance_tolerance_kobo bigint not null default 100 check(variance_tolerance_kobo between 0 and 100000000),
 approval_note text not null check(char_length(approval_note) between 10 and 2000),
 eligibility_evidence text not null check(char_length(eligibility_evidence) between 10 and 4000),
 approved_by uuid not null references public.users(id), approved_at timestamptz not null default now(),
 unique(university_id,context,version), unique(id,university_id)
);
create index bachs_profiles_context on app_private.bachs_fee_profiles(university_id,context,effective_from desc,approved_at desc);
create trigger bachs_profiles_immutable before update or delete on app_private.bachs_fee_profiles
 for each row execute function app_private.prevent_append_only_mutation();

create table app_private.bachs_checkout_quotes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id), university_id uuid not null references public.universities(id),
 resource_type text not null check(resource_type in ('STORE_ORDER','TUTORIAL_BOOKING','TUTORIAL_PURCHASE','KIRA_SUBSCRIPTION','RIDER_COMMISSION')),
 resource_id uuid not null, provider_reference text not null unique check(provider_reference ~ '^K1-B-[A-Za-z0-9_.-]{1,90}$'),
 resource_fingerprint text not null check(resource_fingerprint ~ '^[a-f0-9]{64}$'),
 resource_snapshot jsonb not null check(jsonb_typeof(resource_snapshot)='object' and octet_length(resource_snapshot::text)<=64000),
 fee_profile_id uuid not null, fee_profile_version text not null,
 quote jsonb not null check((jsonb_typeof(quote)='object' and quote->>'provider'='BACHS' and quote->>'currency'='NGN'
  and (quote->>'finalCustomerAmountKobo')::bigint between 1 and 2000000000
  and (quote->>'finalCustomerAmountKobo')::bigint=(quote->>'providerAmountKobo')::bigint) is true),
 created_at timestamptz not null, expires_at timestamptz not null check(expires_at>created_at and expires_at<=created_at+interval '20 minutes'),
 foreign key(fee_profile_id,university_id) references app_private.bachs_fee_profiles(id,university_id),
 unique(id,university_id)
);
create trigger bachs_quotes_immutable before update or delete on app_private.bachs_checkout_quotes
 for each row execute function app_private.prevent_append_only_mutation();
-- Freeze the exact approved campus profile, including its validity window.
create function app_private.validate_bachs_quote_profile() returns trigger language plpgsql set search_path='' as $$
declare p app_private.bachs_fee_profiles;
begin
 select * into p from app_private.bachs_fee_profiles where id=new.fee_profile_id and university_id=new.university_id;
 if p.id is null or p.status<>'APPROVED' or p.context not in ('CHECKOUT_BANK_TRANSFER','LOCAL_CARD')
  or new.created_at<p.effective_from or (p.effective_to is not null and new.expires_at>p.effective_to)
  or new.fee_profile_version is distinct from p.version
  or new.quote->>'context' is distinct from p.context
  or new.quote->'profile'->>'id' is distinct from p.id::text
  or new.quote->'profile'->>'universityId' is distinct from p.university_id::text
  or new.quote->'profile'->>'version' is distinct from p.version
  or new.quote->'profile'->>'context' is distinct from p.context
  or new.quote->'profile'->>'status' is distinct from p.status
  or new.quote->'profile'->'collection' is distinct from p.collection
  or (new.quote->'profile'->>'effectiveFrom')::timestamptz is distinct from p.effective_from
  or (new.quote->'profile'->>'effectiveTo')::timestamptz is distinct from p.effective_to
  or new.quote->'profile'->>'sourceUrl' is distinct from p.source_url
  or (new.quote->'profile'->>'varianceToleranceKobo')::bigint is distinct from p.variance_tolerance_kobo
  or (new.quote->>'createdAt')::timestamptz is distinct from new.created_at
  or (new.quote->>'expiresAt')::timestamptz is distinct from new.expires_at
 then raise exception 'BACHS_QUOTE_PROFILE_MISMATCH'; end if;
 return new;
end $$;
create trigger bachs_quote_profile before insert on app_private.bachs_checkout_quotes
 for each row execute function app_private.validate_bachs_quote_profile();
create table app_private.bachs_priced_sessions (
 quote_id uuid primary key references app_private.bachs_checkout_quotes(id),
 checkout_id text not null check(char_length(checkout_id) between 3 and 200), provider_mode text not null check(provider_mode in ('live','test')),
 checkout_url text not null, expires_at timestamptz not null, created_at timestamptz not null default now(),
 unique(provider_mode,checkout_id)
);
create trigger bachs_sessions_immutable before update or delete on app_private.bachs_priced_sessions
 for each row execute function app_private.prevent_append_only_mutation();
create function app_private.validate_bachs_session_expiry() returns trigger language plpgsql set search_path='' as $$
declare q app_private.bachs_checkout_quotes;
begin
 select * into q from app_private.bachs_checkout_quotes where id=new.quote_id;
 if q.id is null or new.expires_at<=q.created_at or new.expires_at>q.expires_at
 then raise exception 'BACHS_SESSION_EXPIRY_MISMATCH'; end if;
 return new;
end $$;
create trigger bachs_session_expiry before insert on app_private.bachs_priced_sessions
 for each row execute function app_private.validate_bachs_session_expiry();
-- These are verified pricing observations only. They do not fulfill or credit a purchase.
create table app_private.bachs_pricing_receipts (
 quote_id uuid primary key references app_private.bachs_priced_sessions(quote_id),
 university_id uuid not null, provider_mode text not null check(provider_mode in ('live','test')),
 payment_id text not null check(char_length(payment_id) between 3 and 200), amount_kobo bigint not null check(amount_kobo between 1 and 2000000000), actual_fee_kobo bigint not null check(actual_fee_kobo>=0 and actual_fee_kobo<amount_kobo),
 variance_kobo bigint not null, variance_alert boolean not null, paid_at timestamptz not null, recorded_at timestamptz not null default now(),
 foreign key(quote_id,university_id) references app_private.bachs_checkout_quotes(id,university_id),
 unique(provider_mode,payment_id)
);
create trigger bachs_receipts_immutable before update or delete on app_private.bachs_pricing_receipts
 for each row execute function app_private.prevent_append_only_mutation();
create index bachs_receipt_fee_differences on app_private.bachs_pricing_receipts(university_id,recorded_at desc) where variance_alert;

create function app_private.record_bachs_pricing_receipt(p_quote uuid,p_mode text,p_payment text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns app_private.bachs_pricing_receipts language plpgsql set search_path='' as $$
declare q app_private.bachs_checkout_quotes; s app_private.bachs_priced_sessions; old app_private.bachs_pricing_receipts; result app_private.bachs_pricing_receipts; variance bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('bachs-pricing:'||p_quote::text,0));
 select * into q from app_private.bachs_checkout_quotes where id=p_quote;
 select * into s from app_private.bachs_priced_sessions where quote_id=p_quote;
 if q.id is null or s.quote_id is null or p_mode is null or s.provider_mode<>p_mode or p_amount is null or p_amount<>(q.quote->>'providerAmountKobo')::bigint
  or p_fee is null or p_fee<0 or p_fee>=p_amount or p_payment is null or char_length(p_payment) not between 3 and 200
  or p_paid_at is null or p_paid_at<q.created_at or p_paid_at>s.expires_at
 then raise exception 'BACHS_RECEIPT_QUOTE_MISMATCH'; end if;
 select * into old from app_private.bachs_pricing_receipts where quote_id=p_quote;
 if found then
  if old.provider_mode<>p_mode or old.payment_id<>p_payment or old.amount_kobo<>p_amount or old.actual_fee_kobo<>p_fee or old.paid_at<>p_paid_at
   then raise exception 'BACHS_RECEIPT_IDEMPOTENCY_CONFLICT'; end if;
  return old;
 end if;
 variance=p_fee-(q.quote->>'estimatedProviderFeeKobo')::bigint;
 insert into app_private.bachs_pricing_receipts(quote_id,university_id,provider_mode,payment_id,amount_kobo,actual_fee_kobo,variance_kobo,variance_alert,paid_at)
 values(p_quote,q.university_id,p_mode,p_payment,p_amount,p_fee,variance,abs(variance)>(q.quote->'profile'->>'varianceToleranceKobo')::bigint,p_paid_at) returning * into result;
 return result;
end $$;
revoke all on app_private.bachs_fee_profiles,app_private.bachs_checkout_quotes,app_private.bachs_priced_sessions,app_private.bachs_pricing_receipts from public;
revoke all on function app_private.record_bachs_pricing_receipt(uuid,text,text,bigint,bigint,timestamptz) from public;
commit;
