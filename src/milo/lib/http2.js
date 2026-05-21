// http2 module — HTTP/2 protocol support
'use strict';

const EventEmitter = require('events');

const constants = {
  NGHTTP2_SESSION_SERVER: 0,
  NGHTTP2_SESSION_CLIENT: 1,
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522,
  NGHTTP2_FLAG_NONE: 0,
  NGHTTP2_FLAG_END_STREAM: 1,
  NGHTTP2_FLAG_END_HEADERS: 4,
  HTTP2_HEADER_PATH: ':path',
  HTTP2_HEADER_STATUS: ':status',
  HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_AUTHORITY: ':authority',
  HTTP2_HEADER_SCHEME: ':scheme',
  HTTP2_HEADER_CONTENT_TYPE: 'content-type',
  HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
  HTTP2_METHOD_GET: 'GET',
  HTTP2_METHOD_POST: 'POST',
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
};

class Http2Session extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.closed = false; this.socket = null; }
  destroy() { this.destroyed = true; this.emit('close'); }
  close(cb) { this.closed = true; if (cb) cb(); this.emit('close'); }
  ping(cb) { if (cb) process.nextTick(cb, null, 0, Buffer.alloc(8)); return true; }
  settings(settings) {}
  goaway() {}
  ref() { return this; }
  unref() { return this; }
}

class ClientHttp2Session extends Http2Session {
  request(headers) {
    const stream = new ClientHttp2Stream();
    process.nextTick(() => stream.emit('response', {}));
    return stream;
  }
}

class Http2Stream extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.closed = false; this.id = 0; this.pending = false; this.rstCode = 0; this.sentHeaders = {}; this.sentInfoHeaders = []; }
  close(code) { this.closed = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  priority(opts) {}
  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }
}

class ServerHttp2Stream extends Http2Stream {
  respond(headers) { this.headersSent = true; }
  respondWithFile() {}
  respondWithFD() {}
  pushStream() {}
}

class ClientHttp2Stream extends Http2Stream {
  constructor() {
    super();
    this.readable = true;
    this.writable = true;
  }
  write(data) { return true; }
  end(data) { if (data) this.write(data); this.writable = false; this.emit('end'); }
}

function connect(authority, options, listener) {
  const session = new ClientHttp2Session();
  if (listener) session.once('connect', listener);
  process.nextTick(() => session.emit('connect', session));
  return session;
}

function createServer(options, onRequestHandler) {
  if (typeof options === 'function') { onRequestHandler = options; options = {}; }
  const server = new EventEmitter();
  server.listen = function() { return this; };
  server.close = function(cb) { if (cb) cb(); };
  if (onRequestHandler) server.on('stream', onRequestHandler);
  return server;
}

function createSecureServer(options, onRequestHandler) {
  return createServer(options, onRequestHandler);
}

function getDefaultSettings() {
  return { headerTableSize: 4096, enablePush: true, initialWindowSize: 65535, maxFrameSize: 16384, maxConcurrentStreams: 100, maxHeaderListSize: 65535, enableConnectProtocol: false };
}

function getPackedSettings(settings) { return Buffer.alloc(0); }
function getUnpackedSettings(buf) { return getDefaultSettings(); }

const sensitiveHeaders = Symbol('nodejs.http2.sensitiveHeaders');

module.exports = {
  constants,
  connect,
  createServer,
  createSecureServer,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
  Http2Session,
  ClientHttp2Session,
  Http2Stream,
  ServerHttp2Stream,
  ClientHttp2Stream,
};
