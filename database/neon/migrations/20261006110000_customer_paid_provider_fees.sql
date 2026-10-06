-- New quotes send the commercial subtotal to Paystack. Actual provider fees
-- belong to the customer/provider, never seller earnings or platform commission.
-- Historical inclusive quotes and all immutable provider evidence retain their math.
begin;
alter table app_private.collection_payment_pricing
 add column provider_fee_mode text not null default 'LEGACY_INCLUSIVE'
 check(provider_fee_mode in ('LEGACY_INCLUSIVE','CUSTOMER_PASSTHROUGH'));
alter table app_private.collection_payment_pricing drop constraint collection_payment_pricing_check;
alter table app_private.collection_payment_pricing add constraint collection_amounts_by_mode check(
 (provider_fee_mode='LEGACY_INCLUSIVE' and final_customer_amount_kobo=provider_initialized_amount_kobo)
 or provider_fee_mode='CUSTOMER_PASSTHROUGH');
alter table app_private.kira_subscription_quotes add column provider_fee_mode text not null default 'LEGACY_INCLUSIVE'
 check(provider_fee_mode in ('LEGACY_INCLUSIVE','CUSTOMER_PASSTHROUGH'));
alter table app_private.kira_subscription_quotes alter column provider_fee_mode set default 'CUSTOMER_PASSTHROUGH';
alter table app_private.rider_commission_checkouts add column provider_fee_mode text not null default 'LEGACY_INCLUSIVE'
 check(provider_fee_mode in ('LEGACY_INCLUSIVE','CUSTOMER_PASSTHROUGH'));
alter table app_private.rider_commission_checkouts alter column provider_fee_mode set default 'CUSTOMER_PASSTHROUGH';
alter table app_private.collection_receipt_contexts
 add column requested_amount_kobo bigint check(requested_amount_kobo>0),
 add column settlement_principal_kobo bigint check(settlement_principal_kobo>0),
 add column pricing_match_state text not null default 'LEGACY_OBSERVED'
 check(pricing_match_state in ('LEGACY_OBSERVED','MATCHED','MISMATCH'));

CREATE OR REPLACE FUNCTION app_private.snapshot_collection_payment(p_ref text, p_amount bigint, p_metadata jsonb)
 RETURNS app_private.collection_payment_pricing
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare old app_private.collection_payment_pricing; source jsonb; rule jsonb; profile app_private.payment_fee_profiles; native jsonb; amount bigint; expected bigint; kind text; fee_mode text; subtotal bigint;
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
   'pricing',to_jsonb(k)||jsonb_build_object('providerFeeMode',coalesce(q.provider_fee_mode,'LEGACY_INCLUSIVE'),'providerSubtotalKobo',k.amount_kobo-coalesce(q.estimated_processing_kobo,0)),'config',jsonb_build_object('feeBearer','INCLUDED_IN_PRICE'),'createdAt',k.created_at,'expiresAt',k.expires_at) into source
  from app_private.kira_checkouts k join app_private.kira_price_plans p on p.id=k.plan_id left join app_private.kira_subscription_quotes q on q.id=k.quote_id where k.provider_reference=p_ref;
 end if;
 if source is null then
  select jsonb_build_object('universityId',k.university_id,'purpose','RIDER_COMMISSION','resourceId',k.id,'amountKobo',k.amount_kobo,'pricing',to_jsonb(k)||jsonb_build_object('providerFeeMode',k.provider_fee_mode,'providerSubtotalKobo',k.amount_kobo),
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
 fee_mode=coalesce(native->>'providerFeeMode','LEGACY_INCLUSIVE');
 subtotal=case when fee_mode='CUSTOMER_PASSTHROUGH' then (native->>'providerSubtotalKobo')::bigint-coalesce((native->>'couponKobo')::bigint,0) else amount end;
 if fee_mode not in('LEGACY_INCLUSIVE','CUSTOMER_PASSTHROUGH') or subtotal is null or subtotal<=0 then raise exception 'PAYMENT_SUBTOTAL_INVALID';end if;
 kind=coalesce(source->'config'->>'feeBearer',native->>'feeBearer','INCLUDED_IN_PRICE');
 insert into app_private.collection_payment_pricing(provider_reference,university_id,purpose,resource_id,provider_fee_mode,provider_initialized_amount_kobo,final_customer_amount_kobo,expected_provider_fee_kobo,collection,fee_profile_id,fee_profile_version,fee_bearer,raw_requirement_kobo,pricing_adjustment_kobo,visible_processing_kobo,variance_tolerance_kobo,native_pricing,quote_created_at,quote_expires_at)
 values(p_ref,(source->>'universityId')::uuid,source->>'purpose',(source->>'resourceId')::uuid,fee_mode,subtotal,amount,expected,rule,profile.id,profile.version,kind,
   (native->>'rawRequirementKobo')::bigint,(native->>'pricingAdjustmentKobo')::bigint,coalesce((native->>'visibleProcessingKobo')::bigint,0),profile.variance_tolerance_kobo,native,(source->>'createdAt')::timestamptz,(source->>'expiresAt')::timestamptz) returning * into old;
 return old;
end $function$
;


-- Pure helpers preserve gross evidence while checking an exact, saved principal.
create or replace function app_private.collection_settlement_principal(p_ref text,p_gross bigint,p_fee bigint)
returns bigint language sql stable set search_path='' as $$
 select case when q.provider_fee_mode='CUSTOMER_PASSTHROUGH' then p_gross-p_fee else p_gross end
 from app_private.collection_payment_pricing q
 where q.provider_reference=p_ref and p_gross>0 and p_fee>=0 and p_fee<p_gross
 and (case when q.provider_fee_mode='CUSTOMER_PASSTHROUGH' then p_gross-p_fee else p_gross end)=q.provider_initialized_amount_kobo
 and not exists(select 1 from app_private.collection_receipt_contexts c where c.provider_reference=p_ref
   and (c.pricing_match_state='MISMATCH' or c.amount_kobo<>p_gross or c.actual_provider_fee_kobo<>p_fee
     or (c.requested_amount_kobo is not null and c.requested_amount_kobo<>q.provider_initialized_amount_kobo)))
$$;
create or replace function app_private.collection_paid_price_matches(p_ref text,p_gross bigint,p_fee bigint,p_quote bigint)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from app_private.collection_payment_pricing q where q.provider_reference=p_ref
  and q.final_customer_amount_kobo=p_quote
  and app_private.collection_settlement_principal(p_ref,p_gross,p_fee) is not null)
