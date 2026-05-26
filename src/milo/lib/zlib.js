// zlib module — real compression via system zlib
'use strict';

const { Transform } = require('stream');
const b = internalBinding('zlib');

// mode: 0=gzip, 1=gunzip, 2=deflate, 3=inflate, 4=deflateRaw, 5=inflateRaw
function _syncOp(mode, buf, opts) {
  if (typeof buf === 'string') buf = Buffer.from(buf);
  else if (buf == null || typeof buf === 'boolean' || typeof buf === 'number' ||
           (typeof buf === 'object' && !Buffer.isBuffer(buf) && !(buf instanceof Uint8Array) && !(buf instanceof ArrayBuffer) && !(buf instanceof DataView) && !ArrayBuffer.isView(buf))) {
    const received = buf === null ? 'null' : buf === undefined ? 'undefined'
      : Array.isArray(buf) ? 'an instance of Array'
      : typeof buf === 'object' ? `an instance of ${buf.constructor ? buf.constructor.name : 'Object'}`
      : `type ${typeof buf} (${String(buf)})`;
    const e = new TypeError(`The "buffer" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received ${received}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  const input = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.length);
  const level = (opts && opts.level != null) ? opts.level : -1;
  const result = b.zlibOp(input, mode, level);
  if (!result) throw new Error('zlib operation failed');
  return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
}

function gzipSync(buf, opts) { return _syncOp(0, buf, opts); }
function gunzipSync(buf, opts) { return _syncOp(1, buf, opts); }
function deflateSync(buf, opts) { return _syncOp(2, buf, opts); }
function inflateSync(buf, opts) { return _syncOp(3, buf, opts); }
function deflateRawSync(buf, opts) { return _syncOp(4, buf, opts); }
function inflateRawSync(buf, opts) { return _syncOp(5, buf, opts); }
function unzipSync(buf, opts) { return _syncOp(1, buf, opts); }
function brotliCompressSync() { throw new Error('brotli not supported'); }
function brotliDecompressSync() { throw new Error('brotli not supported'); }

// Async versions
function _asyncOp(mode, buf, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  process.nextTick(() => {
    try { cb(null, _syncOp(mode, buf, opts)); }
    catch (e) { cb(e); }
  });
}
function gzip(buf, opts, cb) { _asyncOp(0, buf, opts, cb); }
function gunzip(buf, opts, cb) { _asyncOp(1, buf, opts, cb); }
function deflate(buf, opts, cb) { _asyncOp(2, buf, opts, cb); }
function inflate(buf, opts, cb) { _asyncOp(3, buf, opts, cb); }
function deflateRaw(buf, opts, cb) { _asyncOp(4, buf, opts, cb); }
function inflateRaw(buf, opts, cb) { _asyncOp(5, buf, opts, cb); }
function unzip(buf, opts, cb) { _asyncOp(1, buf, opts, cb); }

// Streaming transforms
class ZlibTransform extends Transform {
  constructor(mode, opts) {
    super(opts);
    this._mode = mode;
    this._chunks = [];
    this._opts = opts || {};
    this._handle = {};
  }
  _destroy(err, cb) {
    this._handle = null;
    cb(err);
  }
  _transform(chunk, encoding, cb) {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);
    else if (chunk != null && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      const e = new TypeError('The "chunk" argument must be of type string or an instance of Buffer or Uint8Array');
      e.code = 'ERR_INVALID_ARG_TYPE'; return cb(e);
    }
    this._chunks.push(chunk);
    cb();
  }
  _flush(cb) {
    const input = Buffer.concat(this._chunks);
    try {
      const result = _syncOp(this._mode, input, this._opts);
      cb(null, result);
    } catch (e) { cb(e); }
  }
  flush(kind, cb) {
    if (typeof kind === 'function') { cb = kind; kind = constants.Z_FULL_FLUSH; }
    if (this._chunks.length > 0) {
      const input = Buffer.concat(this._chunks);
      this._chunks = [];
      try {
        const result = _syncOp(this._mode, input, this._opts);
        this.push(result);
      } catch (e) { if (cb) { cb(e); return; } throw e; }
    }
    if (cb) process.nextTick(cb);
  }
  close(cb) { if (cb) process.nextTick(cb); this.destroy(); }
  params(level, strategy, cb) { if (cb) process.nextTick(cb); }
}

class Gzip extends ZlibTransform { constructor(opts) { super(0, opts); } }
class Gunzip extends ZlibTransform { constructor(opts) { super(1, opts); } }
class Deflate extends ZlibTransform { constructor(opts) { super(2, opts); } }
class Inflate extends ZlibTransform { constructor(opts) { super(3, opts); } }
class DeflateRaw extends ZlibTransform { constructor(opts) { super(4, opts); } }
class InflateRaw extends ZlibTransform { constructor(opts) { super(5, opts); } }
class Unzip extends ZlibTransform { constructor(opts) { super(1, opts); } }
class BrotliCompress extends Transform { _transform(c, e, cb) { cb(null, c); } }
class BrotliDecompress extends Transform { _transform(c, e, cb) { cb(null, c); } }

function createGzip(opts) { return new Gzip(opts); }
function createGunzip(opts) { return new Gunzip(opts); }
function createDeflate(opts) { return new Deflate(opts); }
function createInflate(opts) { return new Inflate(opts); }
function createDeflateRaw(opts) { return new DeflateRaw(opts); }
function createInflateRaw(opts) { return new InflateRaw(opts); }
function createUnzip(opts) { return new Unzip(opts); }
function createBrotliCompress(opts) { return new BrotliCompress(opts); }
function createBrotliDecompress(opts) { return new BrotliDecompress(opts); }

const constants = Object.freeze({
  Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4,
  Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5,
  Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1,
  Z_DEFAULT_STRATEGY: 0, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4,
  BROTLI_OPERATION_PROCESS: 0, BROTLI_OPERATION_FLUSH: 1, BROTLI_OPERATION_FINISH: 2,
});

// Allow calling constructors without new
function _wrapClass(Cls) { const w = function(opts) { return new Cls(opts); }; Object.setPrototypeOf(w, Cls); w.prototype = Cls.prototype; return w; }

// CRC32 lookup table
const _crc32Table = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  _crc32Table[i] = c;
}
function crc32(data, value) {
  if (typeof data !== 'string' && !Buffer.isBuffer(data) && !(data instanceof Uint8Array) && !(data instanceof DataView)) {
    throw _ERR_INVALID_ARG_TYPE('data', ['Buffer', 'TypedArray', 'DataView', 'string'], data);
  }
  if (value !== undefined && typeof value !== 'number') throw _ERR_INVALID_ARG_TYPE('value', 'number', value);
  if (typeof data === 'string') data = Buffer.from(data);
  let crc = (value || 0) ^ -1;
  for (let i = 0; i < data.length; i++) crc = _crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

module.exports = {
  Gzip: _wrapClass(Gzip), Gunzip: _wrapClass(Gunzip), Deflate: _wrapClass(Deflate), Inflate: _wrapClass(Inflate),
  DeflateRaw: _wrapClass(DeflateRaw), InflateRaw: _wrapClass(InflateRaw), Unzip: _wrapClass(Unzip),
  BrotliCompress: _wrapClass(BrotliCompress), BrotliDecompress: _wrapClass(BrotliDecompress),
  createGzip, createGunzip, createDeflate, createInflate,
  createDeflateRaw, createInflateRaw, createUnzip,
  createBrotliCompress, createBrotliDecompress,
  gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip,
  gzipSync, gunzipSync, deflateSync, inflateSync,
  deflateRawSync, inflateRawSync, unzipSync,
  brotliCompressSync, brotliDecompressSync,
  crc32,
  constants,
};
Object.defineProperty(module.exports, 'codes', { value: constants, writable: false, configurable: false, enumerable: true });
