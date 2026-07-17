// buffer module — Buffer over Uint8Array + native fast paths via internalBinding('buffer')
'use strict';

const encodings = ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'hex', 'base64', 'base64url', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'];

// error helper for "must be an instance of X" (not "must be of type X")
function _ERR_INVALID_ARG_TYPE_INSTANCE(name, expected, actual) {
  let actualStr;
  if (actual === null) actualStr = 'null';
  else if (actual === undefined) actualStr = 'undefined';
  else if (typeof actual === 'function') actualStr = 'function ' + (actual.name || '');
  else if (typeof actual === 'object') actualStr = 'an instance of ' + (actual.constructor?.name || 'Object');
  else {
    const inspected = typeof actual === 'string' ? "'" + actual + "'" : String(actual);
    actualStr = 'type ' + typeof actual + ' (' + inspected + ')';
  }
  const e = new TypeError(`The "${name}" argument must be an instance of ${expected}. Received ${actualStr}`);
  e.code = 'ERR_INVALID_ARG_TYPE';
  return e;
}

// error helper for "must be one of type X or an instance of Y"
function _ERR_INVALID_ARG_TYPE_ONEOF(name, expected, actual) {
  let actualStr;
  if (actual === null) actualStr = 'null';
  else if (actual === undefined) actualStr = 'undefined';
  else if (typeof actual === 'function') actualStr = 'function ' + (actual.name || '');
  else if (typeof actual === 'object') actualStr = 'an instance of ' + (actual.constructor?.name || 'Object');
  else {
    const inspected = typeof actual === 'string' ? "'" + actual + "'" : String(actual);
    actualStr = 'type ' + typeof actual + ' (' + inspected + ')';
  }
  const e = new TypeError(`The "${name}" argument must be ${expected}. Received ${actualStr}`);
  e.code = 'ERR_INVALID_ARG_TYPE';
  return e;
}

function _bufFromTypeError(value) {
  let received;
  if (value === null) received = '. Received null';
  else if (value === undefined) received = '. Received undefined';
  else if (typeof value === 'number') received = `. Received type number (${value})`;
  else if (typeof value === 'boolean') received = `. Received an instance of Boolean`;
  else if (typeof value === 'symbol') received = `. Received type symbol (${String(value)})`;
  else if (typeof value === 'bigint') received = `. Received type bigint (${value}n)`;
  else if (typeof value === 'function') received = `. Received function ${value.name || ''}`;
  else if (typeof value === 'object') {
    if (value.constructor?.name) received = `. Received an instance of ${value.constructor.name}`;
    else if (Object.getPrototypeOf(value) === null) received = `. Received [[Object: null prototype]]`;
    else received = `. Received [Object]`;
  }
  else received = `. Received type ${typeof value}`;
  const e = new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object' + received);
  e.code = 'ERR_INVALID_ARG_TYPE';
  return e;
}

function _isValidHexString(str) {
  return str.length > 0 && str.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(str);
}

// native bindings for hot paths
const binding = (typeof internalBinding === 'function') ? internalBinding('buffer') : {};
const _nativeFill = binding.fill;
const _nativeFillRange = binding.fillRange;
const _nativeCompare = binding.compare;
const _nativeCopy = binding.copy;
const _nativeIndexOf = binding.indexOf;
const _nativeIndexOfByte = binding.indexOfByte;
const _nativeHexEncode = binding.hexEncode;
const _nativeHexDecode = binding.hexDecode;
// native base64 binding has a bug (returns NUL bytes) — use JS fallback
const _nativeBase64Encode = null;
const _nativeBase64Decode = null;
const _nativeUtf8ByteLength = binding.utf8ByteLength;

function _utf8Encode(str) {
  const a = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) a.push(c);
    else if (c < 0x800) { a.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: only a *valid* following low surrogate forms a 4-byte
      // codepoint; otherwise it's a lone surrogate → U+FFFD (Node/WHATWG, not
      // raw WTF-8). Must verify c2's range — the old code blindly paired.
      const c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        i++;
        const cp = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
        a.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else { a.push(0xef, 0xbf, 0xbd); }
    } else if (c >= 0xdc00 && c <= 0xdfff) { a.push(0xef, 0xbf, 0xbd); }
    else { a.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return a;
}

function _utf8Decode(buf, start, end) {
  let s = '';
  for (let i = start; i < end;) {
    const b = buf[i];
    if (b < 0x80) { s += String.fromCharCode(b); i++; }
    else if ((b & 0xe0) === 0xc0) {
      if (i + 1 >= end || (buf[i+1] & 0xc0) !== 0x80) { s += '�'; i++; continue; }
      s += String.fromCharCode(((b & 0x1f) << 6) | (buf[i+1] & 0x3f)); i += 2;
    } else if ((b & 0xf0) === 0xe0) {
      if (i + 2 >= end || (buf[i+1] & 0xc0) !== 0x80 || (buf[i+2] & 0xc0) !== 0x80) { s += '�'; i++; continue; }
      s += String.fromCharCode(((b & 0x0f) << 12) | ((buf[i+1] & 0x3f) << 6) | (buf[i+2] & 0x3f)); i += 3;
    } else if ((b & 0xf8) === 0xf0) {
      if (i + 3 >= end || (buf[i+1] & 0xc0) !== 0x80 || (buf[i+2] & 0xc0) !== 0x80 || (buf[i+3] & 0xc0) !== 0x80) { s += '�'; i++; continue; }
      const cp = ((b & 0x07) << 18) | ((buf[i+1] & 0x3f) << 12) | ((buf[i+2] & 0x3f) << 6) | (buf[i+3] & 0x3f);
      if (cp > 0x10ffff) { s += '�'; i++; continue; }
      s += String.fromCodePoint(cp); i += 4;
    } else { s += '�'; i++; }
  }
  return s;
}

function _hexEncode(buf, start, end) {
  if (_nativeHexEncode) return _nativeHexEncode(buf.subarray(start, end));
  let s = '';
  for (let i = start; i < end; i++) s += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
  return s;
}

function _hexDecode(str) {
  if (_nativeHexDecode) return _nativeHexDecode(str);
  const a = [];
  for (let i = 0; i + 1 < str.length; i += 2) {
    const hi = _hexVal(str.charCodeAt(i)), lo = _hexVal(str.charCodeAt(i + 1));
    if (hi === -1 || lo === -1) break;
    a.push((hi << 4) | lo);
  }
  return a;
}

function _hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

function _validateByteLength(byteLength) {
  if (typeof byteLength !== 'number') throw _ERR_INVALID_ARG_TYPE('byteLength', 'number', byteLength);
  if (!Number.isFinite(byteLength) && !Number.isNaN(byteLength)) throw _ERR_OUT_OF_RANGE('byteLength', '>= 1 and <= 6', byteLength);
  if (Number.isNaN(byteLength) || byteLength % 1 !== 0) throw _ERR_OUT_OF_RANGE('byteLength', 'an integer', byteLength);
  if (byteLength < 1 || byteLength > 6) throw _ERR_OUT_OF_RANGE('byteLength', '>= 1 and <= 6', byteLength);
}

function _checkOffset(offset, byteLength, bufLength) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== 'number') {
    const e = new TypeError('The "offset" argument must be of type number. Received type ' + typeof offset);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (!Number.isFinite(offset) && !Number.isNaN(offset)) {
    throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${Math.max(0, bufLength - byteLength)}`, offset);
  }
  if (Number.isNaN(offset) || offset % 1 !== 0) {
    throw _ERR_OUT_OF_RANGE('offset', 'an integer', offset);
  }
  if (offset < 0 || offset + byteLength > bufLength) {
    if (bufLength < byteLength) throw _ERR_BUFFER_OUT_OF_BOUNDS();
    throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${Math.max(0, bufLength - byteLength)}`, offset);
  }
  return offset;
}

function _checkWriteOffset(offset, byteLength, bufLength) {
  if (offset === undefined) return 0;
  if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
  if (Number.isNaN(offset) || (Number.isFinite(offset) && offset % 1 !== 0)) { const e = new RangeError(`The value of "offset" is out of range. It must be an integer. Received ${offset}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
  if (offset < 0 || !Number.isFinite(offset) || offset + byteLength > bufLength) {
    if (bufLength < byteLength) throw _ERR_BUFFER_OUT_OF_BOUNDS();
    throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${Math.max(0, bufLength - byteLength)}`, offset);
  }
  return offset;
}