$$;
create or replace function app_private.recover_customer_processing_fee(p_ref text,p_gross bigint,p_fee bigint)
returns bigint language plpgsql set search_path='' as $$
declare q app_private.collection_payment_pricing; principal bigint;
begin
 select * into q from app_private.collection_payment_pricing where provider_reference=p_ref;
 principal=app_private.collection_settlement_principal(p_ref,p_gross,p_fee);
 if principal is null then raise exception 'PAYMENT_SUBTOTAL_MISMATCH';end if;
 if q.provider_fee_mode='CUSTOMER_PASSTHROUGH' and p_fee>0 then
  if not exists(select 1 from app_private.verified_paystack_receipts where provider_reference=p_ref
   and amount_kobo=p_gross and provider_fee_kobo=p_fee and university_id=q.university_id
   and purpose=q.purpose and resource_id=q.resource_id) then raise exception 'VERIFIED_RECEIPT_REQUIRED';end if;
  perform app_private.post_finance_journal(q.university_id,q.purpose,q.resource_id::text,
   'provider-processing-recovery:'||p_ref,'Customer-paid provider processing fee',jsonb_build_array(
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_fee),
    jsonb_build_object('code','PROCESSING_EXPENSE','type','EXPENSE','direction','CREDIT','amount',p_fee)));
 end if;
 return principal;
end $$;
revoke all on function app_private.collection_settlement_principal(text,bigint,bigint) from public;
revoke all on function app_private.collection_paid_price_matches(text,bigint,bigint,bigint) from public;
revoke all on function app_private.recover_customer_processing_fee(text,bigint,bigint) from public;

