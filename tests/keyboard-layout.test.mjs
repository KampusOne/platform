import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardOverlap } from '../mobile/src/lib/keyboard-layout.ts';

test('edge-to-edge window loses only the part covered by the Android keyboard', () => {
  assert.equal(keyboardOverlap(0, 800, 490), 310);
  assert.equal(keyboardOverlap(24, 776, 490), 310);
});
test('adjustResize already removed the keyboard and must not shrink again', () => {
  assert.equal(keyboardOverlap(0, 490, 490), 0);
  assert.equal(keyboardOverlap(24, 466, 490), 0);
});
test('only the remaining overlap is applied after partial native resize', () => assert.equal(keyboardOverlap(0, 550, 490), 60));
test('a modal uses its own window position and size', () => {
  assert.equal(keyboardOverlap(120, 600, 490), 230);
  assert.equal(keyboardOverlap(120, 300, 490), 0);
});
test('keyboard close, floating keyboards, invalid measurements and rotation stay bounded', () => {
  assert.equal(keyboardOverlap(0, 800, null), 0);
  assert.equal(keyboardOverlap(0, 800, 900), 0);
  assert.equal(keyboardOverlap(0, 360, 220), 140);
  assert.equal(keyboardOverlap(400, 200, 300), 200);
  for (const values of [[NaN, 800, 490], [0, 800, Infinity], [0, -1, 490]]) assert.equal(keyboardOverlap(...values), 0);
});
