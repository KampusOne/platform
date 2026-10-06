begin;
alter table app_private.media_upload_sessions drop constraint media_upload_sessions_upload_kind_check;
alter table app_private.media_upload_sessions add constraint media_upload_sessions_upload_kind_check check(upload_kind in('message','resource','tutorial','post'));
alter table app_private.media_upload_sessions add column transport text not null default 'proxy' check(transport in('proxy','direct'));
create or replace function app_private.reserve_private_upload(p_id uuid,p_user uuid,p_uni uuid,p_key text,p_multipart text,p_name text,p_type text,p_size bigint,p_kind text)
returns app_private.media_upload_sessions language plpgsql set search_path='' as $$
declare saved app_private.media_upload_sessions; used bigint;
begin
 if p_kind not in('message','resource','tutorial','post') or p_size is null or p_size<1 or p_size>(case when p_kind='resource' then 104857600 when p_kind='post' then 52428800 else 524288000 end) then raise exception 'UPLOAD_SIZE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('message-upload:'||p_user::text,0));
 select * into saved from app_private.media_upload_sessions where id=p_id;
 if found then
  if saved.owner_user_id<>p_user or saved.institution_id is distinct from p_uni or saved.upload_kind<>p_kind or saved.original_name<>p_name or saved.declared_type<>p_type or saved.expected_bytes<>p_size or (saved.expires_at<=now() and saved.status<>'COMPLETE') then raise exception 'UPLOAD_SESSION_CONFLICT';end if;
  return saved;
 end if;
 select coalesce(sum(expected_bytes),0) into used from app_private.media_upload_sessions where owner_user_id=p_user and created_at>now()-interval '24 hours' and status<>'ABORTED';
 if used+p_size>2147483648 then raise exception 'UPLOAD_ALLOWANCE_EXHAUSTED';end if;
 insert into app_private.media_upload_sessions(id,owner_user_id,institution_id,object_key,multipart_id,original_name,declared_type,expected_bytes,upload_kind,transport)
 values(p_id,p_user,p_uni,p_key,p_multipart,p_name,p_type,p_size,p_kind,case when p_key like 'direct/%' or p_key like 'post-direct/direct/%' then 'direct' else 'proxy' end) returning * into saved;
 return saved;
end $$;
commit;
