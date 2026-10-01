begin;
create or replace function app_private.review_map_capture(p_id uuid,p_actor uuid,p_approve boolean,p_note text)
returns uuid language plpgsql set search_path='' as $$
declare submission app_private.map_capture_submissions%rowtype; mission app_private.map_capture_missions%rowtype;
begin
 select * into submission from app_private.map_capture_submissions where id=p_id for update;
 if not found then raise exception 'MAP_CAPTURE_NOT_FOUND';end if;
 if submission.status<>'PENDING' then raise exception 'MAP_ALREADY_REVIEWED';end if;
 select * into mission from app_private.map_capture_missions where id=submission.mission_id for update;
 if mission.institution_id<>submission.institution_id then raise exception 'MAP_PLACE_SCOPE';end if;
 if p_approve and mission.status<>'OPEN' then raise exception 'MAP_MISSION_CLOSED';end if;
 if length(trim(p_note))<3 then raise exception 'MAP_NOTE_REQUIRED';end if;
 if p_approve then
  if mission.place_id is null then raise exception 'MAP_ENTRANCE_PLACE_REQUIRED';end if;
  if mission.kind='PHOTO' then
   insert into public.campus_place_media(institution_id,campus_id,place_id,url,media_id,source_provider,attribution,captured_at,verified_at,moderation_state)
   values(mission.institution_id,mission.campus_id,mission.place_id,'private:media',submission.media_id,'AGENT_CAPTURE','Photo: KampusOne campus agent',submission.captured_at,now(),'APPROVED');
  elsif mission.kind='ENTRANCE' then
   insert into public.campus_entrances(institution_id,campus_id,place_id,geom,label,preferred,verified_at,source_feature_id)
   values(mission.institution_id,mission.campus_id,mission.place_id,public.ST_SetSRID(public.ST_MakePoint(submission.longitude,submission.latitude),4326),mission.title,true,now(),'capture/'||submission.id);
  else
   -- Accessibility and path observations remain documented survey evidence.
   -- They do not silently overwrite the routing network.
   perform 1;
  end if;
  update app_private.map_capture_missions set status='COMPLETE',completed_at=now() where id=mission.id;
  update public.institution_campuses set map_revision=map_revision+1 where id=mission.campus_id;
 end if;
 update app_private.map_capture_submissions set status=case when p_approve then 'APPROVED' else 'REJECTED' end,reviewer_user_id=p_actor,reviewed_at=now(),decision_note=p_note where id=p_id;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata)
 values(p_actor,mission.institution_id,'maps.capture.reviewed','map_capture',p_id::text,'succeeded',jsonb_build_object('approved',p_approve,'note',p_note,'missionId',mission.id));
 return mission.campus_id;
end $$;
revoke all on function app_private.review_map_capture(uuid,uuid,boolean,text) from public;
commit;
