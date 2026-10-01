begin;
create or replace function app_private.payout_identity_eligible(p_profile uuid,p_user uuid,p_uni uuid,p_recipient text,p_mode text)
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
  =case when d.is_student then 3 else 2 end)
 or exists(select 1 from public.agent_profiles p join public.agent_applications a on a.id=p.application_id join app_private.trusted_vendor_intakes t on t.application_id=a.id join app_private.trusted_vendor_invites i on i.id=t.invite_id join public.users u on u.id=p.user_id join app_private.payout_account_setups s on s.agent_profile_id=p.id and s.application_id=a.id
 where p.id=p_profile and p.user_id=p_user and p.university_id=p_uni and p.status='ACTIVE' and a.status='APPROVED' and a.agent_type='VENDOR' and a.user_id=p_user and a.university_id=p_uni and u.status='ACTIVE' and u.deleted_at is null and a.kyc_status='MANUALLY_VERIFIED' and a.phone_verified_at is not null and a.terms_accepted_at is not null
 and t.approved_at is not null and t.reviewed_by is not null and length(t.review_note)>=20 and date_part('year',age(current_date,t.birth_date)) between 18 and 110 and i.revoked_at is null and i.institution_id=p_uni and i.claimed_user_id=p_user and lower(i.email)=lower(u.email)
 and a.bank_status='VERIFIED' and a.bank_recipient_code=p_recipient and s.status='APPROVED' and s.user_id=p_user and s.institution_id=p_uni and s.recipient_code=p_recipient and s.provider_mode=p_mode);
$$;
revoke all on function app_private.payout_identity_eligible(uuid,uuid,uuid,text,text) from public;
commit;