function _checkIntValue(value, min, max) {
  if (typeof value !== 'number') throw _ERR_INVALID_ARG_TYPE('value', 'number', value);
  if (value < min || value > max) {
    let range, received;
    if (max > 0xffffffff || min < -0xffffffff) {
      if (min < 0) range = `>= -(2 ** ${Math.log2(-min)}) and < 2 ** ${Math.log2(max + 1)}`;
      else range = `>= 0 and < 2 ** ${Math.log2(max + 1)}`;
      received = String(value).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1_');
    } else {
      range = `>= ${min} and <= ${max}`;
      received = String(value);
    }
    const e = new RangeError(`The value of "value" is out of range. It must be ${range}. Received ${received}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  if (value % 1 !== 0) {
    const e = new RangeError(`The value of "value" is out of range. It must be an integer. Received ${value}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
}

// bigint64/uint64 writes require an actual bigint in range — DataView.setBigInt64
// silently wraps mod 2^64, so we validate before delegating. `range` is the
// human-readable bound string node uses in its ERR_OUT_OF_RANGE message.
function _checkBigIntValue(value, min, max, range) {
  if (typeof value !== 'bigint') throw _ERR_INVALID_ARG_TYPE('value', 'bigint', value);
  if (value < min || value > max) {
    const received = String(value).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1_') + 'n';
    const e = new RangeError(`The value of "value" is out of range. It must be ${range}. Received ${received}`);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
}
const _INT64_MIN = -(2n ** 63n), _INT64_MAX = 2n ** 63n - 1n, _UINT64_MAX = 2n ** 64n - 1n;

const _b64tab = (() => {
  const t = new Int8Array(256).fill(-1);
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < A.length; i++) t[A.charCodeAt(i)] = i;
  t[45] = 62; // '-' url-safe
  t[95] = 63; // '_' url-safe
  return t;
})();
// Forgiving base64: silently skips any byte outside the alphabet (whitespace,
// '=', stray control chars), decoding the valid remainder rather than throwing
// — matches Node, unlike strict atob().
// indexOf/lastIndexOf can be invoked on an arbitrary receiver (e.g.
// `new Buffer.prototype.lastIndexOf()`); reject anything that isn't an
// ArrayBuffer view before touching .length, matching Node's validateBuffer.
// Cross-realm-safe ArrayBuffer/SharedArrayBuffer test: a vm-context AB fails
// `instanceof` (different realm's constructor) but keeps its [[Class]] tag.
function _isAnyArrayBuffer(v) {
  if (v instanceof ArrayBuffer) return true;
  if (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer) return true;
  const tag = Object.prototype.toString.call(v);
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}
function _validateBufferReceiver(self) {
  if (!ArrayBuffer.isView(self)) {
    const e = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received an instance of ' + ((self && self.constructor && self.constructor.name) || typeof self));
    e.code = 'ERR_INVALID_ARG_TYPE';
    throw e;
  }
}
function _base64Decode(str) {
  const out = [];
  let acc = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const cc = str.charCodeAt(i);
    if (cc === 61) break; // '=' terminates the stream (so '=bad…' decodes to nothing)
    const v = _b64tab[cc & 0xff];
    if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return out;
}

function _base64Encode(buf, start, end) {
  if (_nativeBase64Encode) return _nativeBase64Encode(buf.subarray(start, end));
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

// Legacy `new Buffer()`/`Buffer()` is deprecated (DEP0005). Internal allocations
// go through _newBuffer, which sets _internalCtor so the warning fires only for
// direct user calls. The warning is emitted at most once.
let _internalCtor = false;
let _bufferWarned = false;
const _kNodeModulesRE = /[\\/]node_modules[\\/]/;
// Walk the call stack to the first non-internal frame and report whether its
// script lives in node_modules. Uses getScriptNameOrSourceURL() because milo
// loads modules via eval+`//# sourceURL` (getFileName() is null for those, but
// the sourceURL — incl. a vm runInNewContext filename — is preserved here).
function _isInsideNodeModules() {
  const prevPrep = Error.prepareStackTrace;
  const prevLimit = Error.stackTraceLimit;
  let frames;
  try {
    Error.stackTraceLimit = Infinity;
    Error.prepareStackTrace = (_e, f) => f;
    const holder = {};
    Error.captureStackTrace(holder, _isInsideNodeModules);
    frames = holder.stack;
  } catch { return false; }
  finally { Error.prepareStackTrace = prevPrep; Error.stackTraceLimit = prevLimit; }
  if (!Array.isArray(frames)) return false;
  for (const frame of frames) {
    let name = null;
    try { name = frame.getScriptNameOrSourceURL ? frame.getScriptNameOrSourceURL() : frame.getFileName(); } catch {}
    if (!name || typeof name !== 'string') continue;
    if (name.startsWith('node:')) continue;
    if (name.indexOf('/src/milo/') !== -1) continue; // milo runtime internals (≈ node: core)
    if (name === '[main]' || name === '[eval]' || name === '[require]') continue;
    return _kNodeModulesRE.test(name);
  }
  return false;
}
function _emitBufferDeprecation() {
  if (_bufferWarned) return;
  // Calls originating inside node_modules don't warn unless --pending-deprecation
  // is set. Don't latch _bufferWarned when suppressing, so a later top-level call
  // still warns.
  if (!(typeof process !== 'undefined' && process.pendingDeprecation) && _isInsideNodeModules()) return;
  _bufferWarned = true;
  if (typeof process !== 'undefined' && process.emitWarning) {
    process.emitWarning(
      'Buffer() is deprecated due to security and usability issues. Please use the Buffer.alloc(), Buffer.allocUnsafe(), or Buffer.from() methods instead.',
      'DeprecationWarning', 'DEP0005'
    );
  }
}
function _newBuffer(...args) {
  _internalCtor = true;
  try { return new Buffer(...args); }
  finally { _internalCtor = false; }
}

// Buffer pool: small allocations (allocUnsafe, Buffer.from(string)) share one
// backing ArrayBuffer, so e.g. Buffer.from('a').buffer === Buffer.from('b').buffer.
// The pool AB is marked untransferable (refs nodejs/node#32752) so postMessage and
// ArrayBuffer.prototype.transfer cannot steal other live buffers' memory.
let _poolSize, _poolOffset, _allocPool;
function _createPool() {
  _poolSize = Buffer.poolSize;
  _allocPool = new ArrayBuffer(_poolSize);
  if (globalThis.__untransferable) globalThis.__untransferable.add(_allocPool);
  _poolOffset = 0;
}
function _alignPool() {
  // Keep 8-byte alignment so DataView/typed-array views over pooled buffers stay aligned.
  if (_poolOffset & 0x7) { _poolOffset |= 0x7; _poolOffset++; }
}
function _poolAlloc(size) {
  if (size <= 0) return _newBuffer(new ArrayBuffer(0));
  if (size < (Buffer.poolSize >>> 1)) {
    if (_allocPool === undefined || size > _poolSize - _poolOffset) _createPool();
    const b = _newBuffer(_allocPool, _poolOffset, size);
    _poolOffset += size;
    _alignPool();
    return b;
  }
  return _newBuffer(new ArrayBuffer(size));
}

class Buffer extends Uint8Array {
  constructor(arg, byteOffsetOrEncoding, length) {
    if (!_internalCtor) _emitBufferDeprecation();
    if (typeof arg === 'number' && typeof byteOffsetOrEncoding === 'string') {
      const e = new TypeError('The "string" argument must be of type string. Received type number (' + arg + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    // new Buffer(string, encoding) — delegate to from() logic
    if (typeof arg === 'string' && typeof byteOffsetOrEncoding === 'string') {
      const tmp = Buffer.from(arg, byteOffsetOrEncoding);
      super(tmp.buffer, tmp.byteOffset, tmp.byteLength);
      return;
    }
    if (arguments.length === 3) super(arg, byteOffsetOrEncoding, length);
    else if (arguments.length === 2) super(arg, byteOffsetOrEncoding);
    else super(arg);
  }
  static alloc(size, fill, encoding) {
    if (typeof size !== 'number') throw _ERR_INVALID_ARG_TYPE('size', 'number', size);
    if (size < 0 || Number.isNaN(size) || size > Buffer.kMaxLength) {
      const err = new RangeError(`The value "${size}" is invalid for option "size"`);
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    const buf = _newBuffer(size);
    if (fill !== undefined) {
      if (encoding !== undefined && typeof encoding !== 'string') {
        throw _ERR_INVALID_ARG_TYPE('encoding', 'string', encoding);
      }
      if (typeof fill === 'string') {
        if (fill.length === 0) return buf;
        if (encoding !== undefined) {
          const enc = encoding.toLowerCase();
          if (!Buffer.isEncoding(enc)) throw _ERR_UNKNOWN_ENCODING(encoding);
          if (enc === 'hex') {
            if (!_isValidHexString(fill)) throw _ERR_INVALID_ARG_VALUE('value', fill);
          }
        }
        const fillBuf = Buffer.from(fill, encoding);
        if (fillBuf.length === 0) throw _ERR_INVALID_ARG_VALUE('value', fill);
        for (let i = 0; i < size; i++) buf[i] = fillBuf[i % fillBuf.length];
      } else if (typeof fill === 'number') {
        buf.fill(fill);
      } else if (Buffer.isBuffer(fill) || fill instanceof Uint8Array) {
        if (fill.length === 0) throw _ERR_INVALID_ARG_VALUE('value', fill);
        for (let i = 0; i < size; i++) buf[i] = fill[i % fill.length];
      }
    }
    return buf;
  }

  static allocUnsafe(size) {
    if (typeof size !== 'number') throw _ERR_INVALID_ARG_TYPE('size', 'number', size);
    if (size < 0 || Number.isNaN(size) || size > Buffer.kMaxLength) {
      const err = new RangeError(`The value "${size}" is invalid for option "size"`);
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    return _poolAlloc(size);
  }

  static allocUnsafeSlow(size) {
    if (typeof size !== 'number') throw _ERR_INVALID_ARG_TYPE('size', 'number', size);
    if (size < 0 || Number.isNaN(size) || size > Buffer.kMaxLength) {
      const err = new RangeError(`The value "${size}" is invalid for option "size"`);
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    // Allocate from a bare typed array (not an explicit ArrayBuffer) so V8 keeps
    // small instances on-heap with no backing store until .buffer is touched —
    // matches Node's createUnsafeBuffer / arrayBufferViewHasBuffer semantics.
    return _newBuffer(size);
  }

  static from(value, encodingOrOffset, length) {
    if (value === null || value === undefined) throw _bufFromTypeError(value);
    if (typeof value === 'number') throw _bufFromTypeError(value);
    if (typeof value === 'string') {
      const enc = (typeof encodingOrOffset === 'string' ? encodingOrOffset : 'utf8').toLowerCase();
      if (!Buffer.isEncoding(enc)) throw _ERR_UNKNOWN_ENCODING(encodingOrOffset || 'utf8');
      if (enc === 'hex') {
        if (_nativeHexDecode) {
          const u8 = _nativeHexDecode(value);
          Object.setPrototypeOf(u8, Buffer.prototype);
          return u8;
        }
        return _newBuffer(_hexDecode(value));
      }
      if (enc === 'base64' || enc === 'base64url') {
        if (_nativeBase64Decode) {
          // Native may reject invalid input; fall back to the forgiving JS
          // decoder so stray chars are skipped rather than thrown on.
          try {
            const u8 = _nativeBase64Decode(value.replace(/-/g, '+').replace(/_/g, '/'));
            Object.setPrototypeOf(u8, Buffer.prototype);
            return u8;
          } catch { /* fall through */ }
        }
        return _newBuffer(_base64Decode(value));
      }
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
        const a = _poolAlloc(value.length);
        for (let i = 0; i < value.length; i++) a[i] = value.charCodeAt(i) & 0xff;
        return a;
      }
      if (enc === 'ucs2' || enc === 'ucs-2' || enc === 'utf16le' || enc === 'utf-16le') {
        const a = _poolAlloc(value.length * 2);
        for (let i = 0; i < value.length; i++) {
          const c = value.charCodeAt(i);
          a[i * 2] = c & 0xff;
          a[i * 2 + 1] = (c >> 8) & 0xff;
        }
        return a;
      }
      const bytes = _utf8Encode(value);
      const a = _poolAlloc(bytes.length);
      a.set(bytes);
      return a;
    }
    if (_isAnyArrayBuffer(value)) {
      // A fake AB inherits ArrayBuffer.prototype (instanceof passes) but has no real
      // slot — its byteLength getter throws "incompatible receiver"; treat as bad arg.
      let bl;
      try { bl = value.byteLength; } catch { throw _bufFromTypeError(value); }
      // byteOffset: coerce to number, non-numeric defaults to 0.
      let offset = +encodingOrOffset;
      if (Number.isNaN(offset)) offset = 0;
      if (offset < 0 || offset > bl) { const e = new RangeError('"offset" is outside of buffer bounds'); e.code = 'ERR_BUFFER_OUT_OF_BOUNDS'; throw e; }
      // length: undefined → rest of buffer; otherwise coerce, non-numeric → 0.
      let len;
      if (length === undefined) len = bl - offset;
      else { len = +length; if (Number.isNaN(len)) len = 0; }
      if (len < 0 || offset + len > bl) { const e = new RangeError('"length" is outside of buffer bounds'); e.code = 'ERR_BUFFER_OUT_OF_BOUNDS'; throw e; }
      // Resizable/growable AB with no explicit length → length-tracking view, so
      // buffer.byteLength follows ab.resize()/grow(). Passing len would freeze it.
      const view = (length === undefined && (value.resizable || value.growable))
        ? new Uint8Array(value, offset)
        : new Uint8Array(value, offset, len);
      Object.setPrototypeOf(view, Buffer.prototype);
      return view;
    }
    if (Array.isArray(value) || value instanceof Uint8Array) return _newBuffer(value);
    // Non-Uint8Array TypedArrays (Uint32Array, Int16Array, …) are copied
    // element-wise mod 256 as an array of integers, NOT byte-reinterpreted —
    // matches Node's fromArrayLike. Must precede the `.buffer` view path below.
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return _newBuffer(Array.from(value));
    if (Buffer.isBuffer(value)) { const c = _newBuffer(value.length); c.set(value); return c; }
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) return _newBuffer(value.data);
    if (value && typeof value === 'object' && _isAnyArrayBuffer(value.buffer)) {
      return Buffer.from(value.buffer, value.byteOffset || 0, value.byteLength !== undefined ? value.byteLength : value.buffer.byteLength);
    }
    // String objects and objects with Symbol.toPrimitive/valueOf that return a string
    if (value && typeof value === 'object') {
      let primitive;
      if (typeof value[Symbol.toPrimitive] === 'function') primitive = value[Symbol.toPrimitive]('string');
      else if (typeof value.valueOf === 'function') primitive = value.valueOf();
      if (typeof primitive === 'string') return Buffer.from(primitive, encodingOrOffset);
      // Array-like: any own `length` makes it valid. A non-numeric length yields
      // an empty buffer (Node returns new FastBuffer()); a numeric one is copied
      // element-wise via ToLength (so 3.3 → 3, 'BAM'/NaN → 0).
      if (value.length !== undefined) {
        if (typeof value.length !== 'number') return _newBuffer(0);
        return _newBuffer(Array.from(value));
      }
    }
    throw _bufFromTypeError(value);
  }

  static isBuffer(obj) { return obj instanceof Buffer; }
  static isEncoding(enc) { return typeof enc === 'string' && encodings.includes(enc.toLowerCase()); }

  static byteLength(str, encoding) {
    if (typeof str !== 'string') {
      // toStringTag brand check also accepts ArrayBuffers from another realm (vm).
      const _tag = str != null && typeof str === 'object' ? Object.prototype.toString.call(str) : '';
      if (ArrayBuffer.isView(str) || str instanceof ArrayBuffer || str instanceof SharedArrayBuffer ||
          _tag === '[object ArrayBuffer]' || _tag === '[object SharedArrayBuffer]') return str.byteLength;
      if (typeof str !== 'string') {
        throw _ERR_INVALID_ARG_TYPE('string', 'string or an instance of Buffer or ArrayBuffer', str);
      }
    }
    const enc = (encoding || 'utf8').toLowerCase();
    if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') return str.length;
    if (enc === 'ucs2' || enc === 'ucs-2' || enc === 'utf16le' || enc === 'utf-16le') return str.length * 2;
    if (enc === 'hex') return str.length >>> 1;
    if (enc === 'base64' || enc === 'base64url') {
      let validLen = 0;
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        // A-Z, a-z, 0-9, +, /, -, _
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 45 || c === 95) validLen++;
      }
      return (validLen * 3) >>> 2;
    }
    // utf8 — use native if available
    if (_nativeUtf8ByteLength) return _nativeUtf8ByteLength(str);
    return Buffer.from(str, encoding).length;
  }

  static concat(list, totalLength) {
    if (!Array.isArray(list)) {
      throw _ERR_INVALID_ARG_TYPE_INSTANCE('list', 'Array', list);
    }
    if (list.length === 0) return Buffer.alloc(0);
    if (totalLength !== undefined) {
      if (typeof totalLength !== 'number' || !Number.isInteger(totalLength)) {
        throw _ERR_OUT_OF_RANGE('length', 'an integer', totalLength);
      }
      if (totalLength < 0 || totalLength > Buffer.kMaxLength) {
        throw _ERR_OUT_OF_RANGE('length', `>= 0 && <= ${Buffer.kMaxLength}`, totalLength);
      }
    }
    // validate each element
    for (let i = 0; i < list.length; i++) {
      if (!(list[i] instanceof Uint8Array)) {
        throw _ERR_INVALID_ARG_TYPE_INSTANCE(`list[${i}]`, 'Buffer or Uint8Array', list[i]);
      }
    }
    if (totalLength === undefined) {
      totalLength = 0;
      for (let i = 0; i < list.length; i++) totalLength += list[i].byteLength;
    }
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (let i = 0; i < list.length; i++) {
      const buf = list[i];
      // use byteLength to avoid spoofed .length
      const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const copyLen = Math.min(src.length, totalLength - offset);
      if (copyLen <= 0) continue;
      result.set(src.subarray(0, copyLen), offset);
      offset += copyLen;
      if (offset >= totalLength) break;
    }
    return result;
  }

  static copyBytesFrom(source, sourceOffset, length) {
    if (!ArrayBuffer.isView(source)) throw _ERR_INVALID_ARG_TYPE('source', 'TypedArray', source);
    if (sourceOffset !== undefined) {
      if (typeof sourceOffset !== 'number') throw _ERR_INVALID_ARG_TYPE('sourceOffset', 'number', sourceOffset);
      if (sourceOffset < 0 || sourceOffset !== (sourceOffset | 0) || !Number.isFinite(sourceOffset)) throw _ERR_OUT_OF_RANGE('sourceOffset', '>= 0', sourceOffset);
    }
    if (length !== undefined) {
      if (typeof length !== 'number') throw _ERR_INVALID_ARG_TYPE('length', 'number', length);
      if (length < 0 || length !== (length | 0) || !Number.isFinite(length)) throw _ERR_OUT_OF_RANGE('length', '>= 0', length);
    }
    const bytesPerElement = source.BYTES_PER_ELEMENT || 1;
    const srcOffset = (sourceOffset || 0) * bytesPerElement;
    const srcLen = length !== undefined ? length * bytesPerElement : source.byteLength - srcOffset;
    const actualLen = Math.max(0, Math.min(srcLen, source.byteLength - srcOffset));
    if (actualLen === 0) return Buffer.alloc(0);
    const u8 = new Uint8Array(source.buffer, source.byteOffset + srcOffset, actualLen);
    const buf = Buffer.alloc(actualLen);
    buf.set(u8);
    return buf;
  }

  static compare(a, b) {
    // ArrayBuffer.isView is a real-brand check; a fake that merely inherits
    // Buffer.prototype passes `instanceof` but isn't an actual typed array.
    if (!(a instanceof Uint8Array) || !ArrayBuffer.isView(a)) throw _ERR_INVALID_ARG_TYPE_INSTANCE('buf1', 'Buffer or Uint8Array', a);
    if (!(b instanceof Uint8Array) || !ArrayBuffer.isView(b)) throw _ERR_INVALID_ARG_TYPE_INSTANCE('buf2', 'Buffer or Uint8Array', b);
    if (_nativeCompare) return _nativeCompare(a, b);
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
  }

  write(str, offset, length, encoding) {
    if (typeof str !== 'string') throw _ERR_INVALID_ARG_TYPE('string', 'string', str);
    // matches real Node: write(string, encoding) only when length is undefined
    if (length === undefined && typeof offset === 'string') {
      encoding = offset;
      length = this.length;
      offset = 0;
    } else {
      // offset must be a valid integer
      if (offset !== undefined && typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
      offset = offset || 0;
      if (offset < 0 || offset > this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 && <= ${this.length}`, offset);
      const remaining = this.length - offset;
      if (length === undefined) {
        length = remaining;
      } else if (typeof length === 'string') {
        encoding = length;
        length = remaining;
      } else {
        if (length > remaining) length = remaining;
      }
    }
    encoding = encoding || 'utf8';
    if (!Buffer.isEncoding(encoding)) throw _ERR_UNKNOWN_ENCODING(encoding);
    const enc = encoding.toLowerCase();
    const bytes = Buffer.from(str, enc);
    let len = Math.min(bytes.length, length);
    // for 2-byte encodings, only write whole characters
    if (enc === 'ucs2' || enc === 'ucs-2' || enc === 'utf16le' || enc === 'utf-16le') {
      len = len & ~1; // round down to even
    } else if ((enc === 'utf8' || enc === 'utf-8') && len < bytes.length && (bytes[len] & 0xc0) === 0x80) {
      // The cut falls inside a multibyte sequence — Node never writes a partial
      // character, so back up to the lead byte of the incomplete char.
      do { len--; } while (len > 0 && (bytes[len] & 0xc0) === 0x80);
    }
    this.set(bytes.subarray(0, len), offset);
    return len;
  }

  toString(encoding, start, end) {
    if (encoding !== undefined && typeof encoding !== 'string') {
      if (encoding !== null && typeof encoding === 'object' && typeof encoding.toString === 'function') encoding = encoding.toString();
      else { const e = new TypeError(`Unknown encoding: ${encoding}`); e.code = 'ERR_UNKNOWN_ENCODING'; throw e; }
    }
    encoding = (encoding || 'utf8').toLowerCase();
    if (!Buffer.isEncoding(encoding)) throw _ERR_UNKNOWN_ENCODING(encoding);
    start = Number(start) || 0;
    if (start < 0 || !Number.isFinite(start)) start = start > 0 ? this.length : 0;
    start = Math.floor(start);
    if (start > this.length) start = this.length;
    end = end !== undefined ? (Number(end) || 0) : this.length;
    if (end < 0 || !Number.isFinite(end)) end = end > 0 ? this.length : 0;
    end = Math.floor(end);
    if (end > this.length) end = this.length;
    if (end <= start) return '';
    // guard against strings too long for V8
    const MAX_STRING_LENGTH = 2 ** 28 - 16;
    if (end - start > MAX_STRING_LENGTH) {
      const e = new Error('Cannot create a string longer than 0x' + MAX_STRING_LENGTH.toString(16) + ' characters');
      e.code = 'ERR_STRING_TOO_LONG';
      throw e;
    }
    if (encoding === 'hex') return _hexEncode(this, start, end);
    if (encoding === 'base64') return _base64Encode(this, start, end);
    if (encoding === 'base64url') return _base64Encode(this, start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (encoding === 'ascii') {
      // Node's 'ascii' decode masks the high bit (byte & 0x7f), unlike latin1.
      let s = '';
      for (let i = start; i < end; i++) s += String.fromCharCode(this[i] & 0x7f);
      return s;
    }
    if (encoding === 'latin1' || encoding === 'binary') {
      let s = '';
      for (let i = start; i < end; i++) s += String.fromCharCode(this[i]);
      return s;
    }
    if (encoding === 'ucs2' || encoding === 'ucs-2' || encoding === 'utf16le' || encoding === 'utf-16le') {
      let s = '';
      for (let i = start; i + 1 < end; i += 2) s += String.fromCharCode(this[i] | (this[i + 1] << 8));
      return s;
    }
    return _utf8Decode(this, start, end);
  }

  // On Buffer.prototype itself (not a real view) the underlying .buffer/.byteOffset
  // getters throw "incompatible receiver"; Node's prototype getters yield undefined.
  get parent() { try { return this.buffer; } catch { return undefined; } }
  get offset() { try { return this.byteOffset; } catch { return undefined; } }

  inspect(recurseTimes, ctx) {
    const max = _exports.INSPECT_MAX_BYTES;
    const hex = [];
    for (let i = 0; i < Math.min(this.length, max); i++) hex.push(this[i].toString(16).padStart(2, '0'));
    let str = hex.join(' ');
    if (this.length > max) { const rem = this.length - max; str += ' ... ' + rem + ' more byte' + (rem !== 1 ? 's' : ''); }
    // When inspected via util.inspect (ctx present), append own enumerable
    // non-index properties: `<Buffer 31 32, prop: 1>`. Render them through a
    // null-proto object and strip util's `[Object: null prototype] { … }`
    // wrapper (27-char prefix, 2-char suffix), matching Node.
    if (ctx) {
      const obj = { __proto__: null };
      let extras = false;
      for (const key of Object.keys(this)) {
        if (/^(?:0|[1-9]\d*)$/.test(key) && Number(key) < this.length) continue; // skip byte indices
        extras = true; obj[key] = this[key];
      }
      if (extras) {
        if (this.length !== 0) str += ', ';
        const inner = require('util').inspect(obj, { ...ctx, breakLength: Infinity, compact: true });
        str += inner.slice(27, -2);
      }
    }
    return '<Buffer ' + str + '>';
  }

  [Symbol.for('nodejs.util.inspect.custom')](recurseTimes, ctx) {
    if (typeof this.inspect === 'function') return this.inspect(recurseTimes, ctx);
    return Buffer.prototype.inspect.call(this, recurseTimes, ctx);
  }

  toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
  equals(other) {
    if (!(other instanceof Uint8Array)) { const v = typeof other === 'string' ? "('" + other + "')" : '(' + String(other) + ')'; const e = new TypeError('The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received type ' + typeof other + ' ' + v); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (this.length !== other.length) return false;
    if (_nativeCompare) return _nativeCompare(this, other) === 0;
    return Buffer.compare(this, other) === 0;
  }
  compare(other, targetStart, targetEnd, sourceStart, sourceEnd) {
    if (!(other instanceof Uint8Array)) throw _ERR_INVALID_ARG_TYPE_INSTANCE('target', 'Buffer or Uint8Array', other);
    if (targetStart !== undefined && typeof targetStart !== 'number') throw _ERR_INVALID_ARG_TYPE('targetStart', 'number', targetStart);
    if (targetEnd !== undefined && targetEnd !== null && typeof targetEnd !== 'number') throw _ERR_INVALID_ARG_TYPE('targetEnd', 'number', targetEnd);
    if (targetEnd === null) throw _ERR_INVALID_ARG_TYPE('targetEnd', 'number', targetEnd);
    if (sourceStart !== undefined && typeof sourceStart !== 'number') throw _ERR_INVALID_ARG_TYPE('sourceStart', 'number', sourceStart);
    if (sourceEnd !== undefined && typeof sourceEnd !== 'number') throw _ERR_INVALID_ARG_TYPE('sourceEnd', 'number', sourceEnd);
    targetStart = targetStart !== undefined ? targetStart : 0;
    targetEnd = targetEnd !== undefined ? targetEnd : other.length;
    sourceStart = sourceStart !== undefined ? sourceStart : 0;
    sourceEnd = sourceEnd !== undefined ? sourceEnd : this.length;
    if (targetStart < 0) throw _ERR_OUT_OF_RANGE('targetStart', `>= 0`, targetStart);
    if (targetEnd < 0 || targetEnd > other.length) throw _ERR_OUT_OF_RANGE('targetEnd', `>= 0 && <= ${other.length}`, targetEnd);
    if (sourceStart < 0) throw _ERR_OUT_OF_RANGE('sourceStart', `>= 0`, sourceStart);
    if (sourceEnd < 0 || sourceEnd > this.length) throw _ERR_OUT_OF_RANGE('sourceEnd', `>= 0 && <= ${this.length}`, sourceEnd);
    const src = this.subarray(sourceStart, sourceEnd);
    const tgt = other.subarray(targetStart, targetEnd);
    if (_nativeCompare) return _nativeCompare(src, tgt);
    const len = Math.min(src.length, tgt.length);
    for (let i = 0; i < len; i++) { if (src[i] < tgt[i]) return -1; if (src[i] > tgt[i]) return 1; }
    return src.length < tgt.length ? -1 : src.length > tgt.length ? 1 : 0;
  }
  copy(target, targetStart, sourceStart, sourceEnd) {
    if (!target || typeof target !== 'object' || (!ArrayBuffer.isView(target) && !(target instanceof ArrayBuffer) && !(target instanceof SharedArrayBuffer))) {
      // Node renders undefined/null without the "type" prefix.
      const recv = target === undefined ? 'undefined' : target === null ? 'null' : 'type ' + typeof target;
      const err = new TypeError('The "target" argument must be an instance of Buffer or Uint8Array. Received ' + recv);
      err.code = 'ERR_INVALID_ARG_TYPE'; throw err;
    }
    if (ArrayBuffer.isView(target) && !(target instanceof Uint8Array)) {
      target = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    }
    targetStart = targetStart !== undefined ? +targetStart : 0;
    sourceStart = sourceStart !== undefined ? +sourceStart : 0;
    sourceEnd = sourceEnd !== undefined ? +sourceEnd : this.length;
    if (targetStart < 0) { const e = new RangeError('The value of "targetStart" is out of range. It must be >= 0. Received ' + targetStart); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (sourceStart < 0) { const e = new RangeError('The value of "sourceStart" is out of range. It must be >= 0. Received ' + sourceStart); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (sourceEnd < 0) { const e = new RangeError('The value of "sourceEnd" is out of range. It must be >= 0. Received ' + sourceEnd); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (sourceStart > this.length) { const e = new RangeError('The value of "sourceStart" is out of range. It must be <= ' + this.length + '. Received ' + sourceStart); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    targetStart >>>= 0; sourceStart >>>= 0; sourceEnd >>>= 0;
    if (sourceEnd > this.length) sourceEnd = this.length;
    if (targetStart >= target.length || sourceStart >= sourceEnd) return 0;
    if (_nativeCopy) return _nativeCopy(this, target, targetStart, sourceStart, Math.min(sourceEnd, sourceStart + target.length - targetStart));
    const len = Math.min(sourceEnd - sourceStart, target.length - targetStart);
    target.set(this.subarray(sourceStart, sourceStart + len), targetStart);
    return len;
  }

  slice(start, end) {
    const s = this.subarray(start, end);
    Object.setPrototypeOf(s, Buffer.prototype);
    return s;
  }

  indexOf(value, byteOffset, encoding) {
    _validateBufferReceiver(this);
    // 4-arg form: indexOf(value, byteOffset, end, encoding) for limiting search range
    let searchEnd = this.length;
    if (arguments.length >= 4) {
      searchEnd = arguments[2];
      encoding = arguments[3];
    } else if (arguments.length === 3 && typeof encoding === 'number') {
      // indexOf(value, byteOffset, end) — end is a number
      searchEnd = encoding;
      encoding = undefined;
    } else if (arguments.length === 2 && typeof byteOffset === 'string') {
      // indexOf(value, encoding)
      encoding = byteOffset;
      byteOffset = 0;
    }

    // clamp searchEnd
    if (searchEnd < 0) searchEnd = 0;
    if (searchEnd > this.length) searchEnd = this.length;

    if (typeof value === 'number') {
      // resolve negative offset
      let start = +byteOffset || 0;
      if (start < 0) start = this.length + start;
      if (start < 0) start = 0;
      if (start >= searchEnd) return -1;
      const byte = value & 0xff;
      for (let i = start; i < searchEnd; i++) {
        if (this[i] === byte) return i;
      }
      return -1;
    }
    if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
      throw _ERR_INVALID_ARG_TYPE_ONEOF('value', 'one of type number or string or an instance of Buffer or Uint8Array', value);
    }
    if (typeof value === 'string' && encoding !== undefined) {
      const enc = (typeof encoding === 'string' ? encoding : '').toLowerCase();
      if (enc && !Buffer.isEncoding(enc)) throw _ERR_UNKNOWN_ENCODING(encoding);
    }
    const needle = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : Buffer.from(value, encoding);
    // resolve negative offset
    let start = +byteOffset || 0;
    if (start < 0) start = this.length + start;
    if (start < 0) start = 0;
    if (needle.length === 0) return Math.min(start, searchEnd);
    if (start >= searchEnd) return -1;
    // ucs2/utf16le: search in 2-byte units. A match must be even-aligned and
    // both haystack and needle need >=2 bytes to form a 16-bit unit, so a
    // 1-byte needle can never match (Node's IndexOfBuffer UCS2 path).
    const _normEnc = typeof encoding === 'string' ? encoding.toLowerCase() : undefined;
    if (_normEnc === 'ucs2' || _normEnc === 'ucs-2' || _normEnc === 'utf16le' || _normEnc === 'utf-16le') {
      if (this.length < 2 || needle.length < 2) return -1;
      if (start & 1) start++;
      for (let i = start; i + needle.length <= searchEnd; i += 2) {
        let found = true;
        for (let j = 0; j < needle.length; j++) { if (this[i + j] !== needle[j]) { found = false; break; } }
        if (found) return i;
      }
      return -1;
    }
    if (_nativeIndexOf && searchEnd === this.length) return _nativeIndexOf(this, needle, start);
    for (let i = start; i <= searchEnd - needle.length; i++) {
      let found = true;
      for (let j = 0; j < needle.length; j++) { if (this[i + j] !== needle[j]) { found = false; break; } }
      if (found) return i;
    }
    return -1;
  }

  includes(value, byteOffset, encoding) { return this.indexOf(value, byteOffset, encoding) !== -1; }

  readUInt8(offset) { offset = _checkOffset(offset, 1, this.length); return this[offset]; }
  readUInt16BE(offset) { offset = _checkOffset(offset, 2, this.length); return (this[offset] << 8) | this[offset + 1]; }
  readUInt16LE(offset) { offset = _checkOffset(offset, 2, this.length); return this[offset] | (this[offset + 1] << 8); }
  readUInt32BE(offset) { offset = _checkOffset(offset, 4, this.length); return ((this[offset] << 24) | (this[offset+1] << 16) | (this[offset+2] << 8) | this[offset+3]) >>> 0; }
  readUInt32LE(offset) { offset = _checkOffset(offset, 4, this.length); return ((this[offset+3] << 24) | (this[offset+2] << 16) | (this[offset+1] << 8) | this[offset]) >>> 0; }
  readInt8(offset) { offset = _checkOffset(offset, 1, this.length); const v = this[offset]; return v > 127 ? v - 256 : v; }
  readInt16BE(offset) { offset = _checkOffset(offset, 2, this.length); const v = (this[offset] << 8) | this[offset + 1]; return v > 0x7fff ? v - 0x10000 : v; }
  readInt16LE(offset) { offset = _checkOffset(offset, 2, this.length); const v = this[offset] | (this[offset + 1] << 8); return v > 0x7fff ? v - 0x10000 : v; }
  readInt32BE(offset) { offset = _checkOffset(offset, 4, this.length); return (this[offset] << 24) | (this[offset+1] << 16) | (this[offset+2] << 8) | this[offset+3]; }
  readInt32LE(offset) { offset = _checkOffset(offset, 4, this.length); return (this[offset+3] << 24) | (this[offset+2] << 16) | (this[offset+1] << 8) | this[offset]; }
  readFloatBE(offset) { offset = _checkOffset(offset, 4, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat32(offset, false); }
  readFloatLE(offset) { offset = _checkOffset(offset, 4, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat32(offset, true); }
  readDoubleBE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat64(offset, false); }
  readDoubleLE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat64(offset, true); }

  writeUInt8(value, offset) { _checkIntValue(value, 0, 0xff); offset = _checkWriteOffset(offset, 1, this.length); this[offset] = value & 0xff; return offset + 1; }
  writeUInt16BE(value, offset) { _checkIntValue(value, 0, 0xffff); offset = _checkWriteOffset(offset, 2, this.length); this[offset] = (value >> 8) & 0xff; this[offset+1] = value & 0xff; return offset + 2; }
  writeUInt16LE(value, offset) { _checkIntValue(value, 0, 0xffff); offset = _checkWriteOffset(offset, 2, this.length); this[offset] = value & 0xff; this[offset+1] = (value >> 8) & 0xff; return offset + 2; }
  writeUInt32BE(value, offset) { _checkIntValue(value, 0, 0xffffffff); offset = _checkWriteOffset(offset, 4, this.length); this[offset] = (value >>> 24) & 0xff; this[offset+1] = (value >>> 16) & 0xff; this[offset+2] = (value >>> 8) & 0xff; this[offset+3] = value & 0xff; return offset + 4; }
  writeUInt32LE(value, offset) { _checkIntValue(value, 0, 0xffffffff); offset = _checkWriteOffset(offset, 4, this.length); this[offset] = value & 0xff; this[offset+1] = (value >>> 8) & 0xff; this[offset+2] = (value >>> 16) & 0xff; this[offset+3] = (value >>> 24) & 0xff; return offset + 4; }
  writeInt8(value, offset) { _checkIntValue(value, -0x80, 0x7f); offset = _checkWriteOffset(offset, 1, this.length); this[offset] = value < 0 ? value + 256 : value; return offset + 1; }
  writeInt16BE(value, offset) { _checkIntValue(value, -0x8000, 0x7fff); offset = _checkWriteOffset(offset, 2, this.length); const v = value < 0 ? value + 0x10000 : value; this[offset] = (v >> 8) & 0xff; this[offset+1] = v & 0xff; return offset + 2; }
  writeInt16LE(value, offset) { _checkIntValue(value, -0x8000, 0x7fff); offset = _checkWriteOffset(offset, 2, this.length); const v = value < 0 ? value + 0x10000 : value; this[offset] = v & 0xff; this[offset+1] = (v >> 8) & 0xff; return offset + 2; }
  writeInt32BE(value, offset) { _checkIntValue(value, -0x80000000, 0x7fffffff); offset = _checkWriteOffset(offset, 4, this.length); const v = value < 0 ? value + 0x100000000 : value; this[offset] = (v >>> 24) & 0xff; this[offset+1] = (v >>> 16) & 0xff; this[offset+2] = (v >>> 8) & 0xff; this[offset+3] = v & 0xff; return offset + 4; }
  writeInt32LE(value, offset) { _checkIntValue(value, -0x80000000, 0x7fffffff); offset = _checkWriteOffset(offset, 4, this.length); const v = value < 0 ? value + 0x100000000 : value; this[offset] = v & 0xff; this[offset+1] = (v >>> 8) & 0xff; this[offset+2] = (v >>> 16) & 0xff; this[offset+3] = (v >>> 24) & 0xff; return offset + 4; }
  writeFloatBE(value, offset) { offset = _checkWriteOffset(offset, 4, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat32(offset, value, false); return offset + 4; }
  writeFloatLE(value, offset) { offset = _checkWriteOffset(offset, 4, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat32(offset, value, true); return offset + 4; }
  writeDoubleBE(value, offset) { offset = _checkWriteOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat64(offset, value, false); return offset + 8; }
  writeDoubleLE(value, offset) { offset = _checkWriteOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat64(offset, value, true); return offset + 8; }

  readUIntBE(offset, byteLength) {
    _validateByteLength(byteLength);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkOffset(offset, byteLength, this.length);
    let val = 0;
    for (let i = 0; i < byteLength; i++) val = val * 256 + this[offset + i];
    return val;
  }
  readUIntLE(offset, byteLength) {
    _validateByteLength(byteLength);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkOffset(offset, byteLength, this.length);
    let val = 0; let mul = 1;
    for (let i = 0; i < byteLength; i++) { val += this[offset + i] * mul; mul *= 256; }
    return val;
  }
  readIntBE(offset, byteLength) {
    _validateByteLength(byteLength);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkOffset(offset, byteLength, this.length);
    let val = this.readUIntBE(offset, byteLength);
    if (val >= Math.pow(2, 8 * byteLength - 1)) val -= Math.pow(2, 8 * byteLength);
    return val;
  }
  readIntLE(offset, byteLength) {
    _validateByteLength(byteLength);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkOffset(offset, byteLength, this.length);
    let val = this.readUIntLE(offset, byteLength);
    if (val >= Math.pow(2, 8 * byteLength - 1)) val -= Math.pow(2, 8 * byteLength);
    return val;
  }
  writeUIntBE(value, offset, byteLength) {
    if (typeof byteLength !== 'number') throw _ERR_INVALID_ARG_TYPE('byteLength', 'number', byteLength);
    if (Number.isNaN(byteLength) || (Number.isFinite(byteLength) && byteLength % 1 !== 0)) { const e = new RangeError(`The value of "byteLength" is out of range. It must be an integer. Received ${byteLength}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (byteLength < 1 || byteLength > 6) throw _ERR_OUT_OF_RANGE('byteLength', '>= 1 and <= 6', byteLength);
    _checkIntValue(value, 0, Math.pow(2, 8 * byteLength) - 1);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkWriteOffset(offset, byteLength, this.length);
    for (let i = byteLength - 1; i >= 0; i--) { this[offset + i] = value & 0xff; value = Math.floor(value / 256); }
    return offset + byteLength;
  }
  writeUIntLE(value, offset, byteLength) {
    if (typeof byteLength !== 'number') throw _ERR_INVALID_ARG_TYPE('byteLength', 'number', byteLength);
    if (Number.isNaN(byteLength) || (Number.isFinite(byteLength) && byteLength % 1 !== 0)) { const e = new RangeError(`The value of "byteLength" is out of range. It must be an integer. Received ${byteLength}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (byteLength < 1 || byteLength > 6) throw _ERR_OUT_OF_RANGE('byteLength', '>= 1 and <= 6', byteLength);
    _checkIntValue(value, 0, Math.pow(2, 8 * byteLength) - 1);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkWriteOffset(offset, byteLength, this.length);
    for (let i = 0; i < byteLength; i++) { this[offset + i] = value & 0xff; value = Math.floor(value / 256); }
    return offset + byteLength;
  }
  writeIntBE(value, offset, byteLength) {
    if (typeof byteLength !== 'number') throw _ERR_INVALID_ARG_TYPE('byteLength', 'number', byteLength);
    if (Number.isNaN(byteLength) || (Number.isFinite(byteLength) && byteLength % 1 !== 0)) { const e = new RangeError(`The value of "byteLength" is out of range. It must be an integer. Received ${byteLength}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (byteLength < 1 || byteLength > 6) throw _ERR_OUT_OF_RANGE('byteLength', '>= 1 and <= 6', byteLength);
    _checkIntValue(value, -Math.pow(2, 8 * byteLength - 1), Math.pow(2, 8 * byteLength - 1) - 1);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkWriteOffset(offset, byteLength, this.length);
    if (value < 0) value += Math.pow(2, 8 * byteLength);
    for (let i = byteLength - 1; i >= 0; i--) { this[offset + i] = value & 0xff; value = Math.floor(value / 256); }
    return offset + byteLength;
  }
  writeIntLE(value, offset, byteLength) {
    if (typeof byteLength !== 'number') throw _ERR_INVALID_ARG_TYPE('byteLength', 'number', byteLength);
    if (Number.isNaN(byteLength) || (Number.isFinite(byteLength) && byteLength % 1 !== 0)) { const e = new RangeError(`The value of "byteLength" is out of range. It must be an integer. Received ${byteLength}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    if (byteLength < 1 || byteLength > 6) throw _ERR_OUT_OF_RANGE('byteLength', '>= 1 and <= 6', byteLength);
    _checkIntValue(value, -Math.pow(2, 8 * byteLength - 1), Math.pow(2, 8 * byteLength - 1) - 1);
    if (typeof offset !== 'number') throw _ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    offset = _checkWriteOffset(offset, byteLength, this.length);
    if (value < 0) value += Math.pow(2, 8 * byteLength);
    for (let i = 0; i < byteLength; i++) { this[offset + i] = value & 0xff; value = Math.floor(value / 256); }
    return offset + byteLength;
  }

  readBigInt64BE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigInt64(offset, false); }
  readBigInt64LE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigInt64(offset, true); }
  readBigUInt64BE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigUint64(offset, false); }
  readBigUInt64LE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigUint64(offset, true); }
  writeBigInt64BE(value, offset) { _checkBigIntValue(value, _INT64_MIN, _INT64_MAX, '>= -(2n ** 63n) and < 2n ** 63n'); offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigInt64(offset, value, false); return offset + 8; }
  writeBigInt64LE(value, offset) { _checkBigIntValue(value, _INT64_MIN, _INT64_MAX, '>= -(2n ** 63n) and < 2n ** 63n'); offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigInt64(offset, value, true); return offset + 8; }
  writeBigUInt64BE(value, offset) { _checkBigIntValue(value, 0n, _UINT64_MAX, '>= 0n and < 2n ** 64n'); offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigUint64(offset, value, false); return offset + 8; }
  writeBigUInt64LE(value, offset) { _checkBigIntValue(value, 0n, _UINT64_MAX, '>= 0n and < 2n ** 64n'); offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigUint64(offset, value, true); return offset + 8; }

  swap16() { if (this.length % 2 !== 0) { const e = new RangeError('Buffer size must be a multiple of 16-bits'); e.code = 'ERR_INVALID_BUFFER_SIZE'; throw e; } for (let i = 0; i < this.length; i += 2) { const t = this[i]; this[i] = this[i+1]; this[i+1] = t; } return this; }
  swap32() { if (this.length % 4 !== 0) { const e = new RangeError('Buffer size must be a multiple of 32-bits'); e.code = 'ERR_INVALID_BUFFER_SIZE'; throw e; } for (let i = 0; i < this.length; i += 4) { let t = this[i]; this[i] = this[i+3]; this[i+3] = t; t = this[i+1]; this[i+1] = this[i+2]; this[i+2] = t; } return this; }
  swap64() { if (this.length % 8 !== 0) { const e = new RangeError('Buffer size must be a multiple of 64-bits'); e.code = 'ERR_INVALID_BUFFER_SIZE'; throw e; } for (let i = 0; i < this.length; i += 8) { for (let j = 0; j < 4; j++) { const t = this[i+j]; this[i+j] = this[i+7-j]; this[i+7-j] = t; } } return this; }

  lastIndexOf(value, byteOffset, encoding) {
    _validateBufferReceiver(this);
    // 4-arg form: lastIndexOf(value, byteOffset, end, encoding)
    let searchEnd = this.length;
    if (arguments.length >= 4) {
      searchEnd = arguments[2];
      encoding = arguments[3];
    } else if (arguments.length === 3 && typeof encoding === 'number') {
      searchEnd = encoding;
      encoding = undefined;
    } else if (arguments.length === 2 && typeof byteOffset === 'string') {
      encoding = byteOffset;
      byteOffset = undefined;
    }

    if (searchEnd < 0) searchEnd = 0;
    if (searchEnd > this.length) searchEnd = this.length;

    if (typeof value === 'number') {
      const byte = value & 0xff;
      let start;
      const bo = +byteOffset; // coerce first: {}, undefined → NaN; null, [] → 0
      if (bo !== bo) { // NaN → search from the end (whole buffer)
        start = searchEnd - 1;
      } else {
        start = bo;
        if (start < 0) start = this.length + start;
      }
      if (start >= searchEnd) start = searchEnd - 1;
      if (start < 0 || searchEnd <= 0) return -1;
      for (let i = start; i >= 0; i--) {
        if (this[i] === byte) return i;
      }
      return -1;
    }
    const needle = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : Buffer.from(value, encoding);
    if (needle.length === 0) {
      if (byteOffset === undefined || byteOffset !== byteOffset) return Math.min(this.length, searchEnd);
      let off = +byteOffset;
      if (off < 0) off = this.length + off;
      return Math.min(Math.max(off, 0), searchEnd, this.length);
    }
    let start;
    const bo = +byteOffset; // coerce first: {}, undefined → NaN; null, [] → 0
    if (bo !== bo) { // NaN → search from the end (whole buffer)
      start = searchEnd - needle.length;
    } else {
      start = bo;
      if (start < 0) start = this.length + start;
    }
    if (start > searchEnd - needle.length) start = searchEnd - needle.length;
    if (start < 0 || searchEnd <= 0) return -1;
    for (let i = start; i >= 0; i--) {
      let found = true;
      for (let j = 0; j < needle.length; j++) { if (this[i + j] !== needle[j]) { found = false; break; } }
      if (found) return i;
    }
    return -1;
  }

  fill(value, offset, end, encoding) {
    // handle fill(value, encoding) shorthand
    if (typeof offset === 'string') {
      if (typeof end === 'string') { encoding = end; end = undefined; }
      else if (end === undefined) { encoding = offset; offset = undefined; }
    } else if (typeof end === 'string') {
      encoding = end; end = undefined;
    }

    if (encoding !== undefined && typeof encoding !== 'string') {
      throw _ERR_INVALID_ARG_TYPE('encoding', 'string', encoding);
    }
    if (encoding !== undefined && typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw _ERR_UNKNOWN_ENCODING(encoding);
    }

    // validate end type — must be number, not object with toPrimitive
    if (end !== undefined && typeof end !== 'number') {
      throw _ERR_INVALID_ARG_TYPE('end', 'number', end);
    }

    offset = offset !== undefined ? +offset : 0;
    end = end !== undefined ? +end : this.length;

    // both start and end must land within [0, length]; a negative end is just as
    // out-of-range as one past the end (node throws ERR_OUT_OF_RANGE for fill('',1,-1)).
    if (offset < 0 || offset > this.length) throw _ERR_OUT_OF_RANGE('start', `>= 0 and <= ${this.length}`, offset);
    if (end < 0 || end > this.length) throw _ERR_OUT_OF_RANGE('end', `>= 0 and <= ${this.length}`, end);

    // guard against spoofed .length exceeding actual buffer
    if (end > this.byteLength) throw _ERR_BUFFER_OUT_OF_BOUNDS();

    if (end <= offset) return this;

    if (typeof value === 'string') {
      if (value.length === 0) return this;
      if (encoding) {
        const enc = encoding.toLowerCase();
        if (enc === 'hex' && !_isValidHexString(value)) throw _ERR_INVALID_ARG_VALUE('value', value);
      }
      const fillBuf = Buffer.from(value, encoding);
      if (fillBuf.length === 0) return this;
      for (let i = offset; i < end; i++) this[i] = fillBuf[(i - offset) % fillBuf.length];
    } else if (typeof value === 'number' || value === null) {
      const byte = (value === null ? 0 : value) & 0xff;
      if (_nativeFillRange) {
        _nativeFillRange(this, byte, offset, end);
      } else {
        for (let i = offset; i < end; i++) this[i] = byte;
      }
    } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      if (value.length === 0) return this;
      for (let i = offset; i < end; i++) this[i] = value[(i - offset) % value.length];
    }
    return this;
  }
}

// 2^53-1, matching modern Node on 64-bit: `new Uint8Array(kMaxLength+1)` is the
// exact point V8 throws "Invalid typed array length" (spec limit), not a buffer
// pooling cap.
Buffer.kMaxLength = Number.MAX_SAFE_INTEGER;
Buffer.poolSize = 8192;
Buffer.prototype.toLocaleString = Buffer.prototype.toString;

// Inherited TypedArray methods that allocate (map/filter) construct their
// result via the species constructor — Buffer — which would emit DEP0005.
// Wrap them so the internal allocation is flagged as internal (no warning)
// while still returning a real Buffer (same prototype, unlike a FastBuffer
// subclass which would break deepStrictEqual against plain Buffers).
for (const _m of ['map', 'filter', 'subarray']) {
  const _orig = Uint8Array.prototype[_m];
  Buffer.prototype[_m] = function(...a) {
    const _prev = _internalCtor;
    _internalCtor = true;
    try { return _orig.apply(this, a); } finally { _internalCtor = _prev; }
  };
}
// Node defines indexOf/lastIndexOf as ordinary (constructable) functions, so
// `new buf.lastIndexOf()` runs the body and throws a descriptive arg error
// rather than "X is not a constructor". Class methods lack [[Construct]], so
// re-wrap as named function expressions (the name surfaces in that error).
{
  const _io = Buffer.prototype.indexOf;
  const _lio = Buffer.prototype.lastIndexOf;
  Object.defineProperty(Buffer.prototype, 'indexOf', { configurable: true, writable: true, value: function indexOf(...a) { return _io.apply(this, a); } });
  Object.defineProperty(Buffer.prototype, 'lastIndexOf', { configurable: true, writable: true, value: function lastIndexOf(...a) { return _lio.apply(this, a); } });
}
// Explicit Buffer.of avoids inheriting Uint8Array.of, which would allocate via
// `new Buffer(len)` and emit DEP0005.
Buffer.of = function of(...args) { return Buffer.from(args); };

// lowercase UInt → Uint aliases (Node compat)
for (const fn of ['UInt8', 'UInt16LE', 'UInt16BE', 'UInt32LE', 'UInt32BE', 'UIntLE', 'UIntBE', 'BigUInt64LE', 'BigUInt64BE']) {
  const lower = fn.replace(/UInt/, 'Uint');
  if (Buffer.prototype[`write${fn}`]) Buffer.prototype[`write${lower}`] = Buffer.prototype[`write${fn}`];
  if (Buffer.prototype[`read${fn}`]) Buffer.prototype[`read${lower}`] = Buffer.prototype[`read${fn}`];
}

// low-level write methods expected by some tests
Buffer.prototype.asciiWrite = function(str, offset, length) {
  if (offset === undefined) offset = 0;
  if (length === undefined) length = this.length - offset;
  if (length < 0 || offset + length > this.length) throw _ERR_BUFFER_OUT_OF_BOUNDS();
  const len = Math.min(str.length, length);
  for (let i = 0; i < len; i++) this[offset + i] = str.charCodeAt(i) & 0x7f;
  return len;
};
Buffer.prototype.latin1Write = function(str, offset, length) {
  if (offset === undefined) offset = 0;
  if (length === undefined) length = this.length - offset;
  if (length < 0 || offset + length > this.length) throw _ERR_BUFFER_OUT_OF_BOUNDS();
  const len = Math.min(str.length, length);
  for (let i = 0; i < len; i++) this[offset + i] = str.charCodeAt(i) & 0xff;
  return len;
};

// node's internal *Slice methods: return the [start,end) slice decoded in that encoding —
// equivalent to toString(encoding, start, end). busboy (multer's multipart parser) calls
// chunk.latin1Slice directly, so their absence crashed every file upload.
Buffer.prototype.latin1Slice = function(start, end) { return this.toString('latin1', start, end); };
Buffer.prototype.utf8Slice   = function(start, end) { return this.toString('utf8', start, end); };
Buffer.prototype.asciiSlice  = function(start, end) { return this.toString('ascii', start, end); };
Buffer.prototype.hexSlice    = function(start, end) { return this.toString('hex', start, end); };
Buffer.prototype.ucs2Slice   = function(start, end) { return this.toString('ucs2', start, end); };
Buffer.prototype.base64Slice = function(start, end) { return this.toString('base64', start, end); };
Buffer.prototype.base64urlSlice = function(start, end) { return this.toString('base64url', start, end); };
Buffer.prototype.utf8Write = function(str, offset, length) {
  if (offset === undefined) offset = 0;
  if (length === undefined) length = this.length - offset;
  if (length < 0 || offset + length > this.length) throw _ERR_BUFFER_OUT_OF_BOUNDS();
  const bytes = _utf8Encode(str);
  const len = Math.min(bytes.length, length);
  for (let i = 0; i < len; i++) this[offset + i] = bytes[i];
  return len;
};

// ES6 class statics are non-enumerable; Node's Buffer statics are enumerable
for (const k of Object.getOwnPropertyNames(Buffer)) {
  const d = Object.getOwnPropertyDescriptor(Buffer, k);
  if (d && !d.enumerable && typeof d.value === 'function') Object.defineProperty(Buffer, k, { ...d, enumerable: true });
}

// make Buffer callable as a function (deprecated Node.js API, but needed for compat)
const _BufferClass = Buffer;
const Buffer_callable = new Proxy(_BufferClass, {
  apply(target, thisArg, args) {
    // Buffer(size) or Buffer(string, encoding) or Buffer(array)
    const arg = args[0];
    if (typeof arg === 'number') {
      if (arg < 0 || Number.isNaN(arg)) { const e = new RangeError(`The value "${arg}" is invalid for option "size"`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
      return _BufferClass.allocUnsafe(arg);
    }
    if (typeof arg === 'string') return _BufferClass.from(arg, args[1]);
    if (arg instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && arg instanceof SharedArrayBuffer)) {
      return _BufferClass.from(arg, args[1], args[2]);
    }
    return _BufferClass.from(arg);
  },
});
// re-alias so module.exports uses the callable version
Buffer = Buffer_callable;

function SlowBuffer(size) { return _BufferClass.allocUnsafeSlow(size); }
SlowBuffer.prototype = _BufferClass.prototype;

function _validateBufferLikeInput(input) {
  if (input != null && (ArrayBuffer.isView(input) || input instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer))) {
    const underlying = ArrayBuffer.isView(input) ? input.buffer : input;
    if (underlying instanceof ArrayBuffer && underlying.detached) {
      const e = new TypeError('Cannot perform Construct on a detached ArrayBuffer');
      e.code = 'ERR_INVALID_STATE'; throw e;
    }
    return;
  }
  let received;
  if (input === null) received = 'null';
  else if (input === undefined) received = 'undefined';
  else if (typeof input === 'object') received = 'an instance of ' + (input.constructor?.name || 'Object');
  else {
    const v = typeof input === 'bigint' ? String(input) + 'n' : typeof input === 'string' ? "'" + input + "'" : String(input);
    received = 'type ' + typeof input + ' (' + v + ')';
  }
  const e = new TypeError(`The "source" argument must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received ${received}`);
  e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
}

function isAscii(input) {
  _validateBufferLikeInput(input);
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength || input.length);
  for (let i = 0; i < buf.length; i++) { if (buf[i] > 127) return false; }
  return true;
}

function isUtf8(input) {
  _validateBufferLikeInput(input);
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength || input.length);
  // Well-formed UTF-8 per Unicode Table 3-7: range checks reject overlong
  // encodings, surrogate code points (U+D800–DFFF), and values > U+10FFFF —
  // a plain continuation-byte mask would wrongly accept all of these.
  const cont = (x) => (x & 0xc0) === 0x80;
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const b = buf[i];
    if (b <= 0x7f) { i++; }
    else if (b >= 0xc2 && b <= 0xdf) { if (i+1 >= n || !cont(buf[i+1])) return false; i += 2; }
    else if (b === 0xe0) { if (i+2 >= n || buf[i+1] < 0xa0 || buf[i+1] > 0xbf || !cont(buf[i+2])) return false; i += 3; }
    else if (b >= 0xe1 && b <= 0xec) { if (i+2 >= n || !cont(buf[i+1]) || !cont(buf[i+2])) return false; i += 3; }
    else if (b === 0xed) { if (i+2 >= n || buf[i+1] < 0x80 || buf[i+1] > 0x9f || !cont(buf[i+2])) return false; i += 3; }
    else if (b >= 0xee && b <= 0xef) { if (i+2 >= n || !cont(buf[i+1]) || !cont(buf[i+2])) return false; i += 3; }
    else if (b === 0xf0) { if (i+3 >= n || buf[i+1] < 0x90 || buf[i+1] > 0xbf || !cont(buf[i+2]) || !cont(buf[i+3])) return false; i += 4; }
    else if (b >= 0xf1 && b <= 0xf3) { if (i+3 >= n || !cont(buf[i+1]) || !cont(buf[i+2]) || !cont(buf[i+3])) return false; i += 4; }
    else if (b === 0xf4) { if (i+3 >= n || buf[i+1] < 0x80 || buf[i+1] > 0x8f || !cont(buf[i+2]) || !cont(buf[i+3])) return false; i += 4; }
    else return false;
  }
  return true;
}

let _inspectMaxBytes = 50;
const _exports = {
  Buffer, SlowBuffer, kMaxLength: Number.MAX_SAFE_INTEGER, kStringMaxLength: 2 ** 29 - 24,
  isAscii, isUtf8,
  constants: { MAX_LENGTH: Number.MAX_SAFE_INTEGER, MAX_STRING_LENGTH: 2 ** 29 - 24 },
  atob: globalThis.atob, btoa: globalThis.btoa,
  File: globalThis.File, Blob: globalThis.Blob,
};
Object.defineProperty(_exports, 'INSPECT_MAX_BYTES', {
  enumerable: true,
  get() { return _inspectMaxBytes; },
  set(val) {
    if (typeof val !== 'number') {
      const e = new TypeError('The "value" argument must be of type number. Received type ' + typeof val + " ('" + val + "')");
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (val < 0 || Number.isNaN(val)) {
      const e = new RangeError('The value of "value" is out of range. It must be >= 0 && <= 2147483647. Received ' + val);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    _inspectMaxBytes = val;
  }
});
module.exports = _exports;
