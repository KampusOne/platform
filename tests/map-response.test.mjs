import test from 'node:test';
import assert from 'node:assert/strict';
import {readCampusRoute} from '../mobile/src/lib/map-response.ts';
const route = {distanceMetres:420,durationSeconds:330,geometry:{type:'LineString',coordinates:[[5.61,6.39],[5.62,6.4]]},notice:null,instructions:['Walk to the next junction.']};
test('invalid directions become a retryable message before map or text rendering', () => {
  for (const invalid of [null,{}, {...route,distanceMetres:NaN},{...route,durationSeconds:-1},{...route,geometry:{type:'LineString',coordinates:[[5.61,6.39],null]}},{...route,geometry:{type:'LineString',coordinates:[[500,6.39],[5.62,6.4]]}}])
    assert.throws(() => readCampusRoute(invalid), /directions could not be read/);
  assert.deepEqual(readCampusRoute({...route,notice:{private:'data'},instructions:[{},'Walk to the next junction.',null]}),route);
});
