begin;
-- New approvals are immutable. Existing quoted amounts and paid receipts are untouched.
alter table app_private.commerce_fee_policies add column policy_config jsonb not null default '{}'::jsonb check(jsonb_typeof(policy_config)='object');
alter table app_private.tutorial_booking_prices add column pricing_context jsonb check(pricing_context is null or jsonb_typeof(pricing_context)='object');
create table app_private.payment_fee_profiles(
 id uuid primary key default gen_random_uuid(),university_id uuid not null references public.universities(id),
 provider text not null default 'PAYSTACK' check(provider='PAYSTACK'),country text not null default 'NG' check(country='NG'),currency text not null default 'NGN' check(currency='NGN'),
 version text not null check(char_length(version) between 3 and 120),
 transaction_class text not null check(transaction_class in('LOCAL_COLLECTION','INTERNATIONAL_CARD','INTERNATIONAL_AMEX','DEDICATED_VIRTUAL_ACCOUNT','VIRTUAL_TERMINAL_TRANSFER','VIRTUAL_TERMINAL_USSD','VIRTUAL_TERMINAL_LOCAL_CARD','VIRTUAL_TERMINAL_INTERNATIONAL_CARD','PHYSICAL_TERMINAL_CARD','PHYSICAL_TERMINAL_TRANSFER','PHYSICAL_TERMINAL_USSD','EDUCATION_LOCAL_CARD','EDUCATION_OTHER')),
 channel text not null default 'ANY' check(channel in('ANY','card','bank_transfer','ussd')),
 card_network text not null default 'ANY' check(card_network in('ANY','MASTERCARD','VISA','VERVE','AMEX')),
 collection jsonb not null check(jsonb_typeof(collection)='object' and collection ?& array['basisPoints','flatKobo','flatWaivedBelowKobo','capKobo'] and (collection->>'basisPoints')::integer between 0 and 9999 and (collection->>'flatKobo')::bigint>=0 and (collection->>'flatWaivedBelowKobo')::bigint>=0 and (collection->>'capKobo' is null or (collection->>'capKobo')::bigint>=0)),
 effective_from timestamptz not null,effective_to timestamptz check(effective_to>effective_from),status text not null check(status in('APPROVED','DISABLED')),
 variance_tolerance_kobo bigint not null default 100 check(variance_tolerance_kobo between 0 and 100000000),
 source_url text not null,approval_note text not null check(char_length(approval_note) between 10 and 2000),eligibility_evidence text,
 approved_by uuid not null references public.users(id),approved_at timestamptz not null default now(),
 unique(university_id,transaction_class,version),unique(id,university_id),
 check(status='DISABLED' or transaction_class in('LOCAL_COLLECTION','INTERNATIONAL_CARD','INTERNATIONAL_AMEX') or (eligibility_evidence is not null and char_length(eligibility_evidence)>=10))
);
create index payment_profiles_context on app_private.payment_fee_profiles(university_id,transaction_class,effective_from desc,approved_at desc);
create trigger payment_profiles_immutable before update or delete on app_private.payment_fee_profiles for each row execute function app_private.prevent_append_only_mutation();
-- Account setting is a global merchant fact, not a campus preference. Nothing is seeded as reviewed.
create table app_private.paystack_account_reviews(
 id uuid primary key default gen_random_uuid(),provider_mode text not null check(provider_mode in('live','test')),
 pass_fees_disabled boolean not null,reason text not null check(char_length(reason) between 10 and 2000),
 evidence text not null check(char_length(evidence) between 10 and 4000),reviewed_by uuid not null references public.users(id),
 reviewed_at timestamptz not null default now(),expires_at timestamptz check(expires_at>reviewed_at)
);
create trigger paystack_account_reviews_immutable before update or delete on app_private.paystack_account_reviews for each row execute function app_private.prevent_append_only_mutation();
create table app_private.collection_payment_pricing(
 provider_reference text primary key,university_id uuid not null references public.universities(id),purpose text not null,resource_id uuid not null,
 currency text not null default 'NGN' check(currency='NGN'),provider_initialized_amount_kobo bigint not null check(provider_initialized_amount_kobo>0),
 final_customer_amount_kobo bigint not null check(final_customer_amount_kobo=provider_initialized_amount_kobo),
 expected_provider_fee_kobo bigint not null check(expected_provider_fee_kobo>=0),collection jsonb not null,
 fee_profile_id uuid not null references app_private.payment_fee_profiles(id),fee_profile_version text not null,
 fee_bearer text not null default 'INCLUDED_IN_PRICE' check(fee_bearer in('PLATFORM_ABSORBS','SELLER_ABSORBS','BUYER_VISIBLE','INCLUDED_IN_PRICE','SPLIT')),
 raw_requirement_kobo bigint,pricing_adjustment_kobo bigint,visible_processing_kobo bigint not null default 0 check(visible_processing_kobo>=0),
 variance_tolerance_kobo bigint not null check(variance_tolerance_kobo>=0),native_pricing jsonb not null,quote_created_at timestamptz,quote_expires_at timestamptz,
 created_at timestamptz not null default now()
);
create trigger collection_payment_pricing_immutable before update or delete on app_private.collection_payment_pricing for each row execute function app_private.prevent_append_only_mutation();
create table app_private.collection_receipt_contexts(
 provider_reference text primary key references app_private.collection_payment_pricing(provider_reference),university_id uuid not null references public.universities(id),
 provider_transaction_id text,provider_mode text not null check(provider_mode in('live','test')),channel text,payment_country text,card_network text,transaction_class text not null,
 currency text not null,amount_kobo bigint not null,actual_provider_fee_kobo bigint not null check(actual_provider_fee_kobo>=0),provider_fee_variance_kobo bigint not null,
 recorded_at timestamptz not null default now()
);
create unique index collection_provider_transaction_id on app_private.collection_receipt_contexts(provider_mode,provider_transaction_id) where provider_transaction_id is not null;
create trigger collection_receipt_contexts_immutable before update or delete on app_private.collection_receipt_contexts for each row execute function app_private.prevent_append_only_mutation();
create table app_private.payment_pricing_alerts(
 id uuid primary key default gen_random_uuid(),university_id uuid not null references public.universities(id),provider_reference text not null,
 kind text not null,metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),created_at timestamptz not null default now(),
 unique(provider_reference,kind)
);
create trigger payment_pricing_alerts_immutable before update or delete on app_private.payment_pricing_alerts for each row execute function app_private.prevent_append_only_mutation();

