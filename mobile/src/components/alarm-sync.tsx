import {setWebAlarmSound} from "@/src/lib/web-alarms";
import {useEffect} from "react";
import {AppState,Platform} from "react-native";
import {useAuth} from "@/src/auth/auth-context";
import {useToast} from "./toast";
import {api} from "@/src/lib/api";
import {syncAlarms,type Alarm} from "@/src/lib/alarms";
export function AlarmSync(){const{user}=useAuth(),toast=useToast();useEffect(()=>{if(!user)return;let active=true;const restore=async()=>{try{const r=await api<{alarms:Alarm[]}>("/v1/learning/alarms");if(active){if(Platform.OS==="web"){try{const result=await api<{sound:{url:string}|null}>("/v1/notifications/sounds/default");if(active)setWebAlarmSound(result.sound?.url);}catch{/* Keep the built-in sound if the catalogue is unavailable. */}}if(active)await syncAlarms(r.alarms);}}catch{/* Saved alarms stay on-device if offline. */}};void restore();const subscription=AppState.addEventListener("change",state=>{if(state==="active")void restore();});return()=>{active=false;subscription.remove();};},[user?.id]);useEffect(()=>{if(Platform.OS!=="web")return;const ring=(event:Event)=>toast((event as CustomEvent<{label:string}>).detail.label);window.addEventListener("k1-alarm",ring);return()=>window.removeEventListener("k1-alarm",ring);},[toast]);return null;}
