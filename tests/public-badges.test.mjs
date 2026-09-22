import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPublicBadge } from '../mobile/src/lib/public-badges.ts';
test('legacy verified profiles retain their badge', () => assert.equal(hasPublicBadge({ verification_status: 'VERIFIED' }), true));
test('explicit removal overrides a legacy badge without changing identity status', () => {
  const profile = { verification_status: 'VERIFIED', public_badge_verified: false };
  assert.equal(hasPublicBadge(profile), false); assert.equal(profile.verification_status, 'VERIFIED');
});
test('explicit assignment does not require changing identity status', () => {
  const profile = { verification_status: 'UNVERIFIED', public_badge_verified: true };
  assert.equal(hasPublicBadge(profile), true); assert.equal(profile.verification_status, 'UNVERIFIED');
});
test('missing profiles and unverified accounts never acquire a badge', () => {
  for (const value of [null, undefined, {}, { verification_status: 'PENDING' }, { public_badge_verified: null }]) assert.equal(hasPublicBadge(value), false);
});