CREATE OR REPLACE FUNCTION app_private.record_collection_pricing_observation_v2(p_ref text, p_amount bigint, p_fee bigint, p_id text, p_channel text, p_country text, p_network text, p_currency text, p_mode text, p_requested bigint)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q app_private.collection_payment_pricing;old app_private.collection_receipt_contexts; class text; variance bigint; principal bigint; matches boolean;
begin
 q=app_private.snapshot_collection_payment(p_ref,null,'{}'::jsonb);
 if p_id is not null then perform pg_advisory_xact_lock(hashtextextended('paystack-transaction:'||p_mode||':'||p_id,0));end if;
 if p_fee is null or p_fee<0 or p_amount is null or p_amount<=0 or p_fee>=p_amount then raise exception 'INVALID_PROVIDER_FEE';end if;
 principal=case when q.provider_fee_mode='CUSTOMER_PASSTHROUGH' then p_amount-p_fee else p_amount end;
 matches=principal=q.provider_initialized_amount_kobo and p_currency=q.currency and (p_requested is null or p_requested=q.provider_initialized_amount_kobo);
 class=case when p_channel='card' and p_country is not null and upper(p_country)<>'NG' then case when upper(coalesce(p_network,'')) like '%AMEX%' or upper(coalesce(p_network,'')) like '%AMERICAN EXPRESS%' then 'INTERNATIONAL_AMEX' else 'INTERNATIONAL_CARD' end else 'LOCAL_COLLECTION' end;
 variance=p_fee-q.expected_provider_fee_kobo;
 if not matches then perform app_private.record_payment_pricing_alert(p_ref,'PAYMENT_AMOUNT_MISMATCH',jsonb_build_object('expectedPrincipalKobo',q.provider_initialized_amount_kobo,'actualPrincipalKobo',principal,'actualGrossKobo',p_amount,'requestedKobo',p_requested));end if;
 if p_currency<>q.currency then perform app_private.record_payment_pricing_alert(p_ref,'PAYMENT_CURRENCY_MISMATCH',jsonb_build_object('expected',q.currency,'actual',p_currency));end if;
 if abs(variance)>q.variance_tolerance_kobo then perform app_private.record_payment_pricing_alert(p_ref,'PROVIDER_FEE_VARIANCE',jsonb_build_object('expectedFeeKobo',q.expected_provider_fee_kobo,'actualFeeKobo',p_fee,'varianceKobo',variance,'toleranceKobo',q.variance_tolerance_kobo));end if;
 if p_channel is not null and p_channel not in('card','bank','bank_transfer','ussd','qr','mobile_money','eft','apple_pay','direct_debit') then perform app_private.record_payment_pricing_alert(p_ref,'UNEXPECTED_PROVIDER_CHANNEL',jsonb_build_object('channel',p_channel));end if;
 select * into old from app_private.collection_receipt_contexts where provider_reference=p_ref;
 if found then
  if (old.amount_kobo,old.actual_provider_fee_kobo,old.currency,old.provider_mode,old.provider_transaction_id) is distinct from (p_amount,p_fee,p_currency,p_mode,p_id) then perform app_private.record_payment_pricing_alert(p_ref,'PROVIDER_RECEIPT_CHANGED',jsonb_build_object('providerTransactionId',p_id));return 'REQUIRES_REVIEW';end if;
  if not matches or old.pricing_match_state='MISMATCH' or (old.requested_amount_kobo is not null and old.requested_amount_kobo is distinct from p_requested) then return 'REQUIRES_REVIEW';end if;
  return 'ALREADY_OBSERVED';
 end if;
 if p_id is not null and exists(select 1 from app_private.collection_receipt_contexts where provider_transaction_id=p_id and provider_mode=p_mode) then
  perform app_private.record_payment_pricing_alert(p_ref,'DUPLICATE_PROVIDER_TRANSACTION',jsonb_build_object('providerTransactionId',p_id));return 'REQUIRES_REVIEW';end if;
 insert into app_private.collection_receipt_contexts(provider_reference,university_id,provider_transaction_id,provider_mode,channel,payment_country,card_network,transaction_class,currency,amount_kobo,actual_provider_fee_kobo,provider_fee_variance_kobo,requested_amount_kobo,settlement_principal_kobo,pricing_match_state)
  values(p_ref,q.university_id,p_id,p_mode,p_channel,p_country,p_network,class,p_currency,p_amount,p_fee,variance,p_requested,case when principal>0 then principal else null end,case when matches then 'MATCHED' else 'MISMATCH' end);
 return case when matches then 'OBSERVED' else 'REQUIRES_REVIEW' end;
end $function$
;


revoke all on function app_private.record_collection_pricing_observation_v2(text,bigint,bigint,text,text,text,text,text,text,bigint) from public;
create or replace function app_private.record_collection_pricing_observation(p_ref text,p_amount bigint,p_fee bigint,p_id text,p_channel text,p_country text,p_network text,p_currency text,p_mode text)
returns text language sql set search_path='' as $$
 select app_private.record_collection_pricing_observation_v2(p_ref,p_amount,p_fee,p_id,p_channel,p_country,p_network,p_currency,p_mode,null)
$$;

CREATE OR REPLACE FUNCTION app_private.create_discounted_material_quote(p_id uuid, p_uni uuid, p_user uuid, p_resource uuid, p_tutor uuid, p_media uuid, p_policy uuid, p_request uuid, p_title text, p_base integer, p_price jsonb, p_code text)
 RETURNS app_private.material_checkout_quotes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare saved app_private.material_checkout_quotes%rowtype;savings bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('discount-material:'||p_user::text||':'||p_request::text,0));
 select * into saved from app_private.material_checkout_quotes where student_user_id=p_user and request_id=p_request;
 if found then if saved.resource_id<>p_resource or coalesce(saved.pricing->>'couponCode','')<>coalesce(p_code,'') then raise exception 'DISCOUNT_REQUEST_CONFLICT';end if;return saved;end if;
 savings=app_private.reserve_commerce_discount(p_id,p_user,p_uni,'MATERIAL',p_code,(p_price->>'payableKobo')::bigint,now()+interval '15 minutes');
 if savings>0 then p_price=p_price||jsonb_build_object('payableKobo',(p_price->>'payableKobo')::bigint-savings,'discountKobo',(p_price->>'discountKobo')::bigint+savings,'couponKobo',savings,'couponCode',p_code);end if;
 insert into app_private.material_checkout_quotes(id,university_id,student_user_id,resource_id,tutor_user_id,media_object_id,policy_id,request_id,title,base_kobo,pricing)
 values(p_id,p_uni,p_user,p_resource,p_tutor,p_media,p_policy,p_request,p_title,p_base,p_price) returning * into saved;return saved;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.create_discounted_tutorial_booking(p_id uuid, p_uni uuid, p_user uuid, p_listing uuid, p_window uuid, p_request uuid, p_policy uuid, p_base integer, p_price jsonb, p_code text)
 RETURNS TABLE(id uuid, amount_kobo integer, status text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous app_private.tutorial_booking_prices%rowtype; savings bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('tutorial-checkout:'||p_user::text||':'||p_request::text,0));
 select * into previous from app_private.tutorial_booking_prices where student_user_id=p_user and request_id=p_request;
 if found then
  if (previous.university_id,previous.listing_id,previous.availability_window_id) is distinct from(p_uni,p_listing,p_window) or coalesce((select d.code from app_private.discount_redemptions r join app_private.discount_codes d on d.id=r.discount_id where r.purchase_id=previous.booking_id),'')<>coalesce(p_code,'') then raise exception 'DISCOUNT_REQUEST_CONFLICT';end if;
  return query select b.id,b.amount_kobo,b.status from public.tutorial_bookings b where b.id=previous.booking_id;return;
 end if;
 savings=app_private.reserve_commerce_discount(p_id,p_user,p_uni,'TUTORIAL',p_code,(p_price->>'payableKobo')::bigint,now()+interval '15 minutes');
 if savings>0 then p_price=p_price||jsonb_build_object('payableKobo',(p_price->>'payableKobo')::bigint-savings,'discountKobo',(p_price->>'discountKobo')::bigint+savings,'couponKobo',savings);end if;
 return query select * from app_private.create_priced_tutorial_booking(p_id,p_uni,p_user,p_listing,p_window,p_request,p_policy,p_base,p_price);
