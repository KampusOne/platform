begin;

-- Existing posts are not retroactively made public.
alter table public.feed_posts add column if not exists quoted_post_id uuid references public.feed_posts(id);
create index if not exists feed_quotes_idx on public.feed_posts(quoted_post_id) where quoted_post_id is not null and status in ('PUBLISHED', 'CORRECTED');
create unique index if not exists feed_post_institution_idx on public.feed_posts(id, university_id);
create index if not exists feed_public_timeline_idx on public.feed_posts(published_at desc, id desc) where audience->>'visibility' = 'PUBLIC' and status in ('PUBLISHED', 'CORRECTED');

create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  institution_id uuid not null references public.universities(id),
  author_user_id uuid not null references public.users(id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key(post_id, institution_id) references public.feed_posts(id, university_id),
  unique(author_user_id, client_request_id)
);
create index if not exists feed_comments_thread_idx on public.feed_comments(post_id, created_at, id) where deleted_at is null;

create table if not exists public.feed_reposts (
  post_id uuid not null,
  institution_id uuid not null references public.universities(id),
  user_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  primary key(post_id, user_id),
  foreign key(post_id, institution_id) references public.feed_posts(id, university_id)
);
create index if not exists feed_reposts_activity_idx on public.feed_reposts(post_id, created_at desc, user_id);
create index if not exists feed_reposts_owner_idx on public.feed_reposts(user_id, post_id);

-- Only the existing authenticated Worker may access these tables.
alter table public.feed_comments enable row level security;
alter table public.feed_reposts enable row level security;
revoke all on public.feed_comments, public.feed_reposts from public;
commit;
