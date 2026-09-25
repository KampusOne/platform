begin;
create table if not exists public.institution_campuses (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.universities(id),
 name text not null check(length(name) between 2 and 120), slug text not null,
 latitude numeric(9,6) check(latitude between -90 and 90), longitude numeric(9,6) check(longitude between -180 and 180),
 map_style text not null default 'KAMPUSONE' check(map_style in ('KAMPUSONE','SATELLITE')),
 source_url text, status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','ARCHIVED')),
 updated_at timestamptz not null default now(), unique(institution_id,slug), unique(id,institution_id)
);
alter table public.institution_campuses enable row level security;
alter table public.campus_places add column if not exists campus_id uuid;
alter table public.campus_places add column if not exists parent_place_id uuid;
alter table public.campus_places add column if not exists floor_label text;
alter table public.campus_places add column if not exists room_label text;
alter table public.campus_places add column if not exists search_aliases text[] not null default '{}';
create unique index if not exists campus_places_scoped_id on public.campus_places(id,university_id);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='campus_places_campus_scope') then
  alter table public.campus_places add constraint campus_places_campus_scope foreign key(campus_id,university_id) references public.institution_campuses(id,institution_id);
 end if;
 if not exists(select 1 from pg_constraint where conname='campus_places_parent_scope') then
  alter table public.campus_places add constraint campus_places_parent_scope foreign key(parent_place_id,university_id) references public.campus_places(id,university_id);
 end if;
end $$;
alter table public.campus_places drop constraint if exists campus_places_university_id_name_key;
create unique index if not exists campus_places_campus_name on public.campus_places(university_id,coalesce(campus_id,'00000000-0000-0000-0000-000000000000'::uuid),name);
create index if not exists campus_places_campus_search on public.campus_places(university_id,campus_id,status);
insert into public.institution_campuses(institution_id,name,slug,source_url)
select id,c.name,c.slug,'https://www.uniben.edu/' from public.universities u cross join(values('Ugbowo campus','ugbowo'),('Ekehuan campus','ekehuan')) as c(name,slug)
where lower(u.name)='university of benin' and deleted_at is null on conflict(institution_id,slug) do nothing;
commit;
