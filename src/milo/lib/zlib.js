// zlib module — stub (no compression without native binding)
'use strict';

const { Transform } = require('stream');

class ZlibBase extends Transform {
  constructor(opts) { super(opts); }
  _transform(chunk, encoding, cb) { cb(null, chunk); }
}

class Gzip extends ZlibBase {}
class Gunzip extends ZlibBase {}
class Deflate extends ZlibBase {}
class Inflate extends ZlibBase {}
class DeflateRaw extends ZlibBase {}
class InflateRaw extends ZlibBase {}
class Unzip extends ZlibBase {}
class BrotliCompress extends ZlibBase {}
class BrotliDecompress extends ZlibBase {}

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
  constants,
};
