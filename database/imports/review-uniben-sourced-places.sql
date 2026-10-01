-- Apply after import_sourced_campus_map in the coordinated release transaction.
-- This is source review, not a claim of an on-site entrance survey.
DO $review$
declare
 institution constant uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
 reviewer constant uuid := 'd34f89d0-aa39-4a92-b52f-a16af84a0b1f';
 source_ids constant text[] := array['way/44931729','way/44526667','way/1118087989','way/1393499503','way/44466622','way/1118089976','way/1118090053','way/1118090167','way/1118089920','way/1118088238','way/1118082385','way/1118082152','way/1118090101','way/84229659','way/44466612','way/1118088085'];
 before_directory text; after_directory text; candidate record; checked integer := 0;
begin
 select md5(string_agg((to_jsonb(p)-array['geom','latitude','longitude','source_provider','source_feature_id','source_url','verified_at','confidence','updated_at'])::text,'|' order by p.id)) into before_directory from public.campus_places p where p.university_id=institution;
 perform set_config('app.map_actor',reviewer::text,true);
 for candidate in
  select c.*,p.name directory_name,p.search_aliases,p.source_feature_id existing_source
  from app_private.map_candidates c join public.campus_places p on p.id=c.matched_place_id and p.campus_id=c.campus_id and p.university_id=c.institution_id
  join public.institution_campuses cp on cp.id=c.campus_id and cp.slug='ugbowo'
  where c.institution_id=institution and c.source_provider='OSM' and c.feature_kind='PLACE' and c.source_feature_id=any(source_ids)
 loop
  if not exists(select 1 from unnest(candidate.search_aliases||array[candidate.directory_name]) label where regexp_replace(lower(label),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g')) then raise exception 'MAP_RELEASE_NAME_MISMATCH';end if;
  if public.GeometryType(public.ST_GeomFromGeoJSON(candidate.geometry::text))<>'POLYGON' then raise exception 'MAP_RELEASE_EXPECTED_FOOTPRINT';end if;
  if candidate.status='PENDING' then
   perform app_private.review_map_candidate(candidate.id,reviewer,'MERGE',candidate.matched_place_id,null,'Reviewed against the preserved directory name or alias and OpenStreetMap source footprint on 2026-10-01. ODbL attribution retained. This corrects building geometry; entrance survey remains separate.');
  elsif candidate.status<>'MERGED' or candidate.existing_source is distinct from candidate.source_feature_id then raise exception 'MAP_RELEASE_REVIEW_CONFLICT';end if;
  checked=checked+1;
 end loop;
 if checked<>cardinality(source_ids) then raise exception 'MAP_RELEASE_MATCH_COUNT: %',checked;end if;
 select md5(string_agg((to_jsonb(p)-array['geom','latitude','longitude','source_provider','source_feature_id','source_url','verified_at','confidence','updated_at'])::text,'|' order by p.id)) into after_directory from public.campus_places p where p.university_id=institution;
 if before_directory is distinct from after_directory then raise exception 'MAP_RELEASE_DIRECTORY_CHANGED';end if;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata)
 select reviewer,institution,'maps.release-directory.reviewed','map_source','uniben-osm-2026-10-01','succeeded',jsonb_build_object('sourceFeatureIds',source_ids,'matches',checked,'directoryPreserved',true,'entranceSurvey',false)
 where not exists(select 1 from app_private.audit_events where action='maps.release-directory.reviewed' and target_id='uniben-osm-2026-10-01');
end $review$;
