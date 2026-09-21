begin;

-- Additive only: do not change posts, comments, reposts or existing users.
create unique index if not exists feed_posts_like_scope_idx
  on public.feed_posts(id, university_id);
create table if not exists public.feed_likes (
  post_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  institution_id uuid not null references public.universities(id),
  created_at timestamptz not null default now(),
  primary key(post_id, user_id),
  foreign key(post_id, institution_id)
    references public.feed_posts(id, university_id) on delete cascade
);
create index if not exists feed_likes_user_idx on public.feed_likes(user_id, post_id);

-- VOLATILE obtains fresh snapshots after a competing request releases the lock.
-- Count from real rows instead of maintaining a drifting increment-only counter.
create or replace function app_private.set_feed_post_like(
  target_post uuid, actor uuid, campus uuid, desired boolean
) returns table(id uuid, liked boolean, like_count integer)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if target_post is null or actor is null or campus is null or desired is null then
    return;
  end if;
  perform 1 from public.feed_posts posts
    where posts.id = target_post and posts.university_id = campus
      and posts.status in ('PUBLISHED', 'CORRECTED') and posts.published_at <= now()
    for update;
  if not found then return; end if;

  if desired then
    insert into public.feed_likes(post_id, user_id, institution_id)
      values(target_post, actor, campus)
      on conflict(post_id, user_id) do nothing;
  else
    delete from public.feed_likes likes
      where likes.post_id = target_post and likes.user_id = actor
        and likes.institution_id = campus;
  end if;

  return query select target_post,
    exists(select 1 from public.feed_likes mine where mine.post_id = target_post and mine.user_id = actor),
    (select count(*)::integer from public.feed_likes likes where likes.post_id = target_post);
end;
$$;
revoke all on public.feed_likes from public;
revoke all on function app_private.set_feed_post_like(uuid, uuid, uuid, boolean) from public;

commit;
