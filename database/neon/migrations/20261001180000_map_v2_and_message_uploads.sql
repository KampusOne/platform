begin;
create extension if not exists postgis;
alter table public.institution_campuses add column if not exists boundary geometry(MultiPolygon,4326);
alter table public.institution_campuses add column if not exists boundary_verified_at timestamptz;
alter table public.institution_campuses add column if not exists map_revision integer not null default 1;
alter table public.campus_places add column if not exists geom geometry(Geometry,4326);
alter table public.campus_places add column if not exists source_provider text not null default 'KAMPUSONE';
alter table public.campus_places add column if not exists source_feature_id text;
alter table public.campus_places add column if not exists source_url text;
alter table public.campus_places add column if not exists confidence numeric(3,2) not null default 0.5 check(confidence between 0 and 1);
update public.campus_places set geom=ST_SetSRID(ST_MakePoint(longitude,latitude),4326),confidence=case when verified_at is not null then 1 else .5 end where geom is null and latitude is not null and longitude is not null;
create index if not exists campus_places_geometry on public.campus_places using gist(geom);
create index if not exists institution_campuses_boundary on public.institution_campuses using gist(boundary);
create table if not exists app_private.map_imports(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.universities(id),campus_id uuid not null,
 actor_user_id uuid not null references public.users(id),source_provider text not null default 'OSM',status text not null default 'RUNNING' check(status in('RUNNING','REVIEW','FAILED','COMPLETE')),
 request_key text not null,source_url text,diagnostics jsonb not null default '{}',created_at timestamptz not null default now(),completed_at timestamptz,
 unique(campus_id,request_key),foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id)
);
create table if not exists app_private.map_candidates(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null,campus_id uuid not null,import_id uuid not null references app_private.map_imports(id),
 source_provider text not null,source_feature_id text not null,feature_kind text not null check(feature_kind in('PLACE','PATH','BOUNDARY','ENTRANCE')),
 name text,geometry jsonb not null,tags jsonb not null default '{}',matched_place_id uuid,status text not null default 'PENDING' check(status in('PENDING','APPROVED','MERGED','REJECTED')),
 decision_note text,reviewer_user_id uuid references public.users(id),reviewed_at timestamptz,created_at timestamptz not null default now(),
 unique(campus_id,source_provider,source_feature_id,feature_kind),foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id),
 foreign key(matched_place_id,institution_id) references public.campus_places(id,university_id)
);
create table if not exists public.campus_map_features(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null,campus_id uuid not null,source_provider text not null,source_feature_id text not null,
 kind text not null,geom geometry(Geometry,4326) not null,tags jsonb not null default '{}',verified_at timestamptz not null default now(),
 unique(campus_id,source_provider,source_feature_id),foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id)
);
create index if not exists campus_map_features_geometry on public.campus_map_features using gist(geom);
create table if not exists public.campus_paths(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null,campus_id uuid not null,source_feature_id text not null,
 node_ids text[] not null,geom geometry(LineString,4326) not null,name text,access text not null default 'yes',surface text,steps boolean not null default false,
 wheelchair text,closed boolean not null default false,verified_at timestamptz not null default now(),
 unique(campus_id,source_feature_id),foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id)
);
create index if not exists campus_paths_geometry on public.campus_paths using gist(geom);
create table if not exists public.campus_entrances(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null,campus_id uuid not null,place_id uuid,geom geometry(Point,4326) not null,
 label text not null default 'Entrance',wheelchair text,preferred boolean not null default false,verified_at timestamptz,
 foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id),foreign key(place_id,institution_id) references public.campus_places(id,university_id)
);
create table if not exists public.campus_place_media(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null,campus_id uuid not null,place_id uuid not null,url text not null,
 source_provider text not null,source_url text,attribution text not null,captured_at timestamptz,verified_at timestamptz,
 moderation_state text not null default 'PENDING' check(moderation_state in('PENDING','APPROVED','REJECTED')),
 foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id),foreign key(place_id,institution_id) references public.campus_places(id,university_id)
);
create table if not exists app_private.map_capture_missions(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null,campus_id uuid not null,place_id uuid,title text not null,kind text not null,
 assigned_user_id uuid references public.users(id),status text not null default 'OPEN',created_by uuid not null references public.users(id),created_at timestamptz not null default now(),
 foreign key(campus_id,institution_id) references public.institution_campuses(id,institution_id),foreign key(place_id,institution_id) references public.campus_places(id,university_id)
);
create table if not exists app_private.map_capture_submissions(
 id uuid primary key default gen_random_uuid(),mission_id uuid not null references app_private.map_capture_missions(id),institution_id uuid not null,
 user_id uuid not null references public.users(id),media_id uuid not null references public.media_objects(id),latitude numeric(9,6),longitude numeric(9,6),accuracy_metres numeric,heading numeric,
 captured_at timestamptz not null,notes text not null default '',status text not null default 'PENDING',created_at timestamptz not null default now()
);
create table if not exists app_private.media_upload_sessions(
 id uuid primary key,owner_user_id uuid not null references public.users(id),institution_id uuid references public.universities(id),object_key text not null,
 multipart_id text not null,original_name text not null,declared_type text not null,content_type text,expected_bytes bigint not null check(expected_bytes between 1 and 524288000),
 parts jsonb not null default '{}',status text not null default 'OPEN' check(status in('OPEN','COMPLETING','COMPLETE','ABORTED')),
 media_id uuid references public.media_objects(id),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours'
);
create table if not exists app_private.direct_thread_activity(
 id uuid primary key default gen_random_uuid(),thread_id uuid not null references public.direct_threads(id),actor_user_id uuid not null references public.users(id),
 message_id uuid not null references public.direct_messages(id),kind text not null check(kind in('REACTION','PIN','UNPIN')),summary text not null,created_at timestamptz not null default now()
);
create index if not exists direct_thread_activity_latest on app_private.direct_thread_activity(thread_id,created_at desc);
alter table app_private.map_imports enable row level security;
alter table app_private.map_candidates enable row level security;
alter table public.campus_map_features enable row level security;
alter table public.campus_paths enable row level security;
alter table public.campus_entrances enable row level security;
alter table public.campus_place_media enable row level security;
alter table app_private.map_capture_missions enable row level security;
alter table app_private.map_capture_submissions enable row level security;
alter table app_private.media_upload_sessions enable row level security;
alter table app_private.direct_thread_activity enable row level security;
-- Ekehuan centre is a sourced orientation point, not a surveyed boundary or building coordinate.
update public.institution_campuses set latitude=6.3337,longitude=5.60015,source_url='https://www.wikidata.org/wiki/Wikidata:WikiProject_Africa/African_universities',status='PUBLISHED' where institution_id='6a79211e-6e85-4d95-be24-976edb26ba58' and slug='ekehuan';
insert into public.campus_places(university_id,campus_id,name,category,description,status,search_aliases,source_url)
select c.institution_id,c.id,v.name,'ACADEMIC',v.description,'PUBLISHED',v.aliases,v.source_url from public.institution_campuses c cross join(values
 ('Institute of Education','Teacher education programmes and services on Ekehuan campus. Building position and entrance are awaiting field verification.',array['IOE','Institute of Education Ekehuan'],'https://ioe.uniben.edu/'),
 ('Department of Theatre Arts','Theatre Arts, Ekehuan campus. Building position and entrance are awaiting field verification.',array['Theatre','Drama','Theatre Arts Ekehuan'],'https://repository.uniben.edu/taxonomy/term/23170'),
 ('Department of Mass Communication','Mass Communication, Ekehuan campus. Building position and entrance are awaiting field verification.',array['Mass Comm','Mass Communication Ekehuan'],'https://repository.uniben.edu/taxonomy/term/23170'),
 ('Department of Fine and Applied Arts','Fine and Applied Arts, Ekehuan campus. Building position and entrance are awaiting field verification.',array['Fine Arts','FAA','Fine and Applied Art'],'https://repository.uniben.edu/department-fine-and-applied-arts?page=1')
)v(name,description,aliases,source_url) where c.institution_id='6a79211e-6e85-4d95-be24-976edb26ba58' and c.slug='ekehuan' on conflict do nothing;
commit;
