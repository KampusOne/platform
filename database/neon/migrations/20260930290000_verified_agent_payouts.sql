begin;

-- No rate policy, legacy balance or paid transfer is invented/backfilled.
create table app_private.payout_cost_policies(
 id uuid primary key,university_id uuid not null references public.universities(id),
 agent_type text not null check(agent_type in('VENDOR','TUTOR','RIDER')),
 version text not null,fee_bearer text not null check(fee_bearer in('PLATFORM','PAYEE')),
 low_fee_kobo bigint not null check(low_fee_kobo between 0 and 1000000),
 middle_fee_kobo bigint not null check(middle_fee_kobo between 0 and 1000000),
 high_fee_kobo bigint not null check(high_fee_kobo between 0 and 1000000),
 duty_threshold_kobo bigint not null check(duty_threshold_kobo>=0),duty_kobo bigint not null check(duty_kobo between 0 and 1000000),
 source_url text not null,approval_note text not null,
 approved_by uuid not null references public.users(id),approved_at timestamptz not null default now(),
 unique(university_id,agent_type,version)
);
create trigger payout_cost_policy_immutable before update or delete on app_private.payout_cost_policies
 for each row execute function app_private.prevent_append_only_mutation();
create table app_private.active_payout_cost_policies(
 university_id uuid not null references public.universities(id),agent_type text not null,
 policy_id uuid not null references app_private.payout_cost_policies(id),primary key(university_id,agent_type)
);
create table app_private.agent_payout_quotes(
 id uuid primary key,user_id uuid not null references public.users(id),university_id uuid not null references public.universities(id),
 agent_profile_id uuid not null references public.agent_profiles(id),agent_type text not null check(agent_type in('VENDOR','TUTOR','RIDER')),
 policy_id uuid not null references app_private.payout_cost_policies(id),account_setup_id uuid not null references app_private.payout_account_setups(id),
 recipient_code text not null,provider_mode text not null check(provider_mode in('test','live')),
 amount_kobo bigint not null check(amount_kobo between 500000 and 1000000000),
 estimated_fee_kobo bigint not null check(estimated_fee_kobo>=0),fee_allowance_kobo bigint not null check(fee_allowance_kobo>=0),
 bank_net_kobo bigint not null check(bank_net_kobo>0 and bank_net_kobo+fee_allowance_kobo=amount_kobo),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes'
);
create trigger agent_payout_quote_immutable before update or delete on app_private.agent_payout_quotes
 for each row execute function app_private.prevent_append_only_mutation();
