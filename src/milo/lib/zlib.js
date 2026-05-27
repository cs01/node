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
  const out = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
  out._truncated = result.truncated === -1;
  return out;
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
function _validateFlushFlag(val, name) {
  if (val !== undefined) {
    if (typeof val !== 'number') {
      const e = new TypeError(`The "${name}" property must be of type number. Received type ${typeof val} (${typeof val === 'string' ? "'" + val + "'" : val})`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (val < 0 || val > 5) {
      const e = new RangeError(`The value of "${name}" is out of range. It must be >= 0 and <= 5. Received ${val}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
  }
}

// Compression modes where windowBits=0 is invalid (must be 9-15)
const _COMPRESS_MODES = new Set([0, 2, 4]); // gzip, deflate, deflateRaw

class ZlibTransform extends Transform {
  constructor(mode, opts) {
    if (opts) {
      if (opts.chunkSize !== undefined) {
        if (typeof opts.chunkSize !== 'number') {
          const e = new TypeError(`The "options.chunkSize" property must be of type number. Received type ${typeof opts.chunkSize} (${typeof opts.chunkSize === 'string' ? "'" + opts.chunkSize + "'" : opts.chunkSize})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
        if (!Number.isFinite(opts.chunkSize)) {
          const e = new RangeError(`The value of "options.chunkSize" is out of range. It must be a finite number. Received ${opts.chunkSize}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
        if (opts.chunkSize < 64) {
          const e = new RangeError(`The value of "options.chunkSize" is out of range. It must be >= 64. Received ${opts.chunkSize}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
      }
      if (opts.level !== undefined) {
        if (typeof opts.level !== 'number') {
          const e = new TypeError(`The "options.level" property must be of type number. Received type ${typeof opts.level} (${typeof opts.level === 'string' ? "'" + opts.level + "'" : opts.level})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
        if (!Number.isFinite(opts.level)) {
          const e = new RangeError(`The value of "options.level" is out of range. It must be a finite number. Received ${opts.level}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
        if (opts.level < -1 || opts.level > 9) {
          const e = new RangeError(`The value of "options.level" is out of range. It must be >= -1 and <= 9. Received ${opts.level}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
      }
      if (opts.memLevel !== undefined) {
        if (typeof opts.memLevel !== 'number') {
          const e = new TypeError(`The "options.memLevel" property must be of type number. Received type ${typeof opts.memLevel} (${typeof opts.memLevel === 'string' ? "'" + opts.memLevel + "'" : opts.memLevel})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
        if (!Number.isFinite(opts.memLevel) || opts.memLevel < 1 || opts.memLevel > 9) {
          const msg = !Number.isFinite(opts.memLevel) ? 'It must be a finite number' : 'It must be >= 1 and <= 9';
          const e = new RangeError(`The value of "options.memLevel" is out of range. ${msg}. Received ${opts.memLevel}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
      }
      if (opts.strategy !== undefined) {
        if (typeof opts.strategy !== 'number') {
          const e = new TypeError(`The "options.strategy" property must be of type number. Received type ${typeof opts.strategy} (${typeof opts.strategy === 'string' ? "'" + opts.strategy + "'" : opts.strategy})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
        if (!Number.isFinite(opts.strategy) || opts.strategy < 0 || opts.strategy > 4) {
          const msg = !Number.isFinite(opts.strategy) ? 'It must be a finite number' : 'It must be >= 0 and <= 4';
          const e = new RangeError(`The value of "options.strategy" is out of range. ${msg}. Received ${opts.strategy}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
      }
      if (opts.dictionary !== undefined) {
        if (!Buffer.isBuffer(opts.dictionary) && !ArrayBuffer.isView(opts.dictionary) && !(opts.dictionary instanceof ArrayBuffer)) {
          const v = typeof opts.dictionary === 'string' ? "'" + opts.dictionary + "'" : String(opts.dictionary);
          const e = new TypeError(`The "options.dictionary" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received type ${typeof opts.dictionary} (${v})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
      }
      _validateFlushFlag(opts.flush, 'options.flush');
      _validateFlushFlag(opts.finishFlush, 'options.finishFlush');
      if (opts.windowBits !== undefined) {
        if (typeof opts.windowBits !== 'number') {
          const e = new TypeError(`The "options.windowBits" property must be of type number. Received type ${typeof opts.windowBits} (${typeof opts.windowBits === 'string' ? "'" + opts.windowBits + "'" : opts.windowBits})`);
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
        if (!Number.isFinite(opts.windowBits)) {
          const e = new RangeError(`The value of "options.windowBits" is out of range. It must be a finite number. Received ${opts.windowBits}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
        if (opts.windowBits < 8 || opts.windowBits > 15) {
          const e = new RangeError(`The value of "options.windowBits" is out of range. It must be >= 8 and <= 15. Received ${opts.windowBits}`);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
      }
    }
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
      if (result._truncated) {
        // Push partial data then error — matches Node.js behavior for truncated streams
        this.push(result);
        const e = new Error('unexpected end of file');
        e.code = 'Z_BUF_ERROR'; e.errno = -5;
        cb(e);
      } else {
        cb(null, result);
      }
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
  params(level, strategy, cb) {
    if (typeof level !== 'number') {
      const e = new TypeError(`The "level" argument must be of type number. Received type ${typeof level} (${typeof level === 'string' ? "'" + level + "'" : level})`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!Number.isFinite(level)) {
      const e = new RangeError(`The value of "level" is out of range. It must be a finite number. Received ${level}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    if (level < -1 || level > 9) {
      const e = new RangeError(`The value of "level" is out of range. It must be >= -1 and <= 9. Received ${level}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    if (typeof strategy !== 'number') {
      const e = new TypeError(`The "strategy" argument must be of type number. Received type ${typeof strategy} (${typeof strategy === 'string' ? "'" + strategy + "'" : strategy})`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!Number.isFinite(strategy) || strategy < 0 || strategy > 4) {
      const msg = !Number.isFinite(strategy) ? 'It must be a finite number' : 'It must be >= 0 and <= 4';
      const e = new RangeError(`The value of "strategy" is out of range. ${msg}. Received ${strategy}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    if (cb) process.nextTick(cb);
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

const constants = Object.freeze({
  Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5, Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1,
  Z_DEFAULT_STRATEGY: 0, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4,
  Z_DEFAULT_WINDOWBITS: 15, Z_MIN_WINDOWBITS: 8, Z_MAX_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64, Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1, Z_MAX_MEMLEVEL: 9, Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1, Z_MAX_LEVEL: 9, Z_DEFAULT_LEVEL: -1,
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
  createCompress: createDeflate,
  createDecompress: createInflate,
  gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip,
  gzipSync, gunzipSync, deflateSync, inflateSync,
  deflateRawSync, inflateRawSync, unzipSync,
  brotliCompressSync, brotliDecompressSync,
  crc32,
  constants,
};
Object.defineProperty(module.exports, 'codes', { value: constants, writable: false, configurable: false, enumerable: true });
