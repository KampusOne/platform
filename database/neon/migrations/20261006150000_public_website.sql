begin;
create table app_private.website_settings(singleton boolean primary key default true check(singleton),waitlist_enabled boolean not null default true,ios_url text not null default '',play_store_url text not null default '',updated_by uuid references public.users(id),updated_at timestamptz not null default now());
insert into app_private.website_settings(singleton)values(true);
create table app_private.website_waitlist(id uuid primary key default gen_random_uuid(),email text not null unique,full_name text not null,university_name text not null default '',platform text not null check(platform in('ANDROID','IOS','BOTH')),contact_consent_at timestamptz not null default now(),created_at timestamptz not null default now());
create table public.website_articles(id uuid primary key default gen_random_uuid(),slug text not null unique check(slug~'^[a-z0-9][a-z0-9-]{1,119}$'),title text not null check(length(title)between 3 and 180),excerpt text not null default '',body text not null check(length(body)between 10 and 80000),cover_url text not null default '',author_name text not null default 'KampusOne team',status text not null default 'DRAFT' check(status in('DRAFT','PUBLISHED','ARCHIVED')),is_demo boolean not null default false,revision integer not null default 1,created_by uuid references public.users(id),updated_by uuid references public.users(id),published_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index website_articles_published_idx on public.website_articles(published_at desc,id)where status='PUBLISHED';
create table app_private.website_article_likes(article_id uuid not null references public.website_articles(id)on delete cascade,user_id uuid not null references public.users(id)on delete cascade,created_at timestamptz not null default now(),primary key(article_id,user_id));
alter table app_private.website_settings enable row level security;
alter table app_private.website_waitlist enable row level security;
alter table public.website_articles enable row level security;
alter table app_private.website_article_likes enable row level security;
revoke all on app_private.website_settings,app_private.website_waitlist,public.website_articles,app_private.website_article_likes from public;
insert into public.website_articles(slug,title,excerpt,body,status,is_demo,published_at)values('campus-life-should-feel-connected','Campus life should feel connected','Why the everyday student experience needs one calm layer between information, people and places.','A campus is already a network. Students move between classes, people, updates, services and decisions all day. The problem is that the digital experience rarely reflects that reality.

The cost of scattered information

A venue change can sit inside one group chat while a classmate checks another. An event poster can circulate without the location context a new student needs. A useful rider or tutor may be known by one department and invisible to the next.

None of these moments is dramatic on its own. Together, they create friction that students quietly absorb every day.

Connection should feel practical

For KampusOne, connection is not an endless social feed. It means helping the right campus information reach the right student with enough context to act on it.

That can look like a reminder that understands a timetable, a route attached to a venue, or a marketplace result that is actually available around your campus.

Designed around student rhythm

The product should remain useful on ordinary days, not only during registration or exam season. That is why the system is being shaped around small repeatable moments: checking what changed, finding where to go and planning what comes next.

One campus. One app. One clearer student experience.','PUBLISHED',true,now());
commit;
