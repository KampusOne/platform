begin;
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
        when x.code in ('PAYSTACK_CLEARING','BACHS_CLEARING','BACHS_PAYOUT_CLEARING','RIDER_COMMISSION_RECEIVABLE') then 'ASSET'
        when x.code in ('RIDER_PENDING','RIDER_AVAILABLE','RIDER_PAYOUT_RESERVED','VENDOR_PENDING','VENDOR_AVAILABLE','VENDOR_PAYOUT_RESERVED','TUTOR_PENDING','TUTOR_AVAILABLE','TUTOR_PAYOUT_RESERVED','DELIVERY_LIABILITY','PAYMENT_SUSPENSE','STATUTORY_DUTY_ACCRUAL','PAYOUT_DUTY_RESERVED') then 'LIABILITY'
        when x.code in ('PLATFORM_COMMISSION','KIRA_SUBSCRIPTION_REVENUE','PAYOUT_COST_RECOVERY') then 'REVENUE'
        when x.code in('PROCESSING_EXPENSE','PROMOTION_EXPENSE','STATUTORY_DUTY_EXPENSE') then 'EXPENSE' else null end or
      (x.code like 'RIDER_%' or x.code like 'VENDOR_%' or x.code like 'TUTOR_%' or x.code='PAYOUT_DUTY_RESERVED') is distinct from (x.owner is not null)
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
alter table app_private.payout_cost_policies add column provider text not null default 'PAYSTACK' check(provider in('PAYSTACK','BACHS'));
alter table app_private.agent_payout_quotes add column provider text not null default 'PAYSTACK' check(provider in('PAYSTACK','BACHS')),
 add column connected_account_id text;
alter table app_private.agent_payout_settlements add column provider text not null default 'PAYSTACK' check(provider in('PAYSTACK','BACHS')),
 add column connected_account_id text;
create table app_private.bachs_payout_bridges(
 payout_id uuid primary key references public.payout_requests(id),
 funding_amount_kobo bigint not null check(funding_amount_kobo>0),
 funding_transfer_id text,funding_journal_id uuid references public.ledger_transactions(id),
 provider_payout_id text,provider_failure_reason text,actual_fee_kobo bigint check(actual_fee_kobo>=0),
 recovery_transfer_id text,recovery_amount_kobo bigint check(recovery_amount_kobo>0),recovery_journal_id uuid references public.ledger_transactions(id),
 updated_at timestamptz not null default now()
);
revoke all on app_private.bachs_payout_bridges from public;

create or replace function app_private.create_ledger_payout(p_quote uuid,p_user uuid,p_uni uuid,p_request uuid)
returns uuid language plpgsql set search_path='' as $$
declare q app_private.agent_payout_quotes%rowtype;s app_private.agent_payout_settlements%rowtype;
 target uuid;ref text;journal uuid;available_code text;
