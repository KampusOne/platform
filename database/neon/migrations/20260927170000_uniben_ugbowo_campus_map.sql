begin;

with uniben as (
  select id
  from public.universities
  where lower(name) = 'university of benin' and deleted_at is null
  limit 1
)
update public.institution_campuses campus
set
  latitude = 6.398255,
  longitude = 5.618838,
  map_style = 'KAMPUSONE',
  source_url = 'https://www.uniben.edu/',
  status = 'PUBLISHED',
  updated_at = now()
from uniben
where campus.institution_id = uniben.id
  and campus.slug = 'ugbowo';

insert into public.content_sources(university_id, name, source_url, verified)
select
  uniben.id,
  'KampusOne UNIBEN Ugbowo map directory',
  'https://www.openstreetmap.org/#map=16/6.3983/5.6188',
  false
from public.universities uniben
where lower(uniben.name) = 'university of benin'
  and uniben.deleted_at is null
on conflict(university_id, name) do update set
  source_url = excluded.source_url;

with
uniben as (
  select id
  from public.universities
  where lower(name) = 'university of benin' and deleted_at is null
  limit 1
),
campus as (
  select id, institution_id
  from public.institution_campuses
  where institution_id = (select id from uniben)
    and slug = 'ugbowo'
  limit 1
),
source as (
  select id
  from public.content_sources
  where university_id = (select id from uniben)
    and name = 'KampusOne UNIBEN Ugbowo map directory'
  limit 1
),
starter(id, name, category, description, latitude, longitude, aliases) as (
  values
    ('5a3e978c-8d07-411c-bd0d-1b08313fe128'::uuid, 'Student Affairs Division', 'SERVICE', 'Student Affairs Division, University of Benin Ugbowo Campus.', 6.400023::numeric, 5.609885::numeric, array['Student Affairs','Dean of Students']::text[]),
    ('a64fc253-2c9e-407c-b852-b077e0390d5b'::uuid, 'Faculty of Engineering', 'ACADEMIC', 'Faculty of Engineering, University of Benin Ugbowo Campus.', 6.401790::numeric, 5.615370::numeric, array['Engineering','Engr']::text[]),
    ('4abd5761-6388-46f0-b20d-e3aef1f4f1c2'::uuid, 'Faculty of Physical Sciences', 'ACADEMIC', 'Faculty of Physical Sciences, University of Benin Ugbowo Campus.', 6.400310::numeric, 5.615350::numeric, array['Physical Science','Physical Sciences']::text[]),
    ('f61bd3ec-dbdf-498d-aaab-c867c8c77522'::uuid, 'Faculty of Life Sciences', 'ACADEMIC', 'Faculty of Life Sciences, University of Benin Ugbowo Campus.', 6.398940::numeric, 5.614870::numeric, array['Life Science','Life Sciences']::text[]),
    ('c1a6b966-0cec-427d-8672-fe1df10ae369'::uuid, 'Faculty of Education', 'ACADEMIC', 'Faculty of Education, University of Benin Ugbowo Campus.', 6.400910::numeric, 5.619670::numeric, array['Education']::text[]),
    ('e1ab63c1-5fbd-4a41-9a4d-f2c0b18d7fae'::uuid, 'Faculty of Law', 'ACADEMIC', 'Faculty of Law, University of Benin Ugbowo Campus.', 6.400530::numeric, 5.622440::numeric, array['Law']::text[]),
    ('f66a29bf-08dc-43b6-be7a-d66c099613a5'::uuid, 'JUPEB Foundation School', 'ACADEMIC', 'UNIBEN JUPEB Foundation School, Ugbowo Campus.', 6.397003::numeric, 5.617815::numeric, array['JUPEB','Foundation School']::text[]),
    ('99189c22-3c1b-4d07-baf5-81a1544aa283'::uuid, 'Clinical Hostel', 'HOSTEL', 'Clinical Hostel, University of Benin Ugbowo Campus.', 6.394530::numeric, 5.617190::numeric, array['Clinical Hall']::text[]),
    ('8918a6f0-c56a-432f-b8d1-0d6aed349b57'::uuid, 'NDDC Hostel', 'HOSTEL', 'NDDC Hostel, University of Benin Ugbowo Campus.', 6.394710::numeric, 5.617890::numeric, array['NDDC Hall']::text[]),
    ('f9d9e845-ec23-4ef6-90da-aa84a651a5d6'::uuid, 'Food Court (Buka)', 'FOOD', 'Campus food court (Buka), University of Benin Ugbowo Campus.', 6.395260::numeric, 5.619070::numeric, array['Buka','Food Court']::text[]),
    ('647a85ab-9396-45c4-b427-bebb7d3dcf3b'::uuid, 'Hall 5 Hostel', 'HOSTEL', 'Hall 5 student hostel, University of Benin Ugbowo Campus.', 6.397120::numeric, 5.623920::numeric, array['Hall 5']::text[]),
    ('68a12e6f-640c-4412-8cf6-63a5502d454c'::uuid, 'Hall 6 Hostel', 'HOSTEL', 'Hall 6 student hostel, University of Benin Ugbowo Campus.', 6.398220::numeric, 5.626190::numeric, array['Hall 6']::text[]),
    ('5931353c-3b42-4b13-a5f6-a48ff024c92d'::uuid, 'Hall 7 Hostel', 'HOSTEL', 'Hall 7 student hostel, University of Benin Ugbowo Campus.', 6.397970::numeric, 5.625230::numeric, array['Hall 7']::text[])
)
update public.campus_places place
set
  campus_id = campus.id,
  category = starter.category,
  description = starter.description,
  latitude = starter.latitude,
  longitude = starter.longitude,
  source_id = source.id,
  search_aliases = starter.aliases,
  verified_at = now(),
  status = 'PUBLISHED',
  updated_at = now()
