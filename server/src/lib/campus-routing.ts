export type Coordinate = [number, number];
export type WalkPath = { node_ids: string[]; geometry: { type: string; coordinates: Coordinate[] }; name?: string | null; closed?: boolean; access?: string; steps?: boolean; wheelchair?: string | null; oneway?: -1 | 0 | 1 };
export function metres(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180, dlat = (b[1]-a[1])*rad, dlng = (b[0]-a[0])*rad;
  const h = Math.sin(dlat/2)**2 + Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlng/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
/** Routes use shared OSM path node IDs. Nearby landmarks never create graph edges. */
export function walkingRoute(paths: WalkPath[], origin: Coordinate, destination: Coordinate, accessible = false, respectOneWay = false) {
  const points = new Map<string, Coordinate>(), edges = new Map<string, {id:string;weight:number;name:string}[]>();
  const segments:{a:string;b:string;name:string;forward:boolean;reverse:boolean}[]=[];
  for(const path of paths) {
    if(path.closed || ['no','private'].includes(path.access??'') || (accessible&&(path.steps||path.wheelchair==='no'))) continue;
    path.geometry.coordinates.forEach((point,index)=> { const key=path.node_ids[index]; if(key){points.set(key,point);if(!edges.has(key))edges.set(key,[]);} });
    for(let i=1;i<path.geometry.coordinates.length;i++) {
      const a=path.node_ids[i-1],b=path.node_ids[i];if(!a||!b)continue;
      const weight=metres(points.get(a)!,points.get(b)!); if(!Number.isFinite(weight)||weight<=0)continue;
      const name=path.name??'Campus path',forward=!respectOneWay||path.oneway!==-1,reverse=!respectOneWay||path.oneway!==1;
      if(forward)edges.get(a)!.push({id:b,weight,name});if(reverse)edges.get(b)!.push({id:a,weight,name});segments.push({a,b,name,forward,reverse});
    }
  }
  // Snap to a path segment, including long segments with no intermediate OSM nodes.
  // Split only that segment; crossing lines with different node IDs remain disconnected.
  const project=(p:Coordinate,a:Coordinate,b:Coordinate)=>{const scale=Math.cos(p[1]*Math.PI/180),dx=(b[0]-a[0])*scale,dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((p[0]-a[0])*scale*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return {t,point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t] as Coordinate};};
  const snap=(point:Coordinate,key:string)=>{let best:{id:string;distance:number;t:number;point:Coordinate;segment:typeof segments[number]}|null=null;for(const segment of segments){const value=project(point,points.get(segment.a)!,points.get(segment.b)!),distance=metres(point,value.point);if(!best||distance<best.distance)best={id:value.t<1e-8?segment.a:value.t>1-1e-8?segment.b:key,distance,...value,segment};}return best&&best.distance<=120?best:null;};
  const start=snap(origin,'@origin'),end=snap(destination,'@destination');if(!start||!end)return null;
  const snapped=[start,end],splits=new Map<string,typeof snapped>();
  for(const value of snapped){if(value.id!==value.segment.a&&value.id!==value.segment.b){points.set(value.id,value.point);edges.set(value.id,[]);}const key=value.segment.a+':'+value.segment.b;const group=splits.get(key)??[];group.push(value);splits.set(key,group);}
  for(const group of splits.values()){
    const segment=group[0]!.segment;
    edges.set(segment.a,edges.get(segment.a)!.filter(e=>e.id!==segment.b));edges.set(segment.b,edges.get(segment.b)!.filter(e=>e.id!==segment.a));
    const ordered=[{id:segment.a,t:0},...group.filter(v=>v.id!==segment.a&&v.id!==segment.b),{id:segment.b,t:1}].sort((a,b)=>a.t-b.t);
    for(let i=1;i<ordered.length;i++){const a=ordered[i-1]!.id,b=ordered[i]!.id,weight=metres(points.get(a)!,points.get(b)!);if(segment.forward)edges.get(a)!.push({id:b,weight,name:segment.name});if(segment.reverse)edges.get(b)!.push({id:a,weight,name:segment.name});}
  }
  const distances=new Map<string,number>([[start.id,0]]),previous=new Map<string,{id:string;name:string}>(),heap:{id:string;distance:number}[]=[];
  const push=(item:{id:string;distance:number})=>{heap.push(item);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]!.distance<=item.distance)break;heap[i]=heap[p]!;i=p;}heap[i]=item;};
  const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1]!.distance<heap[child]!.distance)child++;if(heap[child]!.distance>=last.distance)break;heap[i]=heap[child]!;i=child;}heap[i]=last;}return first;};
  push({id:start.id,distance:0});while(heap.length){const item=pop(),current=item.id,best=item.distance;if(best!==(distances.get(current)??Infinity))continue;if(current===end.id)break;
    for(const edge of edges.get(current)??[]){const next=best+edge.weight;if(next<(distances.get(edge.id)??Infinity)){distances.set(edge.id,next);previous.set(edge.id,{id:current,name:edge.name});push({id:edge.id,distance:next});}}
  }
  const networkDistance=distances.get(end.id);if(networkDistance===undefined)return null;
  const ids=[end.id],names:string[]=[];let cursor=end.id;while(cursor!==start.id){const p=previous.get(cursor);if(!p)return null;ids.unshift(p.id);names.unshift(p.name);cursor=p.id;}
  const distanceMetres=Math.round(networkDistance+start.distance+end.distance);
  return {distanceMetres,networkDistanceMetres:Math.round(networkDistance),durationSeconds:Math.ceil(distanceMetres/1.25),geometry:{type:'LineString' as const,coordinates:(ids.length===1?[points.get(ids[0]!)!,points.get(ids[0]!)!]:ids.map(key=>points.get(key)!))},originSnapMetres:Math.round(start.distance),destinationSnapMetres:Math.round(end.distance),originPathCoordinate:start.point,destinationPathCoordinate:end.point,instructions:names.filter((name,index)=>index===0||name!==names[index-1]),source:'MAPPED_PATH_NETWORK' as const};
}
