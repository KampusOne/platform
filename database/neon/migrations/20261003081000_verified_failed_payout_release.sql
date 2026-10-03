begin;
alter table app_private.agent_payout_settlements add column failure_release_journal_id uuid references public.ledger_transactions(id);

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
  fee_allowance_kobo,bank_net_kobo,recipient_code,provider_mode,provider_reference,reserve_journal_id)
  values(target,q.id,p_request,p_user,p_uni,q.agent_type,q.amount_kobo,q.fee_allowance_kobo,q.bank_net_kobo,q.recipient_code,q.provider_mode,ref,journal);
 return target;
end;$$;

create or replace function app_private.prepare_ledger_transfer(p_id uuid,p_uni uuid)
returns app_private.agent_payout_settlements language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;p public.payout_requests%rowtype;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id and university_id=p_uni;
 if not found then raise exception 'PAYOUT_UNAVAILABLE';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where payout_id=p_id for update;
 select * into p from public.payout_requests where id=p_id for update;
 if s.failure_release_journal_id is not null then raise exception 'PAYOUT_FAILURE_ALREADY_RELEASED';end if;
 if p.status not in('APPROVED','PROCESSING','FAILED')then raise exception 'PAYOUT_NOT_APPROVED';end if;
 if not app_private.payout_identity_eligible(p.agent_profile_id,s.user_id,p_uni,s.recipient_code,s.provider_mode)then raise exception 'PAYOUT_ACCOUNT_UNVERIFIED';end if;
 perform app_private.offset_rider_commissions(s.user_id,p_uni);
 if exists(select 1 from app_private.rider_unpaid_commissions(s.user_id))then raise exception 'PAYOUT_COMMISSION_DUE';end if;
 update app_private.agent_payout_settlements set initiated_at=coalesce(initiated_at,now())where payout_id=p_id returning * into s;
 update public.payout_requests set status='PROCESSING',updated_at=now()where id=p_id;
 return s;
end;$$;

create or replace function app_private.guard_payout_settlement()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE'then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 if(old.payout_id,old.quote_id,old.request_id,old.user_id,old.university_id,old.agent_type,old.amount_kobo,old.fee_allowance_kobo,old.bank_net_kobo,old.recipient_code,old.provider_mode,old.provider_reference,old.reserve_journal_id)
 is distinct from(new.payout_id,new.quote_id,new.request_id,new.user_id,new.university_id,new.agent_type,new.amount_kobo,new.fee_allowance_kobo,new.bank_net_kobo,new.recipient_code,new.provider_mode,new.provider_reference,new.reserve_journal_id)
 or(old.failure_release_journal_id is not null and old.failure_release_journal_id is distinct from new.failure_release_journal_id)
 or(old.paid_journal_id is not null and old.paid_journal_id is distinct from new.paid_journal_id)
 or(old.reversal_journal_id is not null and old.reversal_journal_id is distinct from new.reversal_journal_id)
 or(old.transfer_code is not null and old.transfer_code is distinct from new.transfer_code)
 or(old.initiated_at is not null and old.initiated_at is distinct from new.initiated_at)
 then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 return new;
end;$$;

create or replace function app_private.guard_ledger_payout()returns trigger language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;
begin
 if old.financial_version is null and new.financial_version is null then return new;end if;
 if(old.id,old.university_id,old.agent_profile_id,old.requested_by_user_id,old.amount_kobo,old.provider_reference,old.financial_version)
  is distinct from(new.id,new.university_id,new.agent_profile_id,new.requested_by_user_id,new.amount_kobo,new.provider_reference,new.financial_version)
  then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 select * into s from app_private.agent_payout_settlements where payout_id=old.id;
 if s.failure_release_journal_id is not null and new.status<>old.status then raise exception 'PAYOUT_FAILURE_ALREADY_RELEASED';end if;
 if new.status='PAID'and s.paid_journal_id is null then raise exception 'PAYOUT_VERIFIED_TRANSFER_REQUIRED';end if;
 if new.status='REVERSED'and s.reversal_journal_id is null then raise exception 'PAYOUT_VERIFIED_REVERSAL_REQUIRED';end if;
 if new.status in('REJECTED','CANCELLED')and(s.initiated_at is not null or not exists(select 1 from public.ledger_transactions where idempotency_key='payout-reject:'||old.id::text))then raise exception 'PAYOUT_RESERVATION_STILL_HELD';end if;
 if old.status in('PAID','REVERSED','REJECTED','CANCELLED')and new.status<>old.status and not(old.status='PAID'and new.status='REVERSED')then raise exception 'PAYOUT_TERMINAL_STATE';end if;
 return new;
