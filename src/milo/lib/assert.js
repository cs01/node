// assert module — core assertion functions with diagnostic error messages
'use strict';

const { inspect, format } = require('util');

// inspect for simple display (single-line, matches util.inspect)
function _inspectSimple(val) {
  return inspect(val);
}

// inspect for multi-line diff display (used in +/- formatted diffs)
function _inspect(val) {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'string') return inspect(val);
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'bigint') return `${val}n`;
  if (typeof val === 'symbol') return val.toString();
  if (typeof val === 'function') {
    return val.name ? `[Function: ${val.name}]` : '[Function (anonymous)]';
  }
  if (val instanceof RegExp) return val.toString();
  if (val instanceof Error) return `[${val.name || 'Error'}: ${val.message}]`;
  if (val instanceof Date) return val.toISOString();
  // for objects/arrays, use multi-line inspect
  return _inspectObj(val, new Set(), 0);
}

// multi-line inspect for objects/arrays with circular detection
function _inspectObj(val, seen, depth) {
  if (val === null || val === undefined) return String(val);
  if (typeof val !== 'object' && typeof val !== 'function') return _inspect(val);
  if (typeof val === 'function') {
    return val.name ? `[Function: ${val.name}]` : '[Function (anonymous)]';
  }
  if (val instanceof RegExp) return val.toString();
  if (val instanceof Date) return val.toISOString();
  if (val instanceof Error) return `[${val.name || 'Error'}: ${val.message}]`;

  if (seen.has(val)) return '[Circular *1]';

  const isCircular = depth === 0 && _hasCircular(val);
  const newSeen = new Set(seen);
  newSeen.add(val);

  const indent = '  '.repeat(depth + 1);
  const closingIndent = '  '.repeat(depth);

  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const items = val.map(v => `${indent}${_inspectObj(v, newSeen, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${closingIndent}]`;
  }

  // check for Arguments
  const tag = Object.prototype.toString.call(val);
  const isArguments = tag === '[object Arguments]';
  const prefix = isArguments ? '[Arguments] ' : '';

  const keys = Object.keys(val);
  // only include enumerable symbol keys
  const symbolKeys = Object.getOwnPropertySymbols(val).filter(s => {
    const desc = Object.getOwnPropertyDescriptor(val, s);
    return desc && desc.enumerable;
  });
  const allKeys = [...keys, ...symbolKeys];

  if (allKeys.length === 0) return `${prefix}{}`;

  const entries = allKeys.map(k => {
    const keyStr = typeof k === 'symbol' ? k.toString() : `${k}`;
    const display = typeof k === 'symbol' ? keyStr :
      (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(keyStr) ? keyStr : `'${keyStr}'`);
    const v = val[k];
    return `${indent}${display}: ${_inspectObj(v, newSeen, depth + 1)}`;
  });

  const circPrefix = isCircular ? '<ref *1> ' : '';
  return `${circPrefix}${prefix}{\n${entries.join(',\n')}\n${closingIndent}}`;
}

function _hasCircular(obj) {
  const seen = new Set();
  function walk(v) {
    if (v === null || typeof v !== 'object') return false;
    if (seen.has(v)) return true;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) { if (walk(v[i])) return true; }
    } else {
      for (const k of Object.keys(v)) { if (walk(v[k])) return true; }
    }
    seen.delete(v);
    return false;
  }
  return walk(obj);
}

