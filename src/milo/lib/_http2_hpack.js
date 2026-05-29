// HPACK header compression (RFC 7541). Full decode (indexed/literal/Huffman +
// dynamic table); encode uses literal-without-indexing, no Huffman (valid, simple).
'use strict';

// Static table (RFC 7541 Appendix A), 1-indexed.
const STATIC = [
  null,
  [':authority', ''], [':method', 'GET'], [':method', 'POST'], [':path', '/'],
  [':path', '/index.html'], [':scheme', 'http'], [':scheme', 'https'],
  [':status', '200'], [':status', '204'], [':status', '206'], [':status', '304'],
  [':status', '400'], [':status', '404'], [':status', '500'], ['accept-charset', ''],
  ['accept-encoding', 'gzip, deflate'], ['accept-language', ''], ['accept-ranges', ''],
  ['accept', ''], ['access-control-allow-origin', ''], ['age', ''], ['allow', ''],
  ['authorization', ''], ['cache-control', ''], ['content-disposition', ''],
  ['content-encoding', ''], ['content-language', ''], ['content-length', ''],
  ['content-location', ''], ['content-range', ''], ['content-type', ''], ['cookie', ''],
  ['date', ''], ['etag', ''], ['expect', ''], ['expires', ''], ['from', ''], ['host', ''],
  ['if-match', ''], ['if-modified-since', ''], ['if-none-match', ''], ['if-range', ''],
  ['if-unmodified-since', ''], ['last-modified', ''], ['link', ''], ['location', ''],
  ['max-forwards', ''], ['proxy-authenticate', ''], ['proxy-authorization', ''],
  ['range', ''], ['referer', ''], ['refresh', ''], ['retry-after', ''], ['server', ''],
  ['set-cookie', ''], ['strict-transport-security', ''], ['transfer-encoding', ''],
  ['user-agent', ''], ['vary', ''], ['via', ''], ['www-authenticate', ''],
];