begin
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||p_user::text,0));
 select * into s from app_private.agent_payout_settlements where user_id=p_user and request_id=p_request;
 if found then
  if(s.quote_id,s.university_id)is distinct from(p_quote,p_uni)then raise exception 'PAYOUT_REQUEST_CHANGED';end if;
  return s.payout_id;
 end if;
 select * into q from app_private.agent_payout_quotes where id=p_quote and user_id=p_user and university_id=p_uni;
 if not found then raise exception 'PAYOUT_QUOTE_UNAVAILABLE';end if;
 if q.expires_at<=now()then raise exception 'PAYOUT_QUOTE_EXPIRED';end if;
 perform 1 from public.agent_profiles where id=q.agent_profile_id for update;
 if not app_private.payout_identity_eligible(q.agent_profile_id,p_user,p_uni,q.recipient_code,q.provider_mode)
  or not exists(select 1 from app_private.payout_account_setups where id=q.account_setup_id and status='APPROVED')
  then raise exception 'PAYOUT_ACCOUNT_UNVERIFIED';end if;
 if exists(select 1 from public.payout_requests where requested_by_user_id=p_user and
  status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','OTP_REQUIRED','FAILED','REQUIRES_REVIEW') and not exists(select 1 from app_private.agent_payout_settlements released where released.payout_id=public.payout_requests.id and released.failure_release_journal_id is not null))
  then raise exception 'PAYOUT_ALREADY_PENDING';end if;
 perform app_private.offset_rider_commissions(p_user,p_uni);
 if exists(select 1 from app_private.rider_unpaid_commissions(p_user))then raise exception 'PAYOUT_COMMISSION_DUE';end if;
 available_code=q.agent_type||'_AVAILABLE';
 if app_private.finance_balance(p_uni,p_user,available_code)<q.amount_kobo then raise exception 'PAYOUT_BALANCE_INSUFFICIENT';end if;
 target=gen_random_uuid();ref='k1-po-'||target::text;
 journal=app_private.post_finance_journal(p_uni,'AGENT_PAYOUT',target::text,'payout-reserve:'||target::text,'Reserve a quoted agent withdrawal',jsonb_build_array(
  jsonb_build_object('code',available_code,'type','LIABILITY','owner',p_user,'direction','DEBIT','amount',q.amount_kobo),
  jsonb_build_object('code',q.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',p_user,'direction','CREDIT','amount',q.amount_kobo)));
 insert into public.payout_requests(id,university_id,agent_profile_id,requested_by_user_id,amount_kobo,provider_reference,financial_version)
  values(target,p_uni,q.agent_profile_id,p_user,q.amount_kobo,ref,'LEDGER_PAYOUT_V1');
 insert into app_private.agent_payout_settlements(payout_id,quote_id,request_id,user_id,university_id,agent_type,amount_kobo,
  fee_allowance_kobo,bank_net_kobo,payout_commission_kobo,provider,connected_account_id,recipient_code,provider_mode,provider_reference,reserve_journal_id)
  values(target,q.id,p_request,p_user,p_uni,q.agent_type,q.amount_kobo,q.fee_allowance_kobo,q.bank_net_kobo,q.payout_commission_kobo,q.provider,q.connected_account_id,q.recipient_code,q.provider_mode,ref,journal);
 return target;
end;$$;

create or replace function app_private.guard_payout_settlement()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE'then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 if(old.payout_id,old.quote_id,old.request_id,old.user_id,old.university_id,old.agent_type,old.amount_kobo,old.fee_allowance_kobo,old.bank_net_kobo,old.payout_commission_kobo,old.provider,old.connected_account_id,old.recipient_code,old.provider_mode,old.provider_reference,old.reserve_journal_id)
 is distinct from(new.payout_id,new.quote_id,new.request_id,new.user_id,new.university_id,new.agent_type,new.amount_kobo,new.fee_allowance_kobo,new.bank_net_kobo,new.payout_commission_kobo,new.provider,new.connected_account_id,new.recipient_code,new.provider_mode,new.provider_reference,new.reserve_journal_id)
 or(old.actual_statutory_duty_kobo is not null and (old.actual_statutory_duty_kobo,old.statutory_duty_source,old.statutory_duty_reconciled_at) is distinct from (new.actual_statutory_duty_kobo,new.statutory_duty_source,new.statutory_duty_reconciled_at))
 or(old.retained_transfer_fee_kobo is not null and old.retained_transfer_fee_kobo is distinct from new.retained_transfer_fee_kobo)
 or(old.failure_release_journal_id is not null and old.failure_release_journal_id is distinct from new.failure_release_journal_id)
 or(old.paid_journal_id is not null and old.paid_journal_id is distinct from new.paid_journal_id)
 or(old.reversal_journal_id is not null and old.reversal_journal_id is distinct from new.reversal_journal_id)
 or(old.transfer_code is not null and old.transfer_code is distinct from new.transfer_code)
 or(old.initiated_at is not null and old.initiated_at is distinct from new.initiated_at)
 then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 return new;
end;$$;

create function app_private.record_bachs_payout_funding(p_id uuid,p_transfer text,p_amount bigint,p_account text)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;b app_private.bachs_payout_bridges%rowtype;journal uuid;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id;
 if not found or s.provider<>'BACHS' then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into b from app_private.bachs_payout_bridges where payout_id=p_id for update;
 if not found or b.funding_amount_kobo<>p_amount or s.connected_account_id<>p_account or p_transfer!~'^tr_[A-Za-z0-9_-]{8,128}$' or s.initiated_at is null then raise exception 'BACHS_FUNDING_MISMATCH';end if;
 if b.funding_journal_id is not null then
  if b.funding_transfer_id<>p_transfer then raise exception 'BACHS_FUNDING_MISMATCH';end if;return 'FUNDED';
 end if;
 journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p_id::text,'bachs-payout-fund:'||s.provider_reference,'Verified funding of the agent bank payout',jsonb_build_array(
 jsonb_build_object('code','BACHS_CLEARING','type','ASSET','direction','CREDIT','amount',p_amount),
 jsonb_build_object('code','BACHS_PAYOUT_CLEARING','type','ASSET','direction','DEBIT','amount',p_amount)));
 update app_private.bachs_payout_bridges set funding_transfer_id=p_transfer,funding_journal_id=journal,updated_at=now()where payout_id=p_id;
 return 'FUNDED';
end;$$;
create function app_private.record_bachs_agent_payout(p_id uuid,p_provider_id text,p_amount bigint,p_fee bigint,p_destination text,p_account text,p_mode text,p_status text,p_updated timestamptz)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;b app_private.bachs_payout_bridges%rowtype;journal uuid;lines jsonb;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id;
 if not found or s.provider<>'BACHS' then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where payout_id=p_id for update;
 select * into b from app_private.bachs_payout_bridges where payout_id=p_id for update;
 if b.funding_journal_id is null or s.initiated_at is null or(s.bank_net_kobo,s.recipient_code,s.connected_account_id,s.provider_mode)is distinct from(p_amount,p_destination,p_account,p_mode)
 or p_fee is null or p_fee<0 or p_fee>1000000 or(p_status='completed' and p_amount+p_fee>b.funding_amount_kobo) or p_provider_id!~'^pay_[A-Za-z0-9_-]{8,128}$' or p_status not in('pending','processing','completed','failed')
 or(b.provider_payout_id is not null and b.provider_payout_id<>p_provider_id) or(p_status='completed' and p_updated is null)then return 'REQUIRES_REVIEW';end if;
 if s.failure_release_journal_id is not null then return case when p_status='failed' then 'FAILED' else 'REQUIRES_REVIEW' end;end if;
 if s.paid_journal_id is not null then return case when p_status='completed' then 'PAID' else 'REQUIRES_REVIEW' end;end if;
 update app_private.bachs_payout_bridges set provider_payout_id=p_provider_id,actual_fee_kobo=case when p_status in('completed','failed') then p_fee else actual_fee_kobo end,updated_at=now()where payout_id=p_id;
 update app_private.agent_payout_settlements set provider_status=p_status,last_verified_at=now()where payout_id=p_id;
 if p_status='completed' then
  lines=jsonb_build_array(
   jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
   jsonb_build_object('code','BACHS_PAYOUT_CLEARING','type','ASSET','direction','CREDIT','amount',s.bank_net_kobo));
  if s.payout_commission_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',s.payout_commission_kobo));end if;
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p_id::text,'payout-paid:'||s.provider_reference,'Bachs GET confirmed the exact saved bank payout',lines);
  if p_fee>0 then perform app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p_id::text,'bachs-payout-fee:'||s.provider_reference,'Verified Bachs payout fee absorbed by the platform',jsonb_build_array(
   jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',p_fee),
   jsonb_build_object('code','BACHS_PAYOUT_CLEARING','type','ASSET','direction','CREDIT','amount',p_fee)));end if;
  update app_private.agent_payout_settlements set paid_journal_id=journal,cost_recorded_kobo=p_fee where payout_id=p_id;
  update public.payout_requests set status='PAID',paid_at=p_updated,updated_at=now()where id=p_id;return 'PAID';
 elsif p_status='failed' then
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p_id::text,'payout-failure-return:'||s.provider_reference,'Bachs GET confirmed bank payout failure; restore the full withdrawal',jsonb_build_array(
   jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
   jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.amount_kobo)));
  update public.payout_requests set status='FAILED',updated_at=now()where id=p_id;
  update app_private.agent_payout_settlements set failure_release_journal_id=journal where payout_id=p_id;return 'FAILED';
 end if;
 return 'PROCESSING';
