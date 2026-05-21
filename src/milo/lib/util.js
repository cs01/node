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

function getCallSites() {
  const orig = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const err = new Error();
  const stack = err.stack || [];
  Error.prepareStackTrace = orig;
  return stack.map(s => ({
    functionName: s.getFunctionName?.() || '',
    scriptName: s.getFileName?.() || '',
    lineNumber: s.getLineNumber?.() || 0,
    column: s.getColumnNumber?.() || 0,
  }));
}

function stripVTControlCharacters(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
}

function parseEnv(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

const ANSI_CODES = {
  reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24],
  inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29],
  black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39],
  blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39],
  blackBright: [90, 39], gray: [90, 39], grey: [90, 39],
  redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39],
  blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39],
  bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49],
  bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49],
};

function styleText(format, text) {
  if (Array.isArray(format)) {
    let result = text;
    for (const f of format) result = styleText(f, result);
    return result;
  }
  const codes = ANSI_CODES[format];
  if (!codes) return text;
  return `\x1b[${codes[0]}m${text}\x1b[${codes[1]}m`;
}

class MIMEType {
  constructor(input) {
    const str = String(input).trim();
    const semi = str.indexOf(';');
    const base = semi >= 0 ? str.substring(0, semi).trim() : str;
    const slash = base.indexOf('/');
    if (slash < 0) throw new Error('Invalid MIME type: ' + input);
    this.type = base.substring(0, slash).toLowerCase();
    this.subtype = base.substring(slash + 1).toLowerCase();
    this.params = new MIMEParams();
    if (semi >= 0) {
      const paramStr = str.substring(semi + 1);
      for (const part of paramStr.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const key = part.substring(0, eq).trim().toLowerCase();
        let val = part.substring(eq + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        this.params.set(key, val);
      }
    }
  }
  get essence() { return this.type + '/' + this.subtype; }
  toString() {
    let s = this.essence;
    for (const [k, v] of this.params) s += `;${k}=${v}`;
    return s;
  }
}

class MIMEParams {
  constructor() { this._map = new Map(); }
  get(key) { return this._map.get(key) || null; }
  set(key, value) { this._map.set(key, value); }
  has(key) { return this._map.has(key); }
  delete(key) { return this._map.delete(key); }
  entries() { return this._map.entries(); }
  keys() { return this._map.keys(); }
  values() { return this._map.values(); }
  [Symbol.iterator]() { return this._map[Symbol.iterator](); }
  toString() {
    const parts = [];
    for (const [k, v] of this._map) parts.push(`${k}=${v}`);
    return parts.join(';');
  }
}

module.exports = {
  inspect, format, formatWithOptions, inherits, deprecate,
  promisify, callbackify, debuglog, types, isDeepStrictEqual,
  getCallSites, stripVTControlCharacters, parseEnv, styleText,
  MIMEType, MIMEParams,
  TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
};
