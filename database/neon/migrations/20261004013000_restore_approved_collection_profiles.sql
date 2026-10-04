begin;
-- Preserve the actual reviewer, source, and collection rule of previously
-- approved native policies. The provider-profile rollout must not invalidate
-- those approvals just because no payment had imported their rule yet.
-- This does not attest or change the merchant's Paystack account setting.
insert into app_private.payment_fee_profiles(
 university_id,version,transaction_class,channel,card_network,collection,
 effective_from,status,source_url,approval_note,approved_by,approved_at
)
select university_id,'LEGACY_'||id::text,'LOCAL_COLLECTION','ANY','ANY',
 collection-'providerProfileId'-'providerProfileVersion'-'transactionClass',
 approved_at,'APPROVED',source_url,approval_note,approved_by,approved_at
from (
 select id,university_id,collection,approved_by,approved_at,source_url,approval_note
 from app_private.kira_price_plans
 union all
 select id,university_id,collection,approved_by,approved_at,source_url,approval_note
 from app_private.commerce_fee_policies
) approved
where collection->>'providerProfileId' is null
 and collection ?& array['basisPoints','flatKobo','flatWaivedBelowKobo','capKobo']
on conflict(university_id,transaction_class,version) do nothing;
commit;
