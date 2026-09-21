-- Public student-feed interactions. Private campus/academic records are unchanged.
-- Apply before deploying the matching Worker and mobile web bundle.
begin;

alter table public.feed_posts
  add column if not exists quoted_post_id uuid references public.feed_posts(id) on delete set null;

-- Student quotes can be short (including a single emoji); editorial minimums remain.
alter table public.feed_posts drop constraint if exists feed_posts_title_check;
alter table public.feed_posts add constraint feed_posts_title_check check (
  char_length(title) between (case when audience->>'studentPost' = 'true' then 1 else 4 end) and 180
);
alter table public.feed_posts drop constraint if exists feed_posts_summary_check;
alter table public.feed_posts add constraint feed_posts_summary_check check (
  char_length(summary) between (case when audience->>'studentPost' = 'true' then 1 else 4 end) and 500
);

create index if not exists feed_posts_quote_lookup_idx
  on public.feed_posts (quoted_post_id, published_at desc)
  where quoted_post_id is not null and status in ('PUBLISHED', 'CORRECTED');

create index if not exists feed_posts_public_students_idx
  on public.feed_posts (published_at desc, id desc)
  where audience->>'studentPost' = 'true' and status in ('PUBLISHED', 'CORRECTED');

create table if not exists public.feed_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  institution_id uuid not null references public.universities(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  client_request_id uuid not null,
  body text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint feed_post_comments_body_check check (
    (deleted_at is null and body is not null and char_length(btrim(body)) between 1 and 2000)
    or (deleted_at is not null and body is null)
  ),
  constraint feed_post_comments_request_unique unique (author_user_id, client_request_id)
);

create index if not exists feed_post_comments_page_idx
  on public.feed_post_comments (post_id, created_at desc, id desc)
  where deleted_at is null;
create index if not exists feed_post_comments_author_idx
  on public.feed_post_comments (author_user_id);
create index if not exists feed_post_comments_institution_idx
  on public.feed_post_comments (institution_id);

create table if not exists public.feed_post_reposts (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  institution_id uuid not null references public.universities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists feed_post_reposts_activity_idx
  on public.feed_post_reposts (post_id, created_at desc, user_id);
create index if not exists feed_post_reposts_user_idx
  on public.feed_post_reposts (user_id, created_at desc);
create index if not exists feed_post_reposts_institution_idx
  on public.feed_post_reposts (institution_id);

-- The authenticated Worker is the only application access path. No public data API.
alter table public.feed_post_comments enable row level security;
alter table public.feed_post_reposts enable row level security;
revoke all on public.feed_post_comments, public.feed_post_reposts from public;

commit;
