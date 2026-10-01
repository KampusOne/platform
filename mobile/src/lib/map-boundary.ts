type Position=[number,number];
export type CampusBoundary={type:'Polygon'|'MultiPolygon';coordinates:number[][][]|number[][][][]};
function inRing(point:Position,ring:number[][]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i]!,b=ring[j]!;if((a[1]!>point[1])!==(b[1]!>point[1])&&point[0]<(b[0]!-a[0]!)*(point[1]-a[1]!)/(b[1]!-a[1]!)+a[0]!)inside=!inside;}return inside;}
export function insideCampusBoundary(point:Position,boundary:CampusBoundary){const polygons=boundary.type==='Polygon'?[boundary.coordinates as number[][][]]:boundary.coordinates as number[][][][];return polygons.some(p=>p[0]&&inRing(point,p[0])&&!p.slice(1).some(h=>inRing(point,h)));}