create function app_private.snapshot_collection_payment(p_ref text,p_amount bigint,p_metadata jsonb)
returns app_private.collection_payment_pricing language plpgsql set search_path='' as $$
declare old app_private.collection_payment_pricing; source jsonb; rule jsonb; profile app_private.payment_fee_profiles; native jsonb; amount bigint; expected bigint; kind text;
begin
 perform pg_advisory_xact_lock(hashtextextended('collection-pricing:'||p_ref,0));
 select * into old from app_private.collection_payment_pricing where provider_reference=p_ref;
 if found then
  if p_amount is not null and old.final_customer_amount_kobo<>p_amount then raise exception 'PAYMENT_AMOUNT_CHANGED';end if;
  return old;
 end if;
 select jsonb_build_object('universityId',a.university_id,'purpose',a.resource_type,'resourceId',a.resource_id,'amountKobo',a.amount_kobo,
   'policyId',cp.id,'version',cp.version,'collection',cp.collection,'approvedBy',cp.approved_by,'approvalNote',cp.approval_note,'sourceUrl',cp.source_url,'approvedAt',cp.approved_at,
   'pricing',case when a.resource_type='STORE_ORDER' then sq.pricing when a.resource_type='TUTORIAL_PURCHASE' then mq.pricing else coalesce(tp.pricing_context,to_jsonb(tp)) end,
   'config',cp.policy_config,'createdAt',coalesce(sq.created_at,mq.created_at,tp.created_at),'expiresAt',coalesce(sq.expires_at,mq.expires_at)) into source
 from public.payment_attempts a
 left join app_private.order_price_snapshots os on a.resource_type='STORE_ORDER' and os.order_id=a.resource_id
 left join app_private.store_checkout_quotes sq on sq.id=os.quote_id
 left join app_private.tutorial_booking_prices tp on a.resource_type='TUTORIAL_BOOKING' and tp.booking_id=a.resource_id
 left join app_private.material_checkout_quotes mq on a.resource_type='TUTORIAL_PURCHASE' and mq.id=a.resource_id
 left join app_private.commerce_fee_policies cp on cp.id=coalesce(sq.policy_id,tp.policy_id,mq.policy_id)
 where a.provider_reference=p_ref;
 if source is null then
  select jsonb_build_object('universityId',k.university_id,'purpose','KIRA_SUBSCRIPTION','resourceId',k.id,'amountKobo',k.amount_kobo,
   'policyId',p.id,'version',p.version,'collection',p.collection,'approvedBy',p.approved_by,'approvalNote',p.approval_note,'sourceUrl',p.source_url,'approvedAt',p.approved_at,
   'pricing',to_jsonb(k),'config',jsonb_build_object('feeBearer','INCLUDED_IN_PRICE'),'createdAt',k.created_at,'expiresAt',k.expires_at) into source
  from app_private.kira_checkouts k join app_private.kira_price_plans p on p.id=k.plan_id where k.provider_reference=p_ref;
 end if;
 if source is null then
  select jsonb_build_object('universityId',k.university_id,'purpose','RIDER_COMMISSION','resourceId',k.id,'amountKobo',k.amount_kobo,'pricing',to_jsonb(k),
   'config',jsonb_build_object('feeBearer','PLATFORM_ABSORBS'),'createdAt',k.created_at,'expiresAt',k.expires_at) into source
  from app_private.rider_commission_checkouts k where k.provider_reference=p_ref;
 end if;
 if source is null then raise exception 'PAYMENT_PRICING_SOURCE_UNAVAILABLE';end if;
 amount=(source->>'amountKobo')::bigint;
 if amount<=0 or (p_amount is not null and p_amount<>amount) or (p_metadata->>'resourceId' is not null and (p_metadata->>'resourceId')::uuid<>(source->>'resourceId')::uuid) then raise exception 'PAYMENT_AMOUNT_CHANGED';end if;
 rule=source->'collection';native=coalesce(nullif(source->'pricing','null'::jsonb),'{}'::jsonb);
 if rule is null or rule='null'::jsonb then
  select * into profile from app_private.payment_fee_profiles where university_id=(source->>'universityId')::uuid and transaction_class='LOCAL_COLLECTION' and effective_from<=now() order by effective_from desc,approved_at desc limit 1;
  if not found or profile.status<>'APPROVED' or (profile.effective_to is not null and profile.effective_to<=now()) then raise exception 'PAYMENT_PROVIDER_PROFILE_UNAVAILABLE';end if;
  rule=profile.collection;
 elsif rule->>'providerProfileId' is not null then
  select * into profile from app_private.payment_fee_profiles where id=(rule->>'providerProfileId')::uuid and university_id=(source->>'universityId')::uuid;
  if not found or profile.transaction_class not in('LOCAL_COLLECTION','INTERNATIONAL_CARD','INTERNATIONAL_AMEX') or profile.status<>'APPROVED' or (profile.collection->>'basisPoints',profile.collection->>'flatKobo',profile.collection->>'flatWaivedBelowKobo',profile.collection->>'capKobo') is distinct from (rule->>'basisPoints',rule->>'flatKobo',rule->>'flatWaivedBelowKobo',rule->>'capKobo') then raise exception 'PAYMENT_PROVIDER_PROFILE_CONTEXT_MISMATCH';end if;
 else
  -- Import the already approved native rule, with its original reviewer and version.
  -- No historical amount or native quote is recalculated or mutated.
  insert into app_private.payment_fee_profiles(university_id,version,transaction_class,collection,effective_from,status,source_url,approval_note,approved_by)
   values((source->>'universityId')::uuid,'LEGACY_'||(source->>'policyId'),'LOCAL_COLLECTION',rule,(source->>'approvedAt')::timestamptz,'APPROVED',source->>'sourceUrl',source->>'approvalNote',(source->>'approvedBy')::uuid)
   on conflict(university_id,transaction_class,version)do nothing;
  select * into profile from app_private.payment_fee_profiles where university_id=(source->>'universityId')::uuid and version='LEGACY_'||(source->>'policyId') and transaction_class='LOCAL_COLLECTION';
 end if;
 expected=ceil(amount::numeric*(rule->>'basisPoints')::numeric/10000)::bigint+case when amount<(rule->>'flatWaivedBelowKobo')::bigint then 0 else (rule->>'flatKobo')::bigint end;
 if rule->>'capKobo' is not null then expected=least(expected,(rule->>'capKobo')::bigint);end if;
 kind=coalesce(source->'config'->>'feeBearer',native->>'feeBearer','INCLUDED_IN_PRICE');
 insert into app_private.collection_payment_pricing(provider_reference,university_id,purpose,resource_id,provider_initialized_amount_kobo,final_customer_amount_kobo,expected_provider_fee_kobo,collection,fee_profile_id,fee_profile_version,fee_bearer,raw_requirement_kobo,pricing_adjustment_kobo,visible_processing_kobo,variance_tolerance_kobo,native_pricing,quote_created_at,quote_expires_at)
 values(p_ref,(source->>'universityId')::uuid,source->>'purpose',(source->>'resourceId')::uuid,amount,amount,expected,rule,profile.id,profile.version,kind,
   (native->>'rawRequirementKobo')::bigint,(native->>'pricingAdjustmentKobo')::bigint,coalesce((native->>'visibleProcessingKobo')::bigint,0),profile.variance_tolerance_kobo,native,(source->>'createdAt')::timestamptz,(source->>'expiresAt')::timestamptz) returning * into old;
 return old;
