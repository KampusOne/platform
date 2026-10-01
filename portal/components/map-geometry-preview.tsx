"use client";
import {useEffect,useRef} from 'react';
export function MapGeometryPreview({geometry,label}:{geometry:{type:string;coordinates:unknown};label:string}){
 const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{
 const coordinates:number[][]=[];const collect=(value:unknown)=>{if(!Array.isArray(value))return;if(typeof value[0]==='number'&&typeof value[1]==='number')coordinates.push(value);else value.forEach(collect);};collect(geometry.coordinates);
 const center:[number,number]=coordinates.length?[coordinates.reduce((v,p)=>v+p[0]!,0)/coordinates.length,coordinates.reduce((v,p)=>v+p[1]!,0)/coordinates.length]:[5.618838,6.398255];
 const payload={campusId:label,centre:center,places:[],features:{type:'FeatureCollection',features:[{type:'Feature',geometry,properties:{name:label,kind:'REVIEW'}}]},route:geometry.type==='LineString'?geometry:null,location:geometry.type==='Point'?center:null,layer:'osm',selectedId:null,focus:{coordinate:center,nonce:Date.now()},preview:true};
 const send=()=>frame.current?.contentWindow?.postMessage(JSON.stringify({type:'kampusone-map',payload}),location.origin);const receive=(e:MessageEvent)=>{if(e.source===frame.current?.contentWindow&&e.origin===location.origin){try{if(JSON.parse(e.data).type==='ready')send();}catch{}}};window.addEventListener('message',receive);send();return()=>window.removeEventListener('message',receive);
 },[geometry,label]);
 return <iframe ref={frame} title={`Geometry of ${label}`} src="/maps/view.html" style={{width:'100%',height:300,border:0,borderRadius:12}}/>;
}
