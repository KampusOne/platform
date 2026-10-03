begin;

-- Extend the existing guarded journal account taxonomy for separate statutory duty.
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

-- Approved policies remain immutable. Defaults preserve the previous ₦5,000
-- withdrawal minimum; seller (VENDOR) and other agent roles can version it independently.
alter table app_private.payout_cost_policies
 add column minimum_withdrawal_kobo bigint not null default 500000 check(minimum_withdrawal_kobo between 1 and 1000000000),
 add column statutory_duty_policy text not null default 'PLATFORM_ABSORBS_PENDING_STATEMENT'
  check(statutory_duty_policy='PLATFORM_ABSORBS_PENDING_STATEMENT');
alter table app_private.agent_payout_quotes drop constraint agent_payout_quotes_amount_kobo_check;
alter table app_private.agent_payout_quotes add constraint agent_payout_quotes_amount_kobo_check check(amount_kobo between 1 and 1000000000);
alter table app_private.agent_payout_quotes
 add column expected_transfer_fee_kobo bigint check(expected_transfer_fee_kobo>=0),
 add column expected_statutory_duty_kobo bigint check(expected_statutory_duty_kobo>=0),
 add column transfer_fee_allowance_kobo bigint check(transfer_fee_allowance_kobo>=0),
 add column statutory_duty_allowance_kobo bigint check(statutory_duty_allowance_kobo>=0),
 add column minimum_withdrawal_kobo bigint check(minimum_withdrawal_kobo>0),
 add column statutory_duty_policy text check(statutory_duty_policy in('PLATFORM_ABSORBS_PENDING_STATEMENT','LEGACY_PAYEE_RESERVED_PENDING_STATEMENT')),
 add constraint payout_quote_fee_components check(
  expected_transfer_fee_kobo is null or (
   expected_statutory_duty_kobo is not null and transfer_fee_allowance_kobo is not null and statutory_duty_allowance_kobo is not null
   and minimum_withdrawal_kobo is not null and statutory_duty_policy is not null
   and estimated_fee_kobo=expected_transfer_fee_kobo+expected_statutory_duty_kobo
   and fee_allowance_kobo=transfer_fee_allowance_kobo+statutory_duty_allowance_kobo));
-- Historical quotes are not rewritten. Nullable components identify their original snapshot.
create function app_private.validate_payout_quote_components()returns trigger language plpgsql set search_path='' as $$
declare policy app_private.payout_cost_policies%rowtype;
begin
 select * into policy from app_private.payout_cost_policies where id=new.policy_id and university_id=new.university_id and agent_type=new.agent_type;
 if not found then raise exception 'PAYOUT_POLICY_UNAVAILABLE';end if;
 if new.amount_kobo<coalesce(new.minimum_withdrawal_kobo,policy.minimum_withdrawal_kobo) then raise exception 'PAYOUT_BELOW_MINIMUM';end if;
 if new.expected_transfer_fee_kobo is not null then
  if new.minimum_withdrawal_kobo<>policy.minimum_withdrawal_kobo or new.statutory_duty_policy<>policy.statutory_duty_policy
   or new.statutory_duty_allowance_kobo<>0 then raise exception 'PAYOUT_POLICY_CHANGED';end if;
 end if;
 return new;
end;$$;
create trigger payout_quote_components_validated before insert on app_private.agent_payout_quotes
 for each row execute function app_private.validate_payout_quote_components();

alter table app_private.agent_payout_settlements
 add column retained_transfer_fee_kobo bigint check(retained_transfer_fee_kobo>=0),
 add column statutory_duty_reserved_kobo bigint not null default 0 check(statutory_duty_reserved_kobo>=0),
 add column expected_duty_accrued_kobo bigint not null default 0 check(expected_duty_accrued_kobo>=0),
 add column actual_statutory_duty_kobo bigint check(actual_statutory_duty_kobo>=0),
 add column statutory_duty_source text check(statutory_duty_source='PAYSTACK_BALANCE_STATEMENT'),
 add column statutory_duty_reconciled_at timestamptz;
alter table app_private.verified_payout_observations
 add column transfer_fee_source text not null default 'PAYSTACK_TRANSFER_VERIFY' check(transfer_fee_source='PAYSTACK_TRANSFER_VERIFY');
create table app_private.payout_duty_observations(
 id uuid primary key default gen_random_uuid(),payout_id uuid not null unique references public.payout_requests(id),
 university_id uuid not null references public.universities(id),actual_duty_kobo bigint not null check(actual_duty_kobo between 0 and 1000000),
 source text not null default 'PAYSTACK_BALANCE_STATEMENT' check(source='PAYSTACK_BALANCE_STATEMENT'),
 statement_reference text not null check(length(statement_reference) between 3 and 200),
 reviewed_by uuid not null references public.users(id),review_note text not null check(length(review_note) between 10 and 2000),
 recorded_at timestamptz not null default now()
);
create trigger payout_duty_observation_immutable before update or delete on app_private.payout_duty_observations
 for each row execute function app_private.prevent_append_only_mutation();

