import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { Alarm } from './alarms';
type Event = {id:string;alarmId:string;kind:'ringing'|'dismiss'|'snooze'|'missed';firedAt:string};
type NativeAlarmModule = {addListener?:(name:string)=>void;removeListeners?:(count:number)=>void;eventSupport?:()=>Promise<boolean>;status():Promise<boolean>;requestExactPermission():Promise<boolean>;sync(alarms:string):Promise<boolean>;dismiss(id:string):Promise<boolean>;snooze(id:string):Promise<boolean>;snoozeFor(id:string,minutes:number):Promise<boolean>;active():Promise<string|null>;events():Promise<string>;acknowledge(ids:string):Promise<boolean>;cacheSound(url:string):Promise<boolean>;cacheAlarmSound(id:string,url:string):Promise<boolean>};
export const nativeAlarms: NativeAlarmModule | null = Platform.OS==='android' ? NativeModules.KampusAlarms ?? null : null;
export type RingingAlarm = Alarm & {firedAt:number;endsAt:number};
export async function getRingingAlarm():Promise<RingingAlarm|null> { const raw=await nativeAlarms?.active();return raw?JSON.parse(raw):null; }
export async function getAlarmEvents():Promise<Event[]> { return JSON.parse(await nativeAlarms?.events()??'[]'); }

/** Event support is discovered at runtime; older installed binaries keep a bounded fallback. */
export function subscribeAlarmChanges(listener:()=>void){
 if(!nativeAlarms?.eventSupport)return null;
 const emitter=new NativeEventEmitter(nativeAlarms as unknown as import('react-native').NativeModule);
 const subscription=emitter.addListener('KampusAlarmStateChanged',listener);
 return()=>subscription.remove();
}
