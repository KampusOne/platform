begin;
alter table app_private.media_upload_sessions add column upload_kind text not null default 'message' check(upload_kind in('message','resource','tutorial'));
alter table public.media_objects drop constraint media_objects_size_bytes_check;
alter table public.media_objects add constraint media_objects_size_bytes_check check(size_bytes>=1 and size_bytes<=case
 when kind='message' then 524288000
 when kind='resource' and content_type in('video/mp4','video/webm') then 524288000
 when kind='resource' and content_type in('application/pdf','text/plain','audio/mpeg','audio/wav') then 104857600
 when kind='post' and content_type in('video/mp4','video/webm') then 52428800
 when kind='notification-sound' then 2097152 else 10485760 end);
create function app_private.reserve_private_upload(p_id uuid,p_user uuid,p_uni uuid,p_key text,p_multipart text,p_name text,p_type text,p_size bigint,p_kind text)
returns app_private.media_upload_sessions language plpgsql set search_path='' as $$
declare saved app_private.media_upload_sessions;used bigint;
begin
 if p_kind not in('message','resource','tutorial') or p_size is null or p_size<1 or p_size>(case when p_kind='resource' then 104857600 else 524288000 end) then raise exception 'UPLOAD_SIZE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('message-upload:'||p_user::text,0));
 select * into saved from app_private.media_upload_sessions where id=p_id;
 if found then
  if saved.owner_user_id<>p_user or saved.institution_id is distinct from p_uni or saved.upload_kind<>p_kind or saved.original_name<>p_name or saved.declared_type<>p_type or saved.expected_bytes<>p_size or (saved.expires_at<=now() and saved.status<>'COMPLETE') then raise exception 'UPLOAD_SESSION_CONFLICT';end if;
  return saved;
 end if;
 select coalesce(sum(expected_bytes),0) into used from app_private.media_upload_sessions where owner_user_id=p_user and created_at>now()-interval '24 hours' and status<>'ABORTED';
 if used+p_size>2147483648 then raise exception 'UPLOAD_ALLOWANCE_EXHAUSTED';end if;
 insert into app_private.media_upload_sessions(id,owner_user_id,institution_id,object_key,multipart_id,original_name,declared_type,expected_bytes,upload_kind)
 values(p_id,p_user,p_uni,p_key,p_multipart,p_name,p_type,p_size,p_kind) returning * into saved;
 return saved;
end $$;
revoke all on function app_private.reserve_private_upload(uuid,uuid,uuid,text,text,text,text,bigint,text) from public;
create or replace function app_private.reserve_message_upload(p_id uuid,p_user uuid,p_uni uuid,p_key text,p_multipart text,p_name text,p_type text,p_size bigint)
returns app_private.media_upload_sessions language sql set search_path='' as $$select app_private.reserve_private_upload(p_id,p_user,p_uni,p_key,p_multipart,p_name,p_type,p_size,'message')$$;
commit;