end $$;
create function app_private.record_payment_pricing_alert(p_ref text,p_kind text,p_metadata jsonb)
returns void language plpgsql set search_path='' as $$
declare uni uuid;
begin
 select university_id into uni from app_private.collection_payment_pricing where provider_reference=p_ref;
 if uni is null then select university_id into uni from public.payment_attempts where provider_reference=p_ref;end if;
 if uni is null then select university_id into uni from app_private.kira_checkouts where provider_reference=p_ref;end if;
 if uni is null then return;end if;
 insert into app_private.payment_pricing_alerts(university_id,provider_reference,kind,metadata) values(uni,p_ref,p_kind,p_metadata) on conflict do nothing;
end $$;
create function app_private.record_collection_pricing_observation(p_ref text,p_amount bigint,p_fee bigint,p_id text,p_channel text,p_country text,p_network text,p_currency text,p_mode text)
returns text language plpgsql set search_path='' as $$
declare q app_private.collection_payment_pricing;old app_private.collection_receipt_contexts; class text; variance bigint;
begin
 q=app_private.snapshot_collection_payment(p_ref,null,'{}'::jsonb);
 if p_id is not null then perform pg_advisory_xact_lock(hashtextextended('paystack-transaction:'||p_mode||':'||p_id,0));end if;
 if p_fee<0 then raise exception 'INVALID_PROVIDER_FEE';end if;
 class=case when p_channel='card' and p_country is not null and upper(p_country)<>'NG' then case when upper(coalesce(p_network,'')) like '%AMEX%' or upper(coalesce(p_network,'')) like '%AMERICAN EXPRESS%' then 'INTERNATIONAL_AMEX' else 'INTERNATIONAL_CARD' end else 'LOCAL_COLLECTION' end;
 variance=p_fee-q.expected_provider_fee_kobo;
 if p_amount<>q.final_customer_amount_kobo then perform app_private.record_payment_pricing_alert(p_ref,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object('expectedKobo',q.final_customer_amount_kobo,'actualKobo',p_amount));end if;
 if p_currency<>q.currency then perform app_private.record_payment_pricing_alert(p_ref,'PAYMENT_CURRENCY_MISMATCH',jsonb_build_object('expected',q.currency,'actual',p_currency));end if;
 if abs(variance)>q.variance_tolerance_kobo then perform app_private.record_payment_pricing_alert(p_ref,'PROVIDER_FEE_VARIANCE',jsonb_build_object('expectedFeeKobo',q.expected_provider_fee_kobo,'actualFeeKobo',p_fee,'varianceKobo',variance,'toleranceKobo',q.variance_tolerance_kobo));end if;
 if p_channel is not null and p_channel not in('card','bank','bank_transfer','ussd','qr','mobile_money','eft','apple_pay','direct_debit') then perform app_private.record_payment_pricing_alert(p_ref,'UNEXPECTED_PROVIDER_CHANNEL',jsonb_build_object('channel',p_channel));end if;
 select * into old from app_private.collection_receipt_contexts where provider_reference=p_ref;
 if found then
  if (old.amount_kobo,old.actual_provider_fee_kobo,old.currency,old.provider_mode,old.provider_transaction_id) is distinct from (p_amount,p_fee,p_currency,p_mode,p_id) then perform app_private.record_payment_pricing_alert(p_ref,'PROVIDER_RECEIPT_CHANGED',jsonb_build_object('providerTransactionId',p_id));return 'REQUIRES_REVIEW';end if;
  return 'ALREADY_OBSERVED';
 end if;
 if p_id is not null and exists(select 1 from app_private.collection_receipt_contexts where provider_transaction_id=p_id and provider_mode=p_mode) then
  perform app_private.record_payment_pricing_alert(p_ref,'DUPLICATE_PROVIDER_TRANSACTION',jsonb_build_object('providerTransactionId',p_id));return 'REQUIRES_REVIEW';end if;
 insert into app_private.collection_receipt_contexts(provider_reference,university_id,provider_transaction_id,provider_mode,channel,payment_country,card_network,transaction_class,currency,amount_kobo,actual_provider_fee_kobo,provider_fee_variance_kobo)
  values(p_ref,q.university_id,p_id,p_mode,p_channel,p_country,p_network,class,p_currency,p_amount,p_fee,variance);
 return 'OBSERVED';
end $$;
revoke all on app_private.payment_fee_profiles,app_private.paystack_account_reviews,app_private.collection_payment_pricing,app_private.collection_receipt_contexts,app_private.payment_pricing_alerts from public;
revoke all on function app_private.snapshot_collection_payment(text,bigint,jsonb),app_private.record_payment_pricing_alert(text,text,jsonb),app_private.record_collection_pricing_observation(text,bigint,bigint,text,text,text,text,text,text) from public;
commit;
