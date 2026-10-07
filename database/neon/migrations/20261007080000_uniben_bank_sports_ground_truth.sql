begin;

do $fix$
declare
  changed_count integer;
  target_university_id constant uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
  target_campus_id constant uuid := '1d60dcae-760d-4de7-8443-6a870d9bbe1a';
begin
  if not exists (
    select 1
    from public.institution_campuses
    where id = target_campus_id
      and institution_id = target_university_id
      and slug = 'ugbowo'
  ) then
    raise exception 'UNIBEN_UGBOWO_SCOPE_MISSING';
  end if;

  with corrections(id, name, latitude, longitude, confidence) as (
    values
      ('65f3124d-3690-50a6-a01e-1a7afe90eec5'::uuid, 'UNIBEN Sports Complex', 6.399200::numeric, 5.612950::numeric, 0.45::numeric),
      ('265d648c-28db-54b4-8eb8-68ddc10a4aef'::uuid, 'Wema Bank - UNIBEN', 6.402505::numeric, 5.609694::numeric, 0.45::numeric),
      ('2ecc6e0e-ce20-5720-baea-d46173dd6a35'::uuid, 'Zenith Bank - UNIBEN', 6.402417::numeric, 5.610280::numeric, 0.45::numeric),
      ('c503e423-4b99-5e36-bf3c-dec9ca03406a'::uuid, 'Guaranty Trust Bank - UNIBEN', 6.402486::numeric, 5.610110::numeric, 0.45::numeric),
      ('7fe547f4-1a71-53f0-b674-4c545b41d3c2'::uuid, 'Stanbic IBTC Bank - UNIBEN', 6.402311::numeric, 5.610390::numeric, 0.45::numeric),
      ('84973da3-033f-5192-9bc6-f76ff76d428c'::uuid, 'First Bank - UNIBEN', 6.402121::numeric, 5.610323::numeric, 0.45::numeric),
      ('ed6428c9-1102-5cd6-9631-db9ec91dbc2e'::uuid, 'Fidelity Bank - UNIBEN', 6.402208::numeric, 5.610560::numeric, 0.45::numeric)
  )
  update public.campus_places place
  set
    latitude = correction.latitude,
    longitude = correction.longitude,
    geom = public.ST_SetSRID(public.ST_MakePoint(correction.longitude::float8, correction.latitude::float8), 4326),
    verified_at = null,
    confidence = correction.confidence,
    updated_at = now()
  from corrections correction
  where place.id = correction.id
    and place.university_id = target_university_id
    and place.campus_id = target_campus_id
    and place.name = correction.name;

  get diagnostics changed_count = row_count;
  if changed_count <> 7 then
    raise exception 'UNIBEN_GROUND_TRUTH_CORRECTION_COUNT expected 7 got %', changed_count;
  end if;

  update public.institution_campuses
  set map_revision = map_revision + 1,
      updated_at = now()
  where id = target_campus_id
    and institution_id = target_university_id;
end
$fix$;

commit;
