// http2 — real HTTP/2 over TCP (RFC 7540) built on the frame codec + HPACK.
'use strict';

const EventEmitter = require('events');
const net = require('net');
const { Duplex } = require('stream');
const F = require('_http2_framer');
const HP = require('_http2_hpack');

const constants = {
  NGHTTP2_SESSION_SERVER: 0, NGHTTP2_SESSION_CLIENT: 1,
  NGHTTP2_FLAG_NONE: 0, NGHTTP2_FLAG_END_STREAM: 1, NGHTTP2_FLAG_END_HEADERS: 4,
  HTTP2_HEADER_PATH: ':path', HTTP2_HEADER_STATUS: ':status', HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_AUTHORITY: ':authority', HTTP2_HEADER_SCHEME: ':scheme',
  HTTP2_HEADER_CONTENT_TYPE: 'content-type', HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
  HTTP2_METHOD_GET: 'GET', HTTP2_METHOD_POST: 'POST',
  HTTP_STATUS_OK: 200, HTTP_STATUS_NOT_FOUND: 404, HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
};
const sensitiveHeaders = Symbol('nodejs.http2.sensitiveHeaders');
const DEFAULT_SETTINGS = { headerTableSize: 4096, enablePush: true, initialWindowSize: 65535, maxFrameSize: 16384, maxConcurrentStreams: 4294967295, maxHeaderListSize: 65535, enableConnectProtocol: false };

function headersToObject(list) {
  const o = {};
  for (const [k, v] of list) {
    if (o[k] === undefined) o[k] = v;
    else if (Array.isArray(o[k])) o[k].push(v);
    else o[k] = [o[k], v];
  }
  return o;
}
function objectToHeaders(obj, extra) {
  const list = [];
  if (extra) for (const [k, v] of extra) list.push([k, String(v)]);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) list.push([k.toLowerCase(), String(item)]);
    else list.push([k.toLowerCase(), String(v)]);
  }
  return list;
}

class Http2Stream extends Duplex {
  constructor(session, id) {
    super();
    this.session = session;
    this.id = id;
    this.closed = false;
    this.rstCode = 0;
    this.sentHeaders = undefined;
    this.pending = id === 0;
    this._localEnded = false;
  }
  get pushAllowed() { return false; }
  _write(chunk, enc, cb) {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, enc || 'utf8');
    this.session._sendData(this.id, chunk, false);
    cb();
  }
  _final(cb) { this._localEnded = true; this.session._sendData(this.id, Buffer.alloc(0), true); cb(); }
  _read() {}
  close(code = 0, cb) {
    if (this.closed) { if (cb) process.nextTick(cb); return; }
    this.closed = true;
    this.rstCode = code;
    if (cb) this.once('close', cb);
    this.session._sendRst(this.id, code);
    process.nextTick(() => this.emit('close'));
  }
  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }
  priority() {}
  _push(chunk) { this.push(chunk); }
  _end() { this.push(null); }
}

class ServerHttp2Stream extends Http2Stream {
  respond(headers = {}, options = {}) {
    this.sentHeaders = headers;
    this.headersSent = true;
    const rest = { ...headers };
    const status = rest[':status'] || 200;
    delete rest[':status'];
    const list = objectToHeaders(rest, [[':status', String(status)]]);
    this.session._sendHeaders(this.id, list, !!options.endStream);
    if (options.endStream) this._localEnded = true;
  }
  respondWithFD() { throw new Error('respondWithFD not supported'); }
  respondWithFile() { throw new Error('respondWithFile not supported'); }
  pushStream() { throw new Error('push streams not supported'); }
}

class ClientHttp2Stream extends Http2Stream {}

class Http2Session extends EventEmitter {
  constructor(socket, type) {
    super();
    this.socket = socket;
    this.type = type;
    this.destroyed = false;
    this.closed = false;
    this.encoder = new HP.Encoder();
    this.decoder = new HP.Decoder();
    this.streams = new Map();
    this._buf = Buffer.alloc(0);
    this._gotPreface = type === constants.NGHTTP2_SESSION_CLIENT;
    this._headerFrag = null;
    this._nextStreamId = type === constants.NGHTTP2_SESSION_CLIENT ? 1 : 2;
    this.localSettings = { ...DEFAULT_SETTINGS };
    this.remoteSettings = { ...DEFAULT_SETTINGS };

    socket.on('data', (d) => this._onData(d));
    socket.on('error', (e) => { if (!this.destroyed) this.emit('error', e); });
    socket.on('close', () => { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } });

