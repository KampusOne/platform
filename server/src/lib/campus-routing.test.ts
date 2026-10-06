import {describe,it,expect} from 'vitest';
import {walkingRoute,walkingAlternatives,type WalkPath} from './campus-routing';
const paths:WalkPath[]=[{node_ids:['a','b','c'],geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.601,6.3],[5.601,6.301]]},name:'Main road'}];
describe('campus path routing',()=>{
 it('follows real graph segments rather than cutting across landmarks',()=>{const route=walkingRoute(paths,[5.6,6.3],[5.601,6.301]);expect(route?.geometry.coordinates).toHaveLength(3);expect(route?.distanceMetres).toBeGreaterThan(210);});
 it('refuses disconnected networks and points outside coverage',()=>{expect(walkingRoute(paths,[5.5,6.3],[5.601,6.301])).toBeNull();expect(walkingRoute([...paths,{node_ids:['d','e'],geometry:{type:'LineString',coordinates:[[5.604,6.3],[5.605,6.3]]}}],[5.6,6.3],[5.605,6.3])).toBeNull();});
 it('snaps to the middle of long mapped segments without travelling back to a vertex',()=>{const p:WalkPath={node_ids:['x','y'],geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.61,6.3]]}};const route=walkingRoute([p],[5.603,6.3],[5.604,6.3]);expect(route?.distanceMetres).toBeGreaterThan(100);expect(route?.distanceMetres).toBeLessThan(120);expect(route?.originSnapMetres).toBe(0);});
 it('does not connect crossing paths without a shared OSM node',()=>{expect(walkingRoute([{node_ids:['a','b'],geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.61,6.3]]}},{node_ids:['c','d'],geometry:{type:'LineString',coordinates:[[5.605,6.295],[5.605,6.305]]}}],[5.601,6.3],[5.605,6.304])).toBeNull();});
 it('respects one-way road direction including mid-segment snaps',()=>{const road:WalkPath={node_ids:['z','a'],oneway:1,geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.61,6.3]]}};expect(walkingRoute([road],[5.603,6.3],[5.607,6.3],false,true)?.distanceMetres).toBeGreaterThan(400);expect(walkingRoute([road],[5.607,6.3],[5.603,6.3],false,true)).toBeNull();expect(walkingRoute([road],[5.607,6.3],[5.603,6.3])).not.toBeNull();});
 it('separates mapped distance from unverified access between a point and the road',()=>{const r=walkingRoute(paths,[5.6,6.3002],[5.601,6.3012]);expect(r?.originSnapMetres).toBeGreaterThan(0);expect(r?.networkDistanceMetres).toBeLessThan(r!.distanceMetres);});
 it('excludes closed paths and inaccessible steps',()=>{expect(walkingRoute([{...paths[0]!,closed:true}],[5.6,6.3],[5.601,6.301])).toBeNull();expect(walkingRoute([{...paths[0]!,steps:true}],[5.6,6.3],[5.601,6.301],true)).toBeNull();});
 it('identifies the actual path endpoints separately from an approximate map pin',()=>{const r=walkingRoute(paths,[5.6,6.3002],[5.601,6.3012]);expect(r?.originPathCoordinate).toEqual(r?.geometry.coordinates[0]);expect(r?.destinationPathCoordinate).toEqual(r?.geometry.coordinates.at(-1));expect(r?.originPathCoordinate).not.toEqual([5.6,6.3002]);});
 it('keeps repeated path instructions when the walker leaves and later rejoins the path',()=>{const p:WalkPath[]=[{node_ids:['a','b'],geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.601,6.3]]},name:'Main path'},{node_ids:['b','c'],geometry:{type:'LineString',coordinates:[[5.601,6.3],[5.601,6.301]]},name:'Library path'},{node_ids:['c','d'],geometry:{type:'LineString',coordinates:[[5.601,6.301],[5.602,6.301]]},name:'Main path'}];expect(walkingRoute(p,[5.6,6.3],[5.602,6.301])?.instructions).toEqual(['Main path','Library path','Main path']);});
 it('offers bounded real detours in distance order without opening a private shortcut',()=>{
  const graph:WalkPath[]=[
   {node_ids:['a','b','c','d','e'],name:'Main walk',geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.601,6.3],[5.602,6.3],[5.603,6.3],[5.604,6.3]]}},
   {node_ids:['b','u','v','d'],name:'Library walk',geometry:{type:'LineString',coordinates:[[5.601,6.3],[5.601,6.301],[5.603,6.301],[5.603,6.3]]}},
   {node_ids:['b','z','d'],access:'private',name:'Private courtyard',geometry:{type:'LineString',coordinates:[[5.601,6.3],[5.602,6.3001],[5.603,6.3]]}},
  ];
  const choices=walkingAlternatives(graph,[5.6,6.3],[5.604,6.3]);expect(choices).toHaveLength(2);
  expect(choices[0]!.distanceMetres).toBeLessThan(choices[1]!.distanceMetres);expect(choices[1]!.instructions).toContain('Library walk');
  expect(choices.every(c=>!c.instructions.includes('Private courtyard'))).toBe(true);
 });

});
