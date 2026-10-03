import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFailureCode} from '../mobile/src/lib/render-diagnostics.ts';
test('render diagnostics identify failure classes without sending private exception text', () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'private-file@example.invalid')");
  assert.equal(renderFailureCode(error),'UI_TYPEERROR_MISSING_DATA');
  assert.equal(renderFailureCode(new Error('Objects are not valid as a React child: private-address')),'UI_ERROR_INVALID_CHILD');
  assert.equal(renderFailureCode(new RangeError('Invalid time value')),'UI_RANGEERROR_DATE');
  assert.equal(renderFailureCode(new Error('private prompt, URL and account')),'UI_ERROR_UNKNOWN');
});