end $function$
;

CREATE OR REPLACE FUNCTION app_private.record_priced_store_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; selected_order public.orders%rowtype; price app_private.order_price_snapshots%rowtype;
  seller_user uuid; journal uuid; lines jsonb; gross_margin bigint; digital_fare integer; principal bigint;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='STORE_ORDER';
  if not found then return 'UNKNOWN'; end if;
  select * into selected_order from public.orders where id=attempt.resource_id and pricing_formula_version='INCLUSIVE_V1' for update;
  if not found then return 'LEGACY'; end if;
  select * into price from app_private.order_price_snapshots where order_id=selected_order.id;
  if not found then raise exception 'PRICE_SNAPSHOT_MISSING'; end if;
  perform app_private.record_verified_paystack_receipt(selected_order.university_id,p_reference,'STORE_ORDER',selected_order.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.commerce_settlements where order_id=selected_order.id) then
    if exists(select 1 from app_private.commerce_settlements where order_id=selected_order.id and provider_reference=p_reference and amount_kobo=p_amount and provider_fee_kobo=p_fee) then return 'ALREADY_PAID'; end if;
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='SECOND_SUCCESSFUL_PAYMENT',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='SECOND_SUCCESSFUL_PAYMENT',updated_at=now()
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  if attempt.university_id is distinct from selected_order.university_id or attempt.user_id<>selected_order.buyer_user_id or
    selected_order.status<>'PENDING_PAYMENT' or attempt.status not in ('CREATED','INITIALIZED') or
    not exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='HELD' and expires_at>now()) or
    not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,price.payable_kobo) or attempt.amount_kobo<>price.payable_kobo or p_fee<0 or p_paid_at is null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now()
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select user_id into seller_user from public.agent_profiles where id=selected_order.vendor_profile_id;
  digital_fare=selected_order.delivery_fee_kobo-price.cash_due_kobo;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  gross_margin=principal-price.seller_net_kobo-digital_fare;
  if gross_margin<0 and not exists(select 1 from app_private.discount_redemptions where purchase_id=selected_order.id and discount_kobo>=-gross_margin) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',seller_user,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if digital_fare>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','CREDIT','amount',digital_fare)); end if;
  if gross_margin>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',gross_margin)); end if;
  if gross_margin<0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',-gross_margin));end if;
  journal=app_private.post_finance_journal(selected_order.university_id,'STORE_ORDER',selected_order.id::text,'priced-payment:'||p_reference,'Verified inclusive store checkout',lines);
  insert into app_private.commerce_settlements(order_id,university_id,provider_reference,amount_kobo,seller_net_kobo,digital_fare_kobo,cash_fare_kobo,provider_fee_kobo,journal_id)
    values(selected_order.id,selected_order.university_id,p_reference,p_amount,price.seller_net_kobo,digital_fare,price.cash_due_kobo,p_fee,journal);
  update public.orders set status='PAID',updated_at=now() where id=selected_order.id;
  update public.inventory_reservations set status='CONVERTED' where order_id=selected_order.id and status='HELD';
  update public.delivery_jobs set status='AVAILABLE',updated_at=now() where order_id=selected_order.id and status='PAYMENT_PENDING';
  update public.payment_attempts set status='SUCCEEDED',completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now()
    where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.record_priced_tutorial_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; booking public.tutorial_bookings%rowtype; price app_private.tutorial_booking_prices%rowtype;
  lines jsonb; journal uuid; reason text; principal bigint;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_BOOKING';
  if not found then return 'UNKNOWN'; end if;
  select * into booking from public.tutorial_bookings where tutorial_bookings.id=attempt.resource_id for update;
  select * into price from app_private.tutorial_booking_prices where booking_id=booking.id;
  if not found then return 'LEGACY'; end if;
  perform app_private.record_verified_paystack_receipt(price.university_id,p_reference,'TUTORIAL_BOOKING',booking.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.tutorial_settlements where booking_id=booking.id and provider_reference=p_reference) then return 'ALREADY_PAID'; end if;
  reason=case when exists(select 1 from app_private.tutorial_settlements where booking_id=booking.id) then 'SECOND_SUCCESSFUL_PAYMENT'
    when (attempt.university_id,attempt.user_id,attempt.amount_kobo) is distinct from(price.university_id,price.student_user_id,price.payable_kobo::bigint)
      or booking.status<>'PENDING_PAYMENT' or booking.payment_expires_at<=now() or attempt.status not in ('CREATED','INITIALIZED')
      or not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,price.payable_kobo) then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',price.tutor_user_id,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if principal>price.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',principal-price.seller_net_kobo)); end if;
  if principal<price.seller_net_kobo then
    if not exists(select 1 from app_private.discount_redemptions where purchase_id=booking.id and discount_kobo>=price.seller_net_kobo-principal) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
    lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',price.seller_net_kobo-principal));
  end if;
  journal=app_private.post_finance_journal(price.university_id,'TUTORIAL_BOOKING',booking.id::text,'tutorial-payment:'||p_reference,'Verified inclusive tutorial payment',lines);
  insert into app_private.tutorial_settlements(booking_id,provider_reference,journal_id) values(booking.id,p_reference,journal);
  update public.tutorial_bookings set status='CONFIRMED',provider_reference=p_reference,updated_at=now() where id=booking.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.record_material_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; purchase app_private.tutorial_material_purchases%rowtype; lines jsonb; reason text; principal bigint;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_PURCHASE';
  if not found then return 'UNKNOWN'; end if;
  select * into purchase from app_private.tutorial_material_purchases where id=attempt.resource_id for update;
  if not found then return 'UNKNOWN'; end if;
  perform app_private.record_verified_paystack_receipt(purchase.university_id,p_reference,'TUTORIAL_PURCHASE',purchase.id,p_amount,p_fee,p_paid_at);
  if purchase.provider_reference=p_reference then return 'ALREADY_PAID'; end if;
  reason=case when purchase.provider_reference is not null then 'SECOND_SUCCESSFUL_PAYMENT'
    when(attempt.university_id,attempt.user_id,attempt.amount_kobo) is distinct from(purchase.university_id,purchase.student_user_id,purchase.amount_kobo)
      or purchase.status<>'PENDING_PAYMENT' or purchase.payment_expires_at<=now() or attempt.status not in ('CREATED','INITIALIZED') or not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,purchase.amount_kobo) then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if purchase.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',purchase.tutor_user_id,'direction','CREDIT','amount',purchase.seller_net_kobo)); end if;
  if principal>purchase.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',principal-purchase.seller_net_kobo)); end if;
  if principal<purchase.seller_net_kobo then
    if not exists(select 1 from app_private.discount_redemptions where purchase_id=purchase.id and discount_kobo>=purchase.seller_net_kobo-principal) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
    lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',purchase.seller_net_kobo-principal));
  end if;
  perform app_private.post_finance_journal(purchase.university_id,'TUTORIAL_PURCHASE',purchase.id::text,'material-payment:'||p_reference,'Verified inclusive learning material purchase',lines);
  update app_private.tutorial_material_purchases set status='PAID',earnings_state='PENDING',provider_reference=p_reference,paid_at=p_paid_at,release_at=now()+interval '7 days' where id=purchase.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.guard_material_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if(new.id,new.university_id,new.student_user_id,new.resource_id,new.tutor_user_id,new.media_object_id,new.title,new.listed_kobo,new.amount_kobo,new.seller_net_kobo) is distinct from
    (old.id,old.university_id,old.student_user_id,old.resource_id,old.tutor_user_id,old.media_object_id,old.title,old.listed_kobo,old.amount_kobo,old.seller_net_kobo) then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE'; end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE'; end if;
  if new.status='PAID' and not exists(select 1 from app_private.verified_paystack_receipts where provider_reference=new.provider_reference and
    university_id=new.university_id and purpose='TUTORIAL_PURCHASE' and resource_id=new.id and app_private.collection_paid_price_matches(new.provider_reference,amount_kobo,provider_fee_kobo,new.amount_kobo)) then raise exception 'VERIFIED_RECEIPT_REQUIRED'; end if;
  if new.earnings_state='AVAILABLE' and old.earnings_state='PENDING' then
    if new.status<>'PAID' or new.release_at is null or new.release_at>now() or new.provider_reference is null or
      exists(select 1 from public.disputes where tutorial_purchase_id=new.id and status in ('OPEN','UNDER_REVIEW')) then raise exception 'EARNINGS_NOT_ELIGIBLE'; end if;
    if new.seller_net_kobo>0 then perform app_private.post_finance_journal(new.university_id,'TUTORIAL_PURCHASE',new.id::text,'material-release:'||new.id::text,'Release learning material earnings after the dispute window',jsonb_build_array(
      jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',new.tutor_user_id,'direction','DEBIT','amount',new.seller_net_kobo),
      jsonb_build_object('code','TUTOR_AVAILABLE','type','LIABILITY','owner',new.tutor_user_id,'direction','CREDIT','amount',new.seller_net_kobo))); end if;
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.record_kira_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare checkout app_private.kira_checkouts; period_start timestamptz; period_end timestamptz; journal uuid; principal bigint;
begin
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference;
  if not found then return 'UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kira-billing:'||checkout.user_id::text,0));
  select * into checkout from app_private.kira_checkouts where provider_reference=p_reference for update;
  perform app_private.record_verified_paystack_receipt(checkout.university_id,p_reference,'KIRA_SUBSCRIPTION',checkout.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.kira_billing_periods where checkout_id=checkout.id) then return 'ALREADY_PAID'; end if;
  if not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,checkout.amount_kobo) or checkout.status not in ('CREATED','INITIALIZED','EXPIRED')
   or p_paid_at is null or p_paid_at<checkout.created_at or p_paid_at>checkout.expires_at then
    update app_private.kira_checkouts set status='REQUIRES_REVIEW' where id=checkout.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  select greatest(now(),case when status='ACTIVE' then current_period_end else now() end) into period_start from app_private.ai_subscriptions where user_id=checkout.user_id;
  period_start=coalesce(period_start,now());period_end=period_start+interval '1 month';
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  journal=app_private.post_finance_journal(checkout.university_id,'KIRA_SUBSCRIPTION',checkout.id::text,'kira-payment:'||p_reference,'Verified monthly Kira '||checkout.tier||' access',jsonb_build_array(
    jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal),jsonb_build_object('code','KIRA_SUBSCRIPTION_REVENUE','type','REVENUE','direction','CREDIT','amount',principal)));
  insert into app_private.kira_billing_periods(checkout_id,user_id,starts_at,ends_at,provider_reference,journal_id,tier) values(checkout.id,checkout.user_id,period_start,period_end,p_reference,journal,checkout.tier);
  insert into app_private.ai_subscriptions(user_id,status,current_period_end,billing_reference,tier) values(checkout.user_id,'ACTIVE',period_end,p_reference,checkout.tier)
    on conflict(user_id) do update set status='ACTIVE',current_period_end=excluded.current_period_end,billing_reference=excluded.billing_reference,tier=excluded.tier,updated_at=now();
  update app_private.kira_checkouts set status='PAID',paid_at=p_paid_at where id=checkout.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end $function$