-- Keep the conclusive-failure wrapper from 20261003081000 unchanged. Only its
-- validated inner accounting separates transfer cost from statement-only duty.
create or replace function app_private.record_ledger_transfer_before_failure_release(p_ref text,p_amount bigint,p_fee bigint,p_recipient text,p_mode text,p_status text,p_code text,p_updated timestamptz)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;p public.payout_requests%rowtype;q app_private.agent_payout_quotes%rowtype;
 policy app_private.payout_cost_policies%rowtype;journal uuid;lines jsonb;retained bigint;unused bigint;cost_delta bigint;
 expected_duty bigint;duty_allowance bigint;transfer_allowance bigint;
begin
 select * into s from app_private.agent_payout_settlements where provider_reference=p_ref;
 if not found then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where provider_reference=p_ref for update;
 select * into p from public.payout_requests where id=s.payout_id for update;
 select * into q from app_private.agent_payout_quotes where id=s.quote_id;
 select * into policy from app_private.payout_cost_policies where id=q.policy_id;
 expected_duty=coalesce(q.expected_statutory_duty_kobo,case when q.amount_kobo>=policy.duty_threshold_kobo then policy.duty_kobo else 0 end);
 duty_allowance=coalesce(q.statutory_duty_allowance_kobo,least(q.fee_allowance_kobo,expected_duty));
 transfer_allowance=coalesce(q.transfer_fee_allowance_kobo,q.fee_allowance_kobo-duty_allowance);
 if s.initiated_at is null or(s.bank_net_kobo,s.recipient_code,s.provider_mode)is distinct from(p_amount,p_recipient,p_mode)
  or p_fee is null or p_fee<0 or p_code is null or p_code!~'^TRF_[A-Za-z0-9]+$' or p_updated is null
  or p_status not in('pending','processing','otp','success','failed','reversed','abandoned','blocked','rejected','received')
  or(s.transfer_code is not null and s.transfer_code<>p_code)then
  if p.status not in('PAID','REVERSED')then update public.payout_requests set status='REQUIRES_REVIEW',updated_at=now()where id=p.id;end if;
  return 'REQUIRES_REVIEW';
 end if;
 insert into app_private.verified_payout_observations(payout_id,provider_reference,status,amount_kobo,fee_kobo,recipient_code,transfer_code,provider_updated_at)
  values(p.id,p_ref,p_status,p_amount,p_fee,p_recipient,p_code,p_updated)on conflict do nothing;
 if s.reversal_journal_id is not null and p_status<>'reversed'then return 'REQUIRES_REVIEW';end if;
 -- fee_charged is a transfer-fee observation, never proof of zero/refunded stamp duty.
 cost_delta=greatest(0,p_fee-s.cost_recorded_kobo);
 if cost_delta>0 then
  perform app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-cost:'||p_ref||':'||p_fee::text,'Verified Paystack transfer fee, excluding separate statutory duty',jsonb_build_array(
   jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',cost_delta),
   jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',cost_delta)));
 end if;
 update app_private.agent_payout_settlements set transfer_code=p_code,provider_status=p_status,
  cost_recorded_kobo=greatest(cost_recorded_kobo,p_fee),last_verified_at=now()where payout_id=p.id;
 if s.reversal_journal_id is not null then return 'REVERSED';end if;
 if p_status='success'then
  if s.paid_journal_id is not null then return 'PAID';end if;
  if expected_duty>0 then
   perform app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-duty-accrual:'||p_ref,'Expected statutory duty awaiting Paystack Balance statement',jsonb_build_array(
    jsonb_build_object('code','STATUTORY_DUTY_EXPENSE','type','EXPENSE','direction','DEBIT','amount',expected_duty),
    jsonb_build_object('code','STATUTORY_DUTY_ACCRUAL','type','LIABILITY','direction','CREDIT','amount',expected_duty)));
  end if;
  retained=least(p_fee,transfer_allowance);unused=transfer_allowance-retained;
  lines=jsonb_build_array(
   jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
   jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',s.bank_net_kobo));
  if retained>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_COST_RECOVERY','type','REVENUE','direction','CREDIT','amount',retained));end if;
  if duty_allowance>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_DUTY_RESERVED','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',duty_allowance));end if;
  if unused>0 then lines=lines||jsonb_build_array(jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',unused));end if;
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-paid:'||p_ref,'Verified bank transfer completed; statutory duty reconciles separately',lines);
  update app_private.agent_payout_settlements set paid_journal_id=journal,retained_fee_kobo=retained+duty_allowance,
   retained_transfer_fee_kobo=retained,statutory_duty_reserved_kobo=duty_allowance,expected_duty_accrued_kobo=expected_duty where payout_id=p.id;
  update public.payout_requests set status='PAID',paid_at=p_updated,updated_at=now()where id=p.id;
  return 'PAID';
 elsif p_status='reversed'then
  if s.paid_journal_id is null then
   lines=jsonb_build_array(
    jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
    jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.amount_kobo));
  else
   retained=coalesce(s.retained_transfer_fee_kobo,s.retained_fee_kobo,0);
   lines=jsonb_build_array(
    jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','DEBIT','amount',s.bank_net_kobo),
    jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.bank_net_kobo+retained));
   if retained>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_COST_RECOVERY','type','REVENUE','direction','DEBIT','amount',retained));end if;
   -- A principal reversal cannot establish that separately charged statutory duty was returned.
  end if;
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-reversed:'||p_ref,'Verified bank reversal; duty remains subject to statement reconciliation',lines);
  update app_private.agent_payout_settlements set reversal_journal_id=journal where payout_id=p.id;
  update public.payout_requests set status='REVERSED',updated_at=now()where id=p.id;
  return 'REVERSED';
 end if;
 if s.paid_journal_id is not null then return 'PAID';end if;
 update public.payout_requests set status=case when p_status='otp'then 'OTP_REQUIRED' when p_status in('failed','abandoned','blocked','rejected')then 'FAILED'else 'PROCESSING'end,updated_at=now()where id=p.id;
 return case when p_status='otp'then 'OTP_REQUIRED' when p_status in('failed','abandoned','blocked','rejected')then 'FAILED'else 'PROCESSING'end;
