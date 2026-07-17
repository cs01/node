// http2 — real HTTP/2 over TCP (RFC 7540) built on the frame codec + HPACK.
'use strict';

const EventEmitter = require('events');
const net = require('net');
const { Duplex } = require('stream');
const F = require('_http2_framer');
const HP = require('_http2_hpack');

const constants = {
  NGHTTP2_SESSION_SERVER: 0, NGHTTP2_SESSION_CLIENT: 1,
  NGHTTP2_FLAG_NONE: 0, NGHTTP2_FLAG_END_STREAM: 0x1, NGHTTP2_FLAG_ACK: 0x1,
  NGHTTP2_FLAG_END_HEADERS: 0x4, NGHTTP2_FLAG_PADDED: 0x8, NGHTTP2_FLAG_PRIORITY: 0x20,
  // RFC 7540 §7 error codes
  NGHTTP2_NO_ERROR: 0x0, NGHTTP2_PROTOCOL_ERROR: 0x1, NGHTTP2_INTERNAL_ERROR: 0x2,
  NGHTTP2_FLOW_CONTROL_ERROR: 0x3, NGHTTP2_SETTINGS_TIMEOUT: 0x4, NGHTTP2_STREAM_CLOSED: 0x5,
  NGHTTP2_FRAME_SIZE_ERROR: 0x6, NGHTTP2_REFUSED_STREAM: 0x7, NGHTTP2_CANCEL: 0x8,
  NGHTTP2_COMPRESSION_ERROR: 0x9, NGHTTP2_CONNECT_ERROR: 0xa, NGHTTP2_ENHANCE_YOUR_CALM: 0xb,
  NGHTTP2_INADEQUATE_SECURITY: 0xc, NGHTTP2_HTTP_1_1_REQUIRED: 0xd,
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522, NGHTTP2_ERR_NOMEM: -901,
  NGHTTP2_DEFAULT_WEIGHT: 16,
  // settings ids
  NGHTTP2_SETTINGS_HEADER_TABLE_SIZE: 0x1, NGHTTP2_SETTINGS_ENABLE_PUSH: 0x2,
  NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS: 0x3, NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE: 0x4,
  NGHTTP2_SETTINGS_MAX_FRAME_SIZE: 0x5, NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE: 0x6,
  // pseudo + common headers
  HTTP2_HEADER_PATH: ':path', HTTP2_HEADER_STATUS: ':status', HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_AUTHORITY: ':authority', HTTP2_HEADER_SCHEME: ':scheme', HTTP2_HEADER_PROTOCOL: ':protocol',
  HTTP2_HEADER_CONTENT_TYPE: 'content-type', HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
  HTTP2_HEADER_CONTENT_ENCODING: 'content-encoding', HTTP2_HEADER_SET_COOKIE: 'set-cookie',
  HTTP2_HEADER_COOKIE: 'cookie', HTTP2_HEADER_DATE: 'date', HTTP2_HEADER_LOCATION: 'location',
  HTTP2_HEADER_ACCEPT: 'accept', HTTP2_HEADER_ACCEPT_ENCODING: 'accept-encoding',
  HTTP2_HEADER_USER_AGENT: 'user-agent', HTTP2_HEADER_HOST: 'host', HTTP2_HEADER_CONNECTION: 'connection',
  HTTP2_HEADER_TE: 'te', HTTP2_HEADER_KEEP_ALIVE: 'keep-alive', HTTP2_HEADER_TRANSFER_ENCODING: 'transfer-encoding',
  HTTP2_HEADER_UPGRADE: 'upgrade', HTTP2_HEADER_PROXY_CONNECTION: 'proxy-connection',
  // methods
  HTTP2_METHOD_GET: 'GET', HTTP2_METHOD_POST: 'POST', HTTP2_METHOD_PUT: 'PUT',
  HTTP2_METHOD_DELETE: 'DELETE', HTTP2_METHOD_HEAD: 'HEAD', HTTP2_METHOD_OPTIONS: 'OPTIONS',
  HTTP2_METHOD_PATCH: 'PATCH', HTTP2_METHOD_CONNECT: 'CONNECT',
  // statuses
  HTTP_STATUS_CONTINUE: 100, HTTP_STATUS_OK: 200, HTTP_STATUS_CREATED: 201, HTTP_STATUS_NO_CONTENT: 204,
  HTTP_STATUS_NOT_MODIFIED: 304, HTTP_STATUS_BAD_REQUEST: 400, HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_FORBIDDEN: 403, HTTP_STATUS_NOT_FOUND: 404, HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_NOT_IMPLEMENTED: 501, HTTP_STATUS_BAD_GATEWAY: 502, HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  MAX_INITIAL_WINDOW_SIZE: 2147483647, DEFAULT_SETTINGS_HEADER_TABLE_SIZE: 4096,
  DEFAULT_SETTINGS_ENABLE_PUSH: 1, DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE: 65535,
  DEFAULT_SETTINGS_MAX_FRAME_SIZE: 16384,
};
const sensitiveHeaders = Symbol('nodejs.http2.sensitiveHeaders');
const RST_CODE_NAMES = {
  1: 'NGHTTP2_PROTOCOL_ERROR', 2: 'NGHTTP2_INTERNAL_ERROR', 3: 'NGHTTP2_FLOW_CONTROL_ERROR',
  4: 'NGHTTP2_SETTINGS_TIMEOUT', 5: 'NGHTTP2_STREAM_CLOSED', 6: 'NGHTTP2_FRAME_SIZE_ERROR',
  7: 'NGHTTP2_REFUSED_STREAM', 9: 'NGHTTP2_COMPRESSION_ERROR', 10: 'NGHTTP2_CONNECT_ERROR',
  11: 'NGHTTP2_ENHANCE_YOUR_CALM', 12: 'NGHTTP2_INADEQUATE_SECURITY', 13: 'NGHTTP2_HTTP_1_1_REQUIRED',
};
const DEFAULT_SETTINGS = { headerTableSize: 4096, enablePush: true, initialWindowSize: 65535, maxFrameSize: 16384, maxConcurrentStreams: 4294967295, maxHeaderListSize: 65535, enableConnectProtocol: false };

