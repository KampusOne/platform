begin;

alter table public.campus_places
  add column if not exists source_provider text,
  add column if not exists source_ref text,
  add column if not exists source_url text,
  add column if not exists source_synced_at timestamptz;

create unique index if not exists campus_places_external_source
  on public.campus_places(campus_id, source_provider, source_ref);

update public.institution_campuses c
set latitude = 6.400790,
    longitude = 5.613090,
    status = 'PUBLISHED',
    updated_at = now()
from public.universities u
where c.institution_id = u.id
  and lower(u.name) = 'university of benin'
  and c.slug = 'ugbowo'
  and c.latitude is null
  and c.longitude is null;

commit;
