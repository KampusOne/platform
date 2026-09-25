begin;
-- IDs 79–86. A visible verification badge never grants a publishing capability.
create table if not exists app_private.publishing_capabilities (
 user_id uuid not null references public.users(id),institution_id uuid not null references public.universities(id),
 capability text not null check(capability in('POLL','QA','ANONYMOUS_QA')),
 granted_by uuid not null references public.users(id),reason text not null,granted_at timestamptz not null default now(),
 revoked_at timestamptz,primary key(user_id,institution_id,capability)
);
create table if not exists public.publishing_posts (
 post_id uuid primary key references public.feed_posts(id),institution_id uuid not null references public.universities(id),
 format text not null check(format in('POLL','QA','ANONYMOUS_QA')),closes_at timestamptz,
 request_hash text not null
);
create table if not exists public.poll_options (
 post_id uuid not null references public.publishing_posts(post_id),id smallint not null check(id between 1 and 6),
 label text not null check(char_length(label) between 1 and 100),primary key(post_id,id)
);
create table if not exists app_private.poll_votes (
 post_id uuid not null,user_id uuid not null references public.users(id),option_id smallint not null,
 created_at timestamptz not null default now(),primary key(post_id,user_id),
 foreign key(post_id,option_id) references public.poll_options(post_id,id)
);
create table if not exists public.publishing_answers (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.publishing_posts(post_id),
 institution_id uuid not null references public.universities(id),body text not null check(char_length(body) between 1 and 3000),
 status text not null default 'PRIVATE' check(status in('PRIVATE','PUBLISHED','DELETED')),
 publisher_reply text,publication_consent_at timestamptz not null,
 published_at timestamptz,deleted_at timestamptz,created_at timestamptz not null default now()
);
-- Linkage never appears in publisher inboxes or public API output for anonymous Q&A.
create table if not exists app_private.publishing_answer_owners (
 answer_id uuid primary key references public.publishing_answers(id),user_id uuid not null references public.users(id),
 request_id uuid not null,request_hash text not null,unique(user_id,request_id)
);
create index if not exists publishing_answers_post_idx on public.publishing_answers(post_id,status,created_at desc);
revoke all on app_private.publishing_capabilities,app_private.poll_votes,app_private.publishing_answer_owners from public;
revoke all on public.publishing_posts,public.poll_options,public.publishing_answers from public;
alter table public.publishing_posts enable row level security;
alter table public.poll_options enable row level security;
alter table public.publishing_answers enable row level security;

create or replace function app_private.create_publishing_post(
 actor uuid,school uuid,request_id uuid,content_hash text,post_format text,post_body text,option_labels jsonb,close_time timestamptz
) returns table(outcome text,id uuid) language plpgsql set search_path='' as $$
declare saved_post uuid; saved_hash text; source uuid; option_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text,921200));
 select p.id,x.request_hash into saved_post,saved_hash from public.feed_posts p
 left join public.publishing_posts x on x.post_id=p.id
 where p.author_user_id=actor and p.client_request_id=request_id;
 if saved_post is not null then
   outcome:=case when saved_hash=content_hash then 'EXISTING' else 'CONFLICT' end; id:=saved_post; return next; return;
 end if;
 if not exists(select 1 from app_private.publishing_capabilities where user_id=actor and institution_id=school and capability=post_format and revoked_at is null) then
   outcome:='FORBIDDEN';return next;return;
 end if;
 if close_time is not null and close_time<=now() then outcome:='CLOSED';return next;return;end if;
 if char_length(post_body) not between 1 and 5000 then raise exception 'Invalid post';end if;
 if post_format='POLL' then
   option_count:=jsonb_array_length(option_labels);
   if option_count not between 2 and 6 then raise exception 'Invalid poll';end if;
 elsif option_labels is not null then raise exception 'Unexpected poll options';end if;
 if not app_private.consume_request_rate_limit('PUBLISHING_POST',actor::text,10,3600,3600) then outcome:='LIMIT';return next;return;end if;
 insert into public.content_sources(university_id,name,owner_user_id) values(school,'student:'||actor::text,actor)
 on conflict(university_id,name) do update set owner_user_id=excluded.owner_user_id returning content_sources.id into source;
 insert into public.feed_posts(university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at,client_request_id)
 values(school,source,actor,'UPDATE',left(post_body,180),left(post_body,500),post_body,jsonb_build_object('studentPost',true,'format',post_format),'PUBLISHED',now(),request_id)
 returning feed_posts.id into saved_post;
 insert into public.publishing_posts(post_id,institution_id,format,closes_at,request_hash) values(saved_post,school,post_format,close_time,content_hash);
 if post_format='POLL' then
   insert into public.poll_options(post_id,id,label) select saved_post,n::smallint,label from jsonb_array_elements_text(option_labels) with ordinality as options(label,n);
 end if;
 outcome:='CREATED';id:=saved_post;return next;
end;
$$;

create or replace function app_private.submit_publishing_answer(
 actor uuid,school uuid,target_post uuid,request_id uuid,content_hash text,answer_body text
) returns table(outcome text,id uuid) language plpgsql set search_path='' as $$
declare saved_id uuid; saved_hash text; post_format text; close_time timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text,921201));
 select answer_id,request_hash into saved_id,saved_hash from app_private.publishing_answer_owners o where o.user_id=actor and o.request_id=submit_publishing_answer.request_id;
 if saved_id is not null then outcome:=case when saved_hash=content_hash then 'EXISTING' else 'CONFLICT' end;id:=saved_id;return next;return;end if;
 select x.format,x.closes_at into post_format,close_time from public.publishing_posts x join public.feed_posts p on p.id=x.post_id
 where p.id=target_post and p.university_id=school and x.institution_id=school and p.status in('PUBLISHED','CORRECTED') and p.published_at<=now();
 if post_format is null then outcome:='NOT_FOUND';return next;return;end if;
 if post_format='POLL' then outcome:='WRONG_FORMAT';return next;return;end if;
 if close_time is not null and close_time<=now() then outcome:='CLOSED';return next;return;end if;
 if not app_private.consume_request_rate_limit('PUBLISHING_ANSWER',actor::text,20,3600,3600) then outcome:='LIMIT';return next;return;end if;
 insert into public.publishing_answers(post_id,institution_id,body,publication_consent_at) values(target_post,school,answer_body,now()) returning publishing_answers.id into saved_id;
 insert into app_private.publishing_answer_owners(answer_id,user_id,request_id,request_hash) values(saved_id,actor,request_id,content_hash);
 outcome:='CREATED';id:=saved_id;return next;
end;
$$;
revoke all on function app_private.create_publishing_post(uuid,uuid,uuid,text,text,text,jsonb,timestamptz) from public;
revoke all on function app_private.submit_publishing_answer(uuid,uuid,uuid,uuid,text,text) from public;
commit;
