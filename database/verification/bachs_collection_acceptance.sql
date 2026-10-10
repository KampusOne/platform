-- No provider calls. All synthetic users, quotes, receipts and ledger lines roll
-- back in an exception subtransaction, even when run against production.
do $bachs_acceptance$
declare
 campus uuid; actor uuid; student uuid:=gen_random_uuid(); reference text:='K1-B-AI-ACCEPTANCE-'||gen_random_uuid()::text;
 quoted app_private.kira_subscription_quotes; checkout app_private.kira_checkouts; profile app_private.bachs_fee_profiles;
 qid uuid:=gen_random_uuid(); snapshot jsonb; profile_json jsonb; payload jsonb; fee bigint; blocked boolean; completed boolean:=false;
 at_time timestamptz:=now(); expires timestamptz:=now()+interval '2 minutes';
begin
 select p.university_id,p.approved_by into campus,actor from app_private.active_kira_price_plans a join app_private.kira_price_plans p on p.id=a.plan_id
 where a.tier='pro' and p.available and p.active_status and app_private.bachs_collection_ready(p.university_id) order by p.approved_at desc limit 1;
 if campus is null then raise exception 'BACHS_ACCEPTANCE_REQUIRES_ACTIVE_KIRA_PLAN';end if;
 begin
  insert into public.users(id,email,password_hash,updated_at)values(student,student::text||'@acceptance.invalid','self-cleaning synthetic acceptance only',now());
  insert into public.profiles(id,user_id,university_id,username,display_name,updated_at)values(student,student,campus,'k1bc_'||substring(replace(student::text,'-',''),1,20),'Self-cleaning BACHS acceptance',now());
  quoted=app_private.quote_kira_subscription(gen_random_uuid(),student,campus,gen_random_uuid(),'pro','');
  checkout=app_private.create_quoted_kira_checkout(student,campus,gen_random_uuid(),reference,quoted.id,'pro',quoted.amount_kobo);
  select i.snapshot into snapshot from app_private.bachs_purchase_intent(reference) i;
  if snapshot is null or (snapshot->>'resourceId')::uuid<>checkout.id then raise exception 'BACHS_INTENT_BINDING_FAILED';end if;
  select * into profile from app_private.bachs_fee_profiles where university_id=campus and context='CHECKOUT_BANK_TRANSFER' and status='APPROVED' and effective_from<=now() order by effective_from desc,approved_at desc,id desc limit 1;
  fee=least(ceil(checkout.amount_kobo::numeric*(profile.collection->>'basisPoints')::int/10000)::bigint,(profile.collection->>'capKobo')::bigint);
  profile_json=jsonb_build_object('id',profile.id,'universityId',profile.university_id,'version',profile.version,'context',profile.context,'collection',profile.collection,'status',profile.status,'effectiveFrom',profile.effective_from,'effectiveTo',profile.effective_to,'sourceUrl',profile.source_url,'varianceToleranceKobo',profile.variance_tolerance_kobo);
  payload=jsonb_build_object('provider','BACHS','currency','NGN','context',profile.context,'profile',profile_json,'input',jsonb_build_object('subtotalKobo',checkout.amount_kobo,'priceMode','FIXED_TOTAL','expiresInMinutes',2),'createdAt',at_time,'expiresAt',expires,
   'subtotalKobo',checkout.amount_kobo,'discountPercent',0,'discountKobo',0,'discountedSubtotalKobo',checkout.amount_kobo,'deliveryKobo',0,'platformRevenueKobo',0,'rawRequirementKobo',checkout.amount_kobo,'pricingAdjustmentKobo',0,'includedProcessingKobo',0,'estimatedProviderFeeKobo',fee,'estimatedNetKobo',checkout.amount_kobo-fee,'finalCustomerAmountKobo',checkout.amount_kobo,'providerAmountKobo',checkout.amount_kobo);
  insert into app_private.bachs_checkout_quotes(id,user_id,university_id,resource_type,resource_id,provider_reference,resource_fingerprint,resource_snapshot,fee_profile_id,fee_profile_version,quote,created_at,expires_at)
  values(qid,student,campus,'KIRA_SUBSCRIPTION',checkout.id,reference,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),snapshot,profile.id,profile.version,payload,at_time,expires);
  insert into app_private.bachs_priced_sessions(quote_id,checkout_id,provider_mode,checkout_url,expires_at)values(qid,'chk_acceptance_'||qid::text,'test','https://sandbox-checkout.bachs.io/c/synthetic-acceptance',expires);
  blocked=false;
  begin perform app_private.record_kira_receipt(reference,checkout.amount_kobo,fee,at_time);
  exception when others then if sqlerrm='BACHS_VERIFIED_RECEIPT_REQUIRED' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'BACHS_UNVERIFIED_RECEIPT_GRANTED_ACCESS';end if;
  perform app_private.record_bachs_pricing_receipt(qid,'test','ch_acceptance_'||qid::text,checkout.amount_kobo,fee,at_time);
  if app_private.record_kira_receipt(reference,checkout.amount_kobo,fee,at_time)<>'PAID' or app_private.record_kira_receipt(reference,checkout.amount_kobo,fee,at_time)<>'ALREADY_PAID' then raise exception 'BACHS_RECEIPT_REPLAY_FAILED';end if;
  if (select count(*) from app_private.kira_billing_periods where checkout_id=checkout.id)<>1
   or (select count(*) from app_private.verified_bachs_receipts where provider_reference=reference)<>1
   or exists(select 1 from app_private.verified_paystack_receipts where provider_reference=reference)
   or exists(select 1 from public.ledger_accounts a join public.ledger_lines l on a.id=l.account_id join public.ledger_transactions t on t.id=l.transaction_id where t.idempotency_key in('provider-receipt:'||reference,'provider-processing:'||reference) and a.account_code='PAYSTACK_CLEARING')
  then raise exception 'BACHS_PROVIDER_OR_ENTITLEMENT_DUPLICATED';end if;
  if exists(select 1 from public.ledger_transactions t join public.ledger_lines l on l.transaction_id=t.id where t.idempotency_key in('provider-receipt:'||reference,'provider-processing:'||reference,'kira-payment:'||reference) group by t.id having sum(case when l.direction='DEBIT' then l.amount_kobo else -l.amount_kobo end)<>0) then raise exception 'BACHS_JOURNAL_UNBALANCED';end if;
  blocked=false;
  begin perform app_private.record_verified_bachs_receipt(campus,reference,'KIRA_SUBSCRIPTION',gen_random_uuid(),checkout.amount_kobo,fee,at_time);
  exception when others then if sqlerrm='BACHS_VERIFIED_RECEIPT_REQUIRED' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'BACHS_WRONG_RESOURCE_ACCEPTED';end if;
  blocked=false;
  begin update app_private.verified_bachs_receipts set amount_kobo=amount_kobo+1 where provider_reference=reference;
  exception when others then if sqlerrm ilike '%append-only%' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'BACHS_RECEIPT_MUTABLE';end if;
  completed=true;raise exception using errcode='Z0001',message='BACHS_ACCEPTANCE_ROLLBACK';
 exception when sqlstate 'Z0001' then
  if not completed or sqlerrm<>'BACHS_ACCEPTANCE_ROLLBACK' then raise;end if;
 end;
 if exists(select 1 from public.users where id=student) or exists(select 1 from app_private.bachs_checkout_quotes where id=qid) or exists(select 1 from app_private.verified_bachs_receipts where provider_reference=reference) then raise exception 'BACHS_ACCEPTANCE_FIXTURE_LEAK';end if;
end $bachs_acceptance$;
