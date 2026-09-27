-- Run on the isolated rehearsal database. All synthetic rows roll back.
do $commerce_smoke$
declare campus uuid:=gen_random_uuid();student uuid:=gen_random_uuid();tutor uuid:=gen_random_uuid();application uuid:=gen_random_uuid();agent uuid:=gen_random_uuid();material uuid:=gen_random_uuid();media uuid:=gen_random_uuid();purchase uuid:=gen_random_uuid();q jsonb;receipt public.tutorial_purchases%rowtype;reference text:='rehearsal-'||gen_random_uuid();result text;
begin
  begin
    insert into public.universities(id,name,slug,updated_at) values(campus,'Rollback commerce fixture',campus::text,now());
    insert into public.users(id,email,password_hash,updated_at) values(student,student||'@example.invalid','synthetic',now()),(tutor,tutor||'@example.invalid','synthetic',now());
    insert into public.profiles(id,user_id,university_id,display_name,username,updated_at) values(gen_random_uuid(),student,campus,'Synthetic student',left(replace(student::text,'-',''),28),now()),(gen_random_uuid(),tutor,campus,'Synthetic tutor',left(replace(tutor::text,'-',''),28),now());
    insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,status) values(application,campus,tutor,'TUTOR','Synthetic tutor','+2348000000000','Rollback-only commerce verification','APPROVED');
    insert into public.agent_profiles(id,university_id,user_id,application_id,agent_type,display_name,verified_at) values(agent,campus,tutor,application,'TUTOR','Synthetic tutor',now());
    insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values(media,tutor,campus,'resource','rollback.pdf','application/pdf',10,'rollback.pdf');
    insert into public.tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,status,media_object_id) values(material,campus,agent,'MTH101','Synthetic mathematics','Rollback-only paid material test','PDF','PAID',30000,'Synthetic tutor','PUBLISHED',media);
    insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason) values(campus,'TUTOR_COMMISSION','rollback-v1',now(),0,1000,tutor,'Rollback-only verification'),(campus,'BUYER_SERVICE','rollback-v1',now(),2000,0,tutor,'Rollback-only verification');
    q:=app_private.tutor_quote(campus,student,material,null);
    if (q->>'amountKobo')::integer<>32000 or (q->>'commissionKobo')::integer<>3000 then raise exception 'FEE_CALCULATION_FAILED'; end if;
    select * into receipt from app_private.create_tutor_purchase(purchase,campus,student,material,null,q);
    if app_private.can_read_tutor_resource(student,material) then raise exception 'UNPAID_ACCESS_GRANTED'; end if;
    insert into public.payment_attempts(user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status) values(student,campus,'TUTORIAL_PURCHASE',purchase,reference,32000,reference,'INITIALIZED');
    insert into public.payment_provider_events(provider,provider_reference,event_type,amount_kobo) values('PAYSTACK',reference,'charge.success',32000);
    result:=app_private.settle_commerce_payment(reference,32000,'NGN');
    if result<>'processed' or not app_private.can_read_tutor_resource(student,material) then raise exception 'CONFIRMED_ACCESS_FAILED'; end if;
    if app_private.settle_commerce_payment(reference,32000,'NGN')<>'already_processed' then raise exception 'REPLAY_FAILED'; end if;
    if (select sum(case when l.direction='DEBIT' then l.amount_kobo else -l.amount_kobo end) from public.ledger_lines l join public.ledger_transactions t on t.id=l.transaction_id where t.reference_id=purchase::text)<>0 then raise exception 'UNBALANCED_JOURNAL'; end if;
    if (select count(*) from public.ledger_transactions where reference_id=purchase::text)<>1 then raise exception 'DUPLICATE_JOURNAL'; end if;
    raise exception 'ROLLBACK_COMMERCE_PASS';
  exception when raise_exception then
    if sqlerrm<>'ROLLBACK_COMMERCE_PASS' then raise; end if;
  end;
end $commerce_smoke$;