// create a diff between two inspected values
function _createDiff(actual, expected) {
  const aLines = _inspect(actual).split('\n');
  const bLines = _inspect(expected).split('\n');

  // both single line — simple !== format, use util.inspect for exact matching
  if (aLines.length === 1 && bLines.length === 1) {
    return `\n${_inspectSimple(actual)} !== ${_inspectSimple(expected)}\n`;
  }

  // multi-line diff using LCS
  let identicalPrefix = 0;
  while (identicalPrefix < aLines.length && identicalPrefix < bLines.length &&
         aLines[identicalPrefix] === bLines[identicalPrefix]) {
    identicalPrefix++;
  }

  let identicalSuffix = 0;
  while (identicalSuffix < aLines.length - identicalPrefix &&
         identicalSuffix < bLines.length - identicalPrefix &&
         aLines[aLines.length - 1 - identicalSuffix] === bLines[bLines.length - 1 - identicalSuffix]) {
    identicalSuffix++;
  }

  const aStart = identicalPrefix;
  const aEnd = aLines.length - identicalSuffix;
  const bStart = identicalPrefix;
  const bEnd = bLines.length - identicalSuffix;
  const skipThreshold = 4;
  let needSkipHeader = false;
  const result = [];

  if (identicalPrefix > skipThreshold) {
    needSkipHeader = true;
    for (let i = 0; i < 3; i++) result.push(`  ${aLines[i]}`);
    result.push('...');
    const contextStart = Math.max(3, identicalPrefix - 1);
    for (let i = contextStart; i < identicalPrefix; i++) result.push(`  ${aLines[i]}`);
  } else {
    for (let i = 0; i < identicalPrefix; i++) result.push(`  ${aLines[i]}`);
  }

  // LCS diff for the middle section
  const aMid = aLines.slice(aStart, aEnd);
  const bMid = bLines.slice(bStart, bEnd);
  const lcs = _lcs(aMid, bMid);
  let ai = 0, bi = 0;
  for (const entry of lcs) {
    while (ai < entry.ai) { result.push(`+ ${aMid[ai++]}`); }
    while (bi < entry.bi) { result.push(`- ${bMid[bi++]}`); }
    result.push(`  ${aMid[ai++]}`);
    bi++;
  }
  while (ai < aMid.length) { result.push(`+ ${aMid[ai++]}`); }
  while (bi < bMid.length) { result.push(`- ${bMid[bi++]}`); }

  // suffix
  const suffixStart = aLines.length - identicalSuffix;
  for (let i = suffixStart; i < aLines.length; i++) result.push(`  ${aLines[i]}`);

  const header = needSkipHeader ? '... Skipped lines\n' : '';
  return `${header}\n${result.join('\n')}\n`;
}

// longest common subsequence of lines
function _lcs(a, b) {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return [];
  const dp = Array(m + 1);
  for (let i = 0; i <= m; i++) { dp[i] = new Array(n + 1).fill(0); }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift({ ai: i - 1, bi: j - 1 });
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) { i--; }
    else { j--; }
  }
  return result;
}

// comparison diff for throws() object matching
function _createComparisonDiff(actual, expected) {
  const keys = Object.keys(expected).sort();
  const lines = ['  Comparison {'];
  for (const key of keys) {
    const aVal = actual[key];
    const eVal = expected[key];
    const aStr = _inspect(aVal);
    const eStr = _inspect(eVal);
    if (expected[key] instanceof RegExp) {
      if (!expected[key].test(actual[key])) {
        lines.push(`+   ${key}: ${aStr},`);
        lines.push(`-   ${key}: ${eStr},`);
      } else {
        lines.push(`    ${key}: ${aStr},`);
      }
    } else if (!_deepEqual(aVal, eVal, true)) {
      if (eVal === undefined && !(key in actual)) {
        lines.push(`-   ${key}: ${eStr},`);
      } else {
        lines.push(`+   ${key}: ${aStr},`);
        lines.push(`-   ${key}: ${eStr},`);
      }
    } else {
      lines.push(`    ${key}: ${aStr},`);
    }
  }
  // remove trailing comma from last line
  if (lines.length > 1) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.replace(/,$/, '');
  }
  lines.push('  }');
  return lines.join('\n');
}

function _invalidArgTypeHelper(val) {
  if (val === undefined) return ' Received undefined';
  if (val === null) return ' Received null';
  const t = typeof val;
  if (t === 'function') return ` Received function ${val.name || '(anonymous)'}`;
  if (t === 'object') {
    const name = val.constructor ? val.constructor.name : 'Object';
    if (name === 'Object') return ` Received an instance of Object`;
    return ` Received an instance of ${name}`;
  }
  if (t === 'string') return ` Received type ${t} ('${val}')`;
  if (t === 'symbol') return ` Received type ${t} (${val.toString()})`;
  return ` Received type ${t} (${val})`;
}

