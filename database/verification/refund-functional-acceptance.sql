-- Synthetic, self-rolling-back acceptance proof. Run only with the server-side
-- migration role after verified_refund_accounting and its finance prerequisites.
-- No provider API, refund initiation, real customer, email or committed write.
do $refund_acceptance$
declare
 campus uuid=gen_random_uuid(); buyer uuid=gen_random_uuid(); seller uuid=gen_random_uuid();
 requester uuid=gen_random_uuid(); reviewer uuid=gen_random_uuid(); application uuid=gen_random_uuid();
 agent uuid=gen_random_uuid(); policy uuid=gen_random_uuid(); listing uuid=gen_random_uuid();
 window_id uuid=gen_random_uuid(); booking uuid=gen_random_uuid(); refund uuid=gen_random_uuid();
 reference text='K1-T-refund-acceptance-'||gen_random_uuid()::text;
 provider_id text='9'||(extract(epoch from clock_timestamp())*1000000)::bigint::text;
 subject uuid; result text; journals_before integer; saved app_private.verified_refund_requests%rowtype;
 completed boolean=false; before_users bigint;before_journals bigint;before_refunds bigint;
begin
 select count(*) into before_users from public.users;
 select count(*) into before_journals from public.ledger_transactions;
 select count(*) into before_refunds from app_private.verified_refund_requests;
 begin
 if to_regprocedure('app_private.record_verified_refund(uuid,uuid,uuid,text,text,text,bigint,text,timestamp with time zone)') is null then
  raise exception 'REFUND_ACCEPTANCE_MIGRATION_REQUIRED';end if;
 insert into public.universities(id,name,slug,updated_at) values(campus,'Synthetic refund acceptance '||campus,campus::text,now());
 foreach subject in array array[buyer,seller,requester,reviewer] loop
  insert into public.users(id,email,password_hash,updated_at) values(subject,subject::text||'@example.invalid','SYNTHETIC_ACCEPTANCE_ONLY',now());
  insert into public.profiles(id,user_id,university_id,username,display_name,updated_at)
   values(subject,subject,campus,'ref_'||substr(replace(subject::text,'-',''),1,20),'Synthetic refund acceptance',now());
 end loop;
 insert into public.agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)
  values(application,seller,campus,'TUTOR','Synthetic refund tutor','+2348012345678','Synthetic acceptance fixture only');
 insert into public.agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)
  values(agent,seller,campus,application,'TUTOR','Synthetic refund tutor',now());
 insert into app_private.commerce_fee_policies(id,university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,
  seller_commission_basis_points,collection,checkout_savings,allow_processor_subsidy,source_url,approval_note,approved_by)
 values(policy,campus,'TUTORIAL','SYNTHETIC_REFUND_ACCEPTANCE',0,0,500,'{}',true,false,'https://paystack.com/pricing','Synthetic reviewed acceptance policy',reviewer);
 insert into public.tutorial_listings(id,university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status)
  values(listing,campus,agent,'SYN101','Synthetic refund session','Synthetic acceptance fixture only','ONLINE',600000,5,'PUBLISHED','APPROVED');
 insert into public.tutorial_availability_windows(id,listing_id,starts_at,ends_at,capacity)
  values(window_id,listing,now()+interval '1 day',now()+interval '25 hours',5);
 perform * from app_private.create_priced_tutorial_booking(booking,campus,buyer,listing,window_id,gen_random_uuid(),policy,600000,
  '{"baseKobo":600000,"fareKobo":0,"payableKobo":600000,"listedItemsKobo":600000,"sellerNetKobo":570000,"estimatedProcessingKobo":19000}'::jsonb);
 insert into public.payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)
  values(gen_random_uuid(),buyer,campus,'TUTORIAL_BOOKING',booking,reference,600000,reference,'INITIALIZED');
 result=app_private.record_priced_tutorial_receipt(reference,600000,19000,now());
 if result<>'PAID' then raise exception 'REFUND_ACCEPTANCE_ORIGINAL_RECEIPT_FAILED: %',result;end if;
 saved=app_private.create_verified_refund_request(refund,campus,requester,gen_random_uuid(),reference,600000,'Synthetic original principal refund acceptance');
 if saved.status<>'REQUESTED' or saved.original_collection_fee_kobo<>19000 then raise exception 'REFUND_ACCEPTANCE_SNAPSHOT_FAILED';end if;
 begin
  perform app_private.approve_verified_refund(refund,campus,buyer,'Synthetic unsafe owner approval');
  raise exception 'REFUND_ACCEPTANCE_OWNER_APPROVAL_ALLOWED';
 exception when others then if sqlerrm not like '%REFUND_INDEPENDENT_REVIEW_REQUIRED%' then raise;end if;end;
 begin
  update app_private.verified_refund_requests set original_snapshot='{}' where id=refund;
  raise exception 'REFUND_ACCEPTANCE_SNAPSHOT_MUTABLE';
 exception when others then if sqlerrm not like '%REFUND_SNAPSHOT_IMMUTABLE%' then raise;end if;end;
 perform app_private.approve_verified_refund(refund,campus,reviewer,'Synthetic independent approved principal refund');
 perform app_private.bind_verified_refund_provider(refund,campus,reviewer,provider_id,'Synthetic existing provider refund ID; no API call');
 select count(*) into journals_before from public.ledger_transactions where university_id=campus;
 perform app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'NGN',600000,'pending',null);
 perform app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'NGN',600000,'pending',null);
 perform app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'NGN',600000,'failed',null);
 if journals_before<>(select count(*) from public.ledger_transactions where university_id=campus) or
  app_private.finance_balance(campus,seller,'TUTOR_PENDING')<>570000 then raise exception 'REFUND_ACCEPTANCE_PENDING_DEBIT';end if;
 begin
  update public.tutorial_bookings set status='COMPLETED',completed_at=now() where id=booking;
  raise exception 'REFUND_ACCEPTANCE_RESERVATION_BYPASSED';
 exception when others then if sqlerrm not like '%PURCHASE_RESERVED_FOR_REFUND_REVIEW%' then raise;end if;end;
 begin
  perform app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'USD',600000,'processed','2026-10-03T10:00:00Z');
  raise exception 'REFUND_ACCEPTANCE_CURRENCY_MISMATCH_ALLOWED';
 exception when others then if sqlerrm not like '%REFUND_PROVIDER_SNAPSHOT_MISMATCH%' then raise;end if;end;
 begin
  perform app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'NGN',600001,'processed','2026-10-03T10:00:00Z');
  raise exception 'REFUND_ACCEPTANCE_AMOUNT_MISMATCH_ALLOWED';
 exception when others then if sqlerrm not like '%REFUND_PROVIDER_SNAPSHOT_MISMATCH%' then raise;end if;end;
 result=app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'NGN',600000,'processed','2026-10-03T10:00:00Z');
 if result<>'SUCCEEDED' then raise exception 'REFUND_ACCEPTANCE_COMPENSATION_FAILED';end if;
 result=app_private.record_verified_refund(refund,campus,reviewer,provider_id,reference,'NGN',600000,'processed','2026-10-03T10:00:00Z');
 if result<>'ALREADY_SUCCEEDED' or
  (select count(*) from public.ledger_transactions where idempotency_key='verified-refund:'||provider_id)<>1 or
  app_private.finance_balance(campus,seller,'TUTOR_PENDING')<>0 or
  app_private.finance_balance(campus,null,'PLATFORM_COMMISSION')<>0 or
  app_private.finance_balance(campus,null,'PAYSTACK_CLEARING')<>-19000 then raise exception 'REFUND_ACCEPTANCE_DUPLICATE_OR_FEE_REVERSAL';end if;
 if (select status from public.tutorial_bookings where id=booking)<>'REFUNDED' then raise exception 'REFUND_ACCEPTANCE_PURCHASE_STATE_FAILED';end if;
 set constraints all immediate;
 completed=true;
 raise exception using errcode='P0399',message='ROLLBACK_REFUND_ACCEPTANCE_FIXTURES';
 exception when sqlstate 'P0399' then if not completed then raise;end if;end;
 if (select count(*) from public.users)<>before_users or
  (select count(*) from public.ledger_transactions)<>before_journals or
  (select count(*) from app_private.verified_refund_requests)<>before_refunds or
  exists(select 1 from public.universities where id=campus) or
  exists(select 1 from app_private.verified_paystack_receipts where provider_reference=reference) or
  exists(select 1 from app_private.verified_refund_events where refund_id=refund)
  then raise exception 'REFUND_ACCEPTANCE_FIXTURE_ROLLBACK';end if;
end $refund_acceptance$;
