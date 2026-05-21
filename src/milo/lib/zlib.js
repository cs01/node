// zlib module — real compression via system zlib
'use strict';

const { Transform } = require('stream');
const b = internalBinding('zlib');

// mode: 0=gzip, 1=gunzip, 2=deflate, 3=inflate, 4=deflateRaw, 5=inflateRaw
function _syncOp(mode, buf, opts) {
  if (typeof buf === 'string') buf = Buffer.from(buf);
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
  }
  _transform(chunk, encoding, cb) {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);
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

const constants = {
  Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4,
  Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5,
  Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1,
  Z_DEFAULT_STRATEGY: 0, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4,
  BROTLI_OPERATION_PROCESS: 0, BROTLI_OPERATION_FLUSH: 1, BROTLI_OPERATION_FINISH: 2,
};

module.exports = {
  Gzip, Gunzip, Deflate, Inflate, DeflateRaw, InflateRaw, Unzip,
  BrotliCompress, BrotliDecompress,
  createGzip, createGunzip, createDeflate, createInflate,
  createDeflateRaw, createInflateRaw, createUnzip,
  createBrotliCompress, createBrotliDecompress,
  gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip,
  gzipSync, gunzipSync, deflateSync, inflateSync,
  deflateRawSync, inflateRawSync, unzipSync,
  brotliCompressSync, brotliDecompressSync,
  constants,
};