end;$$;
create function app_private.record_bachs_payout_recovery(p_id uuid,p_transfer text,p_amount bigint)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;b app_private.bachs_payout_bridges%rowtype;journal uuid;lines jsonb;remaining bigint;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id;
 if not found or s.provider<>'BACHS' then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into b from app_private.bachs_payout_bridges where payout_id=p_id for update;
 if b.recovery_journal_id is not null then
  if b.recovery_transfer_id<>p_transfer then raise exception 'BACHS_RECOVERY_MISMATCH';end if;return 'RECOVERED';end if;
 if s.failure_release_journal_id is not null then remaining=b.funding_amount_kobo;
 elsif s.paid_journal_id is not null then remaining=b.funding_amount_kobo-s.bank_net_kobo-coalesce(b.actual_fee_kobo,0);
 else raise exception 'BACHS_PAYOUT_NOT_FINAL';end if;
 if p_amount is distinct from b.recovery_amount_kobo or p_transfer!~'^tr_[A-Za-z0-9_-]{8,128}$' or p_amount<=0 or p_amount>remaining or (s.failure_release_journal_id is not null and p_amount<s.bank_net_kobo)then raise exception 'BACHS_RECOVERY_MISMATCH';end if;
 lines=jsonb_build_array(
  jsonb_build_object('code','BACHS_CLEARING','type','ASSET','direction','DEBIT','amount',p_amount),
  jsonb_build_object('code','BACHS_PAYOUT_CLEARING','type','ASSET','direction','CREDIT','amount',remaining));
 if remaining>p_amount then lines=lines||jsonb_build_array(jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',remaining-p_amount));end if;
 journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p_id::text,'bachs-payout-recovery:'||s.provider_reference,'Verified Bachs recovery of unused or failed payout funds',lines);
 update app_private.bachs_payout_bridges set recovery_transfer_id=p_transfer,recovery_journal_id=journal,updated_at=now()where payout_id=p_id;
 return 'RECOVERED';
