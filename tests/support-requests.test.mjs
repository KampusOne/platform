import test from 'node:test';
import assert from 'node:assert/strict';
import { supportRequests } from '../mobile/src/lib/support-requests.ts';

test('support remains renderable with missing lists and older incomplete records', () => {
  for (const payload of [null, {}, { requests: null }, { requests: 'unavailable' }]) assert.deepEqual(supportRequests(payload), []);
  assert.deepEqual(supportRequests({ requests: [null, {}, { id: 'ticket', subject: 'Payment help', reply: {} }] }), [
    { id: 'ticket', subject: 'Payment help', reply: null, status: 'OPEN' },
  ]);
});

test('support preserves usable replies and states', () => {
  assert.deepEqual(supportRequests({ requests: [{ id: 'ticket', subject: 'Payment help', status: 'RESOLVED', reply: 'Your payment is confirmed.' }] }), [
    { id: 'ticket', subject: 'Payment help', status: 'RESOLVED', reply: 'Your payment is confirmed.' },
  ]);
});
