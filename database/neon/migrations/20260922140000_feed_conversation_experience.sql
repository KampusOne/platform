begin;

-- NULL preserves existing badge eligibility. TRUE/FALSE is an explicit admin decision.
-- Never alter verification_status, KYC records, enrollment approval or operator roles.
alter table public.profiles add column if not exists public_badge_verified boolean;

-- Existing replies remain untouched. A reply may contain text, one image, or both.
alter table public.feed_comments add column if not exists media_object_id uuid references public.media_objects(id);
alter table public.feed_comments drop constraint if exists feed_comments_body_check;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.feed_comments'::regclass and conname='feed_comments_content_check') then
    alter table public.feed_comments add constraint feed_comments_content_check
      check (char_length(btrim(body)) <= 2000 and (char_length(btrim(body)) >= 1 or media_object_id is not null));
  end if;
end $$;

-- One authenticated account per post, not IP/device tracking. No invented historical views.
create table if not exists public.feed_post_views (
  post_id uuid not null,
  institution_id uuid not null references public.universities(id),
  user_id uuid not null references public.users(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  primary key(post_id,user_id),
  foreign key(post_id,institution_id) references public.feed_posts(id,university_id) on delete cascade
);
alter table public.feed_post_views enable row level security;
revoke all on public.feed_post_views from public;
create index if not exists feed_post_views_user_idx on public.feed_post_views(user_id);
commit;
