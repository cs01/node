// buffer module — Buffer over Uint8Array + internalBinding('buffer') for alloc
'use strict';

const encodings = ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'hex', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'];

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
  let s = '';
  for (let i = start; i < end; i++) s += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
  return s;
}

function _hexDecode(str) {
  const a = [];
  for (let i = 0; i < str.length; i += 2) a.push(parseInt(str.slice(i, i + 2), 16));
  return a;
}

function _base64Decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function _base64Encode(buf, start, end) {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

class Buffer extends Uint8Array {
  static alloc(size, fill, encoding) {
    const buf = new Buffer(size);
    if (fill !== undefined) buf.fill(typeof fill === 'string' ? Buffer.from(fill, encoding)[0] || 0 : fill);
    return buf;
  }

  static allocUnsafe(size) { return new Buffer(size); }

  static from(value, encodingOrOffset, length) {
    if (typeof value === 'string') {
      const enc = (encodingOrOffset || 'utf8').toLowerCase();
      if (enc === 'hex') return new Buffer(_hexDecode(value));
      if (enc === 'base64') return new Buffer(_base64Decode(value));
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
        const a = new Buffer(value.length);
        for (let i = 0; i < value.length; i++) a[i] = value.charCodeAt(i) & 0xff;
        return a;
      }
      return new Buffer(_utf8Encode(value));
    }
    if (value instanceof ArrayBuffer) {
      const offset = encodingOrOffset || 0;
      const len = length !== undefined ? length : value.byteLength - offset;
      return new Buffer(new Uint8Array(value, offset, len));
    }
    if (Array.isArray(value) || value instanceof Uint8Array) return new Buffer(value);
    if (Buffer.isBuffer(value)) { const c = new Buffer(value.length); c.set(value); return c; }
    throw new TypeError('Invalid argument for Buffer.from');
  }

  static isBuffer(obj) { return obj instanceof Buffer; }
  static isEncoding(enc) { return encodings.includes((enc || '').toLowerCase()); }
  static byteLength(str, encoding) { return Buffer.from(str, encoding).length; }

  static concat(list, totalLength) {
    if (totalLength === undefined) totalLength = list.reduce((sum, b) => sum + b.length, 0);
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (const buf of list) { result.set(buf, offset); offset += buf.length; if (offset >= totalLength) break; }
    return result;
  }

  static compare(a, b) {
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
  equals(other) { return Buffer.compare(this, other) === 0; }
  compare(other) { return Buffer.compare(this, other); }
  copy(target, targetStart, sourceStart, sourceEnd) { target.set(this.subarray(sourceStart || 0, sourceEnd || this.length), targetStart || 0); }

  slice(start, end) {
    const s = this.subarray(start, end);
    Object.setPrototypeOf(s, Buffer.prototype);
    return s;
  }

  indexOf(value, byteOffset, encoding) {
    if (typeof value === 'number') return super.indexOf(value, byteOffset);
    const needle = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding);
    const start = byteOffset || 0;
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
}

module.exports = { Buffer, kMaxLength: 2 ** 31 - 1, constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 28 - 16 } };