    if (type === constants.NGHTTP2_SESSION_CLIENT) socket.write(F.PREFACE);
    this._send(F.serializeFrame(F.FRAME.SETTINGS, 0, 0, F.packSettings({ [F.SETTINGS.INITIAL_WINDOW_SIZE]: 0x7fffffff, [F.SETTINGS.ENABLE_PUSH]: 0 })));
  }
  _send(buf) { if (this.socket && !this.socket.destroyed) this.socket.write(buf); }

  _onData(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    if (!this._gotPreface) {
      if (this._buf.length < F.PREFACE.length) return;
      this._buf = this._buf.subarray(F.PREFACE.length);
      this._gotPreface = true;
    }
    const { frames, rest } = F.parseFrames(this._buf);
    this._buf = rest;
    for (const fr of frames) this._handleFrame(fr);
  }

  _handleFrame(fr) {
    switch (fr.type) {
      case F.FRAME.SETTINGS:
        if (fr.flags & F.FLAG.ACK) break;
        Object.assign(this.remoteSettings, F.unpackSettings(fr.payload));
        this._send(F.serializeFrame(F.FRAME.SETTINGS, F.FLAG.ACK, 0, Buffer.alloc(0)));
        this.emit('remoteSettings', this.remoteSettings);
        break;
      case F.FRAME.HEADERS: {
        const block = F.stripPadding(fr.payload, fr.flags, true);
        if (fr.flags & F.FLAG.END_HEADERS) this._onHeaders(fr.streamId, block, !!(fr.flags & F.FLAG.END_STREAM));
        else this._headerFrag = { id: fr.streamId, buf: Buffer.from(block), endStream: !!(fr.flags & F.FLAG.END_STREAM) };
        break;
      }
      case F.FRAME.CONTINUATION:
        if (this._headerFrag && this._headerFrag.id === fr.streamId) {
          this._headerFrag.buf = Buffer.concat([this._headerFrag.buf, fr.payload]);
          if (fr.flags & F.FLAG.END_HEADERS) { const h = this._headerFrag; this._headerFrag = null; this._onHeaders(h.id, h.buf, h.endStream); }
        }
        break;
      case F.FRAME.DATA: {
        const data = F.stripPadding(fr.payload, fr.flags, false);
        const s = this.streams.get(fr.streamId);
        if (s && data.length) s._push(Buffer.from(data));
        if (data.length) {
          const wu = Buffer.allocUnsafe(4); wu.writeUInt32BE(data.length, 0);
          this._send(F.serializeFrame(F.FRAME.WINDOW_UPDATE, 0, 0, wu));
          this._send(F.serializeFrame(F.FRAME.WINDOW_UPDATE, 0, fr.streamId, wu));
        }
        if ((fr.flags & F.FLAG.END_STREAM) && s) s._end();
        break;
      }
      case F.FRAME.PING:
        if (!(fr.flags & F.FLAG.ACK)) this._send(F.serializeFrame(F.FRAME.PING, F.FLAG.ACK, 0, Buffer.from(fr.payload)));
        else this.emit('_pingAck', fr.payload);
        break;
      case F.FRAME.WINDOW_UPDATE: break;
      case F.FRAME.RST_STREAM: {
        const s = this.streams.get(fr.streamId);
        if (s) { s.rstCode = fr.payload.length >= 4 ? fr.payload.readUInt32BE(0) : 0; s._end(); s.emit('close'); this.streams.delete(fr.streamId); }
        break;
      }
      case F.FRAME.GOAWAY:
        this.emit('goaway', fr.payload.length >= 8 ? fr.payload.readUInt32BE(4) : 0);
        break;
      default: break;
    }
  }

  _onHeaders(streamId, block, endStream) {
    let headers;
    try { headers = this.decoder.decode(block); } catch (e) { this.emit('error', e); return; }
    const obj = headersToObject(headers);
    if (this.type === constants.NGHTTP2_SESSION_SERVER) {
      let s = this.streams.get(streamId);
      if (!s) { s = new ServerHttp2Stream(this, streamId); s.pending = false; this.streams.set(streamId, s); }
      if (endStream) s._end();
      this.emit('stream', s, obj, 0);
    } else {
      const s = this.streams.get(streamId);
      if (s) { s.pending = false; s.emit('response', obj, 0); if (endStream) s._end(); }
    }
  }

  _sendHeaders(streamId, list, endStream) {
    const block = this.encoder.encode(list);
    const maxF = this.remoteSettings.maxFrameSize || 16384;
    let off = 0, first = true;
    do {
      const chunk = block.subarray(off, off + maxF);
      off += chunk.length;
      const last = off >= block.length;
      let flags = 0;
      if (last) flags |= F.FLAG.END_HEADERS;
      if (first && endStream) flags |= F.FLAG.END_STREAM;
      this._send(F.serializeFrame(first ? F.FRAME.HEADERS : F.FRAME.CONTINUATION, flags, streamId, chunk));
      first = false;
    } while (off < block.length);
  }
  _sendData(streamId, data, endStream) {
    const maxF = this.remoteSettings.maxFrameSize || 16384;
    if (data.length === 0) { this._send(F.serializeFrame(F.FRAME.DATA, endStream ? F.FLAG.END_STREAM : 0, streamId, data)); return; }
    let off = 0;
    while (off < data.length) {
      const chunk = data.subarray(off, off + maxF);
      off += chunk.length;
      const last = off >= data.length && endStream;
      this._send(F.serializeFrame(F.FRAME.DATA, last ? F.FLAG.END_STREAM : 0, streamId, chunk));
    }
  }
  _sendRst(streamId, code) { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(code >>> 0, 0); this._send(F.serializeFrame(F.FRAME.RST_STREAM, 0, streamId, b)); }

  ping(payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = null; }
    const data = payload || Buffer.alloc(8);
    const start = Date.now();
    if (cb) this.once('_pingAck', () => cb(null, Date.now() - start, data));
    this._send(F.serializeFrame(F.FRAME.PING, 0, 0, data));
    return true;
  }
  settings() {}
  goaway(code = 0, lastStreamId = 0) { const b = Buffer.allocUnsafe(8); b.writeUInt32BE(lastStreamId >>> 0, 0); b.writeUInt32BE(code >>> 0, 4); this._send(F.serializeFrame(F.FRAME.GOAWAY, 0, 0, b)); }
  close(cb) { this.closed = true; if (cb) this.once('close', cb); this.goaway(0); process.nextTick(() => this.destroy()); }
  destroy(err) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
    if (err) this.emit('error', err);
    this.emit('close');
  }
  ref() { if (this.socket) this.socket.ref(); return this; }
  unref() { if (this.socket) this.socket.unref(); return this; }
  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }
}

