import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CampusPlace} from './campus-data';

type SavedMap<T>={places:CampusPlace[];info:T|null;features:unknown|null};
type Geometry={type:'FeatureCollection';features:unknown[]};
const pending=new Map<string,Promise<void>>();
let sequence=0;
/** Android storage reads have a per-entry window limit; geometry is saved in bounded pages. */
export async function readCampusMapCache<T>(key:string):Promise<SavedMap<T>|null>{
  try{
    const text=await AsyncStorage.getItem(key);if(!text)return null;
    const saved=JSON.parse(text);
    const places=Array.isArray(saved.places)?saved.places.filter((place:CampusPlace)=>Boolean(place&&typeof place.id==='string'&&typeof place.name==='string')):[];
    let features:unknown|null=saved.features??null;
    if(typeof saved.geometryRevision==='string'&&Number.isInteger(saved.geometryPages)&&saved.geometryPages>0&&saved.geometryPages<=100){
      try{
        const pages=await Promise.all(Array.from({length:saved.geometryPages},(_,index)=>AsyncStorage.getItem(`${key}.geometry.${saved.geometryRevision}.${index}`)));
        if(pages.every(Boolean))features={type:'FeatureCollection',features:saved.geometryFormat==='json-chunks'?JSON.parse(pages.join('')):pages.flatMap(page=>JSON.parse(page!))};
      }catch{/* Places and campus information remain usable if a geometry page is unavailable. */}
    }
    return {places,info:saved.info??null,features};
  }catch{return null;}
}
export async function writeCampusMapCache<T>(key:string,map:SavedMap<T>){
  const previous=pending.get(key)??Promise.resolve();
  const write=previous.catch(()=>{}).then(async()=>{
    const oldText=await AsyncStorage.getItem(key).catch(()=>null);
    let old:Record<string,unknown>|null=null;try{old=oldText?JSON.parse(oldText):null;}catch{}
    const revision=`${Date.now().toString(36)}-${++sequence}`;
    const features=(map.features as Geometry|null)?.type==='FeatureCollection'&&(Array.isArray((map.features as Geometry).features))?(map.features as Geometry).features:[];
    const serialized=JSON.stringify(features),pages:string[]=[];
    for(let start=0;start<serialized.length;){
      let end=Math.min(start+240000,serialized.length);
      // Keep UTF-16 surrogate pairs together across the native storage bridge.
      const final=serialized.charCodeAt(end-1);if(end<serialized.length&&final>=0xd800&&final<=0xdbff)end--;
      pages.push(serialized.slice(start,end));start=end;
    }
    await Promise.all(pages.map((text,index)=>AsyncStorage.setItem(`${key}.geometry.${revision}.${index}`,text)));
    await AsyncStorage.setItem(key,JSON.stringify({places:map.places,info:map.info,geometryRevision:revision,geometryPages:pages.length,geometryFormat:'json-chunks'}));
    if(typeof old?.geometryRevision==='string'&&Number.isInteger(old.geometryPages)&&Number(old.geometryPages)>0&&Number(old.geometryPages)<=100){
      await Promise.all(Array.from({length:Number(old.geometryPages)},(_,index)=>AsyncStorage.removeItem(`${key}.geometry.${old.geometryRevision}.${index}`))).catch(()=>{});
    }
  });
  pending.set(key,write);
  try{await write;}finally{if(pending.get(key)===write)pending.delete(key);}
}
