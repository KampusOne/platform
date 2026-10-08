begin;

do $reference_pois$
declare
  target_university constant uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
  target_campus constant uuid := '1d60dcae-760d-4de7-8443-6a870d9bbe1a';
  found_count integer;
begin
  if not exists (
    select 1 from public.institution_campuses
    where id=target_campus and institution_id=target_university and slug='ugbowo'
  ) then raise exception 'UNIBEN_UGBOWO_SCOPE_MISSING'; end if;

  insert into public.campus_places(
    id,university_id,campus_id,name,category,description,latitude,longitude,geom,
    search_aliases,status,source_provider,source_feature_id,source_url,verified_at,confidence,updated_at
  ) values
    (
      'da274dde-3a1e-5fe4-ad0d-ff9b30c66439',target_university,target_campus,
      'Promise Land Restaurant','FOOD','Restaurant landmark in the UNIBEN bank/farm axis.',
      6.4031875,5.610078125,public.ST_SetSRID(public.ST_MakePoint(5.610078125,6.4031875),4326),
      array['Promise_land Restaurant','Promise land Restaurant','Promise Land UNIBEN'],'PUBLISHED',
      'REFERENCE','pluscode:CJ36+72G','https://biashara.cybo.com/NG-posta/300271_benin-city/mikahawa',null,.70,now()
    ),
    (
      'cf0a2dea-8b98-5113-806a-8a188c816cdf',target_university,target_campus,
      'UNIBEN Farm Project','ACADEMIC','University farm project landmark on Ugbowo Campus.',
      6.4030625,5.610921875,public.ST_SetSRID(public.ST_MakePoint(5.610921875,6.4030625),4326),
      array['Uniben Farm Project','UNIBEN Farm project','Farm Project'],'PUBLISHED',
      'REFERENCE','pluscode:CJ36+69F','https://www.cybo.com/NG/benin-city/tractors-and-farm-equipment/',null,.70,now()
    ),
    (
      '9dd57650-a5cc-5774-b7cc-a8d985bba7a6',target_university,target_campus,
      'Shopping Complex UNIBEN','SERVICE','Campus shopping complex behind the Fidelity Bank area.',
      6.4023875,5.610421875,public.ST_SetSRID(public.ST_MakePoint(5.610421875,6.4023875),4326),
      array['UNIBEN Shopping Complex','Uniben shopping complex','Shopping Complex'],'PUBLISHED',
      'REFERENCE','pluscode:CJ26+X53','https://ng.worldorgs.com/catalog/benin-city/shopping-mall/shoppingcomplexuniben',null,.70,now()
    )
  on conflict(id) do update set
    name=excluded.name,category=excluded.category,description=excluded.description,
    latitude=excluded.latitude,longitude=excluded.longitude,geom=excluded.geom,
    search_aliases=excluded.search_aliases,status=excluded.status,
    source_provider=excluded.source_provider,source_feature_id=excluded.source_feature_id,
    source_url=excluded.source_url,verified_at=null,confidence=excluded.confidence,updated_at=now()
  where campus_places.university_id=excluded.university_id
    and campus_places.campus_id=excluded.campus_id;

  select count(*)::int into found_count
  from public.campus_places
  where id in (
    'da274dde-3a1e-5fe4-ad0d-ff9b30c66439'::uuid,
    'cf0a2dea-8b98-5113-806a-8a188c816cdf'::uuid,
    '9dd57650-a5cc-5774-b7cc-a8d985bba7a6'::uuid
  ) and university_id=target_university and campus_id=target_campus and verified_at is null;
  if found_count<>3 then raise exception 'UNIBEN_REFERENCE_POI_COUNT expected 3 got %',found_count; end if;

  update public.institution_campuses
  set map_revision=map_revision+1,updated_at=now()
  where id=target_campus and institution_id=target_university;
end
$reference_pois$;

commit;