class ClientHttp2Session extends Http2Session {
  constructor(socket) { super(socket, constants.NGHTTP2_SESSION_CLIENT); }
  request(headers = {}, options = {}) {
    const id = this._nextStreamId; this._nextStreamId += 2;
    const s = new ClientHttp2Stream(this, id);
    this.streams.set(id, s);
    const rest = { ...headers };
    // normalize :method/:path/:scheme/:authority pseudo-headers (Node accepts `method` etc too)
    if (rest.method && !rest[':method']) { rest[':method'] = rest.method; delete rest.method; }
    if (rest.path && !rest[':path']) { rest[':path'] = rest.path; delete rest.path; }
    const list = objectToHeaders(rest, []);
    const hasBody = options.endStream === false;
    // send HEADERS immediately so they precede any body DATA the caller writes
    this._sendHeaders(id, list, !hasBody);
    s.pending = false;
    if (!hasBody) s._localEnded = true;
    return s;
  }
}

class ServerHttp2Session extends Http2Session {
  constructor(socket) { super(socket, constants.NGHTTP2_SESSION_SERVER); }
}

// ---- Compatibility API (HTTP/1-style req/res over an http2 stream) ----
const { Readable } = require('stream');

class Http2ServerRequest extends Readable {
  constructor(stream, headers) {
    super();
    this.stream = stream;
    this.headers = headers;
    this.rawHeaders = [];
    for (const k of Object.keys(headers)) { this.rawHeaders.push(k, headers[k]); }
    this.httpVersionMajor = 2;
    this.httpVersionMinor = 0;
    this.httpVersion = '2.0';
    this.method = headers[':method'] || 'GET';
    this.url = headers[':path'] || '/';
    this.authority = headers[':authority'];
    this.scheme = headers[':scheme'] || 'https';
    this.aborted = false;
    this.complete = false;
    this.socket = stream.session && stream.session.socket;
    stream.on('data', (d) => { if (!this.push(d)) stream.pause && stream.pause(); });
    stream.on('end', () => { this.complete = true; this.push(null); });
    stream.on('close', () => { if (!this.complete) { this.aborted = true; this.emit('aborted'); } });
    stream.on('error', (e) => this.emit('error', e));
  }
  _read() {}
  get trailers() { return {}; }
  get rawTrailers() { return []; }
  setTimeout(ms, cb) { this.stream.setTimeout(ms, cb); return this; }
}