function headersToObject(list) {
  const o = {};
  for (const [k, v] of list) {
    // node coerces :status to a NUMBER (lib/internal/http2/util.js:903 `obj[name] = +value`).
    // milo left it a string, so every `assert.strictEqual(headers[':status'], 200)` in the
    // suite compared '200' !== 200.
    if (k === ':status') { o[k] = +v; continue; }
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
    if (this._timeoutMs > 0) this._armTimeout(); // outbound traffic resets the idle timer
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, enc || 'utf8');
    this.session._sendData(this.id, chunk, false);
    cb();
  }
  _final(cb) {
    // if END_STREAM was already sent (e.g. no-body request/response via HEADERS),
    // don't emit a second END_STREAM via an empty DATA frame (protocol error).
    if (this._localEnded) { cb(); return; }
    // waitForTrailers: the body is done but END_STREAM must ride the TRAILERS frame, not
    // this DATA frame — otherwise the stream closes and trailers can never be sent.
    if (this._waitForTrailers && !this._trailersSent) {
      this.session._sendData(this.id, Buffer.alloc(0), false);
      this._finalCb = cb;
      this.emit('wantTrailers');
      // If the handler did not call sendTrailers(), close normally rather than hang.
      if (!this._trailersSent) { this._localEnded = true; this.session._sendData(this.id, Buffer.alloc(0), true); this._finalCb = null; cb(); }
      return;
    }
    this._localEnded = true;
    this.session._sendData(this.id, Buffer.alloc(0), true);
    cb();
  }

  // Send a trailing HEADERS block carrying END_STREAM. gRPC puts its status here.
  sendTrailers(headers = {}) {
    if (this._trailersSent) throw new Error('ERR_HTTP2_TRAILERS_ALREADY_SENT');
    this._trailersSent = true;
    this._localEnded = true;
    this.session._sendHeaders(this.id, objectToHeaders({ ...headers }, []), true);
    const cb = this._finalCb; this._finalCb = null;
    if (cb) cb();
  }
  _read() {}
  close(code = 0, cb) {
    if (this.closed) { if (cb) process.nextTick(cb); return; }
    this.closed = true;
    this.rstCode = code;
    if (cb) this.once('close', cb);
    this.session._sendRst(this.id, code);
    process.nextTick(() => this.emit('close'));
  }
  // Was a stub. Same idle model as net.js/Http2Session — unref'd, rearmed on traffic,
  // cleared on destroy. Fixing it here also fixes Http2ServerRequest/Response, which
  // correctly delegate to the stream.
  setTimeout(ms, cb) {
    if (cb) this.once('timeout', cb);
    this._timeoutMs = ms;
    this._armTimeout();
    return this;
  }
  _armTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    if (this._timeoutMs > 0 && !this.destroyed) {
      const t = setTimeout(() => { this._timeoutTimer = null; this.emit('timeout'); }, this._timeoutMs);
      if (t && typeof t.unref === 'function') t.unref();
      this._timeoutTimer = t;
    }
  }
  _clearTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    this._timeoutMs = 0;
  }
  // no destroy override existed, so a timer armed before destroy would still fire 'timeout'
  // on a dead stream
  _destroy(err, cb) { this._clearTimeout(); cb(err); }
  priority() {}
  // ignore data/eof once the readable side is done — a peer may keep sending
  // DATA after we've ended/closed/rejected the stream (push-after-EOF guard).
  _push(chunk) { if (this._readableEnded || this.destroyed || this.closed) return; if (this._timeoutMs > 0) this._armTimeout(); this.push(chunk); }
  _end() { if (this._readableEnded) return; this._readableEnded = true; this.push(null); }
}