// handle printf-like format strings and function messages
function _processMessage(message, actual, expected, extraArgs) {
  if (typeof message === 'function') {
    const result = message(actual, expected);
    if (typeof result !== 'string') return undefined; // signal to use generated message
    return result;
  }
  if (extraArgs && extraArgs.length > 0) {
    return format(message, ...extraArgs);
  }
  return message;
}

class AssertionError extends Error {
  constructor(options) {
    if (typeof options !== 'object' || options === null) {
      const err = new TypeError(
        'The "options" argument must be of type object.' +
        _invalidArgTypeHelper(options)
      );
      err.code = 'ERR_INVALID_ARG_TYPE';
      throw err;
    }
    const message = options.message || _createDefaultMessage(options);
    super(message);
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator;
    this.generatedMessage = 'generatedMessage' in options ? options.generatedMessage : !options.message;
    this.code = 'ERR_ASSERTION';
  }
}

function _createDefaultMessage(options) {
  const { actual, expected, operator } = options;
  if (operator === 'strictEqual' || operator === 'deepStrictEqual') {
    return _createEqualMessage(actual, expected, operator);
  }
  if (operator === 'notStrictEqual') {
    return _createNotEqualMessage(actual, 'strictly unequal');
  }
  if (operator === 'notDeepStrictEqual') {
    return _createNotDeepEqualMessage(actual);
  }
  return `${_inspect(actual)} ${operator} ${_inspect(expected)}`;
}

function _createEqualMessage(actual, expected, operator) {
  // strictEqual with two objects
  if (operator === 'strictEqual' && typeof actual === 'object' && typeof expected === 'object' &&
      actual !== null && expected !== null) {
    if (_deepEqual(actual, expected, true)) {
      return `Values have same structure but are not reference-equal:\n\n${_inspect(actual)}\n`;
    }
    // different objects — reference-equal message with diff
    const diff = _createDiff(actual, expected);
    return `Expected "actual" to be reference-equal to "expected":\n+ actual - expected\n${diff}`;
  }

  const header = operator === 'deepStrictEqual'
    ? 'Expected values to be strictly deep-equal:'
    : 'Expected values to be strictly equal:';

  const diff = _createDiff(actual, expected);
  // multi-line diffs use +/- prefix markers; simple !== diffs don't need the header
  const isMultiLineDiff = diff.split('\n').some(l => /^[+-] /.test(l));
  if (isMultiLineDiff) {
    return `${header}\n+ actual - expected\n${diff}`;
  }
  return `${header}\n${diff}`;
}

function _createNotEqualMessage(actual, relation) {
  const inspected = _inspect(actual);
  if (inspected.length < 50) return `Expected "actual" to be ${relation} to: ${inspected}`;
  return `Expected "actual" to be ${relation} to:\n\n${inspected}`;
}

function _createNotDeepEqualMessage(actual) {
  const inspected = _inspect(actual);
  const lines = inspected.split('\n');
  if (lines.length > 50) {
    return `Expected "actual" not to be strictly deep-equal to:\n\n${lines.slice(0, 50).join('\n')}\n...\n`;
  }
  return `Expected "actual" not to be strictly deep-equal to:\n\n${inspected}\n`;
}

function _throwGenerated(actual, expected, message, operator) {
  // throw with generatedMessage=true even though we're providing a message
  const err = new AssertionError({ actual, expected, operator });
  err.message = message;
  err.generatedMessage = true;
  throw err;
}

function assert(value, message) {
  if (arguments.length === 0) {
    _throwGenerated(undefined, undefined, 'No value argument passed to `assert.ok()`', '==');
    return;
  }
  if (!value) {
    if (message instanceof Error) throw message;
    fail(value, true, message, '==', assert);
  }
}

