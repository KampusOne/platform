begin;

-- Exclude historical trace profiles from current online collection contexts.
-- Earlier snapshots retain their exact source, amount and provider profile.
create or replace function app_private.snapshot_collection_payment(p_ref text,p_amount bigint,p_metadata jsonb)
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
 rule=source->'collection';native=coalesce(nullif(source->'pricing','null'::jsonb),'{}'::jsonb)||jsonb_build_object('nativePolicyId',source->>'policyId','nativePolicyVersion',source->>'version');
 if rule is null or rule='null'::jsonb then
  select * into profile from app_private.payment_fee_profiles where university_id=(source->>'universityId')::uuid and transaction_class='LOCAL_COLLECTION' and left(version,7)<>'LEGACY_' and channel='ANY' and card_network='ANY' and effective_from<=now() order by effective_from desc,approved_at desc limit 1;
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
revoke all on function app_private.snapshot_collection_payment(text,bigint,jsonb) from public;
commit;
