// buffer module — Buffer over Uint8Array + native fast paths via internalBinding('buffer')
'use strict';

const encodings = ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'hex', 'base64', 'base64url', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'];

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
const _nativeBase64Encode = binding.base64Encode;
const _nativeBase64Decode = binding.base64Decode;
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
    else if ((b & 0xe0) === 0xc0) { s += String.fromCharCode(((b & 0x1f) << 6) | (buf[i+1] & 0x3f)); i += 2; }
    else if ((b & 0xf0) === 0xe0) { s += String.fromCharCode(((b & 0x0f) << 12) | ((buf[i+1] & 0x3f) << 6) | (buf[i+2] & 0x3f)); i += 3; }
    else { const cp = ((b & 0x07) << 18) | ((buf[i+1] & 0x3f) << 12) | ((buf[i+2] & 0x3f) << 6) | (buf[i+3] & 0x3f); s += String.fromCodePoint(cp); i += 4; }
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
  for (let i = 0; i < str.length; i += 2) a.push(parseInt(str.slice(i, i + 2), 16));
  return a;
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
  static alloc(size, fill, encoding) {
    if (typeof size !== 'number') { const e = new TypeError('The "size" argument must be of type number. Received type ' + typeof size); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (size < 0 || size > Buffer.kMaxLength) {
      const err = new RangeError(`The value "${size}" is invalid for option "size"`);
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    const buf = new Buffer(size);
    if (fill !== undefined) {
      if (typeof fill === 'string') {
        if (fill.length === 0) return buf;
        const fillBuf = Buffer.from(fill, encoding);
        for (let i = 0; i < size; i++) buf[i] = fillBuf[i % fillBuf.length];
      } else if (typeof fill === 'number') {
        buf.fill(fill);
      } else if (Buffer.isBuffer(fill)) {
        for (let i = 0; i < size; i++) buf[i] = fill[i % fill.length];
      }
    }
    return buf;
  }

  static allocUnsafe(size) {
    if (typeof size !== 'number') { const e = new TypeError('The "size" argument must be of type number. Received type ' + typeof size); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (size < 0 || size > Buffer.kMaxLength) {
      const err = new RangeError(`The value "${size}" is invalid for option "size"`);
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    return new Buffer(size);
  }

  static allocUnsafeSlow(size) {
    if (typeof size !== 'number') { const e = new TypeError('The "size" argument must be of type number. Received type ' + typeof size); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (size < 0 || size > Buffer.kMaxLength) {
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
      const enc = (encodingOrOffset || 'utf8').toLowerCase();
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
    if (value && typeof value === 'object' && typeof value.length === 'number') return new Buffer(Array.from(value));
    throw new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.');
  }

  static isBuffer(obj) { return obj instanceof Buffer; }
  static isEncoding(enc) { return encodings.includes((enc || '').toLowerCase()); }

  static byteLength(str, encoding) {
    if (typeof str !== 'string') {
      if (ArrayBuffer.isView(str) || str instanceof ArrayBuffer || str instanceof SharedArrayBuffer) return str.byteLength;
      if (typeof str !== 'string') {
        const e = new TypeError('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received type ' + typeof str);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
    }
    const enc = (encoding || 'utf8').toLowerCase();
    if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') return str.length;
    if (enc === 'ucs2' || enc === 'ucs-2' || enc === 'utf16le' || enc === 'utf-16le') return str.length * 2;
    if (enc === 'hex') return str.length >>> 1;
    if (enc === 'base64' || enc === 'base64url') {
      let len = str.length;
      let pad = 0;
      if (str[len - 1] === '=') pad++;
      if (str[len - 2] === '=') pad++;
      return (len * 3 >>> 2) - pad;
    }
    // utf8 — use native if available
    if (_nativeUtf8ByteLength) return _nativeUtf8ByteLength(str);
    return Buffer.from(str, encoding).length;
  }

  static concat(list, totalLength) {
    if (totalLength === undefined) totalLength = list.reduce((sum, b) => sum + b.length, 0);
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (const buf of list) { result.set(buf, offset); offset += buf.length; if (offset >= totalLength) break; }
    return result;
  }

  static compare(a, b) {
    if (_nativeCompare) return _nativeCompare(a, b);
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
  }

  write(str, offset, length, encoding) {
    if (typeof offset === 'string') { encoding = offset; offset = 0; }
    const bytes = Buffer.from(str, encoding);
    const len = Math.min(bytes.length, length || this.length - (offset || 0));
    this.set(bytes.subarray(0, len), offset || 0);
    return len;
  }

  toString(encoding, start, end) {
    encoding = (encoding || 'utf8').toLowerCase();
    start = start || 0;
    end = end !== undefined ? end : this.length;
    if (encoding === 'hex') return _hexEncode(this, start, end);
    if (encoding === 'base64') return _base64Encode(this, start, end);
    if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
      let s = '';
      for (let i = start; i < end; i++) s += String.fromCharCode(this[i]);
      return s;
    }
    return _utf8Decode(this, start, end);
  }

  toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
  equals(other) {
    if (!(other instanceof Uint8Array)) { const e = new TypeError('The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received type ' + typeof other); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (this.length !== other.length) return false;
    if (_nativeCompare) return _nativeCompare(this, other) === 0;
    return Buffer.compare(this, other) === 0;
  }
  compare(other, targetStart, targetEnd, sourceStart, sourceEnd) {
    if (!Buffer.isBuffer(other)) throw new TypeError('Argument must be a Buffer');
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
    if (!target) throw new TypeError('argument should be a Buffer');
    targetStart = targetStart || 0;
    sourceStart = sourceStart || 0;
    sourceEnd = sourceEnd !== undefined ? sourceEnd : this.length;
    if (targetStart >= target.length || sourceStart >= sourceEnd) return 0;
    if (_nativeCopy) return _nativeCopy(this, target, targetStart, sourceStart, sourceEnd);
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
    if (typeof value === 'number') {
      if (_nativeIndexOfByte) return _nativeIndexOfByte(this, value & 0xff, byteOffset || 0);
      return super.indexOf(value, byteOffset);
    }
    const needle = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding);
    const start = byteOffset || 0;
    if (_nativeIndexOf) return _nativeIndexOf(this, needle, start);
    for (let i = start; i <= this.length - needle.length; i++) {
      let found = true;
      for (let j = 0; j < needle.length; j++) { if (this[i + j] !== needle[j]) { found = false; break; } }
      if (found) return i;
    }
    return -1;
  }

  includes(value, byteOffset, encoding) { return this.indexOf(value, byteOffset, encoding) !== -1; }

  readUInt8(offset) { return this[offset]; }
  readUInt16BE(offset) { return (this[offset] << 8) | this[offset + 1]; }
  readUInt16LE(offset) { return this[offset] | (this[offset + 1] << 8); }
  readUInt32BE(offset) { return ((this[offset] << 24) | (this[offset+1] << 16) | (this[offset+2] << 8) | this[offset+3]) >>> 0; }
  readUInt32LE(offset) { return ((this[offset+3] << 24) | (this[offset+2] << 16) | (this[offset+1] << 8) | this[offset]) >>> 0; }
  readInt8(offset) { const v = this[offset]; return v > 127 ? v - 256 : v; }
  readInt16BE(offset) { const v = this.readUInt16BE(offset); return v > 0x7fff ? v - 0x10000 : v; }
  readInt16LE(offset) { const v = this.readUInt16LE(offset); return v > 0x7fff ? v - 0x10000 : v; }
  readInt32BE(offset) { return (this[offset] << 24) | (this[offset+1] << 16) | (this[offset+2] << 8) | this[offset+3]; }
  readInt32LE(offset) { return (this[offset+3] << 24) | (this[offset+2] << 16) | (this[offset+1] << 8) | this[offset]; }
  readFloatBE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat32(offset, false); }
  readFloatLE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat32(offset, true); }
  readDoubleBE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat64(offset, false); }
  readDoubleLE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getFloat64(offset, true); }

  writeUInt8(value, offset) { this[offset] = value & 0xff; }
  writeUInt16BE(value, offset) { this[offset] = (value >> 8) & 0xff; this[offset+1] = value & 0xff; }
  writeUInt16LE(value, offset) { this[offset] = value & 0xff; this[offset+1] = (value >> 8) & 0xff; }
  writeUInt32BE(value, offset) { this[offset] = (value >>> 24) & 0xff; this[offset+1] = (value >>> 16) & 0xff; this[offset+2] = (value >>> 8) & 0xff; this[offset+3] = value & 0xff; }
  writeUInt32LE(value, offset) { this[offset] = value & 0xff; this[offset+1] = (value >>> 8) & 0xff; this[offset+2] = (value >>> 16) & 0xff; this[offset+3] = (value >>> 24) & 0xff; }
  writeInt8(value, offset) { this[offset] = value < 0 ? value + 256 : value; }
  writeInt16BE(value, offset) { this.writeUInt16BE(value < 0 ? value + 0x10000 : value, offset); }
  writeInt16LE(value, offset) { this.writeUInt16LE(value < 0 ? value + 0x10000 : value, offset); }
  writeInt32BE(value, offset) { this.writeUInt32BE(value < 0 ? value + 0x100000000 : value, offset); }
  writeInt32LE(value, offset) { this.writeUInt32LE(value < 0 ? value + 0x100000000 : value, offset); }
  writeFloatBE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat32(offset, value, false); }
  writeFloatLE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat32(offset, value, true); }
  writeDoubleBE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat64(offset, value, false); }
  writeDoubleLE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setFloat64(offset, value, true); }

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

  readBigInt64BE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigInt64(offset || 0, false); }
  readBigInt64LE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigInt64(offset || 0, true); }
  readBigUInt64BE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigUint64(offset || 0, false); }
  readBigUInt64LE(offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); return dv.getBigUint64(offset || 0, true); }
  writeBigInt64BE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigInt64(offset || 0, value, false); }
  writeBigInt64LE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigInt64(offset || 0, value, true); }
  writeBigUInt64BE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigUint64(offset || 0, value, false); }
  writeBigUInt64LE(value, offset) { const dv = new DataView(this.buffer, this.byteOffset, this.byteLength); dv.setBigUint64(offset || 0, value, true); }

  swap16() { for (let i = 0; i < this.length; i += 2) { const t = this[i]; this[i] = this[i+1]; this[i+1] = t; } return this; }
  swap32() { for (let i = 0; i < this.length; i += 4) { let t = this[i]; this[i] = this[i+3]; this[i+3] = t; t = this[i+1]; this[i+1] = this[i+2]; this[i+2] = t; } return this; }
  swap64() { for (let i = 0; i < this.length; i += 8) { for (let j = 0; j < 4; j++) { const t = this[i+j]; this[i+j] = this[i+7-j]; this[i+7-j] = t; } } return this; }

  lastIndexOf(value, byteOffset, encoding) {
    if (typeof value === 'number') return super.lastIndexOf(value, byteOffset);
    const needle = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding);
    const start = byteOffset !== undefined ? Math.min(byteOffset, this.length - needle.length) : this.length - needle.length;
    for (let i = start; i >= 0; i--) {
      let found = true;
      for (let j = 0; j < needle.length; j++) { if (this[i + j] !== needle[j]) { found = false; break; } }
      if (found) return i;
    }
    return -1;
  }

  fill(value, offset, end, encoding) {
    offset = offset || 0;
    end = end !== undefined ? end : this.length;
    if (typeof value === 'string') {
      if (value.length === 0) return this;
      const fillBuf = Buffer.from(value, encoding);
      for (let i = offset; i < end; i++) this[i] = fillBuf[(i - offset) % fillBuf.length];
    } else if (typeof value === 'number') {
      if (_nativeFillRange) {
        _nativeFillRange(this, value, offset, end);
      } else {
        for (let i = offset; i < end; i++) this[i] = value & 0xff;
      }
    } else if (Buffer.isBuffer(value)) {
      for (let i = offset; i < end; i++) this[i] = value[(i - offset) % value.length];
    }
    return this;
  }
}

Buffer.kMaxLength = 2 ** 31 - 1;
Buffer.poolSize = 8192;

function SlowBuffer(size) { return Buffer.allocUnsafeSlow(size); }
SlowBuffer.prototype = Buffer.prototype;

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

module.exports = {
  Buffer, SlowBuffer, kMaxLength: 2 ** 31 - 1, kStringMaxLength: 2 ** 28 - 16,
  isAscii, isUtf8,
  constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 28 - 16 },
  atob: globalThis.atob, btoa: globalThis.btoa,
  File: globalThis.File, Blob: globalThis.Blob,
};
