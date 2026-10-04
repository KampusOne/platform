import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFailureCode, renderFailureFingerprint} from '../mobile/src/lib/render-diagnostics.ts';
test('render diagnostics identify failure classes without sending private exception text', () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'private-file@example.invalid')");
  assert.equal(renderFailureCode(error),'UI_TYPEERROR_MISSING_DATA');
  assert.equal(renderFailureCode(new Error('Objects are not valid as a React child: private-address')),'UI_ERROR_INVALID_CHILD');
  assert.equal(renderFailureCode(new RangeError('Invalid time value')),'UI_RANGEERROR_DATE');
  assert.equal(renderFailureCode(new Error('private prompt, URL and account')),'UI_ERROR_UNKNOWN');
  assert.equal(renderFailureCode(new Error('Cannot use shared object that was already released')),'UI_ERROR_NATIVE_RELEASED');
  assert.equal(renderFailureCode(new Error('Cannot find native module ExpoAudio')),'UI_ERROR_NATIVE_MODULE');
  assert.equal(renderFailureCode(new Error('Text strings must be rendered within a <Text> component')),'UI_ERROR_TEXT_CHILD');
});

test('component fingerprints group causes and exclude private exception text and stack paths', () => {
  const first = new Error('private-person@example.invalid at https://private.example/document.txt');
  const second = new Error('another-person@example.invalid');
  const stack = '\n    at VoicePlayback (https://private.example/filename.tsx:12:4)\n    at Conversation (address:7:3)';
  const fingerprint = renderFailureFingerprint(first, stack);
  assert.match(fingerprint, /^UI_ERROR_UNKNOWN_[A-F0-9]{8}$/);
  assert.equal(fingerprint, renderFailureFingerprint(second, stack.replace('filename', 'another')));
  assert.notEqual(fingerprint, renderFailureFingerprint(first, '\n    at VideoViewer (private:12:4)'));
  assert.equal(/private|person|http|filename/i.test(fingerprint), false);
  assert.ok(fingerprint.length <= 60);
});
