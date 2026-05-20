// util module — inspect, format, inherits, types, promisify
'use strict';

const types = {
  isDate: (v) => v instanceof Date,
  isRegExp: (v) => v instanceof RegExp,
  isMap: (v) => v instanceof Map,
  isSet: (v) => v instanceof Set,
  isWeakMap: (v) => v instanceof WeakMap,
  isWeakSet: (v) => v instanceof WeakSet,
  isPromise: (v) => v instanceof Promise,
  isNativeError: (v) => v instanceof Error,
  isArrayBuffer: (v) => v instanceof ArrayBuffer,
  isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  isDataView: (v) => v instanceof DataView,
  isProxy: () => false,
  isExternal: () => false,
};

function inspect(obj, opts) {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') return "'" + obj + "'";
  if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'bigint') return String(obj);
  if (typeof obj === 'symbol') return obj.toString();
  if (typeof obj === 'function') return '[Function: ' + (obj.name || 'anonymous') + ']';

  const depth = (opts && opts.depth !== undefined) ? opts.depth : 2;
  return _inspectObject(obj, depth, 0, new Set());
}

function _inspectObject(obj, maxDepth, currentDepth, seen) {
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (Array.isArray(obj)) {
    if (currentDepth >= maxDepth) return '[Array]';
    const items = obj.map(v => _inspectValue(v, maxDepth, currentDepth + 1, seen));
    return '[ ' + items.join(', ') + ' ]';
  }
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof RegExp) return obj.toString();
  if (obj instanceof Error) return obj.stack || obj.toString();
  if (obj instanceof Map) {
    if (currentDepth >= maxDepth) return '[Map]';
    const entries = [];
    for (const [k, v] of obj) entries.push(_inspectValue(k, maxDepth, currentDepth + 1, seen) + ' => ' + _inspectValue(v, maxDepth, currentDepth + 1, seen));
    return 'Map(' + obj.size + ') { ' + entries.join(', ') + ' }';
  }
  if (obj instanceof Set) {
    if (currentDepth >= maxDepth) return '[Set]';
    const items = [];
    for (const v of obj) items.push(_inspectValue(v, maxDepth, currentDepth + 1, seen));
    return 'Set(' + obj.size + ') { ' + items.join(', ') + ' }';
  }

  if (currentDepth >= maxDepth) return '[Object]';
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const pairs = keys.map(k => k + ': ' + _inspectValue(obj[k], maxDepth, currentDepth + 1, seen));
  return '{ ' + pairs.join(', ') + ' }';
}

function _inspectValue(val, maxDepth, currentDepth, seen) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') return "'" + val + "'";
  if (typeof val !== 'object' && typeof val !== 'function') return String(val);
  if (typeof val === 'function') return '[Function: ' + (val.name || 'anonymous') + ']';
  return _inspectObject(val, maxDepth, currentDepth, seen);
}

inspect.defaultOptions = { depth: 2 };

function format(fmt, ...args) {
  if (typeof fmt !== 'string') return [fmt, ...args].map(a => typeof a === 'object' ? inspect(a) : String(a)).join(' ');
  let i = 0;
  const str = fmt.replace(/%[sdjifoO%]/g, (m) => {
    if (m === '%%') return '%';
    if (i >= args.length) return m;
    const a = args[i++];
    if (m === '%s') return String(a);
    if (m === '%d') return Number(a).toString();
    if (m === '%i') return parseInt(a, 10).toString();
    if (m === '%f') return parseFloat(a).toString();
    if (m === '%j') { try { return JSON.stringify(a); } catch { return '[Circular]'; } }
    if (m === '%o' || m === '%O') return inspect(a);
    return m;
  });
  const rest = args.slice(i).map(a => typeof a === 'object' ? inspect(a) : String(a));
  return rest.length ? str + ' ' + rest.join(' ') : str;
}

function formatWithOptions(_opts, fmt, ...args) { return format(fmt, ...args); }

function inherits(ctor, superCtor) {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  Object.setPrototypeOf(ctor, superCtor);
}

function deprecate(fn, msg) {
  let warned = false;
  return function(...args) {
    if (!warned) { warned = true; console.error('DeprecationWarning:', msg); }
    return fn.apply(this, args);
  };
}

function promisify(fn) {
  return function(...args) {
    return new Promise((resolve, reject) => {
      fn(...args, (err, result) => err ? reject(err) : resolve(result));
    });
  };
}

function callbackify(fn) {
  return function(...args) {
    const cb = args.pop();
    fn(...args).then(r => cb(null, r), e => cb(e));
  };
}

function debuglog(section) {
  const enabled = (process.env.NODE_DEBUG || '').split(',').some(s => s.trim().toUpperCase() === section.toUpperCase());
  if (!enabled) return () => {};
  return (...args) => console.error('%s: %s', section.toUpperCase(), format(...args));
}

function isDeepStrictEqual(a, b) {
  const assert = require('assert');
  try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
}

module.exports = {
  inspect, format, formatWithOptions, inherits, deprecate,
  promisify, callbackify, debuglog, types, isDeepStrictEqual,
  TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
};
