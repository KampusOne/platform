import {createElement,useEffect,useRef,useState} from 'react';
import {Platform,View,Text,StyleSheet} from 'react-native';
import {WebView} from 'react-native-webview';
export type MapCoordinate=[number,number];
export type MapPayload={
  satellite?:{url:string;attribution:string}|null;
  campusId:string;
  centre:MapCoordinate;
  places:unknown[];
  features:unknown;
  selectedId:string|null;
  originId?:string|null;
  location:MapCoordinate|null;
  route:unknown;
  origin?:MapCoordinate|null;
  destination?:MapCoordinate|null;
  layer:string;
  pickMode?:'origin'|'destination'|null;
  padding?:{top:number;bottom:number;left:number;right:number};
  reducedMotion?:boolean;
  focus?:{coordinate:MapCoordinate;nonce:number;zoom?:number}|null|undefined;
};
const productionViewer='https://kampusone-mobile-preview.vercel.app/maps/view';
export function CampusMapSurface({payload,onPick,onError,onPoint,safeInsets}:{
  payload:MapPayload;
  onPick:(id:string)=>void;
  onError:(message:string)=>void;
  onPoint?:(coordinate:MapCoordinate)=>void;
  safeInsets?:{top:number;bottom:number};
}){
  const webRef=useRef<WebView>(null),frameRef=useRef<HTMLIFrameElement>(null),[ready,setReady]=useState(false);
  const latest=useRef(payload),lastSent=useRef<MapPayload|null>(null),callbacks=useRef({onPick,onError,onPoint});
  latest.current=payload;callbacks.current={onPick,onError,onPoint};
  const src=Platform.OS==='web'?new URL('/maps/view.html',window.location.origin).href:productionViewer;
  const send=()=>{
    const previous=lastSent.current as unknown as Record<string,unknown>|null;
    const changes=Object.fromEntries(Object.entries(latest.current).filter(([key,value])=>!previous||previous[key]!==value));
    if(!Object.keys(changes).length)return;
    const data=JSON.stringify({type:'kampusone-map',payload:changes});
    lastSent.current=latest.current;
    if(Platform.OS==='web')frameRef.current?.contentWindow?.postMessage(data,new URL(src).origin);
    else webRef.current?.postMessage(data);
  };
  const receive=(raw:string)=>{
    try{
      const message=JSON.parse(raw);
      if(message.type==='ready'){lastSent.current=null;setReady(true);send();}
      else if(message.type==='pick'&&typeof message.id==='string')callbacks.current.onPick(message.id);
      else if(message.type==='point'&&Array.isArray(message.coordinate)&&message.coordinate.length===2&&message.coordinate.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n))){
        const coordinate=message.coordinate as MapCoordinate;
        if(Math.abs(coordinate[0])<=180&&Math.abs(coordinate[1])<=90)callbacks.current.onPoint?.(coordinate);
      }else if(message.type==='error'&&typeof message.message==='string')callbacks.current.onError(message.message);
    }catch{}
  };
  useEffect(()=>{
    if(Platform.OS!=='web')return;
    const handle=(event:MessageEvent)=>{
      if(event.source===frameRef.current?.contentWindow&&event.origin===new URL(src).origin&&typeof event.data==='string')receive(event.data);
    };
    window.addEventListener('message',handle);
    return()=>window.removeEventListener('message',handle);
  },[src]);
  useEffect(()=>{if(ready)send();},[payload,ready]);
  useEffect(()=>{
    if(ready)return;
    const timeout=setTimeout(()=>callbacks.current.onError('The map is taking longer to load. Check your connection and retry.'),12000);
    return()=>clearTimeout(timeout);
  },[ready]);
  return <View style={[StyleSheet.absoluteFill,{top:safeInsets?.top??0,bottom:safeInsets?.bottom??0}]}>
    {Platform.OS==='web'?createElement('iframe',{ref:frameRef,src,title:'Interactive campus map',allow:'geolocation',style:{border:0,width:'100%',height:'100%',background:'#edeae3'}}):
      <WebView ref={webRef} source={{uri:src}} originWhitelist={['https://kampusone-mobile-preview.vercel.app']} onShouldStartLoadWithRequest={r=>{
        if(r.url==='about:blank')return true;
        try{const next=new URL(r.url),trusted=new URL(src);return next.origin===trusted.origin&&next.pathname.startsWith('/maps/');}catch{return false;}
      }} javaScriptEnabled domStorageEnabled cacheEnabled androidLayerType="hardware" setSupportMultipleWindows={false} scrollEnabled={false} bounces={false} onLoadEnd={()=>send()} onMessage={event=>receive(event.nativeEvent.data)} onError={()=>onError('The campus map could not load. Check your connection and try again.')} style={{flex:1,backgroundColor:'#edeae3'}}/>}
    {!ready?<View pointerEvents="none" style={{position:'absolute',top:'48%',alignSelf:'center',padding:12,backgroundColor:'#fff',borderRadius:12}}><Text>Loading campus map…</Text></View>:null}
  </View>;
}
