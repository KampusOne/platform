import * as Location from 'expo-location';
import {api} from './api';
const sent=new Map<string,{latitude:number;longitude:number;at:number}>();
export async function shareAgentLocation(profileId:string,requestPermission=true){
 const permission=requestPermission?await Location.requestForegroundPermissionsAsync():await Location.getForegroundPermissionsAsync();
 if(permission.status!==Location.PermissionStatus.GRANTED)throw new Error('Allow location access to review rider routes.');
 const cached=await Location.getLastKnownPositionAsync({maxAge:requestPermission?15000:60000,requiredAccuracy:50});
 const point=cached??await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
 if(point.coords.accuracy===null||point.coords.accuracy>50||Math.abs(Date.now()-point.timestamp)>120000)throw new Error('Move to a clearer GPS signal and refresh your location. Accuracy within 50 metres is needed.');
 const previous=sent.get(profileId);
 if(!requestPermission&&previous){const radians=Math.PI/180,lat=(point.coords.latitude-previous.latitude)*radians,lon=(point.coords.longitude-previous.longitude)*radians;const distance=Math.hypot(lat,lon*Math.cos(point.coords.latitude*radians))*6371000;if(distance<15&&Date.now()-previous.at<90000)return point.timestamp;}
 await api('/v1/agents/location',{method:'PUT',body:JSON.stringify({profileId,latitude:point.coords.latitude,longitude:point.coords.longitude,accuracyMetres:point.coords.accuracy,capturedAt:new Date(point.timestamp).toISOString()})});
 if(sent.size>8)sent.delete(sent.keys().next().value!);
 sent.set(profileId,{latitude:point.coords.latitude,longitude:point.coords.longitude,at:Date.now()});
 return point.timestamp;
}