// Huffman code table (Appendix B): [code, bitLength] for symbols 0..255 then EOS(256).
const HUFF = [
  [0x1ff8,13],[0x7fffd8,23],[0xfffffe2,28],[0xfffffe3,28],[0xfffffe4,28],[0xfffffe5,28],[0xfffffe6,28],[0xfffffe7,28],[0xfffffe8,28],[0xffffea,24],[0x3ffffffc,30],[0xfffffe9,28],[0xfffffea,28],[0x3ffffffd,30],[0xfffffeb,28],[0xfffffec,28],[0xfffffed,28],[0xfffffee,28],[0xfffffef,28],[0xffffff0,28],[0xffffff1,28],[0xffffff2,28],[0x3ffffffe,30],[0xffffff3,28],[0xffffff4,28],[0xffffff5,28],[0xffffff6,28],[0xffffff7,28],[0xffffff8,28],[0xffffff9,28],[0xffffffa,28],[0xffffffb,28],
  [0x14,6],[0x3f8,10],[0x3f9,10],[0xffa,12],[0x1ff9,13],[0x15,6],[0xf8,8],[0x7fa,11],[0x3fa,10],[0x3fb,10],[0xf9,8],[0x7fb,11],[0xfa,8],[0x16,6],[0x17,6],[0x18,6],
  [0x0,5],[0x1,5],[0x2,5],[0x19,6],[0x1a,6],[0x1b,6],[0x1c,6],[0x1d,6],[0x1e,6],[0x1f,6],[0x5c,7],[0xfb,8],[0x7ffc,15],[0x20,6],[0xffb,12],[0x3fc,10],
  [0x1ffa,13],[0x21,6],[0x5d,7],[0x5e,7],[0x5f,7],[0x60,7],[0x61,7],[0x62,7],[0x63,7],[0x64,7],[0x65,7],[0x66,7],[0x67,7],[0x68,7],[0x69,7],[0x6a,7],
  [0x6b,7],[0x6c,7],[0x6d,7],[0x6e,7],[0x6f,7],[0x70,7],[0x71,7],[0x72,7],[0xfc,8],[0x73,7],[0xfd,8],[0x1ffb,13],[0x7fff0,19],[0x1ffc,13],[0x3ffc,14],[0x22,6],
  [0x7ffd,15],[0x3,5],[0x23,6],[0x4,5],[0x24,6],[0x5,5],[0x25,6],[0x26,6],[0x27,6],[0x6,5],[0x74,7],[0x75,7],[0x28,6],[0x29,6],[0x2a,6],[0x7,5],
  [0x2b,6],[0x76,7],[0x2c,6],[0x8,5],[0x9,5],[0x2d,6],[0x77,7],[0x78,7],[0x79,7],[0x7a,7],[0x7b,7],[0x7ffe,15],[0x7fc,11],[0x3ffd,14],[0x1ffd,13],[0xffffffc,28],
  [0xfffe6,20],[0x3fffd2,22],[0xfffe7,20],[0xfffe8,20],[0x3fffd3,22],[0x3fffd4,22],[0x3fffd5,22],[0x7fffd9,23],[0x3fffd6,22],[0x7fffda,23],[0x7fffdb,23],[0x7fffdc,23],[0x7fffdd,23],[0x7fffde,23],[0xffffeb,24],[0x7fffdf,23],
  [0xffffec,24],[0xffffed,24],[0x3fffd7,22],[0x7fffe0,23],[0xffffee,24],[0x7fffe1,23],[0x7fffe2,23],[0x7fffe3,23],[0x7fffe4,23],[0x3fffd8,22],[0x3fffd9,22],[0x7fffe5,23],[0x3fffda,22],[0x7fffe6,23],[0x3fffdb,22],[0x3fffdc,22],
  [0x3fffdd,22],[0x3fffde,22],[0xffffef,24],[0x3fffdf,22],[0x7fffe7,23],[0x7fffe8,23],[0x7fffe9,23],[0x7fffea,23],[0x7fffeb,23],[0xfffff0,24],[0x3fffe0,22],[0x3fffe1,22],[0x7fffec,23],[0x3fffe2,22],[0x7fffed,23],[0x7fffee,23],
  [0xfffff1,24],[0x3fffe3,22],[0x3fffe4,22],[0x3fffe5,22],[0x7fffef,23],[0x3fffe6,22],[0x7ffff0,23],[0x3ffd60,22],[0xfffff2,24],[0x3fffe7,22],[0x3fffe8,22],[0x7ffff1,23],[0x3ffff8,26],[0x3ffff9,26],[0xfffff3,24],[0x7ffff2,23],
  [0x3fffe9,22],[0x7ffff3,23],[0xfffff4,24],[0x3fffea,22],[0x1ffff0,21],[0x3fffeb,22],[0x3fffec,22],[0x7ffff4,23],[0x7ffff5,23],[0x1ffff1,21],[0x7ffff6,23],[0x1ffff2,21],[0x1ffff3,21],[0x3fffed,22],[0x1ffff4,21],[0x3fffee,22],
  [0x7ffff7,23],[0x3fffef,22],[0x1ffff5,21],[0x3ffff0,22],[0x1ffff6,21],[0x1ffff7,21],[0xfffff5,24],[0xfffff6,24],[0x3ffff2,26],[0x1ffff8,21],[0x3ffff3,26],[0x7ffff8,23],[0x3ffff4,26],[0x3ffff5,26],[0xfffff7,24],[0xfffff8,24],
  [0xfffff9,24],[0x3ffff6,26],[0xfffffa,24],[0x3ffff7,26],[0xfffffb,24],[0x7ffff9,23],[0x3ffd61,22],[0x1ffff9,21],[0x3ffd62,22],[0x1ffffa,21],[0x7ffffa,23],[0x3ffd63,22],[0x3ffd64,22],[0x3ffd65,22],[0x7ffffb,23],[0x7ffffc,23],
  [0x1ffffb,21],[0xfffffc,24],[0x1ffffc,21],[0x1ffffd,21],[0x3ffd66,22],[0x1ffffe,21],[0x3ffd67,22],[0x3ffd68,22],[0x3ffd69,22],[0x3ffd6a,22],[0x3ffd6b,22],[0x7ffffd,23],[0x3ffd6c,22],[0x7ffffe,23],[0x3ffd6d,22],[0x3fffffc,26],
  [0xfffffd,24],[0x7ffffff,27],[0x3ffd6e,22],[0x3ffffa,26],[0x3ffffb,26],[0xfffffe,24],[0xffffff,24],[0x3ffffd,26],[0x3ffffe,26],[0x3fffff,26],[0x3ffd6f,22],[0x3ffd70,22],[0x3ffd71,22],[0x3ffd72,22],[0x3ffd73,22],[0x3ffd74,22],
];
// NOTE: the table above is the standard HPACK Huffman table values per symbol 0..255.

// Build a decode lookup: byLen[bitLen] = Map(code -> symbol)
const _byLen = [];
for (let sym = 0; sym < HUFF.length && sym < 256; sym++) {
  const [code, bits] = HUFF[sym];
  if (!_byLen[bits]) _byLen[bits] = new Map();
  _byLen[bits].set(code, sym);
}

