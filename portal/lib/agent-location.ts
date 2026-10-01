import {portalApi} from './api';
export async function shareAgentLocation(profileId:string){
 if(!profileId||!navigator.geolocation)throw new Error('Location is unavailable in this browser. Use your phone to review rider routes.');
 const point=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Allow location access and refresh before reviewing a rider route.')),{enableHighAccuracy:true,timeout:20000,maximumAge:15000}));
 if(point.coords.accuracy>50||Math.abs(Date.now()-point.timestamp)>120000)throw new Error('Refresh your GPS position with accuracy within 50 metres.');
 await portalApi('/v1/agents/location',{method:'PUT',body:JSON.stringify({profileId,latitude:point.coords.latitude,longitude:point.coords.longitude,accuracyMetres:point.coords.accuracy,capturedAt:new Date(point.timestamp).toISOString()})});
}