end;$$;


-- Only a server GET observation accepted by the original proof validator releases funds.
-- A timeout, a 404, an initiation acknowledgement or an arbitrary status never does.
alter function app_private.record_ledger_transfer(text,bigint,bigint,text,text,text,text,timestamptz) rename to record_ledger_transfer_before_failure_release;
create function app_private.record_ledger_transfer(p_ref text,p_amount bigint,p_fee bigint,p_recipient text,p_mode text,p_status text,p_code text,p_updated timestamptz)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;result text;journal uuid;cost_delta bigint;
begin
 select * into s from app_private.agent_payout_settlements where provider_reference=p_ref;
 if not found then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where provider_reference=p_ref for update;
 if s.failure_release_journal_id is not null then
  if(s.bank_net_kobo,s.recipient_code,s.provider_mode,s.transfer_code)is distinct from(p_amount,p_recipient,p_mode,p_code)
    or p_fee is null or p_fee<0 or p_updated is null then return 'REQUIRES_REVIEW';end if;
  cost_delta=greatest(0,p_fee-s.cost_recorded_kobo);
  if cost_delta>0 then
   perform app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',s.payout_id::text,'payout-cost:'||p_ref||':'||p_fee::text,'Verified bank transfer processing cost',jsonb_build_array(
    jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',cost_delta),
    jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',cost_delta)));
   update app_private.agent_payout_settlements set cost_recorded_kobo=p_fee,last_verified_at=now() where payout_id=s.payout_id;
  end if;
  insert into app_private.verified_payout_observations(payout_id,provider_reference,status,amount_kobo,fee_kobo,recipient_code,transfer_code,provider_updated_at)
   values(s.payout_id,p_ref,p_status,p_amount,p_fee,p_recipient,p_code,p_updated)on conflict do nothing;
  -- A released reference is terminal in KampusOne. Never send or debit it again.
  if p_status in('failed','abandoned','blocked','rejected','reversed')then return 'FAILED';end if;
  return 'REQUIRES_REVIEW';
 end if;
 if exists(select 1 from app_private.verified_payout_observations where payout_id=s.payout_id and provider_updated_at>p_updated)then
  return (select status from public.payout_requests where id=s.payout_id);
 end if;
 result=app_private.record_ledger_transfer_before_failure_release(p_ref,p_amount,p_fee,p_recipient,p_mode,p_status,p_code,p_updated);
 if result='FAILED' and p_status in('failed','abandoned','blocked','rejected')then
  select * into s from app_private.agent_payout_settlements where provider_reference=p_ref for update;
  if s.paid_journal_id is not null or s.reversal_journal_id is not null then return 'REQUIRES_REVIEW';end if;
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',s.payout_id::text,'payout-failure-release:'||p_ref,'Return a verified conclusive failed withdrawal to the available wallet',jsonb_build_array(
   jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
   jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.amount_kobo)));
  update app_private.agent_payout_settlements set failure_release_journal_id=journal where payout_id=s.payout_id;
 end if;
 return result;
end;$$;
revoke all on function app_private.record_ledger_transfer(text,bigint,bigint,text,text,text,text,timestamptz)from public;

commit;
