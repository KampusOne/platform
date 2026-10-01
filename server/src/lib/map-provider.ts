// Provider capability and bounded Overpass failure handling adapted from
// bilawalsidhu/gods-eye-view (MIT). See THIRD_PARTY_NOTICES.md.
import {AppError} from './errors';
export type OsmElement={id:number;type:'node'|'way'|'relation';lat?:number;lon?:number;nodes?:number[];geometry?:{lat:number;lon:number}[];tags?:Record<string,string>};
export function overpassIsData(data:{remark?:string;elements?:unknown}) {
 return Array.isArray(data.elements)&&!/(runtime error|timed out|out of memory|too many requests|rate_limited)/i.test(data.remark??'');
}
export async function discoverCampus(latitude:number,longitude:number) {
 const query=`[out:json][timeout:20];(nwr(around:1600,${latitude},${longitude})[building];way(around:1600,${latitude},${longitude})[highway];nwr(around:1600,${latitude},${longitude})[amenity];node(around:1600,${latitude},${longitude})[entrance];way(around:1600,${latitude},${longitude})[landuse=education];);out geom;`;
 for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']) {
  try {
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'KampusOne Campus Mapper/2.0 (https://kampusone.app)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(24000)});
   if(!response.ok){await response.body?.cancel();continue;}
   const reader=response.body?.getReader();if(!reader)continue;let length=0;const chunks:Uint8Array[]=[];
   while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>8*1024*1024){await reader.cancel();throw new Error('Map response exceeded limit');}chunks.push(next.value);}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const data=JSON.parse(new TextDecoder().decode(bytes));if(overpassIsData(data))return {elements:data.elements as OsmElement[],sourceUrl:endpoint};
  }catch{/* A failed provider never becomes a successful empty import. */}
 }
 throw new AppError(503,'PROVIDER_UNAVAILABLE','OpenStreetMap discovery is temporarily unavailable. The published directory is still available.');
}
export function osmGeometry(element:OsmElement) {
 if(element.type==='node'&&Number.isFinite(element.lon)&&Number.isFinite(element.lat))return {type:'Point',coordinates:[element.lon,element.lat]};
 const coordinates=element.geometry?.map(p=>[p.lon,p.lat]);if(!coordinates||coordinates.length<2)return null;
 const polygon=coordinates.length>3&&coordinates[0]![0]===coordinates.at(-1)![0]&&coordinates[0]![1]===coordinates.at(-1)![1];
 return polygon?{type:'Polygon',coordinates:[coordinates]}:{type:'LineString',coordinates};
}