function fail(actual, expected, message, operator) {
  if (arguments.length === 0 || (arguments.length === 1 && typeof actual === 'undefined')) {
    message = 'Failed';
  } else if (arguments.length === 1) {
    message = actual; actual = undefined;
  }
  if (message instanceof Error) throw message;
  const genMsg = !message && operator && operator !== 'fail';
  const msg = message || (genMsg ? _createDefaultMessage({ actual, expected, operator }) : 'Failed');
  throw new AssertionError({ actual, expected, message: msg, operator: operator || 'fail', generatedMessage: !message });
}

function ok(value, message) {
  if (arguments.length === 0) {
    _throwGenerated(undefined, undefined, 'No value argument passed to `assert.ok()`', '==');
    return;
  }
  if (!value) {
    if (message instanceof Error) throw message;
    fail(value, true, message, '==', ok);
  }
}

function strictEqual(actual, expected, message, ...extra) {
  if (!Object.is(actual, expected)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      if (typeof message === 'function') {
        // function message — append diff info
        const genMsg = _createEqualMessage(actual, expected, 'strictEqual');
        const diffPart = genMsg.replace('Expected values to be strictly equal:\n', '');
        fail(actual, expected, `${processed}\n${diffPart}`, 'strictEqual');
      } else {
        fail(actual, expected, processed, 'strictEqual');
      }
      return;
    }
    if (typeof message === 'string') {
      // custom string message — append diff
      const genMsg = _createEqualMessage(actual, expected, 'strictEqual');
      const diffPart = genMsg.replace('Expected values to be strictly equal:\n', '');
      fail(actual, expected, `${message}\n${diffPart}`, 'strictEqual');
      return;
    }
    fail(actual, expected, undefined, 'strictEqual');
  }
}

function notStrictEqual(actual, expected, message, ...extra) {
  if (Object.is(actual, expected)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, 'notStrictEqual');
      return;
    }
    fail(actual, expected, message, 'notStrictEqual');
  }
}

function equal(actual, expected, message, ...extra) {
  // NaN == NaN should be true
  if (typeof actual === 'number' && typeof expected === 'number' && isNaN(actual) && isNaN(expected)) return;
  if (actual != expected) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, '==');
      return;
    }
    fail(actual, expected, message, '==');
  }
}

function notEqual(actual, expected, message, ...extra) {
  // NaN != NaN should be false (they ARE equal)
  if (typeof actual === 'number' && typeof expected === 'number' && isNaN(actual) && isNaN(expected)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, '!=');
      return;
    }
    fail(actual, expected, message, '!=');
    return;
  }
  if (actual == expected) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, '!=');
      return;
    }
    fail(actual, expected, message, '!=');
  }
}

function _deepEqual(a, b, strict) {
  if (strict ? Object.is(a, b) : a == b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  // check toString tag to distinguish Arguments from plain objects
  const tagA = Object.prototype.toString.call(a);
  const tagB = Object.prototype.toString.call(b);
  if (tagA !== tagB) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) { if (!_deepEqual(a[i], b[i], strict)) return false; }
    return true;
  }

  // Error comparison: compare message and name (non-enumerable props)
  if (a instanceof Error) {
    if (!(b instanceof Error)) return false;
    if (a.message !== b.message || a.name !== b.name) return false;
  }

  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return a.source === b.source && a.flags === b.flags;
  if (a instanceof Map) {
    if (b.size !== a.size) return false;
    for (const [k, v] of a) { if (!b.has(k) || !_deepEqual(v, b.get(k), strict)) return false; }
    return true;
  }
  if (a instanceof Set) {
    if (b.size !== a.size) return false;
    for (const v of a) { if (!b.has(v)) return false; }
    return true;
  }

  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) { if (!Object.prototype.hasOwnProperty.call(b, key) || !_deepEqual(a[key], b[key], strict)) return false; }
  return true;
}

function deepEqual(actual, expected, message, ...extra) {
  if (!_deepEqual(actual, expected, false)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, 'deepEqual');
      return;
    }
    fail(actual, expected, message, 'deepEqual');
  }
}

