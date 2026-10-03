begin;
create table public.student_groups(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.universities(id),
 owner_user_id uuid not null references public.users(id),kind text not null check(kind in('COMMUNITY','STUDY_GROUP')),
 name text not null check(length(name) between 3 and 100),description text not null default '' check(length(description)<=1000),
 keywords text[] not null default '{}',request_id uuid not null,created_at timestamptz not null default now(),
 unique(owner_user_id,request_id),unique(id,institution_id)
);
create index student_groups_search_idx on public.student_groups(institution_id,kind,created_at desc);
create table public.student_group_members(
 group_id uuid not null,institution_id uuid not null,user_id uuid not null references public.users(id) on delete cascade,
 role text not null default 'MEMBER' check(role in('ADMIN','MEMBER')),joined_at timestamptz not null default now(),
 primary key(group_id,user_id),foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create index student_group_members_user_idx on public.student_group_members(user_id,group_id);
create table public.student_group_posts(
 id uuid primary key default gen_random_uuid(),group_id uuid not null,institution_id uuid not null,
 author_user_id uuid not null references public.users(id),request_id uuid not null,
 title text not null check(length(title) between 1 and 140),body text not null check(length(body) between 1 and 5000),
 urgent boolean not null default false,venue text check(length(venue)<=180),poll_options jsonb not null default '[]' check(jsonb_typeof(poll_options)='array' and jsonb_array_length(poll_options)<=6),
 created_at timestamptz not null default now(),unique(author_user_id,request_id),unique(id,group_id),
 foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create index student_group_posts_feed_idx on public.student_group_posts(group_id,created_at desc,id);
create table public.student_group_comments(
 id uuid primary key default gen_random_uuid(),post_id uuid not null,group_id uuid not null,institution_id uuid not null,
 author_user_id uuid not null references public.users(id),body text not null check(length(body) between 1 and 2000),created_at timestamptz not null default now(),
 foreign key(post_id,group_id) references public.student_group_posts(id,group_id) on delete cascade,
 foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create table public.student_group_votes(
 post_id uuid not null,group_id uuid not null,institution_id uuid not null,user_id uuid not null references public.users(id),option_index smallint not null check(option_index between 0 and 5),
 primary key(post_id,user_id),foreign key(post_id,group_id) references public.student_group_posts(id,group_id) on delete cascade,
 foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create table public.student_group_study_sessions(
 id uuid primary key default gen_random_uuid(),group_id uuid not null,institution_id uuid not null,user_id uuid not null references public.users(id),
 request_id uuid not null,started_at timestamptz not null default now(),ended_at timestamptz,
 check(ended_at is null or ended_at>=started_at),unique(user_id,request_id),
 foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create unique index student_group_study_active_idx on public.student_group_study_sessions(user_id) where ended_at is null;
create index student_group_study_history_idx on public.student_group_study_sessions(group_id,started_at desc);
alter table public.student_groups enable row level security;
alter table public.student_group_members enable row level security;
alter table public.student_group_posts enable row level security;
alter table public.student_group_comments enable row level security;
alter table public.student_group_votes enable row level security;
alter table public.student_group_study_sessions enable row level security;
revoke all on public.student_groups,public.student_group_members,public.student_group_posts,public.student_group_comments,public.student_group_votes,public.student_group_study_sessions from public;
-- Existing and newly created class reminders use the requested 15 minute lead.
update public.timetable_entries set reminder_minutes=15 where status::text<>'ARCHIVED' and reminder_minutes<>15;
commit;