alter table public.payout_requests add column financial_version text check(financial_version='LEDGER_PAYOUT_V1');
alter table public.payout_requests drop constraint payout_requests_status_check;
alter table public.payout_requests add constraint payout_requests_status_check
 check(status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','OTP_REQUIRED','PAID','FAILED','REVERSED','REQUIRES_REVIEW','REJECTED','CANCELLED'));
create table app_private.agent_payout_settlements(
 payout_id uuid primary key references public.payout_requests(id),quote_id uuid not null unique references app_private.agent_payout_quotes(id),
 request_id uuid not null,user_id uuid not null references public.users(id),university_id uuid not null references public.universities(id),
 agent_type text not null,amount_kobo bigint not null,fee_allowance_kobo bigint not null,bank_net_kobo bigint not null,
 recipient_code text not null,provider_mode text not null,
 provider_reference text not null unique check(provider_reference ~ '^[a-z0-9_-]{16,50}$'),
 reserve_journal_id uuid not null references public.ledger_transactions(id),
 initiated_at timestamptz,transfer_code text,provider_status text,
 paid_journal_id uuid references public.ledger_transactions(id),reversal_journal_id uuid references public.ledger_transactions(id),
 cost_recorded_kobo bigint not null default 0 check(cost_recorded_kobo>=0),
 retained_fee_kobo bigint check(retained_fee_kobo>=0),last_verified_at timestamptz,
 created_at timestamptz not null default now(),unique(user_id,request_id),
 check(amount_kobo=bank_net_kobo+fee_allowance_kobo)
);
create table app_private.verified_payout_observations(
 id uuid primary key default gen_random_uuid(),payout_id uuid not null references public.payout_requests(id),
 provider_reference text not null,status text not null,amount_kobo bigint not null,
 fee_kobo bigint not null check(fee_kobo>=0),recipient_code text not null,transfer_code text not null,
 provider_updated_at timestamptz not null,recorded_at timestamptz not null default now(),
 unique(provider_reference,status,fee_kobo)
);
create trigger verified_payout_observation_immutable before update or delete on app_private.verified_payout_observations
 for each row execute function app_private.prevent_append_only_mutation();

create function app_private.payout_identity_eligible(p_profile uuid,p_user uuid,p_uni uuid,p_recipient text,p_mode text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.agent_profiles p join public.agent_applications a on a.id=p.application_id
 join public.agent_application_details d on d.application_id=a.id join public.users u on u.id=p.user_id
 join app_private.payout_account_setups s on s.agent_profile_id=p.id and s.application_id=a.id
 where p.id=p_profile and p.user_id=p_user and p.university_id=p_uni and p.status='ACTIVE'
 and a.user_id=p_user and a.university_id=p_uni and a.status='APPROVED' and u.status='ACTIVE'
 and a.kyc_status in('VERIFIED','MANUALLY_VERIFIED') and a.phone_verified_at is not null and a.terms_accepted_at is not null
 and a.bank_status='VERIFIED' and a.bank_recipient_code=p_recipient and s.status='APPROVED'
 and s.user_id=p_user and s.institution_id=p_uni and s.recipient_code=p_recipient and s.provider_mode=p_mode
 and date_part('year',age(current_date,d.birth_date)) between 16 and 110
 and (date_part('year',age(current_date,d.birth_date))>=18 or(d.guardian_consent_at is not null and d.guardian_reviewed_by is not null))
 and exists(select 1 from app_private.verified_people where user_id=p_user)
 and(select count(*) from public.media_objects m where m.owner_user_id=p_user and m.institution_id=p_uni
  and m.deleted_at is null and m.kind='kyc' and m.id in(d.identity_document_id,d.portrait_document_id,case when d.is_student then d.student_document_id end))
  =case when d.is_student then 3 else 2 end);
$$;
create function app_private.create_ledger_payout(p_quote uuid,p_user uuid,p_uni uuid,p_request uuid)
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
  status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','OTP_REQUIRED','FAILED','REQUIRES_REVIEW'))
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

create function app_private.review_ledger_payout(p_id uuid,p_uni uuid,p_actor uuid,p_decision text,p_note text)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;p public.payout_requests%rowtype;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id and university_id=p_uni;
 if not found then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where payout_id=p_id for update;
 select * into p from public.payout_requests where id=p_id for update;
 if s.user_id=p_actor then return 'SELF_REVIEW';end if;
 if s.initiated_at is not null or p.status not in('REQUESTED','IN_REVIEW','APPROVED') or p_decision not in('IN_REVIEW','APPROVED','REJECTED')then return 'INVALID_STATE';end if;
 if p_decision='REJECTED'then
  perform app_private.post_finance_journal(p_uni,'AGENT_PAYOUT',p_id::text,'payout-reject:'||p_id::text,'Release a withdrawal rejected before transfer',jsonb_build_array(
   jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
   jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.amount_kobo)));
 end if;
 update public.payout_requests set status=p_decision,reviewer_user_id=p_actor,review_note=p_note,reviewed_at=now(),updated_at=now()where id=p_id;
 return p_decision;
