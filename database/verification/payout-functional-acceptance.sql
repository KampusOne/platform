-- Run on a rehearsal branch or within the approved production transaction.
-- A caught exception rolls back every synthetic fixture; no provider calls occur.
DO $payout_acceptance$
declare campus uuid=gen_random_uuid();owner_id uuid=gen_random_uuid();actor uuid=gen_random_uuid();
 application uuid=gen_random_uuid();profile uuid=gen_random_uuid();setup uuid=gen_random_uuid();policy uuid=gen_random_uuid();
 quote uuid;payout uuid;journal uuid;reference text;result text;
 completed boolean=false;before_users bigint;before_journals bigint;
begin
 select count(*) into before_users from public.users;
 select count(*) into before_journals from public.ledger_transactions;
 begin
 if to_regprocedure('app_private.reconcile_payout_duty(uuid,uuid,bigint,text,uuid,text)') is null then raise exception 'PAYOUT_COMPONENTS_MIGRATION_MISSING';end if;
 insert into public.universities(id,name,slug,updated_at)values(campus,'Synthetic payout acceptance campus','payout-acceptance-'||campus::text,now());
 insert into public.users(id,email,password_hash,updated_at)values(owner_id,owner_id::text||'@example.invalid','synthetic-rehearsal-only',now()),(actor,actor::text||'@example.invalid','synthetic-rehearsal-only',now());
 insert into public.agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values(application,owner_id,campus,'TUTOR','Synthetic accounting fixture','+2348012345678','Synthetic rehearsal only');
 insert into public.agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values(profile,owner_id,campus,application,'TUTOR','Synthetic accounting fixture',now());
 insert into app_private.payout_account_setups(id,user_id,agent_profile_id,application_id,institution_id,request_hash,status,bank_code,bank_name,account_name,account_last4,recipient_code,provider_mode,reviewed_by,reviewed_at)
 values(setup,owner_id,profile,application,campus,setup::text,'APPROVED','058','Synthetic Bank','Synthetic Owner','1234','RCP_synthetic','live',actor,now());
 insert into app_private.payout_cost_policies(id,university_id,agent_type,version,fee_bearer,low_fee_kobo,middle_fee_kobo,high_fee_kobo,duty_threshold_kobo,duty_kobo,minimum_withdrawal_kobo,source_url,approval_note,approved_by)
 values(policy,campus,'TUTOR',policy::text,'PLATFORM',1000,2500,5000,1000000,5000,500000,'https://support.paystack.com/en/articles/2130370','Synthetic reviewed cost policy',actor);
 perform app_private.post_finance_journal(campus,'SYNTHETIC_FIXTURE',owner_id::text,owner_id::text,'Synthetic accounting funds',jsonb_build_array(
  jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','DEBIT','amount',5000000),
  jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',owner_id,'direction','CREDIT','amount',5000000)));

 -- Expected duty remains unknown until statement review; transfer replay pays once.
 quote=gen_random_uuid();payout=gen_random_uuid();reference='k1-po-'||payout::text;
 insert into app_private.agent_payout_quotes(id,user_id,university_id,agent_profile_id,agent_type,policy_id,account_setup_id,recipient_code,provider_mode,amount_kobo,estimated_fee_kobo,fee_allowance_kobo,bank_net_kobo,expected_transfer_fee_kobo,expected_statutory_duty_kobo,transfer_fee_allowance_kobo,statutory_duty_allowance_kobo,minimum_withdrawal_kobo,statutory_duty_policy)
 values(quote,owner_id,campus,profile,'TUTOR',policy,setup,'RCP_synthetic','live',1000000,7500,0,1000000,2500,5000,0,0,500000,'PLATFORM_ABSORBS_PENDING_STATEMENT');
 journal=app_private.post_finance_journal(campus,'AGENT_PAYOUT',payout::text,'payout-reserve:'||payout::text,'Synthetic reserve',jsonb_build_array(
  jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',owner_id,'direction','DEBIT','amount',1000000),
  jsonb_build_object('code','TUTOR_PAYOUT_RESERVED','type','LIABILITY','owner',owner_id,'direction','CREDIT','amount',1000000)));
 insert into public.payout_requests(id,university_id,agent_profile_id,requested_by_user_id,amount_kobo,provider_reference,financial_version,status)values(payout,campus,profile,owner_id,1000000,reference,'LEDGER_PAYOUT_V1','PROCESSING');
 insert into app_private.agent_payout_settlements(payout_id,quote_id,request_id,user_id,university_id,agent_type,amount_kobo,fee_allowance_kobo,bank_net_kobo,recipient_code,provider_mode,provider_reference,reserve_journal_id,initiated_at)
 values(payout,quote,gen_random_uuid(),owner_id,campus,'TUTOR',1000000,0,1000000,'RCP_synthetic','live',reference,journal,now());
 result=app_private.record_ledger_transfer(reference,1000000,2500,'RCP_synthetic','live','success','TRF_synthetic',now());
 if result<>'PAID' then raise exception 'PAYOUT_SUCCESS_FAILED: %',result;end if;
 perform app_private.record_ledger_transfer(reference,1000000,2500,'RCP_synthetic','live','success','TRF_synthetic',now());
 if(select actual_statutory_duty_kobo is not null or expected_duty_accrued_kobo<>5000 from app_private.agent_payout_settlements where payout_id=payout)then raise exception 'DUTY_INCORRECTLY_INFERRED_FROM_TRANSFER';end if;
 if(select count(*) from public.ledger_transactions where idempotency_key='payout-paid:'||reference)<>1 then raise exception 'DUPLICATE_PAYOUT_PAID';end if;
 result=app_private.reconcile_payout_duty(payout,campus,5000,'SYNTHETIC-STATEMENT-1',actor,'Synthetic separate Balance statement entry');
 perform app_private.reconcile_payout_duty(payout,campus,5000,'SYNTHETIC-STATEMENT-1',actor,'Synthetic separate Balance statement entry');
 if result<>'RECONCILED' or(select count(*) from app_private.payout_duty_observations where payout_id=payout)<>1 then raise exception 'DUTY_RECONCILIATION_NOT_IDEMPOTENT';end if;

 -- A conclusive failure releases only once; pending and mismatched proof hold funds.
 quote=gen_random_uuid();payout=gen_random_uuid();reference='k1-po-'||payout::text;
 insert into app_private.agent_payout_quotes(id,user_id,university_id,agent_profile_id,agent_type,policy_id,account_setup_id,recipient_code,provider_mode,amount_kobo,estimated_fee_kobo,fee_allowance_kobo,bank_net_kobo,expected_transfer_fee_kobo,expected_statutory_duty_kobo,transfer_fee_allowance_kobo,statutory_duty_allowance_kobo,minimum_withdrawal_kobo,statutory_duty_policy)
 values(quote,owner_id,campus,profile,'TUTOR',policy,setup,'RCP_synthetic','live',700000,2500,0,700000,2500,0,0,0,500000,'PLATFORM_ABSORBS_PENDING_STATEMENT');
 journal=app_private.post_finance_journal(campus,'AGENT_PAYOUT',payout::text,'payout-reserve:'||payout::text,'Synthetic reserve',jsonb_build_array(
  jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',owner_id,'direction','DEBIT','amount',700000),
  jsonb_build_object('code','TUTOR_PAYOUT_RESERVED','type','LIABILITY','owner',owner_id,'direction','CREDIT','amount',700000)));
 insert into public.payout_requests(id,university_id,agent_profile_id,requested_by_user_id,amount_kobo,provider_reference,financial_version,status)values(payout,campus,profile,owner_id,700000,reference,'LEDGER_PAYOUT_V1','PROCESSING');
 insert into app_private.agent_payout_settlements(payout_id,quote_id,request_id,user_id,university_id,agent_type,amount_kobo,fee_allowance_kobo,bank_net_kobo,recipient_code,provider_mode,provider_reference,reserve_journal_id,initiated_at)
 values(payout,quote,gen_random_uuid(),owner_id,campus,'TUTOR',700000,0,700000,'RCP_synthetic','live',reference,journal,now());
 perform app_private.record_ledger_transfer(reference,700000,0,'RCP_synthetic','live','pending','TRF_synthetic',now());
 perform app_private.record_ledger_transfer(reference,700001,0,'RCP_synthetic','live','failed','TRF_synthetic',now());
 if app_private.finance_balance(campus,owner_id,'TUTOR_PAYOUT_RESERVED')<>700000 then raise exception 'UNCERTAIN_PAYOUT_RELEASED';end if;
 perform app_private.record_ledger_transfer(reference,700000,0,'RCP_synthetic','live','failed','TRF_synthetic',now());
 perform app_private.record_ledger_transfer(reference,700000,0,'RCP_synthetic','live','failed','TRF_synthetic',now());
 if app_private.finance_balance(campus,owner_id,'TUTOR_PAYOUT_RESERVED')<>0 then raise exception 'FAILED_PAYOUT_NOT_RELEASED';end if;
 if(select count(*) from public.ledger_transactions where idempotency_key='payout-failure-release:'||reference)<>1 then raise exception 'DUPLICATE_FAILURE_RELEASE';end if;
 if app_private.finance_balance(campus,owner_id,'TUTOR_AVAILABLE')<>4000000 then raise exception 'FAILED_PAYOUT_BALANCE_WRONG';end if;
 set constraints all immediate;
 completed=true;
 raise exception using errcode='P0397',message='ROLLBACK_PAYOUT_ACCEPTANCE_FIXTURES';
 exception when sqlstate 'P0397' then if not completed then raise;end if;end;
 if (select count(*) from public.users)<>before_users or (select count(*) from public.ledger_transactions)<>before_journals
  or exists(select 1 from public.universities where id=campus)
  or exists(select 1 from app_private.payout_cost_policies where id=policy)
  or exists(select 1 from public.payout_requests where requested_by_user_id=owner_id) then raise exception 'PAYOUT_FIXTURE_ROLLBACK';end if;
end $payout_acceptance$;
