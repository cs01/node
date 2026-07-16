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
  if (typeof obj === 'number') return _c('number', Object.is(obj, -0) ? '-0' : String(obj));
  if (typeof obj === 'boolean') return _c('boolean', String(obj));
  if (typeof obj === 'bigint') return _c('bigint', String(obj) + 'n');
  if (typeof obj === 'symbol') return _c('symbol', obj.toString());
  if (typeof obj === 'function') {
    const ctorName = obj.constructor && obj.constructor.name;
    const tag = ctorName === 'AsyncFunction' ? 'AsyncFunction'
      : ctorName === 'GeneratorFunction' ? 'GeneratorFunction'
      : ctorName === 'AsyncGeneratorFunction' ? 'AsyncGeneratorFunction'
      : 'Function';
    return _c('special', obj.name ? '[' + tag + ': ' + obj.name + ']' : '[' + tag + ' (anonymous)]');
  }

  // Revoked Proxy throws on any access (including the custom-inspect symbol below).
  try { Reflect.getPrototypeOf(obj); } catch (e) { if (String(e && e.message).includes('revoked')) return '<Revoked Proxy>'; throw e; }

  if (obj[Symbol.for('nodejs.util.inspect.custom')]) {
    const custom = obj[Symbol.for('nodejs.util.inspect.custom')](opts && opts.depth !== undefined ? opts.depth : 2, opts || {}, inspect);
    if (typeof custom === 'string') return custom;
  }

  const depth = (opts && opts.depth !== undefined) ? opts.depth : 2;
  // Module-level active opts so the property loop can honor showHidden/getters
  // without threading them through every recursive call. Safe: inspect recursion
  // shares one opts; nested inspect() (via custom) saves/restores below.
  const prevSH = _inspShowHidden, prevG = _inspGetters;
  _inspShowHidden = !!(opts && opts.showHidden);
  _inspGetters = opts && opts.getters;
  try { return _inspectObject(obj, depth, 0, new Set(), colors); }
  finally { _inspShowHidden = prevSH; _inspGetters = prevG; }
}
let _inspShowHidden = false, _inspGetters = false;

function _colorize(style, s) {
  const code = inspect.colors[inspect.styles[style]];
  return code ? `\x1b[${code[0]}m${s}\x1b[${code[1]}m` : s;
}

