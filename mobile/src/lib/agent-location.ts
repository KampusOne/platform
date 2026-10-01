import * as Location from 'expo-location';
import {api} from './api';
export async function shareAgentLocation(profileId:string,requestPermission=true){
 const permission=requestPermission?await Location.requestForegroundPermissionsAsync():await Location.getForegroundPermissionsAsync();
 if(permission.status!==Location.PermissionStatus.GRANTED)throw new Error('Allow location access to review rider routes.');
 const cached=await Location.getLastKnownPositionAsync({maxAge:15000,requiredAccuracy:50});
 const point=cached??await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
 if(point.coords.accuracy===null||point.coords.accuracy>50||Math.abs(Date.now()-point.timestamp)>120000)throw new Error('Move to a clearer GPS signal and refresh your location. Accuracy within 50 metres is needed.');
 await api('/v1/agents/location',{method:'PUT',body:JSON.stringify({profileId,latitude:point.coords.latitude,longitude:point.coords.longitude,accuracyMetres:point.coords.accuracy,capturedAt:new Date(point.timestamp).toISOString()})});
 return point.timestamp;
}
