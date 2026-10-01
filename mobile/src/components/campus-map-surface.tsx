import {createElement,useEffect,useRef,useState} from 'react';
import {Platform,View,Text,StyleSheet} from 'react-native';
import {WebView} from 'react-native-webview';
export type MapPayload={campusId:string;centre:[number,number];places:unknown[];features:unknown;selectedId:string|null;location:[number,number]|null;route:unknown;layer:string;focus?:{coordinate:[number,number];nonce:number}|null|undefined};
const productionViewer='https://kampusone-mobile-preview.vercel.app/maps/view.html';
export function CampusMapSurface({payload,onPick,onError}:{payload:MapPayload;onPick:(id:string)=>void;onError:(message:string)=>void}){
 const webRef=useRef<WebView>(null),frameRef=useRef<HTMLIFrameElement>(null),[ready,setReady]=useState(false);const latest=useRef(payload);latest.current=payload;
 const src=Platform.OS==='web'?new URL('/maps/view.html',window.location.origin).href:productionViewer;
 const send=()=>{const data=JSON.stringify({type:'kampusone-map',payload:latest.current});if(Platform.OS==='web')frameRef.current?.contentWindow?.postMessage(data,new URL(src).origin);else webRef.current?.postMessage(data);};
 const receive=(raw:string)=>{try{const message=JSON.parse(raw);if(message.type==='ready'){setReady(true);send();}else if(message.type==='pick'&&typeof message.id==='string')onPick(message.id);else if(message.type==='error'&&typeof message.message==='string')onError(message.message);}catch{}};
 useEffect(()=>{if(Platform.OS!=='web')return;const handle=(event:MessageEvent)=>{if(event.source===frameRef.current?.contentWindow&&event.origin===new URL(src).origin&&typeof event.data==='string')receive(event.data);};window.addEventListener('message',handle);return()=>window.removeEventListener('message',handle);},[src,onPick,onError]);
 useEffect(()=>{if(ready)send();},[payload,ready]);
 return <View style={StyleSheet.absoluteFill}>{Platform.OS==='web'?createElement('iframe',{ref:frameRef,src,title:'Interactive campus map',allow:'geolocation',style:{border:0,width:'100%',height:'100%',background:'#edeae3'}}):<WebView ref={webRef} source={{uri:src}} originWhitelist={['https://kampusone-mobile-preview.vercel.app']} onShouldStartLoadWithRequest={r=>r.url===src||r.url==='about:blank'} javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false} onMessage={event=>receive(event.nativeEvent.data)} onError={()=>onError('The map could not load. Your campus directory is still available.')} style={{flex:1,backgroundColor:'#edeae3'}}/>}{!ready?<View pointerEvents="none" style={{position:'absolute',top:'48%',alignSelf:'center',padding:12,backgroundColor:'#fff',borderRadius:12}}><Text>Loading campus map…</Text></View>:null}</View>;
}
