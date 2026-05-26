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
  isUint8Array: (v) => v instanceof Uint8Array,
  isUint8ClampedArray: (v) => v instanceof Uint8ClampedArray,
  isUint16Array: (v) => v instanceof Uint16Array,
  isUint32Array: (v) => v instanceof Uint32Array,
  isInt8Array: (v) => v instanceof Int8Array,
  isInt16Array: (v) => v instanceof Int16Array,
  isInt32Array: (v) => v instanceof Int32Array,
  isFloat32Array: (v) => v instanceof Float32Array,
  isFloat64Array: (v) => v instanceof Float64Array,
  isBigInt64Array: (v) => typeof BigInt64Array !== 'undefined' && v instanceof BigInt64Array,
  isBigUint64Array: (v) => typeof BigUint64Array !== 'undefined' && v instanceof BigUint64Array,
  isArrayBufferView: (v) => ArrayBuffer.isView(v),
  isProxy: () => false,
  isExternal: () => false,
  isGeneratorObject: (v) => v && typeof v.next === 'function' && typeof v.throw === 'function' && typeof v[Symbol.iterator] === 'function',
  isGeneratorFunction: (v) => typeof v === 'function' && v.constructor && v.constructor.name === 'GeneratorFunction',
  isAsyncFunction: (v) => typeof v === 'function' && v.constructor && v.constructor.name === 'AsyncFunction',
  isMapIterator: (v) => Object.prototype.toString.call(v) === '[object Map Iterator]',
  isSetIterator: (v) => Object.prototype.toString.call(v) === '[object Set Iterator]',
  isStringObject: (v) => Object.prototype.toString.call(v) === '[object String]' && typeof v === 'object',
  isNumberObject: (v) => Object.prototype.toString.call(v) === '[object Number]' && typeof v === 'object',
  isBooleanObject: (v) => Object.prototype.toString.call(v) === '[object Boolean]' && typeof v === 'object',
  isSymbolObject: (v) => Object.prototype.toString.call(v) === '[object Symbol]' && typeof v === 'object',
  isBigIntObject: (v) => Object.prototype.toString.call(v) === '[object BigInt]' && typeof v === 'object',
  isAnyArrayBuffer: (v) => v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
  isSharedArrayBuffer: (v) => typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer,
  isModuleNamespaceObject: () => false,
  isArgumentsObject: (v) => Object.prototype.toString.call(v) === '[object Arguments]',
  isBoxedPrimitive: (v) => v instanceof Number || v instanceof String || v instanceof Boolean || (typeof Symbol !== 'undefined' && Object.prototype.toString.call(v) === '[object Symbol]' && typeof v === 'object') || (typeof BigInt !== 'undefined' && Object.prototype.toString.call(v) === '[object BigInt]' && typeof v === 'object'),
  isCryptoKey: () => false,
  isKeyObject: () => false,
};

function inspect(obj, opts) {
  if (typeof opts === 'boolean') opts = { showHidden: opts };
  const colors = opts && opts.colors;
  const _c = (style, s) => {
    if (!colors) return s;
    const code = inspect.colors[inspect.styles[style]];
    return code ? `\x1b[${code[0]}m${s}\x1b[${code[1]}m` : s;
  };
  if (obj === null) return _c('null', 'null');
  if (obj === undefined) return _c('undefined', 'undefined');
  if (typeof obj === 'string') return _c('string', "'" + obj + "'");
  if (typeof obj === 'number') return _c('number', String(obj));
  if (typeof obj === 'boolean') return _c('boolean', String(obj));
  if (typeof obj === 'bigint') return _c('bigint', String(obj) + 'n');
  if (typeof obj === 'symbol') return _c('symbol', obj.toString());
  if (typeof obj === 'function') return _c('special', '[Function: ' + (obj.name || 'anonymous') + ']');

  if (obj[Symbol.for('nodejs.util.inspect.custom')]) {
    const custom = obj[Symbol.for('nodejs.util.inspect.custom')](opts && opts.depth !== undefined ? opts.depth : 2, opts || {}, inspect);
    if (typeof custom === 'string') return custom;
  }

  const depth = (opts && opts.depth !== undefined) ? opts.depth : 2;
  return _inspectObject(obj, depth, 0, new Set(), colors);
}

function _colorize(style, s) {
  const code = inspect.colors[inspect.styles[style]];
  return code ? `\x1b[${code[0]}m${s}\x1b[${code[1]}m` : s;
}