function deepStrictEqual(actual, expected, message, ...extra) {
  if (!_deepEqual(actual, expected, true)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      if (typeof message === 'function') {
        // function message — append diff
        const genMsg = _createEqualMessage(actual, expected, 'deepStrictEqual');
        const diffPart = genMsg.replace('Expected values to be strictly deep-equal:\n', '');
        fail(actual, expected, `${processed}\n${diffPart}`, 'deepStrictEqual');
      } else {
        fail(actual, expected, processed, 'deepStrictEqual');
      }
      return;
    }
    if (typeof message === 'string') {
      const genMsg = _createEqualMessage(actual, expected, 'deepStrictEqual');
      const diffPart = genMsg.replace('Expected values to be strictly deep-equal:\n', '');
      fail(actual, expected, `${message}\n${diffPart}`, 'deepStrictEqual');
      return;
    }
    fail(actual, expected, undefined, 'deepStrictEqual');
  }
}

function notDeepEqual(actual, expected, message, ...extra) {
  if (_deepEqual(actual, expected, false)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, 'notDeepEqual');
      return;
    }
    fail(actual, expected, message, 'notDeepEqual');
  }
}

function notDeepStrictEqual(actual, expected, message, ...extra) {
  if (_deepEqual(actual, expected, true)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      fail(actual, expected, processed, 'notDeepStrictEqual');
      return;
    }
    fail(actual, expected, message, 'notDeepStrictEqual');
  }
}

// partial deep equal: expected is a subset of actual
function _partialDeepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length < b.length) return false;
    for (let i = 0; i < b.length; i++) { if (!_partialDeepEqual(a[i], b[i])) return false; }
    return true;
  }
  for (const key of Object.keys(b)) {
    if (!Object.prototype.hasOwnProperty.call(a, key) || !_partialDeepEqual(a[key], b[key])) return false;
  }
  return true;
}

function partialDeepStrictEqual(actual, expected, message, ...extra) {
  if (!_partialDeepEqual(actual, expected)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, actual, expected, extra);
    if (processed !== undefined && processed !== message) {
      if (typeof message === 'function') {
        const genMsg = _createEqualMessage(actual, expected, 'deepStrictEqual');
        const diffPart = genMsg.replace('Expected values to be strictly deep-equal:\n', '');
        fail(actual, expected, `${processed}\n${diffPart}`, 'partialDeepStrictEqual');
      } else {
        fail(actual, expected, processed, 'partialDeepStrictEqual');
      }
      return;
    }
    if (typeof message === 'string') {
      const genMsg = _createEqualMessage(actual, expected, 'deepStrictEqual');
      const diffPart = genMsg.replace('Expected values to be strictly deep-equal:\n', '');
      fail(actual, expected, `${message}\n${diffPart}`, 'partialDeepStrictEqual');
      return;
    }
    fail(actual, expected, undefined, 'deepStrictEqual');
  }
}

