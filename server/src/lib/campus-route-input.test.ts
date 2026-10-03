import {describe,expect,it} from 'vitest';
import {campusRouteInput} from './campus-route-input';

const base={campusId:'1d60dcae-760d-4de7-8443-6a870d9bbe1a',origin:[5.618838,6.398255]};
describe('manual campus route input',()=>{
  it('accepts two selected map points without a device location or destination place',()=>{
    expect(campusRouteInput.parse({...base,destination:[5.62,6.4]}).destination).toEqual([5.62,6.4]);
  });
  it('accepts sourced origin and destination places',()=>{
    expect(campusRouteInput.safeParse({...base,originPlaceId:base.campusId,destinationId:base.campusId}).success).toBe(true);
  });
  it('rejects missing and ambiguous destinations',()=>{
    expect(campusRouteInput.safeParse(base).success).toBe(false);
    expect(campusRouteInput.safeParse({...base,destination:[5.62,6.4],destinationId:base.campusId}).success).toBe(false);
  });
  it('rejects non-finite and out-of-world coordinates',()=>{
    for(const destination of [[NaN,6.4],[Infinity,6.4],[181,6.4],[5.62,-91]]){
      expect(campusRouteInput.safeParse({...base,destination}).success).toBe(false);
    }
  });
});