function _inspectObject(obj, maxDepth, currentDepth, seen, colors) {
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (Array.isArray(obj)) {
    if (currentDepth >= maxDepth) return '[Array]';
    const items = obj.map(v => _inspectValue(v, maxDepth, currentDepth + 1, seen, colors));
    return '[ ' + items.join(', ') + ' ]';
  }
  if (obj instanceof Date) { const s = obj.toISOString(); return colors ? _colorize('date', s) : s; }
  if (obj instanceof RegExp) { const s = obj.toString(); return colors ? _colorize('regexp', s) : s; }
  if (obj instanceof Error) return obj.stack || obj.toString();
  if (obj instanceof Map) {
    if (currentDepth >= maxDepth) return '[Map]';
    const entries = [];
    for (const [k, v] of obj) entries.push(_inspectValue(k, maxDepth, currentDepth + 1, seen, colors) + ' => ' + _inspectValue(v, maxDepth, currentDepth + 1, seen, colors));
    return 'Map(' + obj.size + ') { ' + entries.join(', ') + ' }';
  }
  if (obj instanceof Set) {
    if (currentDepth >= maxDepth) return '[Set]';
    const items = [];
    for (const v of obj) items.push(_inspectValue(v, maxDepth, currentDepth + 1, seen, colors));
    return 'Set(' + obj.size + ') { ' + items.join(', ') + ' }';
  }

  if (currentDepth >= maxDepth) return '[Object]';
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const pairs = keys.map(k => k + ': ' + _inspectValue(obj[k], maxDepth, currentDepth + 1, seen, colors));
  return '{ ' + pairs.join(', ') + ' }';
}

function _inspectValue(val, maxDepth, currentDepth, seen, colors) {
  if (val === null) return colors ? _colorize('null', 'null') : 'null';
  if (val === undefined) return colors ? _colorize('undefined', 'undefined') : 'undefined';
  if (typeof val === 'string') { const s = "'" + val + "'"; return colors ? _colorize('string', s) : s; }
  if (typeof val === 'number') { const s = String(val); return colors ? _colorize('number', s) : s; }
  if (typeof val === 'boolean') { const s = String(val); return colors ? _colorize('boolean', s) : s; }
  if (typeof val === 'bigint') { const s = String(val) + 'n'; return colors ? _colorize('bigint', s) : s; }
  if (typeof val === 'symbol') { const s = val.toString(); return colors ? _colorize('symbol', s) : s; }
  if (typeof val === 'function') { const s = '[Function: ' + (val.name || 'anonymous') + ']'; return colors ? _colorize('special', s) : s; }
  return _inspectObject(val, maxDepth, currentDepth, seen, colors);
}

