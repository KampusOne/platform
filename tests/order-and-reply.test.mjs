import assert from 'node:assert/strict';
import test from 'node:test';
import { startsReplySwipe, completesReplySwipe } from '../mobile/src/lib/swipe-reply.ts';
import { orderStages, orderStatusLabel, orderDate } from '../mobile/src/lib/order-presentation.ts';

test('a left swipe replies on either side; right and vertical swipes never reply', () => {
  assert.equal(startsReplySwipe(-18, 2), true);
  assert.equal(completesReplySwipe(-60, 2), true);
  for (const [dx, dy] of [[60, 2], [-20, 1], [-60, 70], [0, -70]]) assert.equal(completesReplySwipe(dx, dy), false);
  assert.equal(completesReplySwipe(-60, 0, true), false);
});
test('ready delivery is not presented as already on the way', () => {
  assert.equal(orderStages('READY', false)[2].complete, false);
  assert.equal(orderStages('IN_DELIVERY', false)[2].complete, true);
  assert.equal(orderStages('READY', true)[2].complete, true);
});
test('only a delivered order completes the final stage', () => {
  for (const state of ['PENDING_PAYMENT', 'PAID', 'READY', 'IN_DELIVERY', 'DISPUTED', 'PAYMENT_FAILED']) assert.equal(orderStages(state, true)[3].complete, false);
  assert.ok(orderStages('DELIVERED', true).every(stage => stage.complete));
  assert.equal(orderStatusLabel('DELIVERED', true), 'Collected');
  assert.equal(orderStatusLabel('DISPUTED'), 'Under review');
  assert.equal(orderDate('invalid'), '');
});
