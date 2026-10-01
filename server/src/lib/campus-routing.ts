export type Coordinate = [number, number];
export type WalkPath = { node_ids: string[]; geometry: { type: string; coordinates: Coordinate[] }; name?: string | null; closed?: boolean; access?: string; steps?: boolean; wheelchair?: string | null };
export function metres(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180, dlat = (b[1]-a[1])*rad, dlng = (b[0]-a[0])*rad;
  const h = Math.sin(dlat/2)**2 + Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlng/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
/** Routes use shared OSM path node IDs. Nearby landmarks never create graph edges. */
export function walkingRoute(paths: WalkPath[], origin: Coordinate, destination: Coordinate, accessible = false) {
  const points = new Map<string, Coordinate>(), edges = new Map<string, {id:string;weight:number;name:string}[]>();
  for(const path of paths) {
    if(path.closed || ['no','private'].includes(path.access??'') || (accessible&&(path.steps||path.wheelchair==='no'))) continue;
    path.geometry.coordinates.forEach((point,index)=> { const key=path.node_ids[index]; if(key){points.set(key,point);if(!edges.has(key))edges.set(key,[]);} });
    for(let i=1;i<path.geometry.coordinates.length;i++) {
      const a=path.node_ids[i-1],b=path.node_ids[i];if(!a||!b)continue;
      const weight=metres(points.get(a)!,points.get(b)!); if(!Number.isFinite(weight)||weight<=0)continue;
      edges.get(a)!.push({id:b,weight,name:path.name??'Campus path'});edges.get(b)!.push({id:a,weight,name:path.name??'Campus path'});
    }
  }
  const snap=(point:Coordinate)=> { let nearest:string|null=null,distance=Infinity;for(const[key,value]of points){const d=metres(point,value);if(d<distance){nearest=key;distance=d;}} return nearest&&distance<=120?{id:nearest,distance}:null; };
  const start=snap(origin),end=snap(destination);if(!start||!end)return null;
  const distances=new Map<string,number>([[start.id,0]]),previous=new Map<string,{id:string;name:string}>(),pending=new Set(points.keys());
  while(pending.size){let current:string|null=null,best=Infinity;for(const key of pending){const d=distances.get(key)??Infinity;if(d<best){best=d;current=key;}}if(current===null)break;pending.delete(current);if(current===end.id)break;
    for(const edge of edges.get(current)??[]){const next=best+edge.weight;if(next<(distances.get(edge.id)??Infinity)){distances.set(edge.id,next);previous.set(edge.id,{id:current,name:edge.name});}}
  }
  const networkDistance=distances.get(end.id);if(networkDistance===undefined)return null;
  const ids=[end.id],names:string[]=[];let cursor=end.id;while(cursor!==start.id){const p=previous.get(cursor);if(!p)return null;ids.unshift(p.id);names.unshift(p.name);cursor=p.id;}
  const distanceMetres=Math.round(networkDistance+start.distance+end.distance);
  return {distanceMetres,durationSeconds:Math.ceil(distanceMetres/1.25),geometry:{type:'LineString' as const,coordinates:ids.map(key=>points.get(key)!)},originSnapMetres:Math.round(start.distance),destinationSnapMetres:Math.round(end.distance),instructions:[...new Set(names)],source:'REVIEWED_PATH_NETWORK' as const};
}
