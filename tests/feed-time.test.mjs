import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedTime, compactCount } from '../mobile/src/lib/feed-time.ts';
const now = Date.parse('2026-09-22T12:00:00Z');
const at = (seconds) => new Date(now - seconds * 1000).toISOString();
for (const [seconds, expected] of [[0,'now'],[59,'now'],[60,'1m'],[3599,'59m'],[3600,'1h'],[86399,'23h'],[86400,'1d'],[604799,'6d'],[604800,'1w'],[1209600,'2w'],[1814400,'3w'],[2419199,'3w']]) {
  test(`relative age ${seconds}s is ${expected}`, () => assert.equal(feedTime(at(seconds), now).text, expected));
}
test('switches to a calendar date at four weeks, not during the first week', () => {
  assert.equal(feedTime(at(2419200), now).text, '25 Aug');
  assert.match(feedTime('2025-09-22T12:00:00Z', now).text, /2025/);
});
test('invalid and future timestamps stay safe', () => {
  assert.equal(feedTime('invalid', now).text, 'Recently');
  assert.equal(feedTime(at(-100), now).text, 'now');
});
test('screen readers get expanded time labels', () => assert.equal(feedTime(at(7200), now).label, '2 hours ago'));
test('counts are finite and compact', () => {
  assert.equal(compactCount(-1), '0'); assert.equal(compactCount(Infinity), '0');
  assert.equal(compactCount(1200), '1.2K');
});
