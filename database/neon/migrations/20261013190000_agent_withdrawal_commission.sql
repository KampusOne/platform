begin;
-- Buyer commission remains 2.5%. New withdrawal quotes carry separate 5-8%
-- graduated commission; old quotes, receipts and journals retain their amounts.
alter table app_private.payout_cost_policies add column commission_tiers jsonb not null default '[]'::jsonb;
alter table app_private.agent_payout_quotes add column payout_commission_kobo bigint not null default 0 check(payout_commission_kobo>=0);
alter table app_private.agent_payout_settlements add column payout_commission_kobo bigint not null default 0 check(payout_commission_kobo>=0);
do $$declare constraint_name text;begin
 for constraint_name in select conname from pg_constraint where conrelid='app_private.agent_payout_quotes'::regclass and contype='c' and pg_get_constraintdef(oid) like '%bank_net_kobo%' and pg_get_constraintdef(oid) like '%fee_allowance_kobo%' loop
 execute format('alter table app_private.agent_payout_quotes drop constraint %I',constraint_name);
 end loop;
end;$$;
alter table app_private.agent_payout_quotes add constraint agent_payout_quotes_bank_net_kobo_check check(bank_net_kobo>0 and bank_net_kobo+fee_allowance_kobo+payout_commission_kobo=amount_kobo);
alter table app_private.agent_payout_settlements drop constraint agent_payout_settlements_check;
alter table app_private.agent_payout_settlements add constraint agent_payout_settlements_check check(amount_kobo=bank_net_kobo+fee_allowance_kobo+payout_commission_kobo);
create function app_private.withdrawal_commission(p_amount bigint,p_tiers jsonb)returns bigint language plpgsql immutable set search_path='' as $$
declare tier jsonb; previous bigint:=0; finish bigint; rate integer; last_rate integer:=800; weighted numeric:=0; position integer:=0;
begin
 if p_amount<0 or p_amount>1000000000 or jsonb_typeof(p_tiers)<>'array' then raise exception 'PAYOUT_COMMISSION_INVALID';end if;
 if jsonb_array_length(p_tiers)=0 then return 0;end if;
 if jsonb_array_length(p_tiers)>8 or p_tiers->-1->>'upToKobo' is not null then raise exception 'PAYOUT_COMMISSION_INVALID';end if;
 for tier in select value from jsonb_array_elements(p_tiers) loop
  position=position+1;rate=(tier->>'basisPoints')::integer;finish=coalesce((tier->>'upToKobo')::bigint,p_amount);
  if rate is null or rate<500 or rate>last_rate or (tier->>'upToKobo' is null and position<>jsonb_array_length(p_tiers)) or (tier->>'upToKobo' is not null and finish<=previous) then raise exception 'PAYOUT_COMMISSION_INVALID';end if;
  weighted=weighted+greatest(0,least(p_amount,finish)-previous)*rate;previous=finish;last_rate=rate;
 end loop;
 return floor((weighted+5000)/10000)::bigint;
end;$$;

create or replace function app_private.validate_payout_quote_components()returns trigger language plpgsql set search_path='' as $$
declare policy app_private.payout_cost_policies%rowtype;
begin
 select * into policy from app_private.payout_cost_policies where id=new.policy_id and university_id=new.university_id and agent_type=new.agent_type;
 if not found then raise exception 'PAYOUT_POLICY_UNAVAILABLE';end if;
 if new.amount_kobo<coalesce(new.minimum_withdrawal_kobo,policy.minimum_withdrawal_kobo) then raise exception 'PAYOUT_BELOW_MINIMUM';end if;
 if new.expected_transfer_fee_kobo is not null then
  if new.minimum_withdrawal_kobo<>policy.minimum_withdrawal_kobo or new.statutory_duty_policy<>policy.statutory_duty_policy
   or new.statutory_duty_allowance_kobo<>0 then raise exception 'PAYOUT_POLICY_CHANGED';end if;
 end if;
 if new.payout_commission_kobo<>app_private.withdrawal_commission(new.amount_kobo,policy.commission_tiers) then raise exception 'PAYOUT_COMMISSION_CHANGED';end if;
 return new;
end;$$;

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
  fee_allowance_kobo,bank_net_kobo,payout_commission_kobo,recipient_code,provider_mode,provider_reference,reserve_journal_id)
  values(target,q.id,p_request,p_user,p_uni,q.agent_type,q.amount_kobo,q.fee_allowance_kobo,q.bank_net_kobo,q.payout_commission_kobo,q.recipient_code,q.provider_mode,ref,journal);
 return target;
end;$$;

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
  if s.payout_commission_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',s.payout_commission_kobo));end if;
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
    jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.bank_net_kobo+retained+s.payout_commission_kobo));
   if retained>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_COST_RECOVERY','type','REVENUE','direction','DEBIT','amount',retained));end if;
   if s.payout_commission_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','DEBIT','amount',s.payout_commission_kobo));end if;
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

create or replace function app_private.guard_payout_settlement()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE'then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 if(old.payout_id,old.quote_id,old.request_id,old.user_id,old.university_id,old.agent_type,old.amount_kobo,old.fee_allowance_kobo,old.bank_net_kobo,old.payout_commission_kobo,old.recipient_code,old.provider_mode,old.provider_reference,old.reserve_journal_id)
 is distinct from(new.payout_id,new.quote_id,new.request_id,new.user_id,new.university_id,new.agent_type,new.amount_kobo,new.fee_allowance_kobo,new.bank_net_kobo,new.payout_commission_kobo,new.recipient_code,new.provider_mode,new.provider_reference,new.reserve_journal_id)
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

create function app_private.notify_agent_payout()returns trigger language plpgsql set search_path='' as $$
declare headline text; message text; key text;
begin
 if tg_op='UPDATE' and old.status=new.status then return new;end if;
 if new.status='REQUESTED' then headline='Payout pending';message='Your payout request is waiting for approval.';
 elsif new.status='PAID' then headline='Payout completed';message='The payment provider confirmed your bank transfer.';
 elsif new.status in('FAILED','REVERSED','REJECTED') then headline='Payout update';message=case when new.status='REJECTED' then 'Your request was not approved. Reserved earnings were returned to your wallet.' when new.status='REVERSED' then 'The bank reversed this transfer. Check Earnings for your restored balance.' else 'The transfer did not complete. Your reserved funds remain tracked until the provider result is reconciled.' end;
 else return new;end if;
 key='payout:'||new.id::text||':'||new.status;
 insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key)values(new.requested_by_user_id,new.university_id,headline,message,'/earnings',key)on conflict do nothing;
 insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)values(new.requested_by_user_id,'PUSH',headline,message,key)on conflict do nothing;
 return new;
end;$$;
create trigger agent_payout_notifications after insert or update of status on public.payout_requests for each row execute function app_private.notify_agent_payout();
revoke all on function app_private.withdrawal_commission(bigint,jsonb),app_private.notify_agent_payout() from public;
commit;
