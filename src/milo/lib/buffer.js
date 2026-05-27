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
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
      a.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else { a.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
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

function _checkOffset(offset, byteLength, bufLength) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== 'number' || Number.isNaN(offset) || offset % 1 !== 0) throw _ERR_OUT_OF_RANGE('offset', 'an integer', offset);
  if (offset < 0) throw _ERR_OUT_OF_RANGE('offset', '>= 0', offset);
  if (offset + byteLength > bufLength) throw _ERR_BUFFER_OUT_OF_BOUNDS();
  return offset;
}

function _base64Decode(str) {
  if (_nativeBase64Decode) return _nativeBase64Decode(str);
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function _base64Encode(buf, start, end) {
  if (_nativeBase64Encode) return _nativeBase64Encode(buf.subarray(start, end));
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

class Buffer extends Uint8Array {
  constructor(arg, byteOffsetOrEncoding, length) {
    if (typeof arg === 'number' && typeof byteOffsetOrEncoding === 'string') {
      const e = new TypeError('The "string" argument must be of type string. Received type number (' + arg + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
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
    const buf = new Buffer(size);
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
    return new Buffer(size);
  }

  static allocUnsafeSlow(size) {
    if (typeof size !== 'number') throw _ERR_INVALID_ARG_TYPE('size', 'number', size);
    if (size < 0 || Number.isNaN(size) || size > Buffer.kMaxLength) {
      const err = new RangeError(`The value "${size}" is invalid for option "size"`);
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    return new Buffer(new ArrayBuffer(size));
  }

  static from(value, encodingOrOffset, length) {
    if (value === null || value === undefined) {
      const e = new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received ' + (value === null ? 'null' : 'undefined'));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof value === 'number') {
      const e = new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received type number (' + value + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof value === 'string') {
      if (typeof encodingOrOffset === 'number' || (encodingOrOffset !== undefined && typeof encodingOrOffset !== 'string')) {
        const e = new TypeError(`Unknown encoding: ${encodingOrOffset}`);
        e.code = 'ERR_UNKNOWN_ENCODING'; throw e;
      }
      const enc = (encodingOrOffset || 'utf8').toLowerCase();
      if (!Buffer.isEncoding(enc)) throw _ERR_UNKNOWN_ENCODING(encodingOrOffset || 'utf8');
      if (enc === 'hex') {
        if (_nativeHexDecode) {
          const u8 = _nativeHexDecode(value);
          Object.setPrototypeOf(u8, Buffer.prototype);
          return u8;
        }
        return new Buffer(_hexDecode(value));
      }
      if (enc === 'base64' || enc === 'base64url') {
        const cleaned = value.replace(/-/g, '+').replace(/_/g, '/');
        if (_nativeBase64Decode) {
          const u8 = _nativeBase64Decode(cleaned);
          Object.setPrototypeOf(u8, Buffer.prototype);
          return u8;
        }
        return new Buffer(_base64Decode(cleaned));
      }
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
        const a = new Buffer(value.length);
        for (let i = 0; i < value.length; i++) a[i] = value.charCodeAt(i) & 0xff;
        return a;
      }
      if (enc === 'ucs2' || enc === 'ucs-2' || enc === 'utf16le' || enc === 'utf-16le') {
        const a = new Buffer(value.length * 2);
        for (let i = 0; i < value.length; i++) {
          const c = value.charCodeAt(i);
          a[i * 2] = c & 0xff;
          a[i * 2 + 1] = (c >> 8) & 0xff;
        }
        return a;
      }
      return new Buffer(_utf8Encode(value));
    }
    if (value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)) {
      const offset = encodingOrOffset || 0;
      const len = length !== undefined ? length : value.byteLength - offset;
      const view = new Uint8Array(value, offset, len);
      Object.setPrototypeOf(view, Buffer.prototype);
      return view;
    }
    if (Array.isArray(value) || value instanceof Uint8Array) return new Buffer(value);
    if (Buffer.isBuffer(value)) { const c = new Buffer(value.length); c.set(value); return c; }
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) return new Buffer(value.data);
    // String objects and objects with Symbol.toPrimitive/valueOf that return a string
    if (value && typeof value === 'object') {
      let primitive;
      if (typeof value[Symbol.toPrimitive] === 'function') primitive = value[Symbol.toPrimitive]('string');
      else if (typeof value.valueOf === 'function') primitive = value.valueOf();
      if (typeof primitive === 'string') return Buffer.from(primitive, encodingOrOffset);
      if (typeof value.length === 'number') return new Buffer(Array.from(value));
    }
    throw _ERR_INVALID_ARG_TYPE('value', 'string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object', value);
  }

  static isBuffer(obj) { return obj instanceof Buffer; }
  static isEncoding(enc) { return encodings.includes((enc || '').toLowerCase()); }

  static byteLength(str, encoding) {
    if (typeof str !== 'string') {
      if (ArrayBuffer.isView(str) || str instanceof ArrayBuffer || str instanceof SharedArrayBuffer) return str.byteLength;
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
    if (!(a instanceof Uint8Array)) throw _ERR_INVALID_ARG_TYPE_INSTANCE('buf1', 'Buffer or Uint8Array', a);
    if (!(b instanceof Uint8Array)) throw _ERR_INVALID_ARG_TYPE_INSTANCE('buf2', 'Buffer or Uint8Array', b);
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
    }
    this.set(bytes.subarray(0, len), offset);
    return len;
  }

  toString(encoding, start, end) {
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
    if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
      let s = '';
      for (let i = start; i < end; i++) s += String.fromCharCode(this[i]);
      return s;
    }
    return _utf8Decode(this, start, end);
  }

  get parent() { return this.buffer; }
  get offset() { return this.byteOffset; }

  inspect(recurseTimes, ctx) {
    const max = _exports.INSPECT_MAX_BYTES;
    const hex = [];
    for (let i = 0; i < Math.min(this.length, max); i++) hex.push(this[i].toString(16).padStart(2, '0'));
    let str = hex.join(' ');
    if (this.length > max) str += ' ... ' + (this.length - max) + ' more bytes';
    return '<Buffer ' + str + '>';
  }

  [Symbol.for('nodejs.util.inspect.custom')](recurseTimes, ctx) {
    return this.inspect(recurseTimes, ctx);
  }

  toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
  equals(other) {
    if (!(other instanceof Uint8Array)) { const e = new TypeError('The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received type ' + typeof other); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (this.length !== other.length) return false;
    if (_nativeCompare) return _nativeCompare(this, other) === 0;
    return Buffer.compare(this, other) === 0;
  }
  compare(other, targetStart, targetEnd, sourceStart, sourceEnd) {
    if (!(other instanceof Uint8Array)) throw _ERR_INVALID_ARG_TYPE_INSTANCE('target', 'Buffer or Uint8Array', other);
    sourceStart = sourceStart || 0;
    sourceEnd = sourceEnd !== undefined ? sourceEnd : this.length;
    targetStart = targetStart || 0;
    targetEnd = targetEnd !== undefined ? targetEnd : other.length;
    if (_nativeCompare && sourceStart === 0 && sourceEnd === this.length && targetStart === 0 && targetEnd === other.length) {
      return _nativeCompare(this, other);
    }
    const src = this.subarray(sourceStart, sourceEnd);
    const tgt = other.subarray(targetStart, targetEnd);
    if (_nativeCompare) return _nativeCompare(src, tgt);
    const len = Math.min(src.length, tgt.length);
    for (let i = 0; i < len; i++) { if (src[i] < tgt[i]) return -1; if (src[i] > tgt[i]) return 1; }
    return src.length < tgt.length ? -1 : src.length > tgt.length ? 1 : 0;
  }
  copy(target, targetStart, sourceStart, sourceEnd) {
    if (!target || typeof target !== 'object' || (!ArrayBuffer.isView(target) && !(target instanceof ArrayBuffer) && !(target instanceof SharedArrayBuffer))) {
      const err = new TypeError('The "target" argument must be an instance of Buffer or Uint8Array. Received type ' + typeof target);
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

  writeUInt8(value, offset) { offset = offset >>> 0; if (offset >= this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 and < ${this.length}`, offset); this[offset] = value & 0xff; return offset + 1; }
  writeUInt16BE(value, offset) { offset = offset >>> 0; if (offset + 1 >= this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 2}`, offset); this[offset] = (value >> 8) & 0xff; this[offset+1] = value & 0xff; return offset + 2; }
  writeUInt16LE(value, offset) { offset = offset >>> 0; if (offset + 1 >= this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 2}`, offset); this[offset] = value & 0xff; this[offset+1] = (value >> 8) & 0xff; return offset + 2; }
  writeUInt32BE(value, offset) { offset = offset >>> 0; if (offset + 3 >= this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 4}`, offset); this[offset] = (value >>> 24) & 0xff; this[offset+1] = (value >>> 16) & 0xff; this[offset+2] = (value >>> 8) & 0xff; this[offset+3] = value & 0xff; return offset + 4; }
  writeUInt32LE(value, offset) { offset = offset >>> 0; if (offset + 3 >= this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 4}`, offset); this[offset] = value & 0xff; this[offset+1] = (value >>> 8) & 0xff; this[offset+2] = (value >>> 16) & 0xff; this[offset+3] = (value >>> 24) & 0xff; return offset + 4; }
  writeInt8(value, offset) { offset = offset >>> 0; if (offset >= this.length) throw _ERR_OUT_OF_RANGE('offset', `>= 0 and < ${this.length}`, offset); this[offset] = value < 0 ? value + 256 : value; return offset + 1; }
  writeInt16BE(value, offset) { return this.writeUInt16BE(value < 0 ? value + 0x10000 : value, offset); }
  writeInt16LE(value, offset) { return this.writeUInt16LE(value < 0 ? value + 0x10000 : value, offset); }
  writeInt32BE(value, offset) { return this.writeUInt32BE(value < 0 ? value + 0x100000000 : value, offset); }
  writeInt32LE(value, offset) { return this.writeUInt32LE(value < 0 ? value + 0x100000000 : value, offset); }
  writeFloatBE(value, offset) { offset = offset >>> 0; if (offset + 3 >= this.length) { throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 4}`, offset); } const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat32(offset, value, false); return offset + 4; }
  writeFloatLE(value, offset) { offset = offset >>> 0; if (offset + 3 >= this.length) { throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 4}`, offset); } const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat32(offset, value, true); return offset + 4; }
  writeDoubleBE(value, offset) { offset = offset >>> 0; if (offset + 7 >= this.length) { throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 8}`, offset); } const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat64(offset, value, false); return offset + 8; }
  writeDoubleLE(value, offset) { offset = offset >>> 0; if (offset + 7 >= this.length) { throw _ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${this.length - 8}`, offset); } const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat64(offset, value, true); return offset + 8; }

  readUIntBE(offset, byteLength) {
    let val = 0;
    for (let i = 0; i < byteLength; i++) val = val * 256 + this[offset + i];
    return val;
  }
  readUIntLE(offset, byteLength) {
    let val = 0; let mul = 1;
    for (let i = 0; i < byteLength; i++) { val += this[offset + i] * mul; mul *= 256; }
    return val;
  }
  readIntBE(offset, byteLength) {
    let val = this.readUIntBE(offset, byteLength);
    if (val >= Math.pow(2, 8 * byteLength - 1)) val -= Math.pow(2, 8 * byteLength);
    return val;
  }
  readIntLE(offset, byteLength) {
    let val = this.readUIntLE(offset, byteLength);
    if (val >= Math.pow(2, 8 * byteLength - 1)) val -= Math.pow(2, 8 * byteLength);
    return val;
  }
  writeUIntBE(value, offset, byteLength) {
    for (let i = byteLength - 1; i >= 0; i--) { this[offset + i] = value & 0xff; value = Math.floor(value / 256); }
    return offset + byteLength;
  }
  writeUIntLE(value, offset, byteLength) {
    for (let i = 0; i < byteLength; i++) { this[offset + i] = value & 0xff; value = Math.floor(value / 256); }
    return offset + byteLength;
  }
  writeIntBE(value, offset, byteLength) {
    if (value < 0) value += Math.pow(2, 8 * byteLength);
    return this.writeUIntBE(value, offset, byteLength);
  }
  writeIntLE(value, offset, byteLength) {
    if (value < 0) value += Math.pow(2, 8 * byteLength);
    return this.writeUIntLE(value, offset, byteLength);
  }

  readBigInt64BE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigInt64(offset, false); }
  readBigInt64LE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigInt64(offset, true); }
  readBigUInt64BE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigUint64(offset, false); }
  readBigUInt64LE(offset) { offset = _checkOffset(offset, 8, this.length); const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigUint64(offset, true); }
  writeBigInt64BE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigInt64(offset || 0, value, false); }
  writeBigInt64LE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigInt64(offset || 0, value, true); }
  writeBigUInt64BE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigUint64(offset || 0, value, false); }
  writeBigUInt64LE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigUint64(offset || 0, value, true); }

  swap16() { if (this.length % 2 !== 0) { const e = new RangeError('Buffer size must be a multiple of 16-bits'); e.code = 'ERR_INVALID_BUFFER_SIZE'; throw e; } for (let i = 0; i < this.length; i += 2) { const t = this[i]; this[i] = this[i+1]; this[i+1] = t; } return this; }
  swap32() { if (this.length % 4 !== 0) { const e = new RangeError('Buffer size must be a multiple of 32-bits'); e.code = 'ERR_INVALID_BUFFER_SIZE'; throw e; } for (let i = 0; i < this.length; i += 4) { let t = this[i]; this[i] = this[i+3]; this[i+3] = t; t = this[i+1]; this[i+1] = this[i+2]; this[i+2] = t; } return this; }
  swap64() { if (this.length % 8 !== 0) { const e = new RangeError('Buffer size must be a multiple of 64-bits'); e.code = 'ERR_INVALID_BUFFER_SIZE'; throw e; } for (let i = 0; i < this.length; i += 8) { for (let j = 0; j < 4; j++) { const t = this[i+j]; this[i+j] = this[i+7-j]; this[i+7-j] = t; } } return this; }

  lastIndexOf(value, byteOffset, encoding) {
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
      if (byteOffset === undefined || byteOffset !== byteOffset) { // undefined or NaN
        start = searchEnd - 1;
      } else {
        start = +byteOffset;
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
    if (byteOffset === undefined || byteOffset !== byteOffset) { // undefined or NaN
      start = searchEnd - needle.length;
    } else {
      start = +byteOffset;
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

    if (offset < 0 || end > this.length) throw _ERR_OUT_OF_RANGE('value', `>= 0 and <= ${this.length}`, offset < 0 ? offset : end);

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

Buffer.kMaxLength = 2 ** 31 - 1;
Buffer.poolSize = 8192;
Buffer.prototype.toLocaleString = Buffer.prototype.toString;

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

function isAscii(input) {
  const buf = input instanceof Uint8Array ? input : Buffer.from(input);
  for (let i = 0; i < buf.length; i++) { if (buf[i] > 127) return false; }
  return true;
}

function isUtf8(input) {
  const buf = input instanceof Uint8Array ? input : Buffer.from(input);
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { i++; }
    else if ((b & 0xe0) === 0xc0) { if (i + 1 >= buf.length || (buf[i+1] & 0xc0) !== 0x80) return false; i += 2; }
    else if ((b & 0xf0) === 0xe0) { if (i + 2 >= buf.length || (buf[i+1] & 0xc0) !== 0x80 || (buf[i+2] & 0xc0) !== 0x80) return false; i += 3; }
    else if ((b & 0xf8) === 0xf0) { if (i + 3 >= buf.length || (buf[i+1] & 0xc0) !== 0x80 || (buf[i+2] & 0xc0) !== 0x80 || (buf[i+3] & 0xc0) !== 0x80) return false; i += 4; }
    else return false;
  }
  return true;
}

const _exports = {
  Buffer, SlowBuffer, kMaxLength: 2 ** 31 - 1, kStringMaxLength: 2 ** 28 - 16,
  INSPECT_MAX_BYTES: 50,
  isAscii, isUtf8,
  constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 28 - 16 },
  atob: globalThis.atob, btoa: globalThis.btoa,
  File: globalThis.File, Blob: globalThis.Blob,
};
module.exports = _exports;