function throws(fn, expected, message) {
  // validate fn is a function
  if (typeof fn !== 'function') {
    const err = new TypeError(
      'The "fn" argument must be of type function.' +
      _invalidArgTypeHelper(fn)
    );
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }

  if (typeof expected === 'string') { message = expected; expected = undefined; }

  // validate expected type
  if (expected !== undefined && typeof expected !== 'function' &&
      !(expected instanceof RegExp) &&
      (typeof expected !== 'object' || expected === null)) {
    const err = new TypeError(
      'The "error" argument must be of type function or ' +
      'an instance of Error, RegExp, or Object.' +
      _invalidArgTypeHelper(expected)
    );
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }

  // empty object check
  if (expected && typeof expected === 'object' && !(expected instanceof RegExp) &&
      !(expected instanceof Error) && typeof expected !== 'function' &&
      Object.keys(expected).length === 0) {
    const err = new TypeError("The argument 'error' may not be an empty object. Received {}");
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
  }

  let threw = false;
  let caught;
  try { fn(); } catch (e) {
    threw = true;
    caught = e;
  }

  // ambiguous argument check
  if (threw && typeof message === 'string' && expected === undefined) {
    if (typeof caught === 'string' && caught === message) {
      const err = new TypeError(
        'The "error/message" argument is ambiguous. ' +
        `The error "${caught}" is identical to the message.`
      );
      err.code = 'ERR_AMBIGUOUS_ARGUMENT';
      throw err;
    }
    if (caught instanceof Error && caught.message === message) {
      const err = new TypeError(
        'The "error/message" argument is ambiguous. ' +
        `The error message "${caught.message}" is identical to the message.`
      );
      err.code = 'ERR_AMBIGUOUS_ARGUMENT';
      throw err;
    }
  }

  if (threw && expected !== undefined) {
    if (expected instanceof RegExp) {
      if (!expected.test(String(caught))) {
        const err = new AssertionError({
          actual: caught,
          expected,
          operator: 'throws',
          message: `The input did not match the regular expression ${expected}. ` +
                   `Input:\n\n${_inspect(typeof caught === 'symbol' ? caught.toString() : String(caught))}\n`,
        });
        throw err;
      }
    } else if (typeof expected === 'function') {
      // Error constructors use instanceof; other functions are validators
      const isErrorCtor = expected === Error || expected === TypeError || expected === RangeError ||
        expected === SyntaxError || expected === ReferenceError || expected === URIError ||
        expected === EvalError || (expected.prototype instanceof Error);
      if (isErrorCtor) {
        if (!(caught instanceof expected)) {
          const expectedName = expected.name || 'unknown';
          const actualName = caught && caught.constructor ? caught.constructor.name : typeof caught;
          const errMsg = caught instanceof Error ? caught.message : String(caught);
          if (message) {
            fail(caught, expected, message, 'throws');
          } else {
            // generated message — set generatedMessage=true
            const genMsg = `The error is expected to be an instance of "${expectedName}". ` +
              `Received "${actualName}"\n\nError message:\n\n${errMsg}`;
            const err = new AssertionError({ actual: caught, expected, operator: 'throws' });
            err.message = genMsg;
            err.generatedMessage = true;
            throw err;
          }
        }
      } else {
        // validation function
        const r = expected(caught);
        if (r !== true) {
          fail(caught, expected, message, 'throws');
        }
      }
    } else if (expected instanceof Error) {
      // Error instance — compare message and name properties
      const keys = ['message', 'name'];
      const mismatched = [];
      for (const key of keys) {
        if (!_deepEqual(caught[key], expected[key], true)) {
          mismatched.push(key);
        }
      }
      if (mismatched.length > 0) {
        if (message) {
          fail(caught, expected, message, 'throws');
        } else {
          const genMsg = `Expected values to be strictly deep-equal:\n+ actual - expected\n\n${_createComparisonDiff(caught, { message: expected.message, name: expected.name })}\n`;
          const err = new AssertionError({ actual: caught, expected, operator: 'throws' });
          err.message = genMsg;
          err.generatedMessage = true;
          throw err;
        }
      }
    } else if (typeof expected === 'object') {
      const keys = Object.keys(expected);
      const mismatched = [];
      for (const key of keys) {
        if (expected[key] instanceof RegExp) {
          if (!expected[key].test(caught[key])) mismatched.push(key);
        } else if (!_deepEqual(caught[key], expected[key], true)) {
          mismatched.push(key);
        }
      }
      if (mismatched.length > 0) {
        if (message) {
          fail(caught, expected, message, 'throws');
        } else {
          const diffStr = _createComparisonDiff(caught, expected);
          const genMsg = `Expected values to be strictly deep-equal:\n+ actual - expected\n\n${diffStr}\n`;
          const err = new AssertionError({ actual: caught, expected, operator: 'throws' });
          err.message = genMsg;
          err.generatedMessage = true;
          throw err;
        }
      }
    }
  }

  if (!threw) {
    let msg;
    if (message && typeof expected === 'function' && expected.name) {
      msg = `Missing expected exception (${expected.name}): ${message}`;
    } else if (typeof expected === 'function' && expected.name) {
      msg = `Missing expected exception (${expected.name}).`;
    } else if (message) {
      msg = `Missing expected exception: ${message}`;
    } else {
      msg = 'Missing expected exception.';
    }
    fail(undefined, expected, msg, 'throws');
  }
}