end;$$;
create function app_private.prepare_ledger_transfer(p_id uuid,p_uni uuid)
returns app_private.agent_payout_settlements language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;p public.payout_requests%rowtype;
begin
 select * into s from app_private.agent_payout_settlements where payout_id=p_id and university_id=p_uni;
 if not found then raise exception 'PAYOUT_UNAVAILABLE';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where payout_id=p_id for update;
 select * into p from public.payout_requests where id=p_id for update;
 if p.status not in('APPROVED','PROCESSING','FAILED')then raise exception 'PAYOUT_NOT_APPROVED';end if;
 if not app_private.payout_identity_eligible(p.agent_profile_id,s.user_id,p_uni,s.recipient_code,s.provider_mode)then raise exception 'PAYOUT_ACCOUNT_UNVERIFIED';end if;
 perform app_private.offset_rider_commissions(s.user_id,p_uni);
 if exists(select 1 from app_private.rider_unpaid_commissions(s.user_id))then raise exception 'PAYOUT_COMMISSION_DUE';end if;
 update app_private.agent_payout_settlements set initiated_at=coalesce(initiated_at,now())where payout_id=p_id returning * into s;
 update public.payout_requests set status='PROCESSING',updated_at=now()where id=p_id;
 return s;
end;$$;

-- Initiation is an acknowledgement only. Paid/reversed states require server GET proof.
create function app_private.record_ledger_transfer(p_ref text,p_amount bigint,p_fee bigint,p_recipient text,p_mode text,p_status text,p_code text,p_updated timestamptz)
returns text language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;p public.payout_requests%rowtype;
 journal uuid;lines jsonb;retained bigint;unused bigint;cost_delta bigint;
