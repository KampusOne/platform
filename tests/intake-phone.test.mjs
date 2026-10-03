import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIntakePhone} from '../portal/lib/intake-phone.ts';

test('local, pasted, formatted and browser-autofilled Nigerian contacts store one calling code', () => {
  for (const input of ['08012345678', '8012345678', '2348012345678', '+2348012345678', '002348012345678', '+234 (0) 801 234 5678', '234 801 234 5678'])
    assert.equal(normalizeIntakePhone(input), '+2348012345678');
});
test('saved contacts with the formerly duplicated prefix are repaired without changing the national number', () => {
  for (const input of ['+2342348012345678', '+23408012345678', '+23423408012345678'])
    assert.equal(normalizeIntakePhone(input), '+2348012345678');
  assert.equal(normalizeIntakePhone(normalizeIntakePhone('+2342348012345678')), '+2348012345678');
});
test('country choice and explicitly pasted international contacts are respected', () => {
  assert.equal(normalizeIntakePhone('0241234567', '+233'), '+233241234567');
  assert.equal(normalizeIntakePhone('233241234567', '+233'), '+233241234567');
  assert.equal(normalizeIntakePhone('+44 (0) 7700 900123'), '+447700900123');
  assert.equal(normalizeIntakePhone('00447700900123'), '+447700900123');
  assert.equal(normalizeIntakePhone('12025550123', '+1'), '+12025550123');
  assert.equal(normalizeIntakePhone('+2290197000000'), '+2290197000000');
  assert.equal(normalizeIntakePhone('+353 85 123 4567'), '+353851234567');
});
test('editing and clearing do not erase a partial national number or add two prefixes', () => {
  assert.equal(normalizeIntakePhone(''), '');
  assert.equal(normalizeIntakePhone('+'), '+');
  assert.equal(normalizeIntakePhone('2348'), '+2342348');
  assert.equal(normalizeIntakePhone('241', '+233'), '+233241');
  assert.equal(normalizeIntakePhone('+233'), '+233');
});
test('overlong input is kept for validation rather than silently truncated into a different phone number', () => {
  const result = normalizeIntakePhone('+234801234567890123');
  assert.equal(result, '+234801234567890123');
  assert.equal(/^\+[1-9]\d{7,14}$/.test(result), false);
});
