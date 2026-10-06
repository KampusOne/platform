"""Acquire bounded source polygons for exact university identity matches.

OSM source data is evidence, not a verified survey of rooms or entrances.
Failed chunks remain visible and can be retried without losing completed work.
"""
import json,pathlib,urllib.request,urllib.parse,concurrent.futures
root=pathlib.Path(__file__).parent
matches=json.loads((root/'nigeria-campus-matches-20261006.json').read_text())
features=[m['feature']for m in matches if m['feature']['type']in('way','relation')]
chunks=[features[i:i+5]for i in range(0,len(features),5)]
output=root/'nigeria-campus-polygons-osm-20261006.json'
existing=json.loads(output.read_text())['elements']if output.exists()else[]
known={(e['type'],e['id'])for e in existing}
def fetch(chunk):
 wanted=[f for f in chunk if (f['type'],f['id'])not in known]
 if not wanted:return []
 selectors=''.join(f"{f['type']}(id:{f['id']});"for f in wanted)
 query='[out:json][timeout:40];('+selectors+');out geom;'
 errors=[]
 for endpoint in ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']:
  try:
   req=urllib.request.Request(endpoint,data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'KampusOne Campus Maps (https://kampusone.app)'})
   with urllib.request.urlopen(req,timeout=55)as response:raw=response.read(8*1024*1024+1)
   if len(raw)>8*1024*1024:raise ValueError('Source response exceeded the bounded allowance')
   data=json.loads(raw)
   if data.get('remark')or not isinstance(data.get('elements'),list):raise ValueError(data.get('remark','Incomplete source'))
   return data['elements']
  except Exception as error:errors.append(str(error))
 raise RuntimeError('; '.join(errors))
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
 for future in concurrent.futures.as_completed([pool.submit(fetch,c)for c in chunks]):
  try:existing.extend(future.result());output.write_text(json.dumps({'version':.6,'generator':'OSM Overpass API','attribution':'© OpenStreetMap contributors','elements':existing},ensure_ascii=False,separators=(',',':')));print(json.dumps({'receivedPolygons':len(existing)}),flush=True)
  except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
