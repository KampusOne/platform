"""Bounded read-only OSM acquisition for review. Does not publish any map data."""
import datetime,json,pathlib,urllib.request,urllib.parse,xml.etree.ElementTree as ET
campuses={"ugbowo":(5.602,6.386,5.641,6.420),"ekehuan":(5.594,6.328,5.606,6.340)}
out=pathlib.Path('map-source-data');out.mkdir(exist_ok=True)
for slug,bounds in campuses.items():
    west,south,east,north=bounds
    query=f'[out:json][timeout:20];(nwr({south},{west},{north},{east})[building];way({south},{west},{north},{east})[highway];nwr({south},{west},{north},{east})[amenity];node({south},{west},{north},{east})[entrance];way({south},{west},{north},{east})[landuse=education];);out geom;'
    data=None;source=None;failures=[]
    for endpoint in ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']:
        try:
            request=urllib.request.Request(endpoint,data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'KampusOne Campus Maps/2.0 (https://kampusone.app)'})
            with urllib.request.urlopen(request,timeout=30) as response:raw=response.read(8*1024*1024+1)
            if len(raw)>8*1024*1024:raise ValueError('Response exceeded limit')
            result=json.loads(raw)
            if result.get('remark') or not isinstance(result.get('elements'),list):raise ValueError('Provider did not return complete data')
            data=result;source=endpoint;break
        except Exception as error:failures.append(str(error)[:120])
    if data is None:
        try:
            elements_by_id={}
            mid_x=(west+east)/2;mid_y=(south+north)/2
            tiles=[(west,south,mid_x,mid_y),(mid_x,south,east,mid_y),(west,mid_y,mid_x,north),(mid_x,mid_y,east,north)]
            for tile in tiles:
                source='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str,tile))
                request=urllib.request.Request(source,headers={'User-Agent':'KampusOne Campus Maps/2.0 (https://kampusone.app)'})
                with urllib.request.urlopen(request,timeout=30) as response:raw=response.read(8*1024*1024+1)
                if len(raw)>8*1024*1024:raise ValueError('Response exceeded limit')
                root=ET.fromstring(raw);nodes={n.attrib['id']:{'lat':float(n.attrib['lat']),'lon':float(n.attrib['lon'])} for n in root.findall('node')}
                for element in root:
                    tags={tag.attrib['k']:tag.attrib['v'] for tag in element.findall('tag')}
                    if not tags or element.tag not in ['node','way']:continue
                    feature={'id':int(element.attrib['id']),'type':element.tag,'tags':tags}
                    if element.tag=='node':feature.update(nodes[element.attrib['id']])
                    else:
                        ids=[nd.attrib['ref'] for nd in element.findall('nd')]
                        if any(node not in nodes for node in ids):continue
                        feature.update({'nodes':list(map(int,ids)),'geometry':[nodes[node] for node in ids]})
                    elements_by_id[(feature['type'],feature['id'])]=feature
            data={'elements':list(elements_by_id.values())}
        except Exception as error:failures.append(str(error)[:120])
    payload={'campus':slug,'bounds':bounds,'sourceUrl':source,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'license':'ODbL 1.0; © OpenStreetMap contributors','errors':failures,'elements':data['elements'] if data else []}
    (out/(slug+'.json')).write_text(json.dumps(payload))
    print(f"{slug}: {len(payload['elements'])} source features; {'ready for review' if data else 'unavailable'}")
