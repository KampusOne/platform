begin;
create or replace function app_private.reserve_message_upload(p_id uuid,p_user uuid,p_uni uuid,p_key text,p_multipart text,p_name text,p_type text,p_size bigint)
returns app_private.media_upload_sessions language plpgsql set search_path='' as $$
declare saved app_private.media_upload_sessions;used bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('message-upload:'||p_user::text,0));
 select * into saved from app_private.media_upload_sessions where id=p_id;
 if found then
  if saved.owner_user_id<>p_user or saved.institution_id is distinct from p_uni or saved.original_name<>p_name or saved.declared_type<>p_type or saved.expected_bytes<>p_size or saved.expires_at<=now() then raise exception 'UPLOAD_SESSION_CONFLICT';end if;
  return saved;
 end if;
 if p_size not between 1 and 524288000 then raise exception 'UPLOAD_SIZE_INVALID';end if;
 select coalesce(sum(expected_bytes),0) into used from app_private.media_upload_sessions where owner_user_id=p_user and created_at>now()-interval '24 hours' and status<>'ABORTED';
 if used+p_size>2147483648 then raise exception 'UPLOAD_ALLOWANCE_EXHAUSTED';end if;
 insert into app_private.media_upload_sessions(id,owner_user_id,institution_id,object_key,multipart_id,original_name,declared_type,expected_bytes)
 values(p_id,p_user,p_uni,p_key,p_multipart,p_name,p_type,p_size) returning * into saved;
 return saved;
end $$;
revoke all on function app_private.reserve_message_upload(uuid,uuid,uuid,text,text,text,text,bigint) from public;
commit;