class ServerHttp2Stream extends Http2Stream {
  respond(headers = {}, options = {}) {
    this.sentHeaders = headers;
    this.headersSent = true;
    const rest = { ...headers };
    const status = rest[':status'] || 200;
    delete rest[':status'];
    const list = objectToHeaders(rest, [[':status', String(status)]]);
    // waitForTrailers must NOT set END_STREAM here: the stream stays open so _final can
    // emit 'wantTrailers' and the handler can send them.
    this._waitForTrailers = !!options.waitForTrailers;
    this.session._sendHeaders(this.id, list, !!options.endStream);
    if (options.endStream) this._localEnded = true;
  }
  respondWithFD(fd, headers = {}, options = {}) {
    const fs = require('fs');
    let data;
    try { const st = fs.fstatSync(fd); data = Buffer.alloc(st.size); fs.readSync(fd, data, 0, st.size, 0); }
    catch (e) { if (options.onError) return options.onError(e); this.emit('error', e); return; }
    this.respond({ ':status': 200, 'content-length': data.length, ...headers });
    this.end(data);
  }
  respondWithFile(path, headers = {}, options = {}) {
    const fs = require('fs');
    let st;
    try { st = fs.statSync(path); } catch (e) { if (options.onError) return options.onError(e); this.emit('error', e); return; }
    if (!st.isFile()) { const e = new Error('Not a regular file'); e.code = 'ERR_HTTP2_SEND_FILE'; if (options.onError) return options.onError(e); this.emit('error', e); return; }
    const data = fs.readFileSync(path);
    this.respond({ ':status': 200, 'content-length': data.length, ...headers });
    this.end(data);
  }
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
    socket.on('close', () => {
      // connection gone: tear down every open stream so req/res 'close' fire and
      // the event loop can drain (otherwise the process hangs).
      for (const s of this.streams.values()) {
        try { if (!s._readableEnded) s._end(); } catch {}
        s.emit('close');
      }
      this.streams.clear();
      if (!this.destroyed) { this.destroyed = true; this.emit('close'); }
    });

