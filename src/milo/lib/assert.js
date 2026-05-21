// assert module — core assertion functions
'use strict';

class AssertionError extends Error {
  constructor(options) {
    const message = options.message || `${options.actual} ${options.operator} ${options.expected}`;
    super(message);
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator;
    this.generatedMessage = !options.message;
    this.code = 'ERR_ASSERTION';
  }
}

function assert(value, message) {
  if (!value) fail(value, true, message, '==', assert);
}

function fail(actual, expected, message, operator) {
  throw new AssertionError({ actual, expected, message, operator });
}

function ok(value, message) {
  if (!value) fail(value, true, message, '==', ok);
}

function strictEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) fail(actual, expected, message, 'strictEqual');
}

function notStrictEqual(actual, expected, message) {
  if (Object.is(actual, expected)) fail(actual, expected, message, 'notStrictEqual');
}

function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==');
}

function notEqual(actual, expected, message) {
  if (actual == expected) fail(actual, expected, message, '!=');
}

function _deepEqual(a, b, strict) {
  if (strict ? Object.is(a, b) : a == b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) { if (!_deepEqual(a[i], b[i], strict)) return false; }
    return true;
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

function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected, false)) fail(actual, expected, message, 'deepEqual');
}

function deepStrictEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected, true)) fail(actual, expected, message, 'deepStrictEqual');
}

function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected, false)) fail(actual, expected, message, 'notDeepEqual');
}

function notDeepStrictEqual(actual, expected, message) {
  if (_deepEqual(actual, expected, true)) fail(actual, expected, message, 'notDeepStrictEqual');
}

function throws(fn, expected, message) {
  let threw = false;
  try { fn(); } catch (e) {
    threw = true;
    if (expected instanceof RegExp) { if (!expected.test(e.message)) fail(e.message, expected, message, 'throws'); }
    else if (typeof expected === 'function' && !(e instanceof expected)) fail(e, expected, message, 'throws');
  }
  if (!threw) fail(undefined, undefined, message || 'Missing expected exception', 'throws');
}

function doesNotThrow(fn, expected, message) {
  try { fn(); } catch (e) { fail(e, undefined, message || 'Got unwanted exception', 'doesNotThrow'); }
}

async function rejects(fn, expected, message) {
  let threw = false;
  try { await (typeof fn === 'function' ? fn() : fn); } catch (e) {
    threw = true;
    if (expected instanceof RegExp) { if (!expected.test(e.message)) fail(e.message, expected, message, 'rejects'); }
    else if (typeof expected === 'function') {
      if (expected.prototype !== undefined && !(e instanceof expected)) fail(e, expected, message, 'rejects');
      else if (expected.prototype === undefined) { const r = expected(e); if (r !== true) fail(e, expected, message, 'rejects'); }
    } else if (typeof expected === 'object' && expected !== null) {
      for (const key of Object.keys(expected)) {
        if (!_deepEqual(e[key], expected[key], true)) fail(e[key], expected[key], message || `rejects: ${key} mismatch`, 'rejects');
      }
    }
  }
  if (!threw) fail(undefined, undefined, message || 'Missing expected rejection', 'rejects');
}

async function doesNotReject(fn, expected, message) {
  try { await (typeof fn === 'function' ? fn() : fn); } catch (e) {
    fail(e, undefined, message || 'Got unwanted rejection', 'doesNotReject');
  }
}

function ifError(err) { if (err !== null && err !== undefined) throw err; }

function match(string, regexp, message) {
  if (!regexp.test(string)) fail(string, regexp, message, 'match');
}

function doesNotMatch(string, regexp, message) {
  if (regexp.test(string)) fail(string, regexp, message, 'doesNotMatch');
}

module.exports = Object.assign(assert, {
  AssertionError, ok, fail, strictEqual, notStrictEqual, equal, notEqual,
  deepEqual, deepStrictEqual, notDeepEqual, notDeepStrictEqual,
  throws, doesNotThrow, rejects, doesNotReject, ifError, match, doesNotMatch,
  strict: Object.assign(function strict(value, message) { strictEqual(value, true, message); }, {
    equal: strictEqual, notEqual: notStrictEqual, deepEqual: deepStrictEqual,
    notDeepEqual: notDeepStrictEqual, ok, fail, throws, doesNotThrow, rejects, doesNotReject, ifError, match, doesNotMatch,
    AssertionError,
  }),
});
