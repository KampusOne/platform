-- Owner-requested correction from 78 campus reference frames and retained open geometry.
-- One atomic, replay-safe correction; guard each old point against concurrent review.
begin;
do $review$
declare
 uni uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
 campus uuid := '1d60dcae-760d-4de7-8443-6a870d9bbe1a';
 patches jsonb := $patches$[{"id":"c3928d61-f327-557e-a243-b5c3ae7bec19","name":"Faculty of Environmental Sciences","category":"ACADEMIC","latitude":6.402033,"longitude":5.619308,"before":{"latitude":6.4028,"longitude":5.62065},"confidence":0.7,"sourceFeatureId":"14e74369-c08e-4d5f-a7dc-9afc06756518","sourceFrames":["Map.zip:14","Map 2.zip:40"],"reason":"Distinctive western Education-field building matches the retained Overture footprint. The old pin was east of Uniben Road in the entrepreneurship cluster."},{"id":"60cfd3e2-6db6-581a-9048-76b057103a11","name":"Faculty of Arts","category":"ACADEMIC","latitude":6.403876,"longitude":5.62122,"before":{"latitude":6.4033,"longitude":5.62217},"confidence":0.7,"sourceFeatureId":"bb430539-d552-4920-a402-b0c408a04d74","sourceFrames":["Map.zip:2","Map.zip:15"],"reason":"Retained Overture named Arts point corroborates the complex northeast of the road junction, across Uniben Road from the research field."},{"id":"c8a0887f-0b17-5856-b1aa-e3d1aefffcdb","name":"GST building","category":"ACADEMIC","description":"General Studies building in the research and Education-field area, west of Uniben Road. Location identified from the supplied campus reference; confirm the final entrance on campus.","latitude":6.40387,"longitude":5.61961,"confidence":0.55,"before":null,"search_aliases":["GST","GST Building","General Studies","General Studies building"],"sourceFrames":["Map.zip:14","Map 2.zip:40","05-1000440965.jpg"],"reason":"Reported by the campus owner in the circled cluster west of Uniben Road, northwest of Book Shop and north of Environmental Sciences. Point represents the cluster; a particular entrance or room is not asserted."}]$patches$;
 patch jsonb; affected integer; before_protected jsonb; after_protected jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('release-map:'||campus::text,0));
 if not exists(select 1 from public.institution_campuses where id=campus and institution_id=uni and slug='ugbowo') then raise exception 'MAP_REVIEW_CAMPUS_SCOPE';end if;
 if (select count(*) from public.campus_places c join jsonb_array_elements(patches) p on c.id=(p->>'id')::uuid where c.campus_id=campus and c.university_id=uni and c.source_feature_id='map-review-2026-10-13/'||c.id::text and c.latitude=(p->>'latitude')::numeric and c.longitude=(p->>'longitude')::numeric)=3 then return;end if;
 select jsonb_build_object(
  'otherPlaces',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_places c where not exists(select 1 from jsonb_array_elements(patches) p where (p->>'id')::uuid=c.id)),
  'paths',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_paths c),
  'entrances',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_entrances c),
  'features',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_map_features c)
 ) into before_protected;
 for patch in select value from jsonb_array_elements(patches) loop
  if patch->'before'<>'null'::jsonb then
   update public.campus_places set latitude=(patch->>'latitude')::numeric,longitude=(patch->>'longitude')::numeric,
     geom=public.ST_SetSRID(public.ST_MakePoint((patch->>'longitude')::float8,(patch->>'latitude')::float8),4326),
     source_feature_id='map-review-2026-10-13/'||(patch->>'id'),source_url=null,confidence=(patch->>'confidence')::numeric,verified_at=null,updated_at=now()
   where id=(patch->>'id')::uuid and university_id=uni and campus_id=campus and name=patch->>'name' and source_provider='KAMPUSONE'
     and latitude=(patch->'before'->>'latitude')::numeric and longitude=(patch->'before'->>'longitude')::numeric;
   get diagnostics affected=row_count;
   if affected<>1 then raise exception 'MAP_REVIEW_POINT_CHANGED %',patch->>'name';end if;
  else
   insert into public.campus_places(id,university_id,campus_id,name,category,description,status,latitude,longitude,geom,search_aliases,source_provider,source_feature_id,confidence,verified_at)
   values((patch->>'id')::uuid,uni,campus,patch->>'name',patch->>'category',patch->>'description','PUBLISHED',(patch->>'latitude')::numeric,(patch->>'longitude')::numeric,
    public.ST_SetSRID(public.ST_MakePoint((patch->>'longitude')::float8,(patch->>'latitude')::float8),4326),array(select jsonb_array_elements_text(patch->'search_aliases')),'KAMPUSONE','map-review-2026-10-13/'||(patch->>'id'),(patch->>'confidence')::numeric,null);
  end if;
 end loop;
 select jsonb_build_object(
  'otherPlaces',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_places c where not exists(select 1 from jsonb_array_elements(patches) p where (p->>'id')::uuid=c.id)),
  'paths',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_paths c),
  'entrances',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_entrances c),
  'features',(select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.campus_map_features c)
 ) into after_protected;
 if before_protected is distinct from after_protected then raise exception 'MAP_REVIEW_PROTECTED_DATA_CHANGED';end if;
 if (select count(*) from public.campus_places c join jsonb_array_elements(patches) p on c.id=(p->>'id')::uuid where c.campus_id=campus and c.university_id=uni and c.latitude=(p->>'latitude')::numeric and c.longitude=(p->>'longitude')::numeric and c.verified_at is null and public.ST_X(c.geom)=c.longitude and public.ST_Y(c.geom)=c.latitude)<>3 then raise exception 'MAP_REVIEW_RESULT_INVALID';end if;
end
$review$;
commit;