    if (type === constants.NGHTTP2_SESSION_CLIENT) socket.write(F.PREFACE);
    this._send(F.serializeFrame(F.FRAME.SETTINGS, 0, 0, F.packSettings({ [F.SETTINGS.INITIAL_WINDOW_SIZE]: 0x7fffffff, [F.SETTINGS.ENABLE_PUSH]: 0 })));
  }
  _send(buf) { if (this._timeoutMs > 0) this._armTimeout(); if (this.socket && !this.socket.destroyed) this.socket.write(buf); }

  _onData(chunk) {
    if (this._timeoutMs > 0) this._armTimeout(); // inbound traffic resets the idle timer
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
        if (fr.flags & F.FLAG.ACK) {
          // The peer acked OUR settings — that is what makes them local-and-live. node
          // emits 'localSettings' here (core.js:885); milo dropped the ack on the floor.
          this.emit('localSettings', this.localSettings || { ...DEFAULT_SETTINGS });
          break;
        }
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
        if (s) {
          const code = fr.payload.length >= 4 ? fr.payload.readUInt32BE(0) : 0;
          s.rstCode = code;
          // codes other than NO_ERROR(0)/CANCEL(8) surface as a stream error (Node behavior)
          if (code !== 0 && code !== 8) {
            const e = new Error(`Stream closed with error code ${RST_CODE_NAMES[code] || code}`);
            e.code = 'ERR_HTTP2_STREAM_ERROR';
            s.emit('error', e);
          }
          s._end(); s.emit('close'); this.streams.delete(fr.streamId);
        }
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
      else if (s._headersDone) {
        // A second HEADERS on a live stream is TRAILERS, not a new request. This fell
        // through to `emit('stream')` and re-delivered the request.
        s._trailers = obj;
        s.emit('trailers', obj, 0);
        if (endStream) s._end();
        return;
      }
      s._headersDone = true;
      if (endStream) s._end();
      // A throw in the user handler must not hang the peer: RST the stream and
      // surface the error (matches Node, which sends an internal error).
      try { this.emit('stream', s, obj, 0); }
      catch (e) { try { this._sendRst(streamId, 2); } catch {} process.nextTick(() => { throw e; }); }
    } else {
      const s = this.streams.get(streamId);
      if (s) {
        // An informational (1xx) response is NOT the final response: node emits 'headers'
        // for it and keeps the stream waiting for the real one. Emitting 'response' here
        // would resolve the request with a 103 and drop the actual reply.
        // A second HEADERS after the response is TRAILERS (HTTP/2 allows exactly one
        // trailing HEADERS block after DATA). This re-emitted 'response' instead, so the
        // trailers were never surfaced and no error was raised — gRPC carries its status
        // here, so every call completed with no status.
        if (s._responseDone) {
          s._trailers = obj;
          s.emit('trailers', obj, 0);
          if (endStream) s._end();
          return;
        }
        const st = Number(obj[':status']);
        if (st >= 100 && st < 200) { s.emit('headers', obj, 0); return; }
        s.pending = false; s._responseDone = true; s.emit('response', obj, 0); if (endStream) s._end();
      }
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
    this._clearTimeout();
    this.destroyed = true;
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
    if (err) this.emit('error', err);
    this.emit('close');
  }
  ref() { if (this.socket) this.socket.ref(); return this; }
  unref() { if (this.socket) this.socket.unref(); return this; }
  // Was a stub: registered the callback and armed nothing, so session.setTimeout() could
  // never fire. Modeled on net.js's socket timeout — node's is an IDLE timeout, so it must
  // be unref'd (or it pins the loop for the full duration), rearmed on activity (or the
  // ubiquitous setTimeout(60000, mustNotCall) guard fires spuriously), and cleared on
  // destroy. Getting any of those wrong costs passing tests; net.js proved it.
  setTimeout(ms, cb) {
    if (cb) this.once('timeout', cb);
    this._timeoutMs = ms;
    this._armTimeout();
    return this;
  }
  _armTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    if (this._timeoutMs > 0 && !this.destroyed) {
      const t = setTimeout(() => { this._timeoutTimer = null; this.emit('timeout'); }, this._timeoutMs);
      if (t && typeof t.unref === 'function') t.unref();
      this._timeoutTimer = t;
    }
  }
  _clearTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    this._timeoutMs = 0;
  }
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
    // node defaults the required pseudo-headers when omitted (lib/internal/http2/core.js
    // ~:2916). milo sent :method undefined, so the server saw no method at all.
    if (rest[':method'] === undefined) rest[':method'] = 'GET';
    if (rest[':path'] === undefined) rest[':path'] = '/';
    if (rest[':scheme'] === undefined) rest[':scheme'] = this._protocol || 'https';
    // node: `if (getAuthority(headers) === undefined) headers[:authority] = kAuthority`,
    // and getAuthority checks :authority OR **host** (lib/internal/http2/util.js) — a
    // request carrying a host header must NOT get :authority auto-filled on top of it.
    if (rest[':authority'] === undefined && rest.host === undefined && this._authority) {
      rest[':authority'] = this._authority;
    }
    const list = objectToHeaders(rest, []);
    const hasBody = options.endStream === false;
    // send HEADERS immediately so they precede any body DATA the caller writes
    this._sendHeaders(id, list, !hasBody);
    s.pending = false;
    // node emits 'ready' once the stream is attached and writable (core.js:2117). Deferred
    // a tick so a listener attached right after request() still sees it.
    process.nextTick(() => { if (!s.destroyed) s.emit('ready'); });
    if (!hasBody) s._localEnded = true;
    return s;
  }
}

