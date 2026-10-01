import {describe,it,expect} from 'vitest';
import {walkingRoute,type WalkPath} from './campus-routing';
const paths:WalkPath[]=[{node_ids:['a','b','c'],geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.601,6.3],[5.601,6.301]]},name:'Main road'}];
describe('campus path routing',()=>{
 it('follows real graph segments rather than cutting across landmarks',()=>{const route=walkingRoute(paths,[5.6,6.3],[5.601,6.301]);expect(route?.geometry.coordinates).toHaveLength(3);expect(route?.distanceMetres).toBeGreaterThan(210);});
 it('refuses disconnected networks and points outside coverage',()=>{expect(walkingRoute(paths,[5.5,6.3],[5.601,6.301])).toBeNull();expect(walkingRoute([...paths,{node_ids:['d','e'],geometry:{type:'LineString',coordinates:[[5.604,6.3],[5.605,6.3]]}}],[5.6,6.3],[5.605,6.3])).toBeNull();});
 it('excludes closed paths and inaccessible steps',()=>{expect(walkingRoute([{...paths[0]!,closed:true}],[5.6,6.3],[5.601,6.301])).toBeNull();expect(walkingRoute([{...paths[0]!,steps:true}],[5.6,6.3],[5.601,6.301],true)).toBeNull();});
});