// Port of Node's isBelowBreakLength / reduceToSingleString: decide single-line
// vs one-entry-per-line based on total width (breakLength) and indentation, with
// each multiline entry already indented to its own depth so nesting composes.
const _BREAK_LENGTH = 80;
// Object keys are bare when valid identifiers, quoted otherwise (Node behavior).
function _quoteKey(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : "'" + k.replace(/'/g, "\\'") + "'";
}
function _belowBreakLength(parts, start) {
  let total = parts.length + start;
  if (total + parts.length > _BREAK_LENGTH) return false;
  for (let i = 0; i < parts.length; i++) {
    total += parts[i].length;
    if (total > _BREAK_LENGTH) return false;
    if (parts[i].includes('\n')) return false;
  }
  return true;
}
function _reduceToSingleString(parts, prefix, open, close, currentDepth) {
  if (parts.length === 0) return prefix + open + close;
  const indentationLvl = currentDepth * 2;
  const start = parts.length + indentationLvl + open.length + prefix.length + 10;
  if (_belowBreakLength(parts, start)) {
    const joined = parts.join(', ');
    if (!joined.includes('\n')) return prefix + open + ' ' + joined + ' ' + close;
  }
  const indent = '\n' + ' '.repeat(indentationLvl);
  return prefix + open + indent + '  ' + parts.join(',' + indent + '  ') + indent + close;
}

function _inspectObject(obj, maxDepth, currentDepth, seen, colors) {
  if (seen.has(obj)) return '[Circular]';
  // A revoked Proxy throws on every operation (even Array.isArray/getPrototypeOf).
  // Detect via a benign Reflect op and render like Node instead of crashing.
  try { Reflect.getPrototypeOf(obj); } catch (e) { if (String(e && e.message).includes('revoked')) return '<Revoked Proxy>'; throw e; }
  seen.add(obj);

  if (Array.isArray(obj)) {
    if (currentDepth >= maxDepth) return '[Array]';
    if (obj.length === 0) return '[]';
    const items = obj.map(v => _inspectValue(v, maxDepth, currentDepth + 1, seen, colors));
    return _reduceToSingleString(items, '', '[', ']', currentDepth);
  }
  // A real Date has [[DateValue]]; an object merely sharing Date.prototype (fake)
  // throws on toISOString — fall through to object formatting (renders `Date {}`).
  if (obj instanceof Date) { try { const s = obj.toISOString(); return colors ? _colorize('date', s) : s; } catch { /* not a real Date */ } }
  if (obj instanceof RegExp) { try { const s = RegExp.prototype.toString.call(obj); return colors ? _colorize('regexp', s) : s; } catch {} }
  if (obj instanceof Error) return obj.stack || obj.toString();
  if (obj instanceof Map) {
    if (currentDepth >= maxDepth) return '[Map]';
    if (obj.size === 0) return 'Map(0) {}';
    const entries = [];
    for (const [k, v] of obj) entries.push(_inspectValue(k, maxDepth, currentDepth + 1, seen, colors) + ' => ' + _inspectValue(v, maxDepth, currentDepth + 1, seen, colors));
    return _reduceToSingleString(entries, 'Map(' + obj.size + ') ', '{', '}', currentDepth);
  }
  if (obj instanceof Set) {
    if (currentDepth >= maxDepth) return '[Set]';
    if (obj.size === 0) return 'Set(0) {}';
    const items = [];
    for (const v of obj) items.push(_inspectValue(v, maxDepth, currentDepth + 1, seen, colors));
    return _reduceToSingleString(items, 'Set(' + obj.size + ') ', '{', '}', currentDepth);
  }

  // TypedArrays render as `Name(len) [ elems ]` (empty: `Name(0) []`), distinct
  // from plain objects. Buffers are intercepted earlier by their custom inspect.
  if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    const taName = (obj.constructor && obj.constructor.name) || 'TypedArray';
    if (currentDepth >= maxDepth) return '[' + taName + ']';
    if (obj.length === 0) return taName + '(0) []';
    const items = [];
    for (let i = 0; i < obj.length; i++) items.push(_inspectValue(obj[i], maxDepth, currentDepth + 1, seen, colors));
    return _reduceToSingleString(items, taName + '(' + obj.length + ') ', '[', ']', currentDepth);
  }

  // Compute tag prefix for non-plain objects
  let prefix = '';
  const proto = Object.getPrototypeOf(obj);
  const isNullProto = proto === null || (proto !== null && Object.getPrototypeOf(proto) === null && !proto.hasOwnProperty);
  if (isNullProto) {
    const ctorName = obj.constructor && obj.constructor.name;
    prefix = ctorName ? `[${ctorName}: null prototype] ` : '[Object: null prototype] ';
  } else if (obj.constructor && obj.constructor.name && obj.constructor.name !== 'Object') {
    prefix = obj.constructor.name + ' ';
  }

  if (currentDepth >= maxDepth) return prefix ? `[${prefix.trim()}]` : '[Object]';
  // String keys: enumerable-only by default; all own (incl non-enumerable) with showHidden.
  const strKeys = _inspShowHidden ? Object.getOwnPropertyNames(obj) : Object.keys(obj);
  const symKeys = (_inspShowHidden ? Object.getOwnPropertySymbols(obj)
    : Object.getOwnPropertySymbols(obj).filter(s => Object.getOwnPropertyDescriptor(obj, s).enumerable));
  const pairs = [];
  for (const k of strKeys) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    // Non-enumerable own keys are bracketed (Node: [key]) to distinguish from enumerable.
    const keyStr = d.enumerable ? _quoteKey(k) : '[' + _quoteKey(k) + ']';
    pairs.push(keyStr + ': ' + _formatDescVal(obj, k, d, maxDepth, currentDepth, seen, colors));
  }
  for (const s of symKeys) {
    const d = Object.getOwnPropertyDescriptor(obj, s);
    pairs.push('[' + s.toString() + ']: ' + _formatDescVal(obj, s, d, maxDepth, currentDepth, seen, colors));
  }
  // showHidden also surfaces getters defined on the prototype chain (Node protoProps),
  // shown bracketed since they are non-own. Skip keys already present as own props.
  if (_inspShowHidden) {
    const ownSet = new Set(strKeys);
    let p = Object.getPrototypeOf(obj);
    while (p && p !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(p)) {
        if (k === 'constructor' || ownSet.has(k)) continue;
        const d = Object.getOwnPropertyDescriptor(p, k);
        if (typeof d.get !== 'function') continue;
        ownSet.add(k);
        pairs.push('[' + _quoteKey(k) + ']: ' + _formatDescVal(obj, k, d, maxDepth, currentDepth, seen, colors));
      }
      p = Object.getPrototypeOf(p);
    }
  }
  if (pairs.length === 0) return prefix + '{}';
  return _reduceToSingleString(pairs, prefix, '{', '}', currentDepth);
}

