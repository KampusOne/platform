-- Read-only acceptance after 20261004013000. This verifies migration provenance
-- and never creates a merchant-account attestation or new payment.
do $$
begin
 if exists(
  select 1 from app_private.kira_price_plans p
  where p.collection->>'providerProfileId' is null
   and p.collection ?& array['basisPoints','flatKobo','flatWaivedBelowKobo','capKobo']
   and not exists(select 1 from app_private.payment_fee_profiles f
    where f.university_id=p.university_id and f.version='LEGACY_'||p.id::text
     and f.status='APPROVED' and f.transaction_class='LOCAL_COLLECTION'
     and f.approved_by=p.approved_by and f.approved_at=p.approved_at
     and f.source_url=p.source_url and f.approval_note=p.approval_note)
 ) then raise exception 'APPROVED_KIRA_PROFILE_PROVENANCE_MISSING';end if;
end $$;