;

CREATE OR REPLACE FUNCTION app_private.record_rider_commission_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare intent app_private.rider_commission_checkouts%rowtype; charge jsonb; outstanding bigint;
  allocated bigint:=0; allocation bigint; journal uuid; lines jsonb; fee_journal uuid; principal bigint;
begin
  select * into intent from app_private.rider_commission_checkouts where provider_reference=p_reference;
  if not found then return 'UNKNOWN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rider-finance:'||intent.user_id::text,0));
  select * into intent from app_private.rider_commission_checkouts where id=intent.id for update;
  if intent.status='PAID' then
    if not exists(select 1 from app_private.rider_commission_receipts where checkout_id=intent.id and amount_kobo=p_amount and provider_fee_kobo=p_fee) then raise exception 'RECEIPT_IDEMPOTENCY_CONFLICT'; end if;
    return 'ALREADY_PAID';
  end if;
  perform app_private.record_verified_paystack_receipt(intent.university_id,p_reference,'RIDER_COMMISSION',intent.id,p_amount,p_fee,p_paid_at);
  if not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,intent.amount_kobo) then
    update app_private.rider_commission_checkouts set status='REQUIRES_REVIEW' where id=intent.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='AMOUNT_MISMATCH',updated_at=now()
      where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  for charge in select value from jsonb_array_elements(intent.charges) loop
    select outstanding_kobo into outstanding from app_private.rider_unpaid_commissions(intent.user_id)
      where job_id=(charge->>'jobId')::uuid and university_id=intent.university_id;
    allocation=least(coalesce(outstanding,0),(charge->>'amountKobo')::bigint);
    allocated=allocated+allocation;
  end loop;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  if allocated>principal then raise exception 'RIDER_ALLOCATION_EXCEEDS_PRINCIPAL';end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if allocated>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','RIDER_COMMISSION_RECEIVABLE','type','ASSET','owner',intent.user_id,'direction','CREDIT','amount',allocated)); end if;
  if principal>allocated then lines=lines||jsonb_build_array(jsonb_build_object('code','RIDER_AVAILABLE','type','LIABILITY','owner',intent.user_id,'direction','CREDIT','amount',principal-allocated)); end if;
  journal=app_private.post_finance_journal(intent.university_id,'RIDER_COMMISSION',intent.id::text,'rider-repayment:'||p_reference,'Verified cash commission repayment',lines);
  for charge in select value from jsonb_array_elements(intent.charges) loop
    select outstanding_kobo into outstanding from app_private.rider_unpaid_commissions(intent.user_id) where job_id=(charge->>'jobId')::uuid;
    allocation=least(coalesce(outstanding,0),(charge->>'amountKobo')::bigint);
    if allocation>0 then insert into app_private.rider_commission_allocations(job_id,amount_kobo,source_type,source_id,journal_id)
      values((charge->>'jobId')::uuid,allocation,'PAYSTACK',p_reference,journal); end if;
  end loop;
  insert into app_private.rider_commission_receipts(checkout_id,provider_reference,amount_kobo,provider_fee_kobo,journal_id,paid_at)
    values(intent.id,p_reference,p_amount,p_fee,journal,p_paid_at);
  update app_private.rider_commission_checkouts set status='PAID',paid_at=p_paid_at where id=intent.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now()
    where provider='PAYSTACK' and provider_reference=p_reference;
  perform app_private.offset_rider_commissions(intent.user_id,intent.university_id);
  return 'PAID';
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.refund_original_snapshot(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r app_private.verified_paystack_receipts%rowtype; price jsonb; allocation uuid; buyer uuid;
begin
 select * into r from app_private.verified_paystack_receipts where provider_reference=p_reference;
 if not found then raise exception 'REFUND_ORIGINAL_VERIFIED_RECEIPT_REQUIRED';end if;
 if r.purpose='STORE_ORDER' then
  select jsonb_build_object('price',to_jsonb(p),'quote',to_jsonb(q)),o.buyer_user_id,s.journal_id into price,buyer,allocation
  from app_private.order_price_snapshots p join app_private.store_checkout_quotes q on q.id=p.quote_id
  join public.orders o on o.id=p.order_id join app_private.commerce_settlements s on s.order_id=o.id and s.provider_reference=p_reference
  where p.order_id=r.resource_id and p.university_id=r.university_id and app_private.collection_paid_price_matches(p_reference,r.amount_kobo,r.provider_fee_kobo,p.payable_kobo);
 elsif r.purpose='TUTORIAL_BOOKING' then
  select to_jsonb(p),p.student_user_id,s.journal_id into price,buyer,allocation
  from app_private.tutorial_booking_prices p join app_private.tutorial_settlements s on s.booking_id=p.booking_id and s.provider_reference=p_reference
  where p.booking_id=r.resource_id and p.university_id=r.university_id and app_private.collection_paid_price_matches(p_reference,r.amount_kobo,r.provider_fee_kobo,p.payable_kobo);
 elsif r.purpose='TUTORIAL_PURCHASE' then
  select to_jsonb(q),p.student_user_id,t.id into price,buyer,allocation
  from app_private.material_checkout_quotes q join app_private.tutorial_material_purchases p on p.id=q.id
  join public.ledger_transactions t on t.idempotency_key='material-payment:'||p_reference
  where p.id=r.resource_id and p.provider_reference=p_reference and p.university_id=r.university_id and app_private.collection_paid_price_matches(p_reference,r.amount_kobo,r.provider_fee_kobo,p.amount_kobo);
 elsif r.purpose='KIRA_SUBSCRIPTION' then
  select jsonb_build_object('plan',to_jsonb(p),'checkoutId',c.id,'amountKobo',c.amount_kobo,'planId',c.plan_id),c.user_id,b.journal_id into price,buyer,allocation
  from app_private.kira_checkouts c join app_private.kira_price_plans p on p.id=c.plan_id
  join app_private.kira_billing_periods b on b.checkout_id=c.id and b.provider_reference=p_reference
  where c.id=r.resource_id and c.university_id=r.university_id and app_private.collection_paid_price_matches(p_reference,r.amount_kobo,r.provider_fee_kobo,c.amount_kobo);
 else raise exception 'REFUND_UNSUPPORTED_PAYMENT';end if;
 if price is null or allocation is null or buyer is null then raise exception 'REFUND_ORIGINAL_PRICE_SNAPSHOT_REQUIRED';end if;
 return jsonb_build_object('receipt',to_jsonb(r),'pricing',price,'buyerUserId',buyer,'allocationJournalId',allocation,
   'allocation',(select journal_payload from public.ledger_transactions where id=allocation));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.refund_accounting_review_reason(p_reference text, p_amount bigint)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r app_private.verified_paystack_receipts%rowtype; state text; earnings text; fare bigint; principal bigint;
begin
 select * into r from app_private.verified_paystack_receipts where provider_reference=p_reference;
 principal=app_private.collection_settlement_principal(p_reference,r.amount_kobo,r.provider_fee_kobo);
 if principal is null then return 'REFUND_ORIGINAL_PRICE_SNAPSHOT_REQUIRED';end if;
 if p_amount<>principal then return 'PARTIAL_REFUND_POLICY_REQUIRED';end if;
 if r.purpose='KIRA_SUBSCRIPTION' then return 'KIRA_ENTITLEMENT_REFUND_POLICY_REQUIRED';end if;
 if r.purpose='STORE_ORDER' then
  select status,earnings_state,delivery_fee_kobo into state,earnings,fare from public.orders where id=r.resource_id for update;
  if fare<>0 or exists(select 1 from app_private.order_price_snapshots where order_id=r.resource_id and cash_due_kobo<>0) then return 'DELIVERY_REFUND_POLICY_REQUIRED';end if;
  if state<>'PAID' then return 'PURCHASE_FULFILMENT_REVIEW_REQUIRED';end if;
 elsif r.purpose='TUTORIAL_BOOKING' then
  select status,earnings_state into state,earnings from public.tutorial_bookings where id=r.resource_id for update;
  if state<>'CONFIRMED' then return 'PURCHASE_FULFILMENT_REVIEW_REQUIRED';end if;
 elsif r.purpose='TUTORIAL_PURCHASE' then
  select status,earnings_state into state,earnings from app_private.tutorial_material_purchases where id=r.resource_id for update;
  if state<>'PAID' then return 'PURCHASE_FULFILMENT_REVIEW_REQUIRED';end if;
 else return 'REFUND_UNSUPPORTED_PAYMENT';end if;
 if earnings is null or earnings not in('NOT_EARNED','PENDING') or exists(
  select 1 from public.ledger_transactions where reference_id=r.resource_id::text and
  idempotency_key in('store-release:'||r.resource_id::text,'tutorial-release:'||r.resource_id::text,'material-release:'||r.resource_id::text)
 ) then return 'SELLER_EARNINGS_REVERSAL_POLICY_REQUIRED';end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.create_verified_refund_request(p_id uuid, p_uni uuid, p_actor uuid, p_request uuid, p_reference text, p_amount bigint, p_reason text)
 RETURNS app_private.verified_refund_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare saved app_private.verified_refund_requests%rowtype; snapshot jsonb; r app_private.verified_paystack_receipts%rowtype; review text; seller bigint; commission bigint; principal bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('refund-original:'||p_reference,0));
 select * into saved from app_private.verified_refund_requests where requested_by=p_actor and request_id=p_request;
 if found then
  if(saved.university_id,saved.original_reference,saved.customer_refund_kobo,saved.reason) is distinct from(p_uni,p_reference,p_amount,p_reason) then raise exception 'REFUND_IDEMPOTENCY_CONFLICT';end if;
  return saved;
 end if;
 snapshot=app_private.refund_original_snapshot(p_reference);
 select * into r from app_private.verified_paystack_receipts where provider_reference=p_reference;
 if r.university_id<>p_uni then raise exception 'REFUND_TENANT_MISMATCH';end if;
 principal=app_private.collection_settlement_principal(p_reference,r.amount_kobo,r.provider_fee_kobo);
 if principal is null then raise exception 'REFUND_ORIGINAL_PRICE_SNAPSHOT_REQUIRED';end if;
 if p_amount is null or p_amount<=0 or p_amount>principal then raise exception 'REFUND_AMOUNT_INVALID';end if;
 review=app_private.refund_accounting_review_reason(p_reference,p_amount);
 if snapshot->'allocation' is null or snapshot->'allocation'='null'::jsonb then review='ORIGINAL_JOURNAL_REVIEW_REQUIRED';end if;
 if (select count(*) from jsonb_to_recordset(coalesce(snapshot->'allocation'->'lines','[]'::jsonb)) x(code text,direction text,amount bigint)
  where x.code='PAYMENT_SUSPENSE' and x.direction='DEBIT' and x.amount=principal)<>1 then review='ORIGINAL_JOURNAL_REVIEW_REQUIRED';end if;
 select coalesce(sum(case when x.code in('VENDOR_PENDING','TUTOR_PENDING') and x.direction='CREDIT' then x.amount else 0 end),0),
   coalesce(sum(case when x.code='PLATFORM_COMMISSION' and x.direction='CREDIT' then x.amount else 0 end),0)
 into seller,commission from jsonb_to_recordset(coalesce(snapshot->'allocation'->'lines','[]'::jsonb)) x(code text,direction text,amount bigint);
 insert into app_private.verified_refund_requests(id,university_id,original_reference,resource_type,resource_id,buyer_user_id,request_id,requested_by,original_snapshot,
  original_principal_kobo,customer_refund_kobo,original_collection_fee_kobo,seller_reversal_kobo,commission_reversal_kobo,delivery_treatment,accounting_mode,status,reason,review_reason)
 values(p_id,p_uni,p_reference,r.purpose,r.resource_id,(snapshot->>'buyerUserId')::uuid,p_request,p_actor,snapshot,principal,p_amount,r.provider_fee_kobo,
  case when review is null then seller else 0 end,case when review is null then commission else 0 end,
  case when review='DELIVERY_REFUND_POLICY_REQUIRED' then 'REQUIRES_REVIEW' else 'NONE' end,
  case when review is null then 'FULL_UNEARNED_NO_DELIVERY_V1' else 'MANUAL_REVIEW' end,case when review is null then 'REQUESTED' else 'REQUIRES_REVIEW' end,p_reason,review) returning * into saved;
 insert into app_private.verified_refund_events(refund_id,status,actor_user_id,metadata) values(saved.id,saved.status,p_actor,jsonb_build_object('reviewReason',review));
 return saved;
end $function$
;

commit;