// Format a property value from its descriptor. Accessors render as
// [Getter]/[Setter]/[Getter/Setter], and with the `getters` option the getter
// is invoked: [Getter: <value>] (or the thrown error if it throws).
function _formatDescVal(obj, key, d, maxDepth, currentDepth, seen, colors) {
  if (d.get || d.set) {
    const label = d.get && d.set ? 'Getter/Setter' : d.get ? 'Getter' : 'Setter';
    if (d.get && (_inspGetters === true || _inspGetters === 'get' || (_inspGetters === 'set' && d.set))) {
      try {
        const v = d.get.call(obj);
        return colors ? _colorize('special', '[' + label + ':') + ' ' + _inspectValue(v, maxDepth, currentDepth + 1, seen, colors) + _colorize('special', ']')
          : '[' + label + ': ' + _inspectValue(v, maxDepth, currentDepth + 1, seen, colors) + ']';
      } catch (e) {
        return '[' + label + ': <Inspection threw (' + (e && e.message) + ')>]';
      }
    }
    const s = '[' + label + ']';
    return colors ? _colorize('special', s) : s;
  }
  return _inspectValue(d.value, maxDepth, currentDepth + 1, seen, colors);
}

function _inspectValue(val, maxDepth, currentDepth, seen, colors) {
  if (val === null) return colors ? _colorize('null', 'null') : 'null';
  if (val === undefined) return colors ? _colorize('undefined', 'undefined') : 'undefined';
  if (typeof val === 'string') { const s = "'" + val + "'"; return colors ? _colorize('string', s) : s; }
  if (typeof val === 'number') { const s = Object.is(val, -0) ? '-0' : String(val); return colors ? _colorize('number', s) : s; }
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

function _formatArg(a) {
  if (typeof a === 'string') return a;
  if (typeof a === 'number') return Object.is(a, -0) ? '-0' : String(a);
  if (typeof a === 'bigint') return String(a) + 'n';
  if (typeof a === 'symbol') return a.toString();
  return inspect(a);
}

function _addNumSep(s) {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const parts = [];
  for (let i = body.length; i > 0; i -= 3) parts.unshift(body.slice(Math.max(0, i - 3), i));
  return (neg ? '-' : '') + parts.join('_');
}
function _formatNum(n) {
  if (Object.is(n, -0)) return '-0';
  const s = String(n);
  if (!inspect.defaultOptions.numericSeparator) return s;
  if (!Number.isFinite(n) || Math.abs(n) < 1e6 || s.includes('e') || s.includes('.')) return s;
  return _addNumSep(s);
}

function format(fmt, ...args) {
  if (arguments.length === 0) return '';
  if (typeof fmt !== 'string') return [fmt, ...args].map(a => _formatArg(a)).join(' ');
  let i = 0;
  const str = fmt.replace(/%[sdjifoO%]/g, (m) => {
    if (m === '%%') return '%';
    if (i >= args.length) return m;
    const a = args[i++];
    if (m === '%s') {
      if (typeof a === 'bigint') return inspect.defaultOptions.numericSeparator ? _addNumSep(String(a)) + 'n' : `${a}n`;
      if (typeof a === 'number') { if (Object.is(a, -0)) return '-0'; return inspect.defaultOptions.numericSeparator ? _formatNum(a) : String(a); }
      if (typeof a === 'object' && a !== null) {
        if (typeof a.toString === 'function' && a.toString !== Object.prototype.toString && a.toString !== Array.prototype.toString) return String(a);
        return inspect(a, { depth: 1, colors: false });
      }
      return String(a);
    }
    if (m === '%d') { if (typeof a === 'symbol') return 'NaN'; if (typeof a === 'bigint') return inspect.defaultOptions.numericSeparator ? _addNumSep(String(a)) + 'n' : `${a}n`; const n = Number(a); return Object.is(n, -0) ? '-0' : _formatNum(n); }
    if (m === '%i') { if (typeof a === 'symbol') return 'NaN'; if (typeof a === 'bigint') return inspect.defaultOptions.numericSeparator ? _addNumSep(String(a)) + 'n' : `${a}n`; if (typeof a === 'number' && Object.is(a, -0)) return '-0'; const n = parseInt(a, 10); return _formatNum(n); }
    if (m === '%f') { if (typeof a === 'symbol') return 'NaN'; if (typeof a === 'number') return Object.is(a, -0) ? '-0' : String(a); const n = parseFloat(a); return Object.is(n, -0) ? '-0' : String(n); }
    if (m === '%j') { try { return JSON.stringify(a); } catch { return '[Circular]'; } }
    if (m === '%o' || m === '%O') return inspect(a);
    return m;
  });
  const rest = args.slice(i).map(a => _formatArg(a));
  return rest.length ? str + ' ' + rest.join(' ') : str;
}

function formatWithOptions(opts, fmt, ...args) {
  const saved = {};
  if (opts && typeof opts === 'object') { for (const k in opts) { saved[k] = inspect.defaultOptions[k]; inspect.defaultOptions[k] = opts[k]; } }
  try { return format(fmt, ...args); }
  finally { for (const k in saved) { if (saved[k] === undefined) delete inspect.defaultOptions[k]; else inspect.defaultOptions[k] = saved[k]; } }
}

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

// codes already warned about — a code dedups across ALL functions sharing it, so
// two different deprecated fns with the same code warn only once total (node semantics).
const _warnedDeprecationCodes = new Set();
function deprecate(fn, msg, code, options) {
  if (code !== undefined && typeof code !== 'string') {
    throw _ERR_INVALID_ARG_TYPE('code', 'string', code);
  }
  const modifyPrototype = !(options && options.modifyPrototype === false);
  let warned = false;
  function deprecated(...args) {
    if (!warned) {
      warned = true;
      if (code === undefined || !_warnedDeprecationCodes.has(code)) {
        if (code !== undefined) _warnedDeprecationCodes.add(code);
        process.emitWarning(msg, 'DeprecationWarning', code);
      }
    }
    if (new.target) return Reflect.construct(fn, args, new.target);
    return fn.apply(this, args);
  }
  // preserve the original arity (tests assert deprecate(fn).length === fn.length)
  Object.defineProperty(deprecated, 'length', { value: fn.length, configurable: true });
  // share the wrapped fn's prototype AND inherit its statics unless the caller opts out,
  // so the deprecated wrapper is a drop-in for the original (prototype methods + statics).
  if (modifyPrototype) {
    if (fn.prototype) deprecated.prototype = fn.prototype;
    Object.setPrototypeOf(deprecated, fn);
  }
  return deprecated;
}

// Functions can opt into resolving with a named-object instead of a single value
// by setting this symbol to an array of names (e.g. fs.read → { bytesRead, buffer }).
const kCustomPromisifyArgs = Symbol.for('nodejs.util.promisify.customArgs');
// Mirrors Node's internal invalidArgTypeHelper — the " Received ..." suffix that
// assert.throws matchers compare against verbatim.
function _invalidArgTypeHelper(input) {
  if (input == null) return ` Received ${input}`;
  if (typeof input === 'function' && input.name) return ` Received function ${input.name}`;
  if (typeof input === 'object') {
    if (input.constructor && input.constructor.name) return ` Received an instance of ${input.constructor.name}`;
    return ` Received ${inspect(input, { depth: -1 })}`;
  }
  let inspected = inspect(input, { colors: false });
  if (inspected.length > 28) inspected = `${inspected.slice(0, 25)}...`;
  return ` Received type ${typeof input} (${inspected})`;
}
const _AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
function promisify(original) {
  if (typeof original !== 'function') { const e = new TypeError('The "original" argument must be of type function.' + _invalidArgTypeHelper(original)); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
  // instanceof (not .constructor, which is spoofable) detects real async fns —
  // promisifying one that already returns a Promise is almost always a mistake.
  if (original instanceof _AsyncFunction) {
    process.emitWarning('Calling promisify on a function that returns a Promise is likely a mistake.',
      { type: 'DeprecationWarning', code: 'DEP0174' });
  }
  if (original[promisify.custom]) {
    const custom = original[promisify.custom];
    if (typeof custom !== 'function') { const e = new TypeError('The "util.promisify.custom" argument must be of type Function. Received ' + typeof custom); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    return Object.defineProperty(custom, promisify.custom, { value: custom, enumerable: false, writable: false, configurable: true });
  }
  const argumentNames = original[kCustomPromisifyArgs];
  function fn(...args) {
    return new Promise((resolve, reject) => {
      args.push((err, ...values) => {
        if (err) return reject(err);
        // Default resolves with the single value; customArgs maps multiple values
        // onto a named object — Node never resolves with a bare array.
        if (argumentNames !== undefined && values.length > 1) {
          const obj = {};
          for (let i = 0; i < argumentNames.length; i++) obj[argumentNames[i]] = values[i];
          resolve(obj);
        } else {
          resolve(values[0]);
        }
      });
      Reflect.apply(original, this, args);
    });
  }
  // Inherit the original's prototype (preserves cross-realm identity) and copy its
  // own properties (name, length, custom props) so the wrapper mirrors the original.
  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
  Object.defineProperty(fn, promisify.custom, { value: fn, enumerable: false, writable: false, configurable: true });
  return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
}
promisify.custom = Symbol.for('nodejs.util.promisify.custom');

// Runs inside a nextTick (process.processTicksAndRejections frame). Wraps a
// falsy rejection reason here so the Error's stack points at the tick loop.
function _callbackifyOnRejected(reason, cb) {
  if (!reason) {
    const orig = reason;
    reason = new Error('Promise was rejected with falsy value');
    reason.reason = orig;
    reason.code = 'ERR_FALSY_VALUE_REJECTION';
    // Drop this frame so stack[1] is the tick loop (process.processTicksAndRejections).
    if (Error.captureStackTrace) Error.captureStackTrace(reason, _callbackifyOnRejected);
  }
  return cb(reason);
}

function callbackify(fn) {
  if (typeof fn !== 'function') {
    let received;
    if (fn === null) received = 'null';
    else if (fn === undefined) received = 'undefined';
    else if (typeof fn === 'string') received = "type string ('" + fn + "')";
    else if (typeof fn === 'number') received = 'type number (' + fn + ')';
    else if (typeof fn === 'boolean') received = 'type boolean (' + fn + ')';
    else if (typeof fn === 'symbol') received = 'type symbol (' + fn.toString() + ')';
    else if (typeof fn === 'object') received = 'an instance of ' + (fn.constructor ? fn.constructor.name : 'Object');
    else received = 'type ' + typeof fn;
    const e = new TypeError('The "original" argument must be of type function. Received ' + received);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  const callbackified = function(...args) {
    const cb = args.pop();
    if (typeof cb !== 'function') {
      let _rcv;
      if (cb === null) _rcv = 'null';
      else if (cb === undefined) _rcv = 'undefined';
      else if (typeof cb === 'string') _rcv = "type string ('" + cb + "')";
      else if (typeof cb === 'number') _rcv = 'type number (' + cb + ')';
      else if (typeof cb === 'boolean') _rcv = 'type boolean (' + cb + ')';
      else if (typeof cb === 'symbol') _rcv = 'type symbol (' + cb.toString() + ')';
      else if (typeof cb === 'object') _rcv = 'an instance of ' + (cb.constructor ? cb.constructor.name : 'Object');
      else _rcv = 'type ' + typeof cb;
      const _e = new TypeError('The last argument must be of type function. Received ' + _rcv);
      _e.code = 'ERR_INVALID_ARG_TYPE'; throw _e;
    }
    fn.apply(this, args).then(
      (r) => process.nextTick(cb.bind(this), null, r),
      // Defer the falsy-value wrapping into the nextTick callback so the wrapped
      // Error's stack[1] is `process.processTicksAndRejections` (Node semantics),
      // not the promise .then handler that created it.
      (e) => process.nextTick(_callbackifyOnRejected, e, cb.bind(this))
    );
  };
  Object.defineProperty(callbackified, 'length', { value: fn.length + 1 });
  Object.defineProperty(callbackified, 'name', { value: fn.name + 'Callbackified' });
  return callbackified;
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
  return str.replace(/(?:\x1B\]|\x9D)[^\x07\x1B\x9C]*(?:\x07|\x1B\\|\x9C)/g, '').replace(/(?:\x1B[@-Z\\-_]|\x9B|\x1B\[)[0-?]*[ -/]*[@-~]/g, '');
}

function parseEnv(content) {
  // dotenv-compatible parser (matches Node's util.parseEnv): handles export prefix,
  // single/double/backtick quoting (incl. multiline), inline comments, and \n/\r
  // escape expansion inside double quotes only.
  if (typeof content !== 'string') {
    const e = new TypeError('The "content" argument must be of type string.' + _invalidArgTypeHelper(content));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  const result = { __proto__: null };
  const src = content.replace(/\r\n?/g, '\n');
  const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\n]+)?\s*(?:#.*)?(?:$|$)/gm;
  let m;
  while ((m = LINE.exec(src)) !== null) {
    const key = m[1];
    let value = (m[2] || '').trim();
    if (value.length >= 2) {
      const f = value[0];
      if ((f === '"' || f === "'" || f === '`') && value[value.length - 1] === f) {
        value = value.slice(1, -1);
        if (f === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
      }
    }
    result[key] = value;
  }
  return result;
}

const ANSI_CODES = {
  reset: [0, 0], bold: [1, 22], dim: [2, 22], faint: [2, 22], italic: [3, 23], underline: [4, 24],
  inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29],
  black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39],
  blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39],
  blackBright: [90, 39], gray: [90, 39], grey: [90, 39],
  redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39],
  blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39],
  bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49],
  bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49],
  bgGray: [100, 49], bgGrey: [100, 49], bgBlackBright: [100, 49],
  bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49],
  bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49],
};