begin
 select * into s from app_private.agent_payout_settlements where provider_reference=p_ref;
 if not found then return 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||s.user_id::text,0));
 select * into s from app_private.agent_payout_settlements where provider_reference=p_ref for update;
 select * into p from public.payout_requests where id=s.payout_id for update;
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
 -- Fees only increase the recorded expense. A reduced field on reversal is not proof of a fee refund.
 cost_delta=greatest(0,p_fee-s.cost_recorded_kobo);
 if cost_delta>0 then
  perform app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-cost:'||p_ref||':'||p_fee::text,'Verified bank transfer processing cost',jsonb_build_array(
   jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','DEBIT','amount',cost_delta),
   jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',cost_delta)));
 end if;
 update app_private.agent_payout_settlements set transfer_code=p_code,provider_status=p_status,
  cost_recorded_kobo=greatest(cost_recorded_kobo,p_fee),last_verified_at=now()where payout_id=p.id;
 if s.reversal_journal_id is not null then return 'REVERSED';end if;
 if p_status='success'then
  if s.paid_journal_id is not null then return 'PAID';end if;
  retained=least(p_fee,s.fee_allowance_kobo);unused=s.fee_allowance_kobo-retained;
  lines=jsonb_build_array(
   jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
   jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','CREDIT','amount',s.bank_net_kobo));
  if retained>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_COST_RECOVERY','type','REVENUE','direction','CREDIT','amount',retained));end if;
  if unused>0 then lines=lines||jsonb_build_array(jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',unused));end if;
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-paid:'||p_ref,'Verified bank transfer completed',lines);
  update app_private.agent_payout_settlements set paid_journal_id=journal,retained_fee_kobo=retained where payout_id=p.id;
  update public.payout_requests set status='PAID',paid_at=p_updated,updated_at=now()where id=p.id;
  return 'PAID';
 elsif p_status='reversed'then
  if s.paid_journal_id is null then
   lines=jsonb_build_array(
    jsonb_build_object('code',s.agent_type||'_PAYOUT_RESERVED','type','LIABILITY','owner',s.user_id,'direction','DEBIT','amount',s.amount_kobo),
    jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.amount_kobo));
  else
   retained=coalesce(s.retained_fee_kobo,0);
   lines=jsonb_build_array(
    jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','DEBIT','amount',s.bank_net_kobo),
    jsonb_build_object('code',s.agent_type||'_AVAILABLE','type','LIABILITY','owner',s.user_id,'direction','CREDIT','amount',s.bank_net_kobo+retained));
   if retained>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PAYOUT_COST_RECOVERY','type','REVENUE','direction','DEBIT','amount',retained));end if;
  end if;
  journal=app_private.post_finance_journal(s.university_id,'AGENT_PAYOUT',p.id::text,'payout-reversed:'||p_ref,'Verified bank reversal returns the withdrawal',lines);
  update app_private.agent_payout_settlements set reversal_journal_id=journal where payout_id=p.id;
  update public.payout_requests set status='REVERSED',updated_at=now()where id=p.id;
  return 'REVERSED';
 end if;
 if s.paid_journal_id is not null then return 'PAID';end if;
 update public.payout_requests set status=case when p_status='otp'then 'OTP_REQUIRED' when p_status in('failed','abandoned','blocked','rejected')then 'FAILED'else 'PROCESSING'end,updated_at=now()where id=p.id;
 return case when p_status='otp'then 'OTP_REQUIRED' when p_status in('failed','abandoned','blocked','rejected')then 'FAILED'else 'PROCESSING'end;
end;$$;

create function app_private.guard_ledger_payout()returns trigger language plpgsql set search_path='' as $$
declare s app_private.agent_payout_settlements%rowtype;
begin
 if old.financial_version is null and new.financial_version is null then return new;end if;
 if(old.id,old.university_id,old.agent_profile_id,old.requested_by_user_id,old.amount_kobo,old.provider_reference,old.financial_version)
  is distinct from(new.id,new.university_id,new.agent_profile_id,new.requested_by_user_id,new.amount_kobo,new.provider_reference,new.financial_version)
  then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 select * into s from app_private.agent_payout_settlements where payout_id=old.id;
 if new.status='PAID'and s.paid_journal_id is null then raise exception 'PAYOUT_VERIFIED_TRANSFER_REQUIRED';end if;
 if new.status='REVERSED'and s.reversal_journal_id is null then raise exception 'PAYOUT_VERIFIED_REVERSAL_REQUIRED';end if;
 if new.status in('REJECTED','CANCELLED')and(s.initiated_at is not null or not exists(select 1 from public.ledger_transactions where idempotency_key='payout-reject:'||old.id::text))then raise exception 'PAYOUT_RESERVATION_STILL_HELD';end if;
 if old.status in('PAID','REVERSED','REJECTED','CANCELLED')and new.status<>old.status and not(old.status='PAID'and new.status='REVERSED')then raise exception 'PAYOUT_TERMINAL_STATE';end if;
 return new;
end;$$;
create trigger payout_state_verified before update on public.payout_requests for each row execute function app_private.guard_ledger_payout();
create function app_private.guard_payout_settlement()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE'then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 if(old.payout_id,old.quote_id,old.request_id,old.user_id,old.university_id,old.agent_type,old.amount_kobo,old.fee_allowance_kobo,old.bank_net_kobo,old.recipient_code,old.provider_mode,old.provider_reference,old.reserve_journal_id)
 is distinct from(new.payout_id,new.quote_id,new.request_id,new.user_id,new.university_id,new.agent_type,new.amount_kobo,new.fee_allowance_kobo,new.bank_net_kobo,new.recipient_code,new.provider_mode,new.provider_reference,new.reserve_journal_id)
 or(old.paid_journal_id is not null and old.paid_journal_id is distinct from new.paid_journal_id)
 or(old.reversal_journal_id is not null and old.reversal_journal_id is distinct from new.reversal_journal_id)
 or(old.transfer_code is not null and old.transfer_code is distinct from new.transfer_code)
 or(old.initiated_at is not null and old.initiated_at is distinct from new.initiated_at)
 then raise exception 'SEALED_PAYOUT_IMMUTABLE';end if;
 return new;
end;$$;
create trigger payout_settlement_sealed before update or delete on app_private.agent_payout_settlements for each row execute function app_private.guard_payout_settlement();
revoke all on app_private.payout_cost_policies,app_private.active_payout_cost_policies,app_private.agent_payout_quotes,app_private.agent_payout_settlements,app_private.verified_payout_observations from public;
revoke all on function app_private.payout_identity_eligible(uuid,uuid,uuid,text,text),app_private.create_ledger_payout(uuid,uuid,uuid,uuid),
 app_private.review_ledger_payout(uuid,uuid,uuid,text,text),app_private.prepare_ledger_transfer(uuid,uuid),app_private.record_ledger_transfer(text,bigint,bigint,text,text,text,text,timestamptz)from public;
commit;
