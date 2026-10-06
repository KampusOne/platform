#!/usr/bin/env python3
"""Query real Overture GeoParquet by campus bounding box; never invent POIs.

Requires duckdb with httpfs + spatial. Output is source evidence for the existing
map importer, with release/licence attribution, not an automatic publication.
Use --bounds WEST SOUTH EAST NORTH for any other institution's campus.
"""
import argparse
import json
from pathlib import Path
import duckdb

CAMPUS_BOUNDS = {
    "ugbowo": (5.602, 6.386, 5.641, 6.420),
    "ekehuan": (5.594, 6.328, 5.606, 6.340),
}
parser = argparse.ArgumentParser()
parser.add_argument("--campus", choices=CAMPUS_BOUNDS, default="ugbowo")
parser.add_argument("--bounds", type=float, nargs=4)
parser.add_argument("--release", default="2026-09-23.1")
parser.add_argument("--output", required=True)
parser.add_argument("--themes", choices=("all", "places", "buildings"), default="all")
args = parser.parse_args()
west, south, east, north = args.bounds or CAMPUS_BOUNDS[args.campus]
if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
    raise ValueError("Use valid west, south, east, north coordinates")
if not __import__('re').fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", args.release):
    raise ValueError("Use an Overture release identifier")
conn = duckdb.connect()
conn.execute("SET memory_limit='512MB'")
conn.execute("SET threads=2")
conn.execute("LOAD httpfs")
conn.execute("LOAD spatial")
features, counts = [], {}
for theme, kind in (("places", "place"), ("buildings", "building")):
    if args.themes != "all" and theme != args.themes:
        continue
    path = f"s3://overturemaps-us-west-2/release/{args.release}/theme={theme}/type={kind}/*"
    rows = conn.execute(f"""
      select id,names.primary,ST_AsGeoJSON(geometry),to_json(sources)
      from read_parquet('{path}',hive_partitioning=1)
      where bbox.xmin <= ? and bbox.xmax >= ? and bbox.ymin <= ? and bbox.ymax >= ?
      limit 20000
    """, [east, west, north, south]).fetchall()
    counts[kind] = len(rows)
    for source_id, name, geometry, sources in rows:
        features.append({"type": "Feature", "geometry": json.loads(geometry), "properties": {
            "sourceId": source_id, "name": name, "kind": kind,
            "sources": json.loads(sources) if sources else [],
            "release": args.release, "provider": "Overture Maps Foundation",
        }})
    print(json.dumps({"campus": args.campus, "type": kind, "records": len(rows)}), flush=True)
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"type": "FeatureCollection", "features": features,
    "source": {"provider": "Overture Maps Foundation", "release": args.release,
        "bounds": [west, south, east, north], "licence": "https://docs.overturemaps.org/attribution/",
        "counts": counts}}, ensure_ascii=False))
print(json.dumps({"saved": str(output), "counts": counts}), flush=True)