inspect.defaultOptions = { depth: 2 };
inspect.colors = {
  bold: [1, 22], italic: [3, 23], underline: [4, 24], inverse: [7, 27],
  white: [37, 39], grey: [90, 39], black: [30, 39], blue: [34, 39],
  cyan: [36, 39], green: [32, 39], magenta: [35, 39], red: [31, 39], yellow: [33, 39],
};
inspect.styles = {
  special: 'cyan', number: 'yellow', bigint: 'yellow', boolean: 'yellow',
  undefined: 'grey', null: 'bold', string: 'green', symbol: 'green',
  date: 'magenta', regexp: 'red', module: 'underline',
};
inspect.custom = Symbol.for('nodejs.util.inspect.custom');

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
  if (ctor === undefined || ctor === null || typeof ctor !== 'function') {
    const e = new TypeError(`The "ctor" argument must be of type function. Received ${ctor === null ? 'null' : ctor === undefined ? 'undefined' : 'type ' + typeof ctor}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (superCtor === null || superCtor === undefined) {
    const e = new TypeError(`The "superCtor" argument must be of type function. Received ${superCtor === null ? 'null' : 'undefined'}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (superCtor.prototype === undefined || superCtor.prototype === null) {
    const e = new TypeError(`The "superCtor.prototype" property must be of type object. Received ${superCtor.prototype === null ? 'null' : 'undefined'}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  Object.defineProperty(ctor, 'super_', { value: superCtor, writable: true, configurable: true });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

function deprecate(fn, msg, code) {
  if (code !== undefined && typeof code !== 'string') {
    throw _ERR_INVALID_ARG_TYPE('code', 'string', code);
  }
  let warned = false;
  const wrapped = function(...args) {
    if (!warned) { warned = true; process.emitWarning(msg, 'DeprecationWarning', code); }
    return fn.apply(this, args);
  };
  return wrapped;
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

// Replace lone surrogates with U+FFFD
function toUSVString(str) {
  return String(str).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

function aborted(signal, resource) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

// Deprecated type-checking functions (Node.js compat)
const isArray = Array.isArray;
const isBoolean = (v) => typeof v === 'boolean';
const isNull = (v) => v === null;
const isNullOrUndefined = (v) => v == null;
const isNumber = (v) => typeof v === 'number';
const isString = (v) => typeof v === 'string';
const isSymbol = (v) => typeof v === 'symbol';
const isUndefined = (v) => v === undefined;
const isRegExp = (v) => v instanceof RegExp;
const isObject = (v) => typeof v === 'object' && v !== null;
const isDate = (v) => v instanceof Date;
const isError = (v) => v instanceof Error;
const isFunction = (v) => typeof v === 'function';
const isPrimitive = (v) => v === null || (typeof v !== 'object' && typeof v !== 'function');
const isBuffer = (v) => Buffer.isBuffer(v);

const _errnoMap = { [-1]: 'EPERM', [-2]: 'ENOENT', [-3]: 'ESRCH', [-4]: 'EINTR', [-5]: 'EIO', [-9]: 'EBADF', [-12]: 'ENOMEM', [-13]: 'EACCES', [-14]: 'EFAULT', [-17]: 'EEXIST', [-20]: 'ENOTDIR', [-21]: 'EISDIR', [-22]: 'EINVAL', [-24]: 'EMFILE', [-28]: 'ENOSPC', [-30]: 'EROFS', [-32]: 'EPIPE', [-35]: 'EAGAIN', [-36]: 'EINPROGRESS', [-38]: 'ENOTSOCK', [-40]: 'EMSGSIZE', [-43]: 'EPROTONOSUPPORT', [-47]: 'EAFNOSUPPORT', [-48]: 'EADDRINUSE', [-49]: 'EADDRNOTAVAIL', [-51]: 'ENETUNREACH', [-54]: 'ECONNRESET', [-56]: 'EISCONN', [-57]: 'ENOTCONN', [-60]: 'ETIMEDOUT', [-61]: 'ECONNREFUSED', [-63]: 'ENAMETOOLONG', [-65]: 'EHOSTUNREACH', [-66]: 'ENOTEMPTY' };
function getSystemErrorName(err) { return _errnoMap[err] || 'Unknown system error ' + err; }

function _extend(target, source) {
  if (source === null || source === undefined) return target;
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) target[keys[i]] = source[keys[i]];
  return target;
}

function log(...args) {
  console.error('%s - %s', new Date().toUTCString(), format(...args));
}

function normalizeEncoding(enc) {
  if (!enc) return 'utf8';
  const lower = enc.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (lower === 'utf8' || lower === 'utf-8') return 'utf8';
  if (lower === 'ascii') return 'ascii';
  if (lower === 'hex') return 'hex';
  if (lower === 'base64') return 'base64';
  if (lower === 'base64url') return 'base64url';
  if (lower === 'latin1' || lower === 'binary') return 'latin1';
  if (lower === 'utf16le' || lower === 'ucs2' || lower === 'ucs-2') return 'utf16le';
  return undefined;
}

const _sysErrors = new Map([
  [-1, ['EPERM', 'operation not permitted']], [-2, ['ENOENT', 'no such file or directory']],
  [-13, ['EACCES', 'permission denied']], [-17, ['EEXIST', 'file already exists']],
  [-20, ['ENOTDIR', 'not a directory']], [-21, ['EISDIR', 'is a directory']],
  [-22, ['EINVAL', 'invalid argument']], [-28, ['ENOSPC', 'no space left on device']],
  [-36, ['ENAMETOOLONG', 'name too long']], [-40, ['EMSGSIZE', 'message too long']],
]);

module.exports = {
  inspect, format, formatWithOptions, inherits, deprecate, log,
  promisify, callbackify, debuglog, debug: debuglog, types, isDeepStrictEqual, getSystemErrorName,
  getCallSites, stripVTControlCharacters, parseEnv, styleText,
  MIMEType, MIMEParams, toUSVString, aborted, _extend, normalizeEncoding,
  getSystemErrorMap: () => _sysErrors,
  TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
  isArray, isBoolean, isNull, isNullOrUndefined, isNumber, isString,
  isSymbol, isUndefined, isRegExp, isObject, isDate, isError,
  isFunction, isPrimitive, isBuffer,
};