end;$$;

create function app_private.reconcile_payout_duty(p_id uuid,p_uni uuid,p_duty bigint,p_statement text,p_actor uuid,p_note text)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;old_observation app_private.payout_duty_observations%rowtype;
 lines jsonb='[]'::jsonb;retained bigint;unused bigint;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id and university_id=p_uni;
 if not found then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where payout_id=p_id for update;
 if p_duty is null or p_duty<0 or p_duty>1000000 or length(p_statement) not between 3 and 200 or length(p_note) not between 10 and 2000 or p_actor is null
  then raise exception 'PAYOUT_DUTY_EVIDENCE_REQUIRED';end if;
 if s.initiated_at is null or s.provider_status not in('success','reversed','failed','abandoned','blocked','rejected')then return 'TRANSFER_NOT_FINAL';end if;
 select * into old_observation from app_private.payout_duty_observations where payout_id=p_id;
 if found then
  if(old_observation.actual_duty_kobo,old_observation.statement_reference)is distinct from(p_duty,p_statement)then raise exception 'PAYOUT_DUTY_ALREADY_RECONCILED';end if;
  return 'RECONCILED';
 end if;
 insert into app_private.payout_duty_observations(payout_id,university_id,actual_duty_kobo,statement_reference,reviewed_by,review_note)
  values(p_id,p_uni,p_duty,p_statement,p_actor,p_note);
 if s.expected_duty_accrued_kobo>0 then lines=lines||jsonb_build_array(
  jsonb_build_object('code','STATUTORY_DUTY_ACCRUAL','type','LIABILITY','direction','DEBIT','amount',s.expected_duty_accrued_kobo),
  jsonb_build_object('code','STATUTORY_DUTY_EXPENSE','type','EXPENSE','direction','CREDIT','amount',s.expected_duty_accrued_kobo));end if;
 if p_duty>0 then lines=lines||jsonb_build_array(
  jsonb_build_object('code','STATUTORY_DUTY_EXPENSE','type','EXPENSE','direction','DEBIT','amount',p_duty),
  jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',p_duty));end if;
 retained=least(s.statutory_duty_reserved_kobo,p_duty);unused=s.statutory_duty_reserved_kobo-retained;
 if s.statutory_duty_reserved_kobo>0 then lines=lines||jsonb_build_array(
  jsonb_build_object('code','PAYOUT_DUTY_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.statutory_duty_reserved_kobo));end if;
 if retained>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_COST_RECOVERY','type','REVENUE','direction','CREDIT','amount',retained));end if;
 if unused>0 then lines=lines||jsonb_build_array(jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',unused));end if;
 if jsonb_array_length(lines)>0 then perform app_private.post_finance_journal(p_uni,'AGENT_PAYOUT',p_id::text,'payout-duty-statement:'||s.provider_reference,'Reviewed Paystack Balance statement statutory duty; platform absorbs excess variance',lines);end if;
 update app_private.agent_payout_settlements set actual_statutory_duty_kobo=p_duty,statutory_duty_source='PAYSTACK_BALANCE_STATEMENT',statutory_duty_reconciled_at=now(),statutory_duty_reserved_kobo=0 where payout_id=p_id;
 return 'RECONCILED';
end;$$;
create or replace function app_private.guard_payout_settlement()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE'then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 if(old.payout_id,old.quote_id,old.request_id,old.user_id,old.university_id,old.agent_type,old.amount_kobo,old.fee_allowance_kobo,old.bank_net_kobo,old.recipient_code,old.provider_mode,old.provider_reference,old.reserve_journal_id)
 is distinct from(new.payout_id,new.quote_id,new.request_id,new.user_id,new.university_id,new.agent_type,new.amount_kobo,new.fee_allowance_kobo,new.bank_net_kobo,new.recipient_code,new.provider_mode,new.provider_reference,new.reserve_journal_id)
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
revoke all on app_private.payout_duty_observations from public;
revoke all on function app_private.validate_payout_quote_components(),app_private.reconcile_payout_duty(uuid,uuid,bigint,text,uuid,text) from public;
commit;
