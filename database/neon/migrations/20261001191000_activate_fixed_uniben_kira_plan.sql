begin;
-- The owner explicitly requested the existing fixed ₦6,000 paid plan in
-- complaints 106 and 122. This does not approve any supplier or payout fees.
-- Current public Nigeria collection fees checked on 1 October 2026.
with plan as (
 insert into app_private.kira_price_plans(id,university_id,version,amount_kobo,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
 select gen_random_uuid(),u.id,'2026-10-01-fixed-6000',600000,'{"basisPoints":150,"flatKobo":10000,"flatWaivedBelowKobo":250000,"capKobo":200000}'::jsonb,19000,owner.id,
 'Owner requested activation of the existing fixed ₦6,000 monthly Kira Pro purchase in the October correction batch, complaints 106 and 122. Platform absorbs collection costs. No automatic renewal.','https://paystack.com/pricing'
 from public.universities u join public.users owner on owner.id='d34f89d0-aa39-4a92-b52f-a16af84a0b1f' and lower(owner.email)='igiehongideon864@gmail.com' and owner.deleted_at is null
 where u.id='6a79211e-6e85-4d95-be24-976edb26ba58' and not exists(select 1 from app_private.active_kira_price_plans a where a.university_id=u.id)
 on conflict(university_id,version) do nothing returning id,university_id,approved_by
 ), activated as (
 insert into app_private.active_kira_price_plans(university_id,plan_id) select university_id,id from plan on conflict(university_id) do nothing returning university_id,plan_id
 ) insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata)
 select p.approved_by,p.university_id,'kira.price_plan.approved','kira_price_plan',p.id::text,'succeeded','{"complaints":[106,122],"amountKobo":600000,"processingAbsorbed":true,"release":"2026-10-01"}'::jsonb from plan p join activated a on a.plan_id=p.id;
commit;