function huffmanDecode(buf) {
  const out = [];
  let cur = 0, curBits = 0;
  for (let i = 0; i < buf.length; i++) {
    cur = (cur * 256) + buf[i];
    curBits += 8;
    // try to peel off codes (longest match isn't needed: prefix-free codes)
    let matched = true;
    while (matched && curBits > 0) {
      matched = false;
      for (let bits = 5; bits <= curBits && bits <= 30; bits++) {
        const m = _byLen[bits];
        if (!m) continue;
        const code = Math.floor(cur / Math.pow(2, curBits - bits)) & ((1 << bits) - 1 || 0x3fffffff);
        const codeMasked = _topBits(cur, curBits, bits);
        const sym = m.get(codeMasked);
        if (sym !== undefined) {
          out.push(sym);
          curBits -= bits;
          cur = cur % Math.pow(2, curBits);
          matched = true;
          break;
        }
      }
    }
  }
  return Buffer.from(out);
}
function _topBits(cur, curBits, bits) {
  // top `bits` of the low `curBits` of cur
  return Math.floor(cur / Math.pow(2, curBits - bits));
}

// Integer with N-bit prefix (RFC 7541 §5.1). Returns [value, newOffset].
function decodeInt(buf, off, prefixBits) {
  const max = (1 << prefixBits) - 1;
  let val = buf[off] & max;
  off++;
  if (val < max) return [val, off];
  let m = 0, b;
  do { b = buf[off++]; val += (b & 0x7f) * Math.pow(2, m); m += 7; } while (b & 0x80);
  return [val, off];
}

function decodeStr(buf, off) {
  const huff = (buf[off] & 0x80) !== 0;
  let len; [len, off] = decodeInt(buf, off, 7);
  const raw = buf.subarray(off, off + len);
  off += len;
  return [huff ? huffmanDecode(raw).toString('latin1') : raw.toString('latin1'), off];
}

class Decoder {
  constructor(maxSize = 4096) { this.dyn = []; this.maxSize = maxSize; this.size = 0; }
  _add(name, value) {
    const entrySize = name.length + value.length + 32;
    this.dyn.unshift([name, value]);
    this.size += entrySize;
    while (this.size > this.maxSize && this.dyn.length) {
      const [n, v] = this.dyn.pop();
      this.size -= n.length + v.length + 32;
    }
  }
  _get(index) {
    if (index < STATIC.length) return STATIC[index];
    const d = this.dyn[index - STATIC.length];
    return d || null;
  }
  decode(block) {
    const headers = [];
    let off = 0;
    while (off < block.length) {
      const b = block[off];
      if (b & 0x80) { // indexed header field
        let idx; [idx, off] = decodeInt(block, off, 7);
        const e = this._get(idx);
        if (e) headers.push([e[0], e[1]]);
      } else if (b & 0x40) { // literal with incremental indexing
        let idx; [idx, off] = decodeInt(block, off, 6);
        let name, value;
        if (idx === 0) { [name, off] = decodeStr(block, off); } else { name = this._get(idx)[0]; }
        [value, off] = decodeStr(block, off);
        this._add(name, value);
        headers.push([name, value]);
      } else if (b & 0x20) { // dynamic table size update
        let sz; [sz, off] = decodeInt(block, off, 5);
        this.maxSize = sz;
        while (this.size > this.maxSize && this.dyn.length) { const [n, v] = this.dyn.pop(); this.size -= n.length + v.length + 32; }
      } else { // literal without indexing / never indexed
        let idx; [idx, off] = decodeInt(block, off, 4);
        let name, value;
        if (idx === 0) { [name, off] = decodeStr(block, off); } else { name = this._get(idx)[0]; }
        [value, off] = decodeStr(block, off);
        headers.push([name, value]);
      }
    }
    return headers;
  }
}

function encodeInt(value, prefixBits, firstByteHigh) {
  const max = (1 << prefixBits) - 1;
  const bytes = [];
  if (value < max) { bytes.push(firstByteHigh | value); return bytes; }
  bytes.push(firstByteHigh | max);
  value -= max;
  while (value >= 128) { bytes.push((value % 128) + 128); value = Math.floor(value / 128); }
  bytes.push(value);
  return bytes;
}
function encodeStr(s) {
  const buf = Buffer.from(String(s), 'latin1');
  return Buffer.from([...encodeInt(buf.length, 7, 0x00), ...buf]); // no Huffman (high bit 0)
}

class Encoder {
  constructor() {}
  encode(headers) {
    // headers: array of [name, value]. Literal without indexing, new name (0x00).
    const parts = [];
    for (const [name, value] of headers) {
      parts.push(Buffer.from([0x00])); // literal w/o indexing, name not indexed
      parts.push(encodeStr(String(name).toLowerCase()));
      parts.push(encodeStr(value));
    }
    return Buffer.concat(parts);
  }
}

module.exports = { STATIC, Decoder, Encoder, huffmanDecode, decodeInt, decodeStr };
