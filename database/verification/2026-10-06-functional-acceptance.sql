-- Execute between a savepoint and its rollback. Every account, quote, journal,
-- notification and schedule here is synthetic and must never be committed.
do $acceptance$
declare
 campus uuid:=gen_random_uuid(); other_campus uuid:=gen_random_uuid();
 owner uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 fee_profile uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid();
 grp uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
 exam_request uuid:=gen_random_uuid(); challenge uuid:=gen_random_uuid();
 exam_day date:=(now() at time zone 'Africa/Lagos')::date+30;
 ref text:='K1-AI-fixture-'||gen_random_uuid(); checkout uuid:=gen_random_uuid();
 imported record; result text;
begin
 insert into public.universities(id,name,slug,updated_at) values
 (campus,'October 6 synthetic acceptance',campus::text,now()),
 (other_campus,'October 6 foreign acceptance',other_campus::text,now());
 insert into public.users(id,email,password_hash,updated_at,email_verified_at)
 select u,u::text||'@example.test','temporary-acceptance-only',now(),now()
 from unnest(array[owner,student,outsider])u;
 insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)
 select u,u,'oct6_'||left(replace(u::text,'-',''),20),'Synthetic acceptance',
 case when u=outsider then other_campus else campus end,now()
 from unnest(array[owner,student,outsider])u;

 insert into public.student_groups(id,institution_id,owner_user_id,kind,name,request_id)
 values(grp,campus,owner,'COMMUNITY','Synthetic pending membership',gen_random_uuid());
 insert into public.student_group_members(group_id,institution_id,user_id,role)
 values(grp,campus,owner,'ADMIN');
 insert into app_private.community_join_requests(id,group_id,institution_id,user_id,full_name,matriculation_number,department,level,nickname,guidelines_version,guidelines_snapshot)
 values(request,grp,campus,student,'Synthetic Student','MAT/FIXTURE/001','Computer Science','200','Fixture',1,'Respect members');
 if exists(select 1 from public.student_group_members where group_id=grp and user_id=student)then raise exception 'Pending membership granted access';end if;
 begin
  perform app_private.review_community_join_requests(grp,student,campus,'{}',true,'APPROVED');
  raise exception 'Unprivileged member approved requests';
 exception when others then if sqlerrm not like '%JOIN_REVIEW_FORBIDDEN%'then raise;end if;end;
 if app_private.review_community_join_requests(grp,owner,campus,'{}',true,'APPROVED')<>1 then raise exception 'Authorized approval failed';end if;
 if not exists(select 1 from public.student_group_members where group_id=grp and user_id=student and nickname='Fixture' and notifications_enabled)then raise exception 'Approval did not save identity and alerts';end if;

 select * into imported from app_private.import_exam_schedule(student,campus,exam_request,'fixture-exam',jsonb_build_array(
 jsonb_build_object('title','First paper','courseCode','CSC201','date',exam_day,'startsAt','09:00','endsAt','11:00','venue','Hall A'),
 jsonb_build_object('title','Later paper','courseCode','MTH201','date',exam_day,'startsAt','14:00','endsAt','16:00','venue','Hall B'),
 jsonb_build_object('title','Next day','courseCode','PHY201','date',exam_day+1,'startsAt','12:00','endsAt','14:00','venue','Hall C')));
 if imported.imported<>3 or imported.replayed then raise exception 'Exam import failed';end if;
 if (select count(*) from public.student_alarms where user_id=student and enabled)<>8 then raise exception 'Exams must schedule only first paper per day';end if;
 if exists(select 1 from app_private.exam_alarm_links l join public.student_exams e on e.id=l.exam_id where e.user_id=student and e.course_code='MTH201')then raise exception 'Later paper received reminders';end if;
 if not exists(select 1 from public.student_alarms a join app_private.exam_alarm_links l on l.alarm_id=a.id where a.user_id=student and l.lead_minutes=120 and a.fires_at=exam_day::timestamp+interval '6 hours')then raise exception 'Lagos reminder time incorrect';end if;
 insert into app_private.exam_disable_challenges(id,user_id,exam_date,code_hash,expires_at) values(challenge,student,exam_day,'right-fixture-code',now()+interval '10 minutes');
 if app_private.confirm_exam_awareness(outsider,challenge,'right-fixture-code')<>'EXPIRED'then raise exception 'Foreign user consumed challenge';end if;
 if app_private.confirm_exam_awareness(student,challenge,'wrong-fixture-code')<>'INCORRECT'then raise exception 'Incorrect code accepted';end if;
 if (select count(*) from public.student_alarms where user_id=student and enabled)<>8 then raise exception 'Incorrect code disabled alarms';end if;
 if app_private.confirm_exam_awareness(student,challenge,'right-fixture-code')<>'CONFIRMED'then raise exception 'Valid owner code failed';end if;
 if (select count(*) from public.student_alarms where user_id=student and enabled)<>4 then raise exception 'Acknowledgement affected another day';end if;

 insert into app_private.payment_fee_profiles(id,university_id,version,transaction_class,collection,effective_from,status,source_url,approval_note,approved_by)
 values(fee_profile,campus,'fixture-v1','LOCAL_COLLECTION','{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}',now()-interval '1 day','APPROVED','https://paystack.com/pricing','Synthetic fixture rules',owner);
 insert into app_private.kira_price_plans(id,university_id,version,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
 values(plan,campus,'fixture-pro','{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}',19000,owner,'Synthetic fixture plan','https://paystack.com/pricing');
 insert into app_private.collection_payment_pricing(provider_reference,university_id,purpose,resource_id,provider_fee_mode,provider_initialized_amount_kobo,final_customer_amount_kobo,expected_provider_fee_kobo,collection,fee_profile_id,fee_profile_version,variance_tolerance_kobo,native_pricing)
 values(ref,campus,'KIRA_SUBSCRIPTION',checkout,'CUSTOMER_PASSTHROUGH',581000,600000,19000,'{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}',fee_profile,'fixture-v1',100,'{}');
 insert into app_private.kira_checkouts(id,user_id,university_id,plan_id,request_id,provider_reference,created_at,expires_at,status)
 values(checkout,student,campus,plan,gen_random_uuid(),ref,now()-interval '3 hours',now()-interval '2 hours','EXPIRED');
 result=app_private.record_collection_pricing_observation_v2(ref,600000,19000,'fixture-'||checkout,'card','NG','VISA','NGN','test',581000);
 if result<>'OBSERVED'then raise exception 'Exact principal receipt was not observed';end if;
 if app_private.record_kira_receipt(ref,600000,19000,now()-interval '150 minutes')<>'PAID'then raise exception 'Late payment failed to reconcile';end if;
 if app_private.record_kira_receipt(ref,600000,19000,now()-interval '150 minutes')<>'ALREADY_PAID'then raise exception 'Receipt replay was not idempotent';end if;
 if (select count(*) from app_private.kira_billing_periods where checkout_id=checkout)<>1 then raise exception 'Duplicate billing period';end if;
 if not app_private.collection_paid_price_matches(ref,600000,19000,600000)then raise exception 'Exact principal did not match';end if;
 if app_private.collection_paid_price_matches(ref,600001,19000,600000)then raise exception 'Arbitrary overpayment accepted';end if;
 if app_private.collection_settlement_principal(ref,600000,19000)<>581000 then raise exception 'Provider fee entered settlement principal';end if;
 if exists(select 1 from public.ledger_transactions t where t.idempotency_key like '%'||ref||'%' and (select coalesce(sum((line->>'amount')::bigint*(case line->>'direction'when 'DEBIT'then 1 else -1 end)),0)from jsonb_array_elements(t.journal_payload->'lines')line)<>0)then raise exception 'Unbalanced fixture journal';end if;
end $acceptance$;
