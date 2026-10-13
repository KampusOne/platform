-- Owner-reported field and office correction; preserve stable IDs and all other data.
begin;
do $review$
declare
 uni uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
 campus uuid := '1d60dcae-760d-4de7-8443-6a870d9bbe1a';
 patches jsonb := $patches$[{"id":"2be8a76a-ef9f-5a69-a3cc-3abbd5803bae","name":"Exams and Records","category":"SERVICE","description":"Examinations and records office area in the owner-marked building cluster.","latitude":6.398015,"longitude":5.61408,"before":{"name":"Exams and Records","category":"SERVICE","latitude":6.399,"longitude":5.6121},"confidence":0.55,"search_aliases":["Exams & Records","Examinations and Records","Records Office"],"reason":"Move the office from the football field to the building cluster marked in screenshots 03 and 04. The pin represents the area, not a surveyed entrance."},{"id":"2436a456-902d-57fb-8310-cf9b8f7d5946","name":"School Field (Football Field)","category":"SPORT","description":"School football field within the UNIBEN sports complex.","latitude":6.398387,"longitude":5.61207,"before":{"name":"Main Bowl","category":"SPORT","latitude":6.3992,"longitude":5.61295},"confidence":0.6,"search_aliases":["School Field","Football Field","UNIBEN Football Field","Main Bowl","UNIBEN Main Bowl","Main Stadium Bowl"],"reason":"Name and place the existing Main Bowl landmark inside the field identified by the owner, retaining old search aliases and the same ID."},{"id":"65f3124d-3690-50a6-a01e-1a7afe90eec5","name":"UNIBEN Sports Complex","category":"SPORT","description":"University sports complex at the school football field.","latitude":6.398037,"longitude":5.612018,"before":{"name":"UNIBEN Sports Complex","category":"SPORT","latitude":6.3992,"longitude":5.61295},"confidence":0.6,"search_aliases":["Sports Complex","School Sports Complex","Stadium"],"reason":"Move the sports-complex label away from the auditorium junction and into the owner-identified field."}]$patches$;
 patch jsonb; affected integer; before_protected jsonb; after_protected jsonb; old_revision bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('release-map:'||campus::text,0));
 select map_revision into old_revision from public.institution_campuses where id=campus and institution_id=uni and slug='ugbowo';
 if old_revision is null then raise exception 'MAP_REVIEW_CAMPUS_SCOPE';end if;
 if (select count(*) from public.campus_places c join jsonb_array_elements(patches) p on c.id=(p->>'id')::uuid where c.campus_id=campus and c.university_id=uni and c.source_feature_id='field-records-review-2026-10-13/'||c.id::text and c.name=p->>'name' and c.latitude=(p->>'latitude')::numeric and c.longitude=(p->>'longitude')::numeric and c.search_aliases=array(select jsonb_array_elements_text(p->'search_aliases')))=3 then return;end if;
 if exists(select 1 from public.campus_entrances e join jsonb_array_elements(patches) p on e.place_id=(p->>'id')::uuid) then raise exception 'MAP_REVIEW_ENTRANCES_REQUIRE_REVIEW';end if;
 select jsonb_build_object(
  'otherPlaces',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_places c where not exists(select 1 from jsonb_array_elements(patches) p where (p->>'id')::uuid=c.id)),
  'paths',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_paths c),
  'entrances',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_entrances c),
  'features',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_map_features c)
 ) into before_protected;
 for patch in select value from jsonb_array_elements(patches) loop
  update public.campus_places set name=patch->>'name',category=patch->>'category',description=patch->>'description',latitude=(patch->>'latitude')::numeric,longitude=(patch->>'longitude')::numeric,
   geom=public.ST_SetSRID(public.ST_MakePoint((patch->>'longitude')::float8,(patch->>'latitude')::float8),4326),search_aliases=array(select jsonb_array_elements_text(patch->'search_aliases')),
   source_feature_id='field-records-review-2026-10-13/'||(patch->>'id'),source_url=null,confidence=(patch->>'confidence')::numeric,verified_at=null,updated_at=now()
  where id=(patch->>'id')::uuid and university_id=uni and campus_id=campus and source_provider='KAMPUSONE' and status='PUBLISHED'
   and name=patch->'before'->>'name' and category=patch->'before'->>'category' and latitude=(patch->'before'->>'latitude')::numeric and longitude=(patch->'before'->>'longitude')::numeric;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'MAP_REVIEW_POINT_CHANGED %',patch->>'name';end if;
 end loop;
 select jsonb_build_object(
  'otherPlaces',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_places c where not exists(select 1 from jsonb_array_elements(patches) p where (p->>'id')::uuid=c.id)),
  'paths',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_paths c),
  'entrances',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_entrances c),
  'features',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_map_features c)
 ) into after_protected;
 if before_protected is distinct from after_protected then raise exception 'MAP_REVIEW_PROTECTED_DATA_CHANGED';end if;
 if (select count(*) from public.campus_places c join jsonb_array_elements(patches) p on c.id=(p->>'id')::uuid where c.campus_id=campus and c.university_id=uni and c.name=p->>'name' and c.latitude=(p->>'latitude')::numeric and c.longitude=(p->>'longitude')::numeric and c.verified_at is null and public.ST_X(c.geom)=c.longitude and public.ST_Y(c.geom)=c.latitude)<>3 then raise exception 'MAP_REVIEW_RESULT_INVALID';end if;
 if (select map_revision from public.institution_campuses where id=campus)<=old_revision then raise exception 'MAP_REVIEW_CACHE_NOT_INVALIDATED';end if;
end
$review$;
commit;
