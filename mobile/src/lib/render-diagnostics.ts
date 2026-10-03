/** Diagnostic codes contain no error text, account ids, file names or URLs. */
export function renderFailureCode(error: Error) {
  const name = ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name) ? error.name.toUpperCase() : 'ERROR';
  const message = typeof error.message === 'string' ? error.message : '';
  const category = /Rendered (more|fewer) hooks|Invalid hook call|React error #(300|310|311)/i.test(message) ? 'HOOKS' :
    /Objects are not valid as a React child|React error #31\b/i.test(message) ? 'INVALID_CHILD' :
    /Cannot read propert|undefined is not an object|null is not an object/i.test(message) ? 'MISSING_DATA' :
    /Invalid time value|Invalid Date/i.test(message) ? 'DATE' : 'UNKNOWN';
  return `UI_${name}_${category}`;
}
