begin;

-- Additive and repeatable; preserve existing comments and reactions.
create unique index if not exists feed_comments_like_scope_idx on public.feed_comments(id, institution_id);
create table if not exists public.feed_comment_likes (
  comment_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  institution_id uuid not null references public.universities(id),
  created_at timestamptz not null default now(),
  primary key(comment_id, user_id),
  foreign key(comment_id, institution_id) references public.feed_comments(id, institution_id) on delete cascade
);
create index if not exists feed_comment_likes_user_idx on public.feed_comment_likes(user_id, comment_id);

create or replace function app_private.set_feed_comment_like(
  target_comment uuid, actor uuid, campus uuid, desired boolean
) returns table(id uuid, liked boolean, like_count integer)
language plpgsql volatile security invoker set search_path = '' as $$
declare target_post uuid; post_campus uuid;
begin
  if target_comment is null or actor is null or campus is null or desired is null then return; end if;
  select comments.post_id into target_post from public.feed_comments comments
    where comments.id = target_comment and comments.deleted_at is null;
  if not found then return; end if;

  -- Parent before comment: different comments may receive likes concurrently,
  -- while post archival and comment deletion cannot race past authorization.
  select posts.university_id into post_campus from public.feed_posts posts
    where posts.id = target_post
      and (posts.university_id = campus or posts.audience->>'visibility' = 'PUBLIC')
      and posts.status in ('PUBLISHED', 'CORRECTED') and posts.published_at <= now()
    for share;
  if not found then return; end if;
  perform 1 from public.feed_comments comments
    where comments.id = target_comment and comments.post_id = target_post
      and comments.institution_id = post_campus and comments.deleted_at is null
    for update;
  if not found then return; end if;

  if desired then
    insert into public.feed_comment_likes(comment_id, user_id, institution_id)
      values(target_comment, actor, post_campus)
      on conflict(comment_id, user_id) do nothing;
  else
    delete from public.feed_comment_likes likes
      where likes.comment_id = target_comment and likes.user_id = actor
        and likes.institution_id = post_campus;
  end if;
  return query select target_comment,
    exists(select 1 from public.feed_comment_likes mine where mine.comment_id = target_comment and mine.user_id = actor),
    (select count(*)::integer from public.feed_comment_likes likes where likes.comment_id = target_comment);
end;
$$;
revoke all on public.feed_comment_likes from public;
revoke all on function app_private.set_feed_comment_like(uuid,uuid,uuid,boolean) from public;

commit;
