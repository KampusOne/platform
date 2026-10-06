import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlayDistribution} from '../mobile/src/lib/digital-billing-policy.ts';
test('only the explicitly configured Play Android bundle uses consumption-only digital plans',()=>{
  assert.equal(isPlayDistribution('android','play'),true);
  for(const [platform,distribution] of [['android',undefined],['android','direct'],['web','play'],['ios','play']])
    assert.equal(isPlayDistribution(platform,distribution),false);
});
