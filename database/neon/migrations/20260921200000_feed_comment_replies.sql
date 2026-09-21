begin;
set local lock_timeout = '5s';

-- Additive: existing comments stay at the root and retain their IDs and likes.
alter table public.feed_comments add column if not exists parent_comment_id uuid;
create unique index if not exists feed_comments_parent_scope_idx on public.feed_comments(id, post_id, institution_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'feed_comments_parent_scope_fk' and conrelid = 'public.feed_comments'::regclass) then
    alter table public.feed_comments add constraint feed_comments_parent_scope_fk
      foreign key(parent_comment_id, post_id, institution_id)
      references public.feed_comments(id, post_id, institution_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feed_comments_not_own_parent' and conrelid = 'public.feed_comments'::regclass) then
    alter table public.feed_comments add constraint feed_comments_not_own_parent check(parent_comment_id is distinct from id);
  end if;
end $$;
-- Includes tombstones, which preserve access to other authors' descendants.
create index if not exists feed_comments_parent_page_idx on public.feed_comments(post_id, parent_comment_id, created_at, id);
commit;
