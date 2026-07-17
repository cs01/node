// zlib module — real compression via system zlib with persistent streaming support
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
  const result = b.zlibOp(input, mode === 6 ? 1 : mode, level);
  if (!result) throw new Error('zlib operation failed');
  const out = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
  out._truncated = result.truncated === -1;
  return (opts && opts.info) ? { buffer: out, engine: _engineFor(mode, opts) } : out;
}

function gzipSync(buf, opts) { return _syncOp(0, buf, opts); }
function gunzipSync(buf, opts) { return _syncOp(1, buf, opts); }
function deflateSync(buf, opts) { return _syncOp(2, buf, opts); }
function inflateSync(buf, opts) { return _syncOp(3, buf, opts); }
function deflateRawSync(buf, opts) { return _syncOp(4, buf, opts); }
function inflateRawSync(buf, opts) { return _syncOp(5, buf, opts); }
function unzipSync(buf, opts) { return _syncOp(6, buf, opts); }
function brotliCompressSync() { throw new Error('brotli not supported'); }
function brotliDecompressSync() { throw new Error('brotli not supported'); }

// Async versions
// info:true makes the callback receive { buffer, engine } — engine is an instance of
// the stream class matching the operation (mode 6 = unzip -> Unzip, unlike gunzip's Gunzip).
function _engineFor(mode, opts) {
  const M = module.exports;
  const Cls = [M.Gzip, M.Gunzip, M.Deflate, M.Inflate, M.DeflateRaw, M.InflateRaw][mode] || M.Unzip;
  return new Cls(opts);
}
function _asyncOp(mode, buf, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  opts = opts || {};
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
function unzip(buf, opts, cb) { _asyncOp(6, buf, opts, cb); }

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

function _windowBitsForMode(mode, opts) {
  const wb = (opts && opts.windowBits) || 15;
  if (mode === 0) return wb + 16;       // gzip
  if (mode === 1) return wb + 32;       // gunzip (auto-detect)
  if (mode === 2) return wb;            // deflate
  if (mode === 3) return wb + 32;       // inflate (auto-detect)
  if (mode === 4) return -wb;           // deflateRaw
  if (mode === 5) return -wb;           // inflateRaw
  return wb;
}

function _isCompressMode(mode) { return mode === 0 || mode === 2 || mode === 4; }

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
        if (Number.isNaN(opts.level)) { opts.level = -1; }
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
        if (Number.isNaN(opts.strategy)) { opts.strategy = 0; }
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
        const minWB = _isCompressMode(mode) ? 9 : 8;
        if (opts.windowBits < minWB || opts.windowBits > 15) {
          if (opts.windowBits === 0 && !_isCompressMode(mode)) { /* 0 = use stream header */ }
          else { const e = new RangeError(`The value of "options.windowBits" is out of range. It must be >= ${minWB} and <= 15. Received ${opts.windowBits}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
        }
      }
    }
    super(opts);
    this._mode = mode;
    this._opts = opts || {};
    this._isCompress = _isCompressMode(mode);
    const wb = _windowBitsForMode(mode, this._opts);
    this._level = this._opts.level != null ? this._opts.level : -1;
    const memLevel = this._opts.memLevel || 8;
    this._strategy = this._opts.strategy || 0;
    this._streamHandle = b.streamCreate(this._isCompress ? 1 : 0, this._level, wb, memLevel, this._strategy);
    this._handle = {};
  }
  _destroy(err, cb) {
    if (this._streamHandle) {
      b.streamClose(this._streamHandle, this._isCompress ? 1 : 0);
      this._streamHandle = null;
    }
    this._handle = null;
    cb(err);
  }
  // node-internal: synchronously run one chunk through zlib with the given flush flag and
  // RETURN the output (minizlib — used by tar/node-tar — reaches into `handle._processChunk`
  // for its sync path). streamWrite already loop-drains and returns the full output buffer.
  _processChunk(chunk, flushFlag) {
    if (!this._streamHandle) return Buffer.alloc(0);
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const input = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    const result = b.streamWrite(this._streamHandle, this._isCompress ? 1 : 0, input, flushFlag);
    return (result && result.length > 0)
      ? Buffer.from(result.buffer, result.byteOffset, result.byteLength) : Buffer.alloc(0);
  }
  _transform(chunk, encoding, cb) {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);
    else if (chunk != null && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      const e = new TypeError('The "chunk" argument must be of type string or an instance of Buffer or Uint8Array');
      e.code = 'ERR_INVALID_ARG_TYPE'; return cb(e);
    }
    if (!this._streamHandle) return cb();
    const input = new Uint8Array(chunk.buffer || chunk, chunk.byteOffset || 0, chunk.length);
    const result = b.streamWrite(this._streamHandle, this._isCompress ? 1 : 0, input, constants.Z_NO_FLUSH);
    if (result && result.length > 0) this.push(Buffer.from(result.buffer, result.byteOffset, result.byteLength));
    cb();
  }
  _flush(cb) {
    if (!this._streamHandle) return cb();
    const input = new Uint8Array(0);
    const result = b.streamWrite(this._streamHandle, this._isCompress ? 1 : 0, input, constants.Z_FINISH);
    if (result && result.length > 0) this.push(Buffer.from(result.buffer, result.byteOffset, result.byteLength));
    cb();
  }
  flush(kind, cb) {
    if (typeof kind === 'function') { cb = kind; kind = constants.Z_SYNC_FLUSH; }
    if (!this._streamHandle) { if (cb) process.nextTick(cb); return; }
    const input = new Uint8Array(0);
    const result = b.streamWrite(this._streamHandle, this._isCompress ? 1 : 0, input, kind || constants.Z_SYNC_FLUSH);
    if (result && result.length > 0) this.push(Buffer.from(result.buffer, result.byteOffset, result.byteLength));
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
  reset() {
    if (this._streamHandle) {
      b.streamReset(this._streamHandle, this._isCompress ? 1 : 0);
    }
    if (this._writableState) {
      this._writableState.ended = false;
      this._writableState.ending = false;
      this._writableState.finished = false;
      this._writableState.length = 0;
      this._writableState.errored = null;
      this._writableState.writing = false;
      this._writableState.buffered = [];
      if (this._writableState.writable !== undefined) this._writableState.writable = true;
    }
    if (this._readableState) {
      this._readableState.ended = false;
      this._readableState.length = 0;
      this._readableState.buffer = [];
      this._readableState.endEmitted = false;
      if (this._readableState.readable !== undefined) this._readableState.readable = true;
    }
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