class Http2ServerResponse extends EventEmitter {
  constructor(stream) {
    super();
    this.stream = stream;
    this.statusCode = 200;
    this.headersSent = false;
    this.finished = false;
    this.writableEnded = false;
    this.sendDate = true;
    this._headers = {};
    this[sensitiveHeaders] = [];
    stream.on('close', () => { if (!this.finished) this.emit('close'); });
    stream.on('drain', () => this.emit('drain'));
  }
  setHeader(name, value) { this._headers[String(name).toLowerCase()] = value; return this; }
  getHeader(name) { return this._headers[String(name).toLowerCase()]; }
  getHeaders() { return { ...this._headers }; }
  getHeaderNames() { return Object.keys(this._headers); }
  hasHeader(name) { return String(name).toLowerCase() in this._headers; }
  removeHeader(name) { delete this._headers[String(name).toLowerCase()]; }
  get headersSent() { return this._sent === true; }
  set headersSent(v) { this._sent = v; }
  writeHead(statusCode, statusMessage, headers) {
    if (typeof statusMessage === 'object') { headers = statusMessage; statusMessage = undefined; }
    this.statusCode = statusCode;
    if (headers) for (const k of Object.keys(headers)) this._headers[k.toLowerCase()] = headers[k];
    this._respond(false);
    return this;
  }
  _respond(endStream) {
    if (this._sent) return;
    this._sent = true;
    this.stream.respond({ ':status': this.statusCode, ...this._headers }, { endStream });
  }
  write(chunk, enc, cb) {
    if (!this._sent) this._respond(false);
    const r = this.stream.write(chunk, enc, cb);
    return r;
  }
  end(chunk, enc, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    if (!this._sent) {
      if (chunk === undefined || chunk === null) { this._respond(true); }
      else { this._respond(false); }
    }
    this.finished = true; this.writableEnded = true;
    const done = () => { this.emit('finish'); this.emit('close'); if (cb) cb(); };
    if (chunk !== undefined && chunk !== null) this.stream.end(chunk, enc, done);
    else if (!this._localEndedViaRespond) { try { this.stream.end(done); } catch { done(); } }
    else done();
    return this;
  }
  setTimeout(ms, cb) { this.stream.setTimeout(ms, cb); return this; }
  get socket() { return this.stream.session && this.stream.session.socket; }
  get writable() { return !this.finished; }
  flushHeaders() { if (!this._sent) this._respond(false); }
}

class Http2Server extends EventEmitter {
  constructor(options, handler) {
    super();
    this._net = net.createServer((socket) => {
      const session = new ServerHttp2Session(socket);
      this.emit('session', session);
      session.on('stream', (s, h, flags) => {
        this.emit('stream', s, h, flags);
        if (this.listenerCount('request') > 0) {
          const req = new Http2ServerRequest(s, h);
          const res = new Http2ServerResponse(s);
          this.emit('request', req, res);
        }
      });
      session.on('error', (e) => this.emit('sessionError', e));
    });
    this._net.on('error', (e) => this.emit('error', e));
    // createServer's handler is the compat 'request' handler (per Node docs)
    if (handler) this.on('request', handler);
  }
  listen(...args) { this._net.listen(...args); return this; }
  close(cb) { this._net.close(cb); return this; }
  address() { return this._net.address(); }
  setTimeout(ms, cb) { if (cb) this.on('timeout', cb); return this; }
  ref() { this._net.ref(); return this; }
  unref() { this._net.unref(); return this; }
}

function createServer(options, handler) {
  if (typeof options === 'function') { handler = options; options = {}; }
  return new Http2Server(options, handler);
}
function createSecureServer(options, handler) { return createServer(options, handler); }

function connect(authority, options, listener) {
  if (typeof options === 'function') { listener = options; options = {}; }
  options = options || {};
  let url;
  try { url = typeof authority === 'string' ? new URL(authority) : authority; } catch { url = { hostname: 'localhost', port: 80 }; }
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const host = url.hostname || 'localhost';
  const socket = net.connect(port, host);
  const session = new ClientHttp2Session(socket);
  socket.on('connect', () => { if (listener) listener(session, socket); session.emit('connect', session, socket); });
  return session;
}

function getDefaultSettings() { return { ...DEFAULT_SETTINGS }; }
function getPackedSettings(s) { return F.packSettings({ [F.SETTINGS.INITIAL_WINDOW_SIZE]: (s && s.initialWindowSize) || 65535 }); }
function getUnpackedSettings(buf) { return { ...DEFAULT_SETTINGS, ...F.unpackSettings(buf) }; }

module.exports = {
  constants, sensitiveHeaders, connect, createServer, createSecureServer,
  getDefaultSettings, getPackedSettings, getUnpackedSettings,
  Http2Session, ClientHttp2Session, ServerHttp2Session, Http2Stream, ServerHttp2Stream, ClientHttp2Stream, Http2Server,
  Http2ServerRequest, Http2ServerResponse,
};