function doesNotThrow(fn, expected, message) {
  // validate fn is a function
  if (typeof fn !== 'function') {
    const err = new TypeError(
      'The "fn" argument must be of type function.' +
      _invalidArgTypeHelper(fn)
    );
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }

  if (typeof expected === 'string') {
    message = expected;
    expected = undefined;
  }

  // validate expected is function/regexp/undefined (NOT object)
  if (expected !== undefined && typeof expected !== 'function' && !(expected instanceof RegExp)) {
    const err = new TypeError(
      'The "expected" argument must be of type function or an ' +
      'instance of RegExp. Received an instance of ' +
      (expected && expected.constructor ? expected.constructor.name : typeof expected)
    );
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }

  try { fn(); } catch (e) {
    // if expected is provided and error doesn't match type, rethrow original
    if (typeof expected === 'function') {
      if (!(e instanceof expected)) throw e;
    }
    if (expected instanceof RegExp) {
      if (!expected.test(String(e))) throw e;
    }
    // error matched (or no expected filter)
    const actualMsg = e instanceof Error ? e.message : String(e);
    let errMsg;
    const msgStr = message instanceof Error ? message.message : message;
    if (msgStr) {
      errMsg = `Got unwanted exception: ${msgStr}\nActual message: "${actualMsg}"`;
    } else {
      errMsg = `Got unwanted exception.\nActual message: "${actualMsg}"`;
    }
    fail(e, undefined, errMsg, 'doesNotThrow');
  }
}

async function rejects(fn, expected, message) {
  let threw = false;
  try { await (typeof fn === 'function' ? fn() : fn); } catch (e) {
    threw = true;
    if (expected instanceof RegExp) {
      if (!expected.test(String(e))) {
        fail(e, expected,
          message || `The input did not match the regular expression ${expected}. ` +
          `Input:\n\n${_inspect(String(e))}\n`,
          'rejects');
      }
    } else if (typeof expected === 'function') {
      if (expected.prototype !== undefined && !(e instanceof expected)) {
        const expectedName = expected.name || 'unknown';
        const actualName = e && e.constructor ? e.constructor.name : typeof e;
        fail(e, expected,
          message || `The error is expected to be an instance of "${expectedName}". ` +
          `Received "${actualName}"\n\nError message:\n\n${e.message || String(e)}`,
          'rejects');
      } else if (expected.prototype === undefined) {
        const r = expected(e);
        if (r !== true) fail(e, expected, message, 'rejects');
      }
    } else if (typeof expected === 'object' && expected !== null) {
      for (const key of Object.keys(expected)) {
        if (!_deepEqual(e[key], expected[key], true)) {
          fail(e[key], expected[key],
            message || `rejects: ${key} mismatch (actual: ${_inspect(e[key])}, expected: ${_inspect(expected[key])})`,
            'rejects');
        }
      }
    }
  }
  if (!threw) {
    let msg;
    if (message && typeof expected === 'function' && expected.name) {
      msg = `Missing expected rejection (${expected.name}): ${message}`;
    } else if (typeof expected === 'function' && expected.name) {
      msg = `Missing expected rejection (${expected.name}).`;
    } else if (message) {
      msg = `Missing expected rejection: ${message}`;
    } else {
      msg = 'Missing expected rejection.';
    }
    fail(undefined, expected, msg, 'rejects');
  }
}

async function doesNotReject(fn, expected, message) {
  try { await (typeof fn === 'function' ? fn() : fn); } catch (e) {
    fail(e, undefined, message || 'Got unwanted rejection', 'doesNotReject');
  }
}

