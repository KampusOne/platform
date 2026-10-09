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
    id,university_id,campus_id,name,category,description,latitude,longitude,
    search_aliases,status,verified_at,updated_at
  ) values
    (
      'da274dde-3a1e-5fe4-ad0d-ff9b30c66439',target_university,target_campus,
      'Promise Land Restaurant','FOOD','Restaurant landmark in the UNIBEN bank/farm axis.',
      6.403188,5.610078,array['Promise_land Restaurant','Promise land Restaurant','Promise Land UNIBEN'],
      'PUBLISHED',null,now()
    ),
    (
      'cf0a2dea-8b98-5113-806a-8a188c816cdf',target_university,target_campus,
      'UNIBEN Farm Project','ACADEMIC','University farm project landmark on Ugbowo Campus.',
      6.403063,5.610922,array['Uniben Farm Project','UNIBEN Farm project','Farm Project'],
      'PUBLISHED',null,now()
    ),
    (
      '9dd57650-a5cc-5774-b7cc-a8d985bba7a6',target_university,target_campus,
      'Shopping Complex UNIBEN','SERVICE','Campus shopping complex behind the Fidelity Bank area.',
      6.402388,5.610422,array['UNIBEN Shopping Complex','Uniben shopping complex','Shopping Complex'],
      'PUBLISHED',null,now()
    )
  on conflict(id) do update set
    name=excluded.name,category=excluded.category,description=excluded.description,
    latitude=excluded.latitude,longitude=excluded.longitude,
    search_aliases=excluded.search_aliases,status=excluded.status,
    verified_at=null,updated_at=now()
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

  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='campus_places' and column_name='source_provider'
  ) then
    execute $metadata$
      update public.campus_places p set
        source_provider='REFERENCE',
        source_feature_id=v.source_feature_id,
        source_url=v.source_url,
        confidence=.70
      from (values
        ('da274dde-3a1e-5fe4-ad0d-ff9b30c66439'::uuid,'pluscode:CJ36+72G','https://biashara.cybo.com/NG-posta/300271_benin-city/mikahawa'),
        ('cf0a2dea-8b98-5113-806a-8a188c816cdf'::uuid,'pluscode:CJ36+69F','https://www.cybo.com/NG/benin-city/tractors-and-farm-equipment/'),
        ('9dd57650-a5cc-5774-b7cc-a8d985bba7a6'::uuid,'pluscode:CJ26+X53','https://ng.worldorgs.com/catalog/benin-city/shopping-mall/shoppingcomplexuniben')
      ) as v(id,source_feature_id,source_url)
      where p.id=v.id
    $metadata$;
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='campus_places' and column_name='geom'
  ) then
    execute $geometry$
      update public.campus_places
      set geom=public.ST_SetSRID(public.ST_MakePoint(longitude::float8,latitude::float8),4326)
      where id in (
        'da274dde-3a1e-5fe4-ad0d-ff9b30c66439'::uuid,
        'cf0a2dea-8b98-5113-806a-8a188c816cdf'::uuid,
        '9dd57650-a5cc-5774-b7cc-a8d985bba7a6'::uuid
      )
    $geometry$;
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='institution_campuses' and column_name='map_revision'
  ) then
    execute 'update public.institution_campuses set map_revision=map_revision+1,updated_at=now() where id=$1 and institution_id=$2'
      using target_campus,target_university;
  else
    update public.institution_campuses
    set updated_at=now()
    where id=target_campus and institution_id=target_university;
  end if;
end
$reference_pois$;

commit;
