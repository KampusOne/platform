import type {CampusRouteResponse} from './map-response';
type Point=[number,number];
const radius=6371000,rad=Math.PI/180;
function length(a:Point,b:Point){const x=(b[0]-a[0])*rad*Math.cos((a[1]+b[1])*rad/2),y=(b[1]-a[1])*rad;return Math.hypot(x,y)*radius;}
/** Project onto the existing path; GPS updates do not request a new route. */
export function routeProgress(route:CampusRouteResponse,position:Point,previousMetres=0){
 const points=route.geometry.coordinates;let total=0,nearest=Infinity,progress=0,segment=0,projected:Point=points[0]!;
 for(let i=1;i<points.length;i++){
  const a=points[i-1]!,b=points[i]!,scale=Math.cos(position[1]*rad),dx=(b[0]-a[0])*scale,dy=b[1]-a[1],denominator=dx*dx+dy*dy;
  const t=denominator?Math.max(0,Math.min(1,((position[0]-a[0])*scale*dx+(position[1]-a[1])*dy)/denominator)):0;
  const point:Point=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=length(point,position),span=length(a,b);
  // A nearby later crossing must not jump a walker far ahead on the route.
  const along=total+t*span;
  if(distance<nearest&&along>=previousMetres-20&&(previousMetres===0||along<=previousMetres+150)){nearest=distance;progress=along;segment=i;projected=point;}
  total+=span;
 }
 if(!Number.isFinite(nearest))return {route,progressMetres:previousMetres,offPathMetres:Infinity};
 if(progress<previousMetres)return {route:null,progressMetres:previousMetres,offPathMetres:nearest};
 const remaining=Math.max(0,total-progress),ratio=total?remaining/total:0;
 const coordinates=[projected,...points.slice(segment)];if(coordinates.length<2)coordinates.push(projected);
 return {progressMetres:progress,offPathMetres:nearest,route:{...route,distanceMetres:Math.round(route.distanceMetres*ratio),durationSeconds:Math.ceil(route.durationSeconds*ratio),geometry:{type:'LineString' as const,coordinates}}};
}
