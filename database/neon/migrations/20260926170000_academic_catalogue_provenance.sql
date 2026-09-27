begin;
-- Additive provenance only. Publishing the checked snapshot is a separate,
-- explicit importer action; this migration does not rename or remove any data.
alter table public.universities add column if not exists catalogue_metadata jsonb not null default '{}'::jsonb;
alter table public.faculties add column if not exists catalogue_metadata jsonb not null default '{}'::jsonb;
alter table public.departments add column if not exists catalogue_metadata jsonb not null default '{}'::jsonb;
create table if not exists public.academic_catalogue_imports (
  snapshot_sha256 text primary key check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_version text not null,
  source_manifest jsonb not null,
  imported_at timestamptz not null default now(),
  environment text not null check(environment in ('local','preview','staging','production')),
  summary jsonb not null
);
comment on table public.academic_catalogue_imports is 'Primary-source catalogue snapshots. Does not certify programme accreditation or academic rules.';
commit;
