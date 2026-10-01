begin;
alter table public.publishing_posts add column if not exists anonymous_poll boolean not null default false;
create or replace function app_private.create_publishing_post_with_privacy(
 actor uuid,school uuid,request uuid,payload_hash text,post_format text,post_body text,options jsonb,close_time timestamptz,anonymous boolean
) returns table(outcome text,id uuid) language plpgsql set search_path='' as $$
declare saved record;
begin
 if anonymous and post_format<>'POLL' then raise exception 'ANONYMOUS_POLL_FORMAT';end if;
 select * into saved from app_private.create_publishing_post(actor,school,request,payload_hash,post_format,post_body,options,close_time);
 if saved.outcome='CREATED' then
  update public.publishing_posts set anonymous_poll=anonymous where post_id=saved.id and institution_id=school;
 end if;
 return query select saved.outcome::text,saved.id::uuid;
end $$;
revoke all on function app_private.create_publishing_post_with_privacy(uuid,uuid,uuid,text,text,text,jsonb,timestamptz,boolean) from public;
commit;