end;$$;
revoke all on function app_private.record_bachs_payout_funding(uuid,text,bigint,text),app_private.record_bachs_agent_payout(uuid,text,bigint,bigint,text,text,text,text,timestamptz),app_private.record_bachs_payout_recovery(uuid,text,bigint) from public;

alter table app_private.payout_cost_policies add constraint bachs_withdrawal_policy check(provider<>'BACHS' or (fee_bearer='PLATFORM' and jsonb_array_length(commission_tiers)>0));
alter table app_private.agent_payout_quotes add constraint bachs_withdrawal_quote_bound check(provider<>'BACHS' or (connected_account_id is not null and recipient_code ~ '^pd_[A-Za-z0-9_-]{8,128}$'));
alter table app_private.agent_payout_settlements add constraint bachs_withdrawal_settlement_bound check(provider<>'BACHS' or (connected_account_id is not null and recipient_code ~ '^pd_[A-Za-z0-9_-]{8,128}$'));
create function app_private.guard_bachs_payout_bridge()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or(old.payout_id,old.funding_amount_kobo)is distinct from(new.payout_id,new.funding_amount_kobo)
 or(old.funding_transfer_id is not null and old.funding_transfer_id is distinct from new.funding_transfer_id)
 or(old.funding_journal_id is not null and old.funding_journal_id is distinct from new.funding_journal_id)
 or(old.provider_payout_id is not null and old.provider_payout_id is distinct from new.provider_payout_id)
 or(old.actual_fee_kobo is not null and old.actual_fee_kobo is distinct from new.actual_fee_kobo)
 or(old.recovery_amount_kobo is not null and old.recovery_amount_kobo is distinct from new.recovery_amount_kobo)
 or(old.recovery_transfer_id is not null and old.recovery_transfer_id is distinct from new.recovery_transfer_id)
 or(old.recovery_journal_id is not null and old.recovery_journal_id is distinct from new.recovery_journal_id)
 then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 return new;
end;$$;
create trigger bachs_payout_bridge_sealed before update or delete on app_private.bachs_payout_bridges for each row execute function app_private.guard_bachs_payout_bridge();
revoke all on function app_private.guard_bachs_payout_bridge() from public;

create or replace function app_private.validate_payout_quote_components()returns trigger language plpgsql set search_path='' as $$
declare policy app_private.payout_cost_policies%rowtype;
begin
 select * into policy from app_private.payout_cost_policies where id=new.policy_id and university_id=new.university_id and agent_type=new.agent_type;
 if not found or policy.provider<>new.provider then raise exception 'PAYOUT_POLICY_UNAVAILABLE';end if;
 if not exists(select 1 from app_private.payout_account_setups a where a.id=new.account_setup_id and a.user_id=new.user_id and a.institution_id=new.university_id and a.agent_profile_id=new.agent_profile_id and a.provider=new.provider and a.recipient_code=new.recipient_code and a.connected_account_id is not distinct from new.connected_account_id and a.status='APPROVED')then raise exception 'PAYOUT_ACCOUNT_UNVERIFIED';end if;
 if new.amount_kobo<coalesce(new.minimum_withdrawal_kobo,policy.minimum_withdrawal_kobo) then raise exception 'PAYOUT_BELOW_MINIMUM';end if;
 if new.expected_transfer_fee_kobo is not null then
  if new.minimum_withdrawal_kobo<>policy.minimum_withdrawal_kobo or new.statutory_duty_policy<>policy.statutory_duty_policy
   or new.statutory_duty_allowance_kobo<>0 then raise exception 'PAYOUT_POLICY_CHANGED';end if;
 end if;
 if new.payout_commission_kobo<>app_private.withdrawal_commission(new.amount_kobo,policy.commission_tiers) then raise exception 'PAYOUT_COMMISSION_CHANGED';end if;
 return new;
end;$$;
commit;