from starter, campus, source
where place.university_id = campus.institution_id
  and lower(place.name) = lower(starter.name)
  and (place.campus_id is null or place.campus_id = campus.id);

with
uniben as (
  select id
  from public.universities
  where lower(name) = 'university of benin' and deleted_at is null
  limit 1
),
campus as (
  select id, institution_id
  from public.institution_campuses
  where institution_id = (select id from uniben)
    and slug = 'ugbowo'
  limit 1
),
source as (
  select id
  from public.content_sources
  where university_id = (select id from uniben)
    and name = 'KampusOne UNIBEN Ugbowo map directory'
  limit 1
),
starter(id, name, category, description, latitude, longitude, aliases) as (
  values
    ('5a3e978c-8d07-411c-bd0d-1b08313fe128'::uuid, 'Student Affairs Division', 'SERVICE', 'Student Affairs Division, University of Benin Ugbowo Campus.', 6.400023::numeric, 5.609885::numeric, array['Student Affairs','Dean of Students']::text[]),
    ('a64fc253-2c9e-407c-b852-b077e0390d5b'::uuid, 'Faculty of Engineering', 'ACADEMIC', 'Faculty of Engineering, University of Benin Ugbowo Campus.', 6.401790::numeric, 5.615370::numeric, array['Engineering','Engr']::text[]),
    ('4abd5761-6388-46f0-b20d-e3aef1f4f1c2'::uuid, 'Faculty of Physical Sciences', 'ACADEMIC', 'Faculty of Physical Sciences, University of Benin Ugbowo Campus.', 6.400310::numeric, 5.615350::numeric, array['Physical Science','Physical Sciences']::text[]),
    ('f61bd3ec-dbdf-498d-aaab-c867c8c77522'::uuid, 'Faculty of Life Sciences', 'ACADEMIC', 'Faculty of Life Sciences, University of Benin Ugbowo Campus.', 6.398940::numeric, 5.614870::numeric, array['Life Science','Life Sciences']::text[]),
    ('c1a6b966-0cec-427d-8672-fe1df10ae369'::uuid, 'Faculty of Education', 'ACADEMIC', 'Faculty of Education, University of Benin Ugbowo Campus.', 6.400910::numeric, 5.619670::numeric, array['Education']::text[]),
    ('e1ab63c1-5fbd-4a41-9a4d-f2c0b18d7fae'::uuid, 'Faculty of Law', 'ACADEMIC', 'Faculty of Law, University of Benin Ugbowo Campus.', 6.400530::numeric, 5.622440::numeric, array['Law']::text[]),
    ('f66a29bf-08dc-43b6-be7a-d66c099613a5'::uuid, 'JUPEB Foundation School', 'ACADEMIC', 'UNIBEN JUPEB Foundation School, Ugbowo Campus.', 6.397003::numeric, 5.617815::numeric, array['JUPEB','Foundation School']::text[]),
    ('99189c22-3c1b-4d07-baf5-81a1544aa283'::uuid, 'Clinical Hostel', 'HOSTEL', 'Clinical Hostel, University of Benin Ugbowo Campus.', 6.394530::numeric, 5.617190::numeric, array['Clinical Hall']::text[]),
    ('8918a6f0-c56a-432f-b8d1-0d6aed349b57'::uuid, 'NDDC Hostel', 'HOSTEL', 'NDDC Hostel, University of Benin Ugbowo Campus.', 6.394710::numeric, 5.617890::numeric, array['NDDC Hall']::text[]),
    ('f9d9e845-ec23-4ef6-90da-aa84a651a5d6'::uuid, 'Food Court (Buka)', 'FOOD', 'Campus food court (Buka), University of Benin Ugbowo Campus.', 6.395260::numeric, 5.619070::numeric, array['Buka','Food Court']::text[]),
    ('647a85ab-9396-45c4-b427-bebb7d3dcf3b'::uuid, 'Hall 5 Hostel', 'HOSTEL', 'Hall 5 student hostel, University of Benin Ugbowo Campus.', 6.397120::numeric, 5.623920::numeric, array['Hall 5']::text[]),
    ('68a12e6f-640c-4412-8cf6-63a5502d454c'::uuid, 'Hall 6 Hostel', 'HOSTEL', 'Hall 6 student hostel, University of Benin Ugbowo Campus.', 6.398220::numeric, 5.626190::numeric, array['Hall 6']::text[]),
    ('5931353c-3b42-4b13-a5f6-a48ff024c92d'::uuid, 'Hall 7 Hostel', 'HOSTEL', 'Hall 7 student hostel, University of Benin Ugbowo Campus.', 6.397970::numeric, 5.625230::numeric, array['Hall 7']::text[])
)
insert into public.campus_places(
  id, university_id, campus_id, name, category, description,
  latitude, longitude, source_id, search_aliases, verified_at, status
)
select
  starter.id, campus.institution_id, campus.id, starter.name, starter.category,
  starter.description, starter.latitude, starter.longitude, source.id,
  starter.aliases, now(), 'PUBLISHED'
from starter, campus, source
where not exists (
  select 1
  from public.campus_places existing
  where existing.university_id = campus.institution_id
    and lower(existing.name) = lower(starter.name)
    and (existing.campus_id is null or existing.campus_id = campus.id)
);

commit;
