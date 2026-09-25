begin;
alter table public.courses add column if not exists award text;
alter table public.courses add column if not exists normal_duration_years numeric(3,1) check(normal_duration_years between 1 and 10);
alter table public.courses add column if not exists primary_source_url text;
alter table public.courses add column if not exists source_verified_at timestamptz;
commit;