function _parseHexColor(format) {
  if (typeof format !== 'string' || format[0] !== '#') return null;
  const hex = format.slice(1);
  if (hex.length === 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  if (hex.length === 3 && /^[0-9a-fA-F]{3}$/.test(hex)) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  }
  return false; // starts with # but invalid
}

function styleText(format, text, options) {
  if (typeof text !== 'string') {
    let desc;
    if (text === null) desc = 'null';
    else if (text === undefined) desc = 'undefined';
    else if (typeof text === 'object') desc = 'an instance of ' + ((text.constructor && text.constructor.name) || 'Object');
    else if (typeof text === 'symbol') desc = 'type symbol (' + text.toString() + ')';
    else desc = 'type ' + typeof text + ' (' + String(text) + ')';
    const e = new TypeError('The "text" argument must be of type string. Received ' + desc);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  // format must be a style string or an array of them — guard before any string
  // coercion (a Symbol/number format would otherwise throw a raw TypeError downstream).
  if (typeof format !== 'string' && !Array.isArray(format)) {
    const e = new TypeError(`The argument 'format' must be a string or an array of strings. Received ${typeof format === 'symbol' ? format.toString() : String(format)}`);
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
  if (Array.isArray(format)) {
    let result = text;
    for (let i = format.length - 1; i >= 0; i--) result = styleText(format[i], result, options);
    return result;
  }
  if (format === 'none') return text;
  const validateStream = !options || options.validateStream !== false;
  if (validateStream && options && options.stream !== undefined) {
    const stream = options.stream;
    // a provided stream must actually be a writable stream (node rejects e.g. {}).
    if (stream === null || typeof stream !== 'object' || typeof stream.write !== 'function') {
      const e = new TypeError(`The "options.stream" property must be an instance of Stream. Received ${stream === null ? 'null' : typeof stream === 'object' ? 'an instance of ' + ((stream.constructor && stream.constructor.name) || 'Object') : 'type ' + typeof stream}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!stream.isTTY && !process.env.FORCE_COLOR) return String(text);
    if (process.env.NO_COLOR && !process.env.FORCE_COLOR) return String(text);
    if (process.env.NODE_DISABLE_COLORS && !process.env.FORCE_COLOR) return String(text);
    if (process.env.FORCE_COLOR === '0') return String(text);
  }
  const codes = ANSI_CODES[format];
  if (codes) {
    // Restore this style after any nested reset (with content after it) so an inner
    // styleText() doesn't prematurely terminate the outer style. Color resets (39 fg /
    // 49 bg) are replaced by the open code, since setting a color implicitly clears the
    // previous one. Attribute resets (22 intensity, 23, 24, ...) must be kept AND followed
    // by a re-open: e.g. 22 turns off both bold and dim, so we re-emit dim afterwards.
    const open = `\x1b[${codes[0]}m`;
    const closeCode = codes[1];
    const close = `\x1b[${closeCode}m`;
    const isColorReset = closeCode === 39 || closeCode === 49;
    const reopen = new RegExp(`\\x1b\\[${closeCode}m(?=[\\s\\S]+)`, 'g');
    return `${open}${text.replace(reopen, isColorReset ? open : close + open)}${close}`;
  }
  const rgb = _parseHexColor(format);
  if (rgb) {
    const open = `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    const s = String(text);
    // restore this color after any inner foreground reset that has content after it
    const inner = s.replace(/\x1b\[39m(?=[\s\S]+)/g, open);
    return `${open}${inner}\x1b[39m`;
  }
  if (rgb === false) {
    const e = new TypeError(`The argument 'format' must be a valid hex color. Received '${format}'`);
    e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
  }
  // Unknown format name
  const e = new TypeError(`The argument 'format' is invalid. Received '${format}'`);
  e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
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