function ifError(err) { if (err !== null && err !== undefined) throw err; }

function match(string, regexp, message, ...extra) {
  if (typeof string !== 'string') {
    const err = new AssertionError({
      actual: string,
      expected: regexp,
      operator: 'match',
      message: 'The "string" argument must be of type string. ' +
               `Received type ${typeof string} (${_inspect(string)})`
    });
    throw err;
  }
  if (!(regexp instanceof RegExp)) {
    const err = new AssertionError({
      actual: string,
      expected: regexp,
      operator: 'match',
      message: 'The "regexp" argument must be an instance of RegExp. ' +
               `Received type ${typeof regexp} (${_inspect(regexp)})`
    });
    throw err;
  }
  if (!regexp.test(string)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, string, regexp, extra);
    if (processed !== undefined && processed !== message) {
      fail(string, regexp, processed, 'match');
      return;
    }
    if (typeof message === 'function') {
      // function returned non-string — use generated message
      fail(string, regexp, `${_inspect(string)} match ${regexp}`, 'match');
      return;
    }
    fail(string, regexp,
      message || `The input did not match the regular expression ${regexp}. ` +
      `Input:\n\n${_inspect(string)}\n`,
      'match');
  }
}

function doesNotMatch(string, regexp, message, ...extra) {
  // ambiguous arguments check
  if (extra.length > 0) {
    const err = new TypeError(
      'The "message" argument is ambiguous. ' +
      `Received ${typeof message === 'function' ? message.toString() : _inspect(message)}`
    );
    err.code = 'ERR_AMBIGUOUS_ARGUMENT';
    throw err;
  }

  if (typeof string !== 'string') {
    const err = new AssertionError({
      actual: string,
      expected: regexp,
      operator: 'doesNotMatch',
      message: 'The "string" argument must be of type string. ' +
               `Received type ${typeof string} (${_inspect(string)})`
    });
    throw err;
  }
  if (!(regexp instanceof RegExp)) {
    const err = new AssertionError({
      actual: string,
      expected: regexp,
      operator: 'doesNotMatch',
      message: 'The "regexp" argument must be an instance of RegExp. ' +
               `Received type ${typeof regexp} (${_inspect(regexp)})`
    });
    throw err;
  }
  if (regexp.test(string)) {
    if (message instanceof Error) throw message;
    const processed = _processMessage(message, string, regexp, extra);
    if (processed !== undefined && processed !== message) {
      fail(string, regexp, processed, 'doesNotMatch');
      return;
    }
    if (typeof message === 'function') {
      // function returned non-string
      fail(string, regexp, `${_inspect(string)} doesNotMatch ${regexp}`, 'doesNotMatch');
      return;
    }
    fail(string, regexp,
      message || `The input was expected to not match the regular expression ` +
      `${regexp}. Input:\n\n${_inspect(string)}\n`,
      'doesNotMatch');
  }
}

const strict = Object.assign(function strict(value, message) {
  if (arguments.length === 0) {
    _throwGenerated(undefined, undefined, 'No value argument passed to `assert.ok()`', '==');
    return;
  }
  if (!value) {
    if (message instanceof Error) throw message;
    fail(value, true, message, '==', strict);
  }
}, {
  equal: strictEqual, notEqual: notStrictEqual,
  deepEqual: deepStrictEqual, deepStrictEqual, notDeepEqual: notDeepStrictEqual, notDeepStrictEqual,
  strictEqual, notStrictEqual, partialDeepStrictEqual,
  ok, fail, throws, doesNotThrow, rejects, doesNotReject, ifError, match, doesNotMatch,
  AssertionError,
});
strict.strict = strict;

module.exports = Object.assign(assert, {
  AssertionError, ok, fail, strictEqual, notStrictEqual, equal, notEqual,
  deepEqual, deepStrictEqual, notDeepEqual, notDeepStrictEqual, partialDeepStrictEqual,
  throws, doesNotThrow, rejects, doesNotReject, ifError, match, doesNotMatch,
  strict,
});