class ServerHttp2Session extends Http2Session {
  constructor(socket) { super(socket, constants.NGHTTP2_SESSION_SERVER); }
}

// ---- Compatibility API (HTTP/1-style req/res over an http2 stream) ----
const { Readable } = require('stream');

// Node's req.socket/res.socket is a proxy to the real TCP socket whose
// readable/writable/destroy reflect the http2 *stream*, not the raw connection.
// A Proxy over the real socket keeps `instanceof net.Socket` true while
// overriding the stream-coupled bits.
function _proxySocket(stream) {
  const real = stream.session && stream.session.socket;
  if (!real) return undefined;
  return new Proxy(real, {
    get(target, prop) {
      switch (prop) {
        case 'readable': return stream.readable;
        case 'writable': return stream.writable;
        case 'destroyed': return stream.destroyed || target.destroyed;
        case 'destroy': return (...a) => { stream.destroy(...a); return target; };
        case 'end': return (...a) => { stream.end(...a); return target; };
        default: {
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        }
      }
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}

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
    this.authority = headers[':authority'] !== undefined ? headers[':authority'] : headers['host'];
    this.scheme = headers[':scheme'] || 'https';
    this.aborted = false;
    this.complete = false;
    this.socket = _proxySocket(stream);
    this.connection = this.socket;
    stream.on('data', (d) => { if (!this.push(d)) stream.pause && stream.pause(); });
    stream.on('end', () => { this.complete = true; this.push(null); });
    stream.on('close', () => { if (!this.complete) { this.aborted = true; this.emit('aborted'); } this.emit('close'); });
    stream.on('error', (e) => this.emit('error', e));
  }
  _read() {}
  // These returned {} and [] unconditionally — reporting "no trailers" rather than admitting
  // none were ever parsed. Now they reflect what actually arrived.
  get trailers() { return this._trailers || {}; }
  get rawTrailers() {
    const t = this._trailers;
    if (!t) return [];
    const out = [];
    for (const k of Object.keys(t)) { out.push(k, String(t[k])); }
    return out;
  }
  // node: a no-op once the request/response is closed (compat.js:434, :871) — the test
  // asserts a post-'finish' setTimeout is mustNotCall. The stream's 'timeout' is also
  // forwarded onto this object (compat.js:303 onStreamTimeout), because listeners are
  // registered on req/res, not on the stream.
  setTimeout(ms, cb) {
    if (!this.stream || this.stream.destroyed) return this; // node no-ops once closed (compat.js:434,:871)
    if (!this._timeoutFwd && this.stream) {
      this._timeoutFwd = true;
      this.stream.on('timeout', () => this.emit('timeout'));
    }
    if (this.stream) this.stream.setTimeout(ms, cb);
    return this;
  }
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
    this._proxy = _proxySocket(stream);
    stream.on('close', () => { if (!this.finished) this.emit('close'); });
    stream.on('drain', () => this.emit('drain'));
  }
  _normHeader(name) {
    if (typeof name !== 'string') { const e = new TypeError(`The "name" argument must be of type string. Received ${name === undefined ? 'undefined' : typeof name}`); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    return name.trim().toLowerCase(); // http2 header names are case-insensitive; trim ws/control
  }
  _checkSettable(k, value, rawName) {
    if (k[0] === ':') { const e = new TypeError('Cannot set HTTP/2 pseudo-headers'); e.code = 'ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED'; throw e; }
    // valid HTTP token (RFC 7230) — checked before the value
    if (!/^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/.test(k)) { const e = new TypeError(`Header name must be a valid HTTP token ["${rawName}"]`); e.code = 'ERR_INVALID_HTTP_TOKEN'; throw e; }
    if (value === undefined || value === null) { const e = new TypeError(`Invalid value "${value}" for header "${k}"`); e.code = 'ERR_HTTP2_INVALID_HEADER_VALUE'; throw e; }
  }
  // node: lib/internal/http2/compat.js writeEarlyHints — validate, build the Link header,
  // then send a 103 informational HEADERS frame. Absent entirely in milo.
  writeEarlyHints(hints) {
    if (typeof hints !== 'object' || hints === null || Array.isArray(hints)) {
      const e = new TypeError(`The "hints" argument must be of type object. Received ${hints === null ? 'null' : typeof hints}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    const out = {};
    let link = hints.link;
    if (Array.isArray(link)) link = link.join(', ');
    if (link !== undefined && typeof link !== 'string') {
      const e = new TypeError(`The "hints.link" property must be of type string or an array of strings. Received ${typeof link}`);
      e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
    }
    for (const key of Object.keys(hints)) {
      if (key === 'link') continue;
      const name = key.trim().toLowerCase();
      if (!/^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/.test(name)) {
        const e = new TypeError(`Header name must be a valid HTTP token ["${key}"]`);
        e.code = 'ERR_INVALID_HTTP_TOKEN'; throw e;
      }
      out[name] = hints[key];
    }
    if (!link || link.length === 0) return false;
    out.link = link;
    const list = objectToHeaders({ ':status': '103', ...out }, []);
    this.stream.session._sendHeaders(this.stream.id, list, false);
    return true;
  }
  setHeader(name, value) { const k = this._normHeader(name); this._checkSettable(k, value, name); this._headers[k] = value; return this; }
  getHeader(name) { return this._headers[this._normHeader(name)]; }
  getHeaders() { return { ...this._headers }; }
  getHeaderNames() { return Object.keys(this._headers); }
  hasHeader(name) { return this._normHeader(name) in this._headers; }
  removeHeader(name) { delete this._headers[this._normHeader(name)]; }
  appendHeader(name, value) {
    const k = this._normHeader(name);
    this._checkSettable(k, value);
    const cur = this._headers[k];
    if (cur === undefined) this._headers[k] = value;
    else if (Array.isArray(cur)) cur.push(value);
    else this._headers[k] = [cur, value];
  }
  get headersSent() { return this._sent === true; }
  set headersSent(v) { this._sent = v; }
  writeHead(statusCode, statusMessage, headers) {
    if (this._sent) { const e = new Error('Response has already been initiated.'); e.code = 'ERR_HTTP2_HEADERS_SENT'; throw e; }
    if (typeof statusMessage === 'object') { headers = statusMessage; statusMessage = undefined; }
    this.statusCode = statusCode;
    if (headers) for (const k of Object.keys(headers)) this._headers[k.toLowerCase()] = headers[k];
    this._respond(false);
    return this;
  }
  _respond(endStream) {
    if (this._sent) return;
    this._sent = true;
    if (endStream) this._endedViaHeaders = true;
    this.stream.respond({ ':status': this.statusCode, ...this._headers }, { endStream });
  }
  write(chunk, enc, cb) {
    if (!this._sent) this._respond(false);
    const r = this.stream.write(chunk, enc, cb);
    return r;
  }
  end(chunk, enc, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    if (typeof enc === 'function') { cb = enc; enc = undefined; }
    // end() may be called repeatedly; only the first actually ends, but every
    // call's callback still fires exactly once (Node compat semantics).
    if (this.finished) { if (cb) process.nextTick(cb); return this; }
    this.finished = true; this.writableEnded = true;
    const noBody = chunk === undefined || chunk === null;
    if (!this._sent) this._respond(noBody);
    const done = () => { if (cb) cb(); };
    if (!noBody) this.stream.end(chunk, enc, done);
    else if (this._endedViaHeaders) process.nextTick(done); // END_STREAM already sent on HEADERS
    else { try { this.stream.end(); } catch {} process.nextTick(done); }
    process.nextTick(() => this.emit('finish'));
    return this;
  }
  // node: a no-op once the request/response is closed (compat.js:434, :871) — the test
  // asserts a post-'finish' setTimeout is mustNotCall. The stream's 'timeout' is also
  // forwarded onto this object (compat.js:303 onStreamTimeout), because listeners are
  // registered on req/res, not on the stream.
  setTimeout(ms, cb) {
    if (!this.stream || this.stream.destroyed) return this; // node no-ops once closed (compat.js:434,:871)
    if (!this._timeoutFwd && this.stream) {
      this._timeoutFwd = true;
      this.stream.on('timeout', () => this.emit('timeout'));
    }
    if (this.stream) this.stream.setTimeout(ms, cb);
    return this;
  }
  // Node detaches the socket from the response once it has finished.
  get socket() { return this.finished ? undefined : this._proxy; }
  get connection() { return this.socket; }
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
    // The inner net.Server is where these actually fire; only 'error' was forwarded, so
    // `server.on('listening')` never fired on an Http2Server and anything gated on it sat
    // silent forever (the whole write-early-hints file does its work inside that handler).
    // listen(cb) appeared to work only because the cb is registered on the inner server.
    this._net.on('listening', () => this.emit('listening'));
    this._net.on('close', () => this.emit('close'));
    this._net.on('connection', (sock) => this.emit('connection', sock));
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
  // connect() parsed these out of the url and then threw them away, so :authority came out
  // undefined and :scheme was guessed. node derives both from the connection
  // (lib/internal/http2/core.js: kAuthority / kProtocol).
  session._authority = url.host || (url.port ? `${host}:${url.port}` : host);
  session._protocol = url.protocol === 'https:' ? 'https' : 'http';
  socket.on('connect', () => { if (listener) listener(session, socket); session.emit('connect', session, socket); });
  return session;
}

function getDefaultSettings() { return { ...DEFAULT_SETTINGS }; }

// id, name, kind, min, max — order matches Node's getPackedSettings output.
const _SETTING_ORDER = [
  ['headerTableSize', 0x1, 'int', 0, 2 ** 32 - 1],
  ['enablePush', 0x2, 'bool'],
  ['maxConcurrentStreams', 0x3, 'int', 0, 2 ** 32 - 1],
  ['initialWindowSize', 0x4, 'int', 0, 2 ** 31 - 1],
  ['maxFrameSize', 0x5, 'int', 16384, 2 ** 24 - 1],
  ['maxHeaderListSize', 0x6, 'int', 0, 2 ** 32 - 1],
  ['maxHeaderSize', 0x6, 'int', 0, 2 ** 32 - 1],
  ['enableConnectProtocol', 0x8, 'bool'],
];
const _SETTING_BY_ID = { 1: ['headerTableSize'], 2: ['enablePush', true], 3: ['maxConcurrentStreams'], 4: ['initialWindowSize'], 5: ['maxFrameSize'], 6: ['maxHeaderListSize'], 8: ['enableConnectProtocol', true] };

function _invalidSetting(name, value, isType) {
  const Ctor = isType ? TypeError : RangeError;
  const e = new Ctor(`Invalid value for setting "${name}": ${value}`);
  e.code = 'ERR_HTTP2_INVALID_SETTING_VALUE';
  throw e;
}
function getPackedSettings(settings) {
  settings = settings || {};
  const entries = [];
  const emitted = new Set();
  for (const [name, id, kind, min, max] of _SETTING_ORDER) {
    const v = settings[name];
    if (v === undefined) continue;
    let packed;
    if (kind === 'bool') { if (typeof v !== 'boolean') _invalidSetting(name, v, true); packed = v ? 1 : 0; }
    else { if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) _invalidSetting(name, v, false); packed = v; }
    // validate every present key, but emit each setting id only once
    // (maxHeaderSize is an alias of maxHeaderListSize → same id 6)
    if (emitted.has(id)) continue;
    emitted.add(id);
    entries.push([id, packed]);
  }
  if (settings.customSettings) {
    const keys = Object.keys(settings.customSettings);
    if (keys.length > 10) { const e = new Error('Number of custom settings exceeds MAX_ADDITIONAL_SETTINGS'); e.code = 'ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS'; throw e; }
    for (const k of keys) {
      const id = Number(k);
      const val = settings.customSettings[k];
      if (!Number.isInteger(id) || id < 0 || id > 0xffff) _invalidSetting('customSettings', k, false);
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 2 ** 32 - 1) _invalidSetting('customSettings', val, false);
      entries.push([id, val >>> 0]);
    }
  }
  const buf = Buffer.allocUnsafe(entries.length * 6);
  let o = 0;
  for (const [id, v] of entries) { buf.writeUInt16BE(id, o); buf.writeUInt32BE(v >>> 0, o + 2); o += 6; }
  return buf;
}
function getUnpackedSettings(buf, opts) {
  if (!Buffer.isBuffer(buf) && !ArrayBuffer.isView(buf)) {
    let r;
    if (buf == null) r = String(buf);
    else if (typeof buf === 'object') r = 'an instance of ' + (buf.constructor && buf.constructor.name || 'Object');
    else if (typeof buf === 'string') r = "type string ('" + buf + "')";
    else r = 'type ' + typeof buf + ' (' + String(buf) + ')';
    const e = new TypeError(`The "buf" argument must be an instance of Buffer or TypedArray. Received ${r}`);
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength); // wrap TypedArray
  if (buf.length % 6 !== 0) { const e = new RangeError('Packed settings length must be a multiple of six'); e.code = 'ERR_HTTP2_INVALID_PACKED_SETTINGS_LENGTH'; throw e; }
  const out = {};
  const custom = {};
  for (let o = 0; o + 6 <= buf.length; o += 6) {
    const id = buf.readUInt16BE(o); const val = buf.readUInt32BE(o + 2);
    const m = _SETTING_BY_ID[id];
    if (m) { out[m[0]] = m[1] ? !!val : val; if (id === 6) out.maxHeaderSize = val; }
    else custom[id] = val;
  }
  if (Object.keys(custom).length) out.customSettings = custom;
  return out;
}

module.exports = {
  constants, sensitiveHeaders, connect, createServer, createSecureServer,
  getDefaultSettings, getPackedSettings, getUnpackedSettings,
  Http2Session, ClientHttp2Session, ServerHttp2Session, Http2Stream, ServerHttp2Stream, ClientHttp2Stream, Http2Server,
  Http2ServerRequest, Http2ServerResponse,
};
