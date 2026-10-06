"""Prepare reproducible, bounded map imports from the committed source files.

The database importer performs the final campus clipping. Source centres and
polygons are not claimed to be a survey of entrances, rooms, or walking paths.
"""
import argparse, hashlib, json, math, pathlib, uuid

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--campuses', type=pathlib.Path, required=True)
parser.add_argument('--actor', required=True, type=uuid.UUID)
args = parser.parse_args()
root = pathlib.Path(__file__).parent
args.output.mkdir(parents=True, exist_ok=True)
campuses = json.loads(args.campuses.read_text())
manifest = {'sourceDate': '2026-10-06', 'overtureRelease': '2026-09-23.1', 'batches': []}

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def distance(a, b):
    r = math.pi / 180
    return 6371000 * math.hypot((a[0]-b[0])*r*math.cos((a[1]+b[1])*r/2), (a[1]-b[1])*r)

def vertices(geometry):
    def flatten(value):
        if len(value) == 2 and all(isinstance(x, (float, int)) for x in value):
            yield value
        else:
            for child in value:
                yield from flatten(child)
    return list(flatten(geometry['coordinates']))

for campus in campuses:
    slug = campus['slug']
    source = root / f'overture-{slug}-20260923.geojson'
    if not source.exists():
        continue
    raw = source.read_bytes()
    boundary = vertices(campus['boundary']) if campus['boundary'] else None
    bounds = (min(p[0] for p in boundary), min(p[1] for p in boundary),
              max(p[0] for p in boundary), max(p[1] for p in boundary)) if boundary else None
    centre = [float(campus['longitude']), float(campus['latitude'])]
    features = []
    for feature in json.loads(raw)['features']:
        points = vertices(feature['geometry'])
        if not points:
            continue
        if bounds:
            if (max(p[0] for p in points) < bounds[0] or min(p[0] for p in points) > bounds[2]
                    or max(p[1] for p in points) < bounds[1] or min(p[1] for p in points) > bounds[3]):
                continue
        elif min(distance(point, centre) for point in points) > 1400:
            continue
        properties = {key: value for key, value in feature['properties'].items() if key != 'sources'}
        features.append({'geometry': feature['geometry'], 'properties': properties})
    for index in range(0, len(features), 150):
        payload = json.dumps(features[index:index+150], separators=(',', ':'), ensure_ascii=False)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        filename = f'{slug}-{index//150:03}.sql'
        sql = (f"select app_private.import_overture_campus('{campus['id']}', '{args.actor}',"
               f"'2026-09-23.1','{digest}',{quote(payload)}::jsonb) result;")
        (args.output / filename).write_text(sql)
        manifest['batches'].append({'file': filename, 'campus': slug, 'features': len(features[index:index+150]),
                                    'payloadSha256': digest, 'sourceSha256': hashlib.sha256(raw).hexdigest()})

polygons = {(f['type'], f['id']): f for f in json.loads((root/'nigeria-campus-polygons-osm-20261006.json').read_text())['elements']}
matches = json.loads((root/'nigeria-campus-matches-20261006.json').read_text())
selected = []
for match in sorted(matches, key=lambda m: (m['feature']['type'] == 'node', m['feature']['id'])):
    feature = match['feature']
    location = feature.get('center', feature)
    if not all(key in location for key in ['lat', 'lon']):
        continue
    centre = [location['lon'], location['lat']]
    if match['universityId'] in {c['institutionId'] for c in campuses}:
        continue
    if any(other['universityId'] == match['universityId'] and distance(other['centre'], centre) < 1000 for other in selected):
        continue
    match = dict(match, centre=centre)
    selected.append(match)

def source_polygon(feature):
    source = polygons.get((feature['type'], feature['id']))
    if not source:
        return None
    points = [[p['lon'], p['lat']] for p in source.get('geometry', [])]
    if len(points) >= 4 and points[0] == points[-1]:
        return {'type': 'MultiPolygon', 'coordinates': [[points]]}
    # Unassembled relation parts remain a sourced centre until reviewed.
    return None

records = []
for match in selected:
    feature = match['feature']
    source_id = f"{feature['type']}/{feature['id']}"
    campus_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://kampusone.app/maps/{match['universityId']}/{source_id}"))
    records.append({'id': campus_id, 'institutionId': match['universityId'], 'name': feature['tags']['name'],
                    'slug': 'osm-'+source_id.replace('/', '-'), 'sourceId': source_id,
                    'longitude': match['centre'][0], 'latitude': match['centre'][1], 'boundary': source_polygon(feature)})

for index in range(0, len(records), 10):
    payload = json.dumps(records[index:index+10], separators=(',', ':'), ensure_ascii=False)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    filename = f'national-{index//10:03}.sql'
    sql = f"""do $national$
declare entry jsonb; shape public.geometry;
begin
 for entry in select value from jsonb_array_elements({quote(payload)}::jsonb) loop
  shape=null;
  if entry->'boundary'<>'null'::jsonb then
   shape=public.ST_SetSRID(public.ST_GeomFromGeoJSON((entry->'boundary')::text),4326);
   if not public.ST_IsValid(shape) then shape=null;end if;
  end if;
  insert into public.institution_campuses(id,institution_id,name,slug,latitude,longitude,source_url,status,boundary)
  values((entry->>'id')::uuid,(entry->>'institutionId')::uuid,entry->>'name',entry->>'slug',
    (entry->>'latitude')::numeric,(entry->>'longitude')::numeric,'https://www.openstreetmap.org/'||(entry->>'sourceId'),'PUBLISHED',shape)
  on conflict(institution_id,slug)do nothing;
  insert into app_private.map_imports(institution_id,campus_id,actor_user_id,source_provider,request_key,status,source_url,diagnostics,completed_at)
  values((entry->>'institutionId')::uuid,(entry->>'id')::uuid,'{args.actor}','OSM','national-centres:{digest}','COMPLETE',
   'https://www.openstreetmap.org/'||(entry->>'sourceId'),jsonb_build_object('identityMatch','exact-directory-name','boundaryAvailable',shape is not null,'entrancesSurveyed',false,'walkingPathsImported',false),now())
  on conflict(campus_id,request_key)do nothing;
 end loop;
end $national$;"""
    (args.output/filename).write_text(sql)
    manifest['batches'].append({'file': filename, 'campus': 'national', 'campuses': len(records[index:index+10]), 'payloadSha256': digest})
manifest['nationalCampuses'] = len(records)
manifest['nationalUniversities'] = len({r['institutionId'] for r in records})
manifest['nationalBoundaries'] = len([r for r in records if r['boundary']])
(args.output/'manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps({'batches': len(manifest['batches']), 'overtureFeatures': sum(b.get('features',0) for b in manifest['batches']),
                  'nationalCampuses': manifest['nationalCampuses'], 'nationalUniversities': manifest['nationalUniversities'], 'nationalBoundaries': manifest['nationalBoundaries']}))
