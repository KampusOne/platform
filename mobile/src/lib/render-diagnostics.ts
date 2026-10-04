/** Diagnostic codes contain no error text, account ids, file names or URLs. */
export function renderFailureCode(error: Error) {
  const name = ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name) ? error.name.toUpperCase() : 'ERROR';
  const message = typeof error.message === 'string' ? error.message : '';
  const category = /shared object.*(?:already released|no longer available)|native object.*released/i.test(message) ? 'NATIVE_RELEASED' :
    /Cannot find native module|native module.*(?:not found|unavailable)|NativeEventEmitter/i.test(message) ? 'NATIVE_MODULE' :
    /Text strings must be rendered within a <Text>|Unexpected text node/i.test(message) ? 'TEXT_CHILD' :
    /Rendered (more|fewer) hooks|Invalid hook call|React error #(300|310|311)/i.test(message) ? 'HOOKS' :
    /Objects are not valid as a React child|React error #31\b/i.test(message) ? 'INVALID_CHILD' :
    /Cannot read propert|undefined is not an object|null is not an object/i.test(message) ? 'MISSING_DATA' :
    /Invalid time value|Invalid Date/i.test(message) ? 'DATE' : 'UNKNOWN';
  return `UI_${name}_${category}`;
}

/** Group matching component failures without uploading error text or paths. */
export function renderFailureFingerprint(error: Error, componentStack = '') {
  const code = renderFailureCode(error);
  const stack = componentStack || (typeof error.stack === 'string' ? error.stack : '');
  const components = [...stack.matchAll(/^\s*(?:at|in) ([A-Za-z_$][A-Za-z0-9_$.]{0,79})(?:\s|\()/gm)]
    .slice(0, 12).map((match) => match[1]).join('|');
  let hash = 2166136261;
  for (const char of `${code}|${components}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${code}_${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}
