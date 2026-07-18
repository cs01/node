// http module — real HTTP client over TCP, basic server
'use strict';

const EventEmitter = require('events');
const net = require('net');
const stream = require('stream');
const { Readable } = stream;

function _invalidArgTypeHelper(input) {
  if (input == null) return ' Received ' + String(input);
  if (typeof input === 'function' && input.name) return ' Received function ' + input.name;
  if (typeof input === 'object') {
    const name = input.constructor?.name || 'Object';
    return ' Received an instance of ' + name;
  }
  let inspected = String(input);
  if (inspected.length > 28) inspected = inspected.slice(0, 25) + '...';
  return ' Received type ' + typeof input + ' (' + inspected + ')';
}

// Headers that should NOT be concatenated — first value wins
const _SINGLE_HEADERS = new Set([
  'content-type', 'content-length', 'user-agent', 'referer', 'host',
  'authorization', 'proxy-authorization', 'if-modified-since',
  'if-unmodified-since', 'from', 'location', 'max-forwards',
  'retry-after', 'etag', 'last-modified', 'server', 'age', 'expires',
]);

// node exposes these as symbols on the Server so ServerResponse/IncomingMessage can be
// swapped per-server (http.createServer({IncomingMessage, ServerResponse}, handler)).
const kIncomingMessage = Symbol('IncomingMessage');
const kServerResponse = Symbol('ServerResponse');

class IncomingMessage extends Readable {
  constructor() {
    super();
    this.headers = {};
    this.rawHeaders = [];
    this.method = null;
    this.url = null;
    this.statusCode = null;
    this.statusMessage = '';
    this.httpVersion = '1.1';
    this.complete = false;
  }
  _read() {}
  // IncomingMessage had NO destroy override, so it inherited Readable.destroy(): the stream
  // died but the underlying socket stayed open and held the loop forever. Node tears the
  // socket down (lib/_http_incoming.js _destroy) and marks the message aborted when it was
  // destroyed before completing.
  _destroy(err, cb) {
    if (!this.readableEnded || !this.complete) {
      this.aborted = true;
      this.emit('aborted');
    }
    if (this.socket && !this.socket.destroyed && this.aborted) this.socket.destroy(err);
    if (typeof cb === 'function') process.nextTick(cb, err);
  }
  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }
  _addHeaderLines(headers, n) {
    if (headers && headers.length) {
      for (let i = 0; i < headers.length; i += 2) {
        const key = headers[i].toLowerCase();
        const val = headers[i + 1];
        this.rawHeaders.push(headers[i], val);
        if (key === 'set-cookie') {
          if (this.headers[key]) this.headers[key].push(val);
          else this.headers[key] = [val];
        } else if (this.headers[key]) { this.headers[key] += ', ' + val; }
        else { this.headers[key] = val; }
      }
    }
  }
  _addHeaderLine(field, value, dest) {
    const key = field.toLowerCase();
    this.rawHeaders.push(field, value);
    if (key === 'set-cookie') {
      if (key in dest) dest[key].push(value);
      else dest[key] = [value];
    } else if (key in dest) {
      if (_SINGLE_HEADERS.has(key)) return;
      const sep = key === 'cookie' ? '; ' : ', ';
      if (dest[key] !== undefined) dest[key] += sep + value;
      else dest[key] = value;
    } else {
      dest[key] = value;
    }
  }
}

class OutgoingMessage extends EventEmitter {
  constructor() {
    super();
    this._headers = {};
    this._rawHeaderNames = {};
    this._headersSent = false;
    this.finished = false;
    this.destroyed = false;
    this.writableEnded = false;
    this.sendDate = true;
    this._outputData = [];
    this._outputSize = 0;
  }
  get headersSent() { return this._headersSent; }
  get writableObjectMode() { return false; }
  get writableHighWaterMark() { return this.socket ? this.socket.writableHighWaterMark : 65536; }
  get writableLength() { return this._outputSize; }
  get writableFinished() { return this.finished; }
  get writableCorked() { return 0; }
  get writableNeedDrain() { return false; }
  setTimeout(ms, cb) {
    if (cb) this.on('timeout', cb);
    if (!this.socket) {
      this.once('socket', (s) => s.setTimeout(ms));
    } else {
      this.socket.setTimeout(ms);
    }
    return this;
  }
  destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (this.socket) this.socket.destroy(err);
    return this;
  }
  // node answers a write/end after end() with ERR_STREAM_WRITE_AFTER_END: it invokes the
  // callback with the error AND emits 'error'. Milo silently dropped both, so tests that
  // assert on the callback error just hung waiting for a call that never came.
  _writeAfterEnd(cb) {
    const err = new Error('write after end');
    err.code = 'ERR_STREAM_WRITE_AFTER_END';
    process.nextTick(() => { if (typeof cb === 'function') cb(err); this.emit('error', err); });
    return false;
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    if (chunk === null) { const e = new TypeError('May not write null values to stream'); e.code = 'ERR_STREAM_NULL_VALUES'; throw e; }
    if (this.finished) return this._writeAfterEnd(cb);
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      const e = new TypeError('The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received ' + (chunk === undefined ? 'undefined' : 'type ' + typeof chunk + ' (' + chunk + ')'));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (!this._header && !this._headersSent) {
      if (!this._implicitHeader) { const e = new Error('The _implicitHeader() method is not implemented'); e.code = 'ERR_METHOD_NOT_IMPLEMENTED'; throw e; }
      this._implicitHeader();
    }
    const data = typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk;
    if (!this._hasBody) { if (cb) process.nextTick(cb); return true; }
    if (this.socket) {
      return this.socket.write(data, encoding, cb);
    }
    if (this._outputData) {
      this._outputData.push(data);
      this._outputSize += data.length;
    }
    if (cb) process.nextTick(cb);
    return true;
  }
  _flushOutput(socket) {
    if (this._outputData.length > 0) {
      for (const d of this._outputData) socket.write(d);
      this._outputData = [];
      this._outputSize = 0;
    }
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    // guard BEFORE write(): a second end() is a write-after-end, not a no-op
    if (this.finished) { this._writeAfterEnd(cb); return this; }
    if (chunk) this.write(chunk, encoding);
    if (!this._headersSent && this._implicitHeader) this._implicitHeader();
    this.finished = true;
    this.writableEnded = true;
    if (this.socket) {
      const onFinish = () => {
        this.emit('finish');
        if (cb) cb();
      };
      this.socket.write(Buffer.alloc(0), onFinish);
    } else {
      this.emit('finish');
      if (cb) cb();
    }
    return this;
  }
  setHeader(k, v) {
    if (this._headersSent || this._header) { const e = new Error('Cannot set headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
    if (typeof k !== 'string' || !/^[\t\x20-\x7e]+$/.test(k) || /[^!#$%&'*+\-.0-9A-Z^_`a-z|~]/.test(k)) {
      const e = new TypeError(`Header name must be a valid HTTP token ["${k}"]`);
      e.code = 'ERR_INVALID_HTTP_TOKEN';
      throw e;
    }
    if (v === undefined) {
      const e = new TypeError(`Invalid value "${v}" for header "${k}"`);
      e.code = 'ERR_HTTP_INVALID_HEADER_VALUE';
      throw e;
    }
    if (typeof v === 'string' && /[^\t\x20-\x7e\x80-\xff]/.test(v)) {
      const e = new TypeError(`Invalid character in header content ["${k}"]`);
      e.code = 'ERR_INVALID_CHAR'; throw e;
    }
    const lower = k.toLowerCase();
    if (lower === 'set-cookie') {
      const existing = this._headers[lower];
      if (Array.isArray(v)) this._headers[lower] = existing ? existing.concat(v) : v;
      else if (existing) { if (Array.isArray(existing)) existing.push(v); else this._headers[lower] = [existing, v]; }
      else this._headers[lower] = v;
    } else {
      this._headers[lower] = v;
    }
    this._rawHeaderNames[lower] = k;
    return this;
  }
  getHeader(k) { return this._headers[k.toLowerCase()]; }
  removeHeader(k) {
    if (this._headersSent) { const e = new Error('Cannot remove headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
    const lower = k.toLowerCase();
    delete this._headers[lower];
    delete this._rawHeaderNames[lower];
    return this;
  }
  hasHeader(k) { return k.toLowerCase() in this._headers; }
  getHeaderNames() { return Object.keys(this._headers); }
  getHeaders() { return { ...this._headers }; }
  setHeaders(headers) {
    if (this._headersSent) { const e = new Error('Cannot set headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
    if (!(headers instanceof globalThis.Headers) && !(headers instanceof Map)) {
      const e = new TypeError('The "headers" argument must be an instance of Headers or Map');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    headers.forEach((v, k) => this.setHeader(k, v));
    return this;
  }
  _renderHeaders() {
    if (this._headersSent) { const e = new Error('Cannot render headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
    const headers = {};
    for (const [lower, val] of Object.entries(this._headers)) {
      const raw = this._rawHeaderNames[lower] || lower;
      headers[raw] = val;
    }
    return headers;
  }
  getRawHeaderNames() { return Object.values(this._rawHeaderNames); }
  appendHeader(name, value) {
    const lower = name.toLowerCase();
    const existing = this._headers[lower];
    if (existing === undefined) {
      this._headers[lower] = value;
      this._rawHeaderNames[lower] = name;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      this._headers[lower] = [existing, value];
    }
    return this;
  }
  flushHeaders() {}
  cork() {}
  uncork() {}
  addTrailers(headers) {
    if (this.finished) { const e = new Error('Cannot set trailing headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
    const keys = Object.keys(headers);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (typeof k !== 'string' || /[^!#$%&'*+\-.0-9A-Z^_`a-z|~]/.test(k)) {
        const e = new TypeError(`Trailer name must be a valid HTTP token ["${k}"]`);
        e.code = 'ERR_INVALID_HTTP_TOKEN'; throw e;
      }
      const v = headers[k];
      if (typeof v === 'string' && /[^\t\x20-\x7e\x80-\xff]/.test(v)) {
        const e = new TypeError(`Invalid character in trailer content ["${k}"]`);
        e.code = 'ERR_INVALID_CHAR'; throw e;
      }
    }
  }
}

class ServerResponse extends OutgoingMessage {
  constructor(socket) {
    super();
    this._socket = socket;
    this.socket = socket;
    this.connection = socket;
    this.statusCode = 200;
    this.writable = true;
    socket.on('close', () => { this.emit('close'); });
  }
  _implicitHeader() { this.writeHead(this.statusCode); }
  // ServerResponse only defined _flushHeaders, so the public flushHeaders() resolved to
  // OutgoingMessage's EMPTY stub and sent nothing. _flushHeaders already no-ops when the
  // headers are out, which gives node's required idempotency for free.
  flushHeaders() { this._flushHeaders(); return this; }
  // 100-continue: node emits 'checkContinue' instead of 'request' when the client sends
  // Expect: 100-continue and a listener exists; the handler answers with writeContinue().
  // Ported from lib/_http_server.js (writeContinue -> writeInformation(100)).
  writeInformation(statusCode, headers, cb) {
    if (this._headersSent) { const e = new Error('Cannot write headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 199) {
      const e = new RangeError(`Invalid status code: ${statusCode}`); e.code = 'ERR_HTTP_INVALID_STATUS_CODE'; throw e;
    }
    if (statusCode === 101) { const e = new RangeError(`Invalid status code: ${statusCode}`); e.code = 'ERR_HTTP_INVALID_STATUS_CODE'; throw e; }
    const statusMessage = STATUS_CODES[statusCode] || 'unknown';
    let head = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
    if (headers) {
      if (Array.isArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) head += `${headers[i]}: ${headers[i+1]}\r\n`;
      } else {
        for (const [k, v] of Object.entries(headers)) head += `${k}: ${v}\r\n`;
      }
    }
    head += '\r\n';
    // an interim response does NOT set _headersSent — the real response still follows
    this._socket.write(head, cb);
    return this;
  }
  writeContinue(cb) { this.writeInformation(100, null, cb); this._sent100 = true; return this; }
  writeHead(code, reason, headers) {
    if (typeof reason === 'object' || Array.isArray(reason)) { headers = reason; reason = undefined; }
    code = +code;
    if (code < 100 || code > 999 || !Number.isFinite(code) || code !== (code | 0)) {
      const e = new RangeError(`Invalid status code: ${arguments[0] === undefined ? 'undefined' : String(arguments[0])}`);
      e.code = 'ERR_HTTP_INVALID_STATUS_CODE'; throw e;
    }
    this.statusCode = code;
    if (headers) {
      if (Array.isArray(headers)) {
        if (Array.isArray(headers[0])) {
          for (let i = 0; i < headers.length; i++) this.setHeader(String(headers[i][0]), String(headers[i][1]));
        } else {
          if (headers.length % 2 !== 0) { const e = new TypeError('Invalid number of arguments'); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; }
          for (let i = 0; i < headers.length; i += 2) this.setHeader(String(headers[i]), String(headers[i + 1]));
        }
      } else {
        for (const [k,v] of Object.entries(headers)) this.setHeader(k, v);
      }
    }
    this._flushHeaders();
    return this;
  }
  _flushHeaders() {
    if (this._headersSent) return;
    this._headersSent = true;
    const noBody = this.statusCode === 204 || this.statusCode === 304 || (this.statusCode >= 100 && this.statusCode < 200);
    if (!noBody && !this._headers['content-length'] && !this._headers['transfer-encoding']) {
      this._headers['transfer-encoding'] = 'chunked';
      this._chunked = true;
    }
    const statusMsg = STATUS_CODES[this.statusCode] || 'Unknown';
    let head = `HTTP/1.1 ${this.statusCode} ${statusMsg}\r\n`;
    // RFC 7231 7.1.1.2 requires a Date on responses; node sends one unless res.sendDate is
    // set false, honouring an explicit user Date header. `sendDate` was assigned in the
    // constructor and read by nothing, so milo never sent it at all.
    if (this.sendDate !== false && this._headers['date'] === undefined) {
      head += `Date: ${new Date().toUTCString()}\r\n`;
    }
    for (const [k,v] of Object.entries(this._headers)) {
      if (Array.isArray(v)) { for (const item of v) head += `${k}: ${item}\r\n`; }
      else head += `${k}: ${v}\r\n`;
    }
    // keep-alive logic, ported from node's lib/_http_outgoing.js:470-495. Appended here
    // rather than stored in _headers because that map lowercases its keys, and these two
    // go on the wire with node's exact casing. An explicit user Connection header wins.
    if (this._headers['connection'] === undefined) {
      if (this.shouldKeepAlive) {
        head += 'Connection: keep-alive\r\n';
        if (this._keepAliveTimeout > 0) {
          const timeoutSeconds = Math.floor(this._keepAliveTimeout / 1000);
          const max = ~~this._maxRequestsPerSocket > 0 ? `, max=${this._maxRequestsPerSocket}` : '';
          head += `Keep-Alive: timeout=${timeoutSeconds}${max}\r\n`;
        }
      } else {
        head += 'Connection: close\r\n';
      }
    }
    head += '\r\n';
    this._socket.write(head);
  }
  write(chunk, encoding, cb) {
    // `encoding` is optional: res.write(chunk, cb) is the common form, and dropping it
    // here meant the callback was silently never invoked.
    if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    if (this.finished) return this._writeAfterEnd(cb);
    if (!this._headersSent) this._implicitHeader();
    if (this._chunked) {
      let data;
      if (Buffer.isBuffer(chunk)) data = chunk;
      else if (chunk instanceof Uint8Array) data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      else data = Buffer.from(typeof chunk === 'string' ? chunk : String(chunk), encoding);
      this._socket.write(data.length.toString(16) + '\r\n');
      this._socket.write(data);
      // cb must ride the LAST piece of the chunk — it was passed to none of the three, so
      // res.write(data, cb) silently never called back on any chunked response (the default
      // whenever there is no content-length).
      this._socket.write('\r\n', cb);
    } else {
      this._socket.write(chunk, encoding, cb);
    }
    return true;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    // a second end() is a write-after-end in node, not a silent no-op
    if (this.finished) { this._writeAfterEnd(cb); return this; }
    if (!this._headersSent) this._implicitHeader();
    if (chunk) this.write(chunk, encoding);
    if (this._chunked) this._socket.write('0\r\n\r\n');
    this.finished = true;
    this.writable = false;
    this.writableEnded = true;
    // Only FIN the socket when the connection is NOT keep-alive. Ending it unconditionally
    // closed the write side after EVERY response, so a keep-alive client's 2nd request on a
    // reused socket got no reply (server half-closed). The gated close in the res.on('finish')
    // handler (see server 'request' wiring) owns the keep-alive/close decision instead — matching
    // node, where end() finishes the response and detaches, leaving the socket open for reuse.
    if (!this.shouldKeepAlive) this._socket.end();
    this.emit('finish');
    if (cb) cb();
    return this;
  }
}

class Server extends EventEmitter {
  constructor(opts, handler) {
    super();
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    if (handler) this.on('request', handler);
    // node lets a server supply its own request/response classes; they were ignored, so
    // subclass methods (req.getUserAgent() etc) simply did not exist on the objects handed
    // to the handler.
    this[kIncomingMessage] = (opts && opts.IncomingMessage) || IncomingMessage;
    this[kServerResponse] = (opts && opts.ServerResponse) || ServerResponse;
    this._server = null;
    this._listening = false;
    this.timeout = 0;
    this.keepAliveTimeout = (opts && opts.keepAliveTimeout != null) ? opts.keepAliveTimeout : 65000; // node 27 default (lib/_http_server.js:544)
    this.maxHeadersCount = (opts && opts.maxHeadersCount != null) ? opts.maxHeadersCount : 2000;
    this.maxRequestsPerSocket = (opts && opts.maxRequestsPerSocket != null) ? opts.maxRequestsPerSocket : 0;
    this.maxConnections = (opts && opts.maxConnections != null) ? opts.maxConnections : 0;
    this.requestTimeout = (opts && opts.requestTimeout != null) ? opts.requestTimeout : 300000;
    const defaultHeadersTimeout = 60000;
    this.headersTimeout = (opts && opts.headersTimeout != null) ? opts.headersTimeout : defaultHeadersTimeout;
    if (opts && opts.headersTimeout != null && opts.requestTimeout != null &&
        opts.headersTimeout > 0 && opts.requestTimeout > 0 && opts.headersTimeout > opts.requestTimeout) {
      const e = new RangeError('The "headersTimeout" option must be less than or equal to the "requestTimeout" option');
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    if (this.requestTimeout > 0 && this.headersTimeout > this.requestTimeout) {
      this.headersTimeout = this.requestTimeout;
    }
  }
  listen(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    // Accept the options-object form listen({port, host}, cb) — fastify and most frameworks
    // use it. Previously only the positional form (port, host) was parsed, so an options
    // object landed in `port`, was passed to net.listen as a bogus first arg, and the
    // callback never fired — fastify's listen() hung forever waiting on it.
    let port, host;
    if (args[0] && typeof args[0] === 'object') {
      port = args[0].port || 0;
      host = args[0].host || '0.0.0.0';
    } else {
      port = args[0] || 0;
      host = args[1] || '0.0.0.0';
    }
    this._sockets = new Set();
    this._closing = false;
    this._server = net.createServer({ allowHalfOpen: true }, (socket) => {
      this._sockets.add(socket);
      socket._httpActive = false;
      // server.setTimeout(ms) stored _timeout but nothing ever applied it, so 'timeout'
      // could never fire. Node reads server.timeout when the connection arrives, arms the
      // socket, and — if nothing listens for 'timeout' — destroys the socket itself.
      const srvTimeout = this.timeout;
      if (srvTimeout > 0) {
        socket.setTimeout(srvTimeout);
        socket.on('timeout', () => {
          if (this.listenerCount('timeout') > 0) this.emit('timeout', socket);
          else socket.destroy();
        });
      }
      socket.on('error', (err) => this.emit('clientError', err, socket));
      socket.on('close', () => {
        this._sockets.delete(socket);
        if (this._closing && this._sockets.size === 0) {
          process.nextTick(() => this.emit('close'));
        }
      });
      // Rolling parse buffer + per-request state. Reset after each request so
      // subsequent requests on a kept-alive (or pipelined) connection parse
      // fresh — previously headersParsed never reset and request #2 was dropped.
      let buffer = Buffer.alloc(0);
      let currentReq = null;   // request whose body is still being read
      let contentLength = 0;
      let bodyReceived = 0;

      const httpDataHandler = (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        buffer = buffer.length === 0 ? buf : Buffer.concat([buffer, buf]);

        for (;;) {
          // Phase 1: parse request line + headers (no request in flight).
          if (!currentReq) {
            // RFC 7230 3.5: a server MUST ignore at least one empty line (CRLF) before the
            // request line — old clients emit a stray CRLF after a body, and on a keep-alive
            // connection it lands here as the start of the "next" request. Without this we
            // parsed "\r\n\r\n" as a request with an empty method and undefined url and
            // emitted a bogus 'request' event, so the client got two responses for one
            // request and the connection desynchronised.
            let skip = 0;
            while (skip + 1 < buffer.length && buffer[skip] === 0x0d && buffer[skip+1] === 0x0a) skip += 2;
            if (skip > 0) buffer = buffer.slice(skip);
            let headerEnd = -1;
            for (let i = 0; i <= buffer.length - 4; i++) {
              if (buffer[i] === 0x0d && buffer[i+1] === 0x0a && buffer[i+2] === 0x0d && buffer[i+3] === 0x0a) {
                headerEnd = i; break;
              }
            }
            if (headerEnd === -1) break; // need more bytes for full headers
            const headerPart = buffer.slice(0, headerEnd).toString();
            buffer = buffer.slice(headerEnd + 4);
            const lines = headerPart.split('\r\n');
            const [method, url, version] = lines[0].split(' ');
            // The request line was never validated: "GARBAGE NOT HTTP" parsed happily into
            // method='GARBAGE'. Node's parser rejects it and emits 'clientError' with an
            // HPE_* code; with no listener it answers 400 and destroys (lib/_http_server.js
            // socketOnError). 13 tests reference clientError.
            const _badMethod = !METHODS.includes(method);
            const _badVersion = !/^HTTP\/1\.[01]$/.test(version || '');
            if (_badMethod || _badVersion) {
              // node checks the METHOD first: "GARBAGE NOT HTTP" is HPE_INVALID_METHOD, not
              // a version complaint, because GARBAGE is not a known method.
              const e = new Error(_badMethod ? 'Parse Error: Invalid method encountered'
                                             : 'Parse Error: Invalid HTTP version');
              e.code = _badMethod ? 'HPE_INVALID_METHOD' : 'HPE_INVALID_VERSION';
              e.rawPacket = buffer;
              buffer = Buffer.alloc(0);
              if (!this.emit('clientError', e, socket)) {
                try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
              }
              return;
            }
            const req = new (this[kIncomingMessage])();
            req.method = method;
            req.url = url;
            req.httpVersion = (version || '').replace('HTTP/', '');
            req.socket = socket;
            req.connection = socket;
            for (let i = 1; i < lines.length; i++) {
              const idx = lines[i].indexOf(':');
              if (idx > 0) {
                const key = lines[i].substring(0, idx).trim().toLowerCase();
                const val = lines[i].substring(idx + 1).trim();
                if (key === 'set-cookie') {
                  if (req.headers[key]) req.headers[key].push(val);
                  else req.headers[key] = [val];
                } else if (req.headers[key]) { req.headers[key] += ', ' + val; }
                else { req.headers[key] = val; }
                req.rawHeaders.push(lines[i].substring(0, idx).trim(), val);
              }
            }
            currentReq = req;
            contentLength = parseInt(req.headers['content-length']) || 0;
            bodyReceived = 0;

            if (req.headers['upgrade'] && this.listenerCount('upgrade') > 0) {
              req.push(null);
              req.complete = true;
              // Release socket from HTTP parsing so upgrade handler (e.g. ws) owns it
              socket.removeListener('data', httpDataHandler);
              this.emit('upgrade', req, socket, buffer);
              currentReq = null;
              return;
            }

            socket._httpActive = true;
            const res = new (this[kServerResponse])(socket);
            // node derives keep-alive from the request and the server's settings; milo
            // never wired either up, so no Connection/Keep-Alive header was ever emitted.
            res.shouldKeepAlive = req.httpVersion !== '1.0' && String(req.headers['connection'] || '').toLowerCase() !== 'close';
            res._keepAliveTimeout = this.keepAliveTimeout;
            res._maxRequestsPerSocket = this.maxRequestsPerSocket;
            res.on('finish', () => {
              socket._httpActive = false;
              // socket.end(), NOT destroy(): 'finish' fires when the RESPONSE is done, but the
              // socket's own write buffer may still hold chunks parked under EAGAIN
              // backpressure. destroy() drops them — a large Connection: close response (e.g.
              // anything through compression middleware, many buffered res.write()s) lost its
              // tail: ~45% truncation, corrupt gzip, blocks that never render. end() flushes
              // the buffer, then FINs, matching node.
              if (this._closing || req.headers['connection'] === 'close') socket.end();
            });
            try {
              // Expect: 100-continue -> node emits 'checkContinue' if anyone listens, else
              // auto-answers 100 and emits 'request' (lib/_http_server.js:1351-1357).
              const _expect = req.headers['expect'];
              if (_expect !== undefined && /^\s*100-continue\s*$/i.test(String(_expect))) {
                res._expect_continue = true;
                if (this.listenerCount('checkContinue') > 0) {
                  this.emit('checkContinue', req, res);
                } else {
                  res.writeContinue();
                  this.emit('request', req, res);
                }
              } else {
              this.emit('request', req, res);
              }
            } catch (e) {
              // Node treats an exception from a request handler as an uncaughtException: it
              // does NOT answer 500 and does NOT report it as 'clientError' (that event is
              // for connection-level errors). Answering 500 turned every failed assertion
              // in the standard `common.mustCall((req,res) => { assert... })` pattern into
              // an opaque TIMEOUT. Route it straight to the fatal path so it never reaches
              // the socket's error machinery, which http itself forwards to clientError.
              if (process._fatalException) process._fatalException(e); else throw e;
            }
          }

          // Phase 2: feed body bytes to the in-flight request.
          if (currentReq && !currentReq.complete) {
            if (contentLength > 0) {
              const take = Math.min(contentLength - bodyReceived, buffer.length);
              if (take > 0) {
                currentReq.push(buffer.slice(0, take));
                buffer = buffer.slice(take);
                bodyReceived += take;
              }
              if (bodyReceived < contentLength) break; // await more body
            }
            currentReq.push(null);
            currentReq.complete = true;
          }

          // Request fully received — reset and parse the next one if buffered.
          currentReq = null;
          if (buffer.length === 0) break;
        }
      };
      socket.on('data', httpDataHandler);

      socket.on('end', () => {
        if (currentReq && !currentReq.complete) {
          currentReq.push(null);
          currentReq.complete = true;
        }
        if (socket._httpActive) {
          socket._peerDisconnected = true;
          try { net.Socket._sockets.delete(socket._fd); } catch {}
          const e = new Error('read ECONNRESET'); e.code = 'ECONNRESET';
          // Use setImmediate so on-finished listeners can attach before error fires
          setImmediate(() => {
            socket.emit('error', e);
            socket.destroy();
          });
        } else {
          // Idle keep-alive socket: client closed, no active request — clean up
          socket.destroy();
        }
      });
    });
    this._server.on('error', (err) => {
      this.emit('error', err);
    });
    // Only 'error' was forwarded from the inner net.Server, so http.Server never emitted
    // 'connection' — node emits it for every accepted socket, before any request is parsed.
    // (Same shape as the Http2Server bug that made the early-hints tests emit zero bytes.)
    this._server.on('connection', (sock) => this.emit('connection', sock));
    if (cb) this.once('error', cb);
    this._server.listen(port, host, () => {
      this._listening = true;
      this._handle = this._server._handle;
      if (cb) this.removeListener('error', cb);
      this.emit('listening');
      if (cb) cb.call(this);
    });
    return this;
  }
  close(cb) {
    if (cb) this.once('close', cb);
    this._listening = false;
    this._closing = true;
    this._handle = null;
    if (this._server) this._server.close();
    if (!this._sockets || this._sockets.size === 0) {
      process.nextTick(() => this.emit('close'));
      return this;
    }
    for (const socket of this._sockets) {
      if (!socket._httpActive) socket.destroy();
    }
    if (this._sockets.size === 0) {
      process.nextTick(() => this.emit('close'));
    }
    return this;
  }
  address() { return this._server ? this._server.address() : null; }
  setTimeout(ms, cb) { this._timeout = ms; if (cb) this.on('timeout', cb); return this; }
  get timeout() { return this._timeout || 0; }
  set timeout(ms) { this._timeout = ms; }
  get listening() { return this._listening; }
  closeIdleConnections() {
    if (this._sockets) {
      for (const socket of this._sockets) {
        if (!socket._httpActive) socket.destroy();
      }
    }
  }
  closeAllConnections() {
    if (this._sockets) {
      for (const socket of this._sockets) socket.destroy();
    }
  }
  ref() { return this; }
  unref() { return this; }
}

class ClientRequest extends EventEmitter {
  constructor(options, cb) {
    super();
    if (typeof options === 'string') options = new URL(options);
    if (options instanceof URL) {
      options = { hostname: options.hostname, port: options.port || 80, path: options.pathname + options.search, protocol: options.protocol };
    }
    this._options = options;
    this._headers = {};
    this._body = [];
    if (options.hostname != null && typeof options.hostname !== 'string') {
      const e = new TypeError('The "options.hostname" property must be of type string or one of undefined or null.' + _invalidArgTypeHelper(options.hostname));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (options.host != null && typeof options.host !== 'string') {
      const e = new TypeError('The "options.host" property must be of type string or one of undefined or null.' + _invalidArgTypeHelper(options.host));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (options.method != null && typeof options.method !== 'string') {
      const e = new TypeError('The "options.method" property must be of type string. Received type ' + typeof options.method + ' (' + String(options.method) + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this.method = (options.method || 'GET').toUpperCase();
    this.path = options.path || '/';
    if (typeof this.path === 'string' && /[^!-ÿ]/.test(this.path)) throw _ERR_UNESCAPED_CHARACTERS('Request path');
    this.host = options.hostname || options.host || 'localhost';
    this.protocol = options.protocol || 'http:';
    if (this.protocol !== 'http:' && this.protocol !== 'https:') {
      const e = new TypeError('Protocol "' + this.protocol + '" not supported. Expected "http:"');
      e.code = 'ERR_INVALID_PROTOCOL'; throw e;
    }
    if (options.timeout !== undefined && (typeof options.timeout !== 'number' || options.timeout < 0 || !Number.isFinite(options.timeout))) {
      const e = new TypeError('The "timeout" argument must be of type number. Received ' + (options.timeout === null ? 'null' : typeof options.timeout + ' (' + options.timeout + ')'));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this.timeout = options.timeout || 0;
    this.socket = null;
    this.finished = false;
    this.destroyed = false;
    this.writableEnded = false;
    this.writableFinished = false;
    this.headersSent = false;

    if (options.agent !== undefined && options.agent !== null && options.agent !== false) {
      if (typeof options.agent !== 'object' || !options.agent.addRequest) {
        let recv;
        if (typeof options.agent === 'boolean') recv = ' Received type boolean (' + options.agent + ')';
        else if (typeof options.agent === 'function') recv = ' Received function ' + (options.agent.name || '');
        else if (typeof options.agent === 'symbol') recv = ' Received type symbol (' + String(options.agent) + ')';
        else if (typeof options.agent === 'object') recv = ' Received an instance of ' + (options.agent.constructor?.name || 'Object');
        else if (typeof options.agent === 'string') recv = " Received type string ('" + options.agent + "')";
        else recv = ' Received type ' + typeof options.agent + ' (' + String(options.agent) + ')';
        const e = new TypeError('The "options.agent" property must be one of Agent-like Object, undefined, or false.' + recv);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
    }

    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        if (k.toLowerCase() === 'host' && Array.isArray(v)) {
          const e = new TypeError('The "headers.host" property must be of type string. Received an instance of Array');
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
        this._headers[k.toLowerCase()] = v;
      }
    }

    if (cb) this.once('response', cb);

    // Auto-end GET/HEAD requests if no body expected
    if (this.method === 'GET' || this.method === 'HEAD') {
      process.nextTick(() => { if (!this.finished) this.end(); });
    }
  }

  _implicitHeader() { this._flushHeaders(); }
  _flushHeaders() { this.headersSent = true; }
  flushHeaders() { this._flushHeaders(); }
  setHeader(k, v) { this._headers[k.toLowerCase()] = Array.isArray(v) ? v.map(String) : v; return this; }
  getHeader(k) { return this._headers[k.toLowerCase()]; }
  removeHeader(k) { delete this._headers[k.toLowerCase()]; }
  hasHeader(k) { return k.toLowerCase() in this._headers; }
  getHeaderNames() { return Object.keys(this._headers); }
  getRawHeaderNames() { return Object.keys(this._headers); }
  getHeaders() { return { ...this._headers }; }

  destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (this.socket) this.socket.destroy(err);
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }
  abort() { this.destroy(); }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    this._body.push(typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk);
    if (cb) process.nextTick(cb);
    return true;
  }

  end(data, encoding, cb) {
    if (typeof data === 'function') { cb = data; data = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    // end() must be idempotent: a bare re-end() is a no-op in node. It was not here — it
    // called _send() unconditionally, so a second end() opened a SECOND dns lookup, tls
    // connection and request. fetch hit this every GET (https.js's _makeRequest already
    // ends the request, then fetch ends it again), and both responses then fed the one
    // shared _chunkBuf: on a real network their records interleave, desync the chunk-size
    // parser, and one connection's 0\r\n\r\n terminates the other's res — 'end' fires early
    // and silently with a corrupt body. https.get was immune only because it happens to
    // guard with `if (!req.finished)`.
    if (this.finished) { if (cb) this.once('finish', cb); return this; }
    if (data) this.write(data, encoding);
    this.finished = true;
    if (cb) this.once('finish', cb);
    this._send();
    return this;
  }

  _send() {
    if (this.destroyed) return;
    const opts = this._options;
    const host = opts.hostname || opts.host || 'localhost';
    const port = parseInt(opts.port) || 80;

    // Delegate to agent.addRequest if agent has a custom implementation
    const agent = opts.agent;
    if (agent && typeof agent.addRequest === 'function' && agent.addRequest !== Agent_class.prototype.addRequest) {
      agent.addRequest(this, opts);
      return;
    }

    const dns = require('dns');

    // Resolve hostname to IP first (tcp.connect needs an IP address)
    const doConnect = (ip) => {
      let socket;
      if (typeof opts.createConnection === 'function') {
        socket = opts.createConnection(Object.assign({}, opts, { host: ip }));
      } else {
        socket = new net.Socket();
      }
      this.socket = socket;
      if (!socket) return;
      // Node emits 'socket' on the request once its socket is assigned. Tests listen for it
      // (and req.setTimeout defers arming to it, since the socket does not exist yet when
      // setTimeout is called). Emit on a tick so listeners attached after http.request()
      // returns — the normal pattern — still see it.
      this.connection = socket;
      process.nextTick(() => this.emit('socket', socket));

      let responseChunks = [];
      let responseLen = 0;
      let headersParsed = false;
      let res = null;
      let contentLength = -1;
      let bodyReceived = 0;
      let chunked = false;

      const onConnect = () => {
        this.headersSent = true;
        const body = this._body.length > 0 ? Buffer.concat(this._body) : null;
        if (!this._headers['host']) this._headers['host'] = port === 80 ? host : `${host}:${port}`;
        if (body) {
          if (!this._headers['content-length']) this._headers['content-length'] = String(body.length);
        } else if (!this._headers['content-length'] && !this._headers['transfer-encoding']) {
          const m = this.method.toUpperCase();
          if (m === 'POST' || m === 'PUT' || m === 'PATCH') this._headers['content-length'] = '0';
        }
        if (!this._headers['connection']) this._headers['connection'] = 'close';

        let reqStr = `${this.method} ${this.path} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(this._headers)) reqStr += `${k}: ${v}\r\n`;
        reqStr += '\r\n';
        socket.write(reqStr);
        if (body) socket.write(body);
        this.emit('finish');
      };

      const clientDataHandler = (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!headersParsed) {
          responseChunks.push(buf);
          responseLen += buf.length;
          const combined = Buffer.concat(responseChunks, responseLen);
          let headerEnd = -1;
          for (let i = 0; i <= combined.length - 4; i++) {
            if (combined[i] === 0x0d && combined[i+1] === 0x0a && combined[i+2] === 0x0d && combined[i+3] === 0x0a) {
              headerEnd = i; break;
            }
          }
          if (headerEnd === -1) return;
          const headerPart = combined.slice(0, headerEnd).toString();
          const bodyPart = combined.slice(headerEnd + 4);
          const lines = headerPart.split('\r\n');
          const statusLine = lines[0];
          const match = statusLine.match(/^HTTP\/(\d\.\d) (\d+) ?(.*)$/);

          res = new IncomingMessage();
          res.socket = socket;
          // node links the response back to its request; tests reach through it
          // (e.g. `res.on('data', function(){ this.req.id })`), and a missing .req throws
          // a TypeError inside the user handler that currently gets swallowed.
          res.req = this;
          res.connection = socket;
          res.connection = socket;
          if (match) {
            res.httpVersion = match[1];
            res.statusCode = parseInt(match[2]);
            res.statusMessage = match[3] || '';
          }
          for (let i = 1; i < lines.length; i++) {
            const idx = lines[i].indexOf(':');
            if (idx > 0) {
              const rawKey = lines[i].substring(0, idx).trim();
              const val = lines[i].substring(idx + 1).trim();
              res._addHeaderLine(rawKey, val, res.headers);
            }
          }
          headersParsed = true;
          responseChunks = null;

          if (res.statusCode === 101 && this.listenerCount('upgrade') > 0) {
            socket.removeListener('data', clientDataHandler);
            this.emit('upgrade', res, socket, bodyPart);
            return;
          }

          contentLength = parseInt(res.headers['content-length']) || -1;
          chunked = (res.headers['transfer-encoding'] || '').includes('chunked');

          this.emit('response', res);

          if (bodyPart.length > 0) {
            if (chunked) {
              this._pushChunkedBuf(res, bodyPart);
            } else {
              res.push(bodyPart);
              bodyReceived += bodyPart.length;
            }
          }
          if (contentLength >= 0 && bodyReceived >= contentLength) {
            res.complete = true;
            res.push(null);
            socket.destroy();
          }
        } else {
          if (chunked) {
            this._pushChunkedBuf(res, buf);
          } else {
            res.push(buf);
            bodyReceived += buf.length;
            if (contentLength >= 0 && bodyReceived >= contentLength) {
              res.complete = true;
              res.push(null);
              socket.destroy();
            }
          }
        }
      };

      socket.on('data', clientDataHandler);
      socket.on('end', () => {
        if (res && !res.complete) { res.complete = true; res.push(null); }
        socket.destroy();
      });
      socket.on('error', (err) => { this.emit('error', err); });

      if (typeof opts.createConnection === 'function') {
        if (socket.connecting === false) onConnect();
        else socket.once('connect', onConnect);
      } else {
        socket.connect(port, ip, onConnect);
      }
    };

    // If host looks like an IP, connect directly; otherwise DNS resolve first
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') {
      doConnect(host === 'localhost' ? '127.0.0.1' : host);
    } else {
      dns.lookup(host, 4, (err, address) => {
        if (err) { this.emit('error', err); return; }
        doConnect(address);
      });
    }
  }

  // Binary-safe chunked transfer decoding
  _pushChunkedBuf(res, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!this._chunkBuf) this._chunkBuf = buf;
    else this._chunkBuf = Buffer.concat([this._chunkBuf, buf]);
    while (true) {
      let nl = -1;
      for (let i = 0; i < this._chunkBuf.length - 1; i++) {
        if (this._chunkBuf[i] === 0x0d && this._chunkBuf[i+1] === 0x0a) { nl = i; break; }
      }
      if (nl === -1) break;
      const sizeStr = this._chunkBuf.slice(0, nl).toString().trim();
      const size = parseInt(sizeStr, 16);
      if (isNaN(size)) { this._chunkBuf = this._chunkBuf.slice(nl + 2); continue; }
      if (size === 0) { res.complete = true; res.push(null); if (this.socket) this.socket.destroy(); return; }
      if (this._chunkBuf.length < nl + 2 + size + 2) break;
      res.push(this._chunkBuf.slice(nl + 2, nl + 2 + size));
      this._chunkBuf = this._chunkBuf.slice(nl + 2 + size + 2);
    }
  }

  setTimeout(ms, cb) {
    if (cb) this.once('timeout', cb);
    // Was a no-op stub: it registered the callback but never armed anything, so
    // req.on('timeout') could never fire. Arm the underlying socket and surface its
    // 'timeout' on the request (node does both). The socket does not exist yet when
    // setTimeout() is called, hence the deferral to the 'socket' event.
    const arm = (s) => {
      if (!s) return;
      // Bind to the socket's CURRENT request, not to `this`: a keep-alive socket outlives
      // request 1, so a forwarder capturing `this` would keep firing on the completed
      // request and never on request 2.
      s._httpCurrentReq = this;
      s.setTimeout(ms);
      if (!s._reqTimeoutFwd) {
        s._reqTimeoutFwd = true;
        s.on('timeout', () => { const r = s._httpCurrentReq; if (r) r.emit('timeout'); });
      }
    };
    if (this.socket) arm(this.socket);
    else this.once('socket', arm);
    return this;
  }
  setNoDelay(noDelay) { if (this.socket) this.socket.setNoDelay(noDelay); }
  setSocketKeepAlive(enable, delay) { if (this.socket) this.socket.setKeepAlive(enable, delay); }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    // nextTick so client socket teardown happens after poll but before setImmediate,
    // giving the server socket time to detect EOF in re-poll.
    const err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    process.nextTick(() => {
      if (this.socket) this.socket.destroy();
      this.emit('error', err);
      this.emit('close');
    });
  }
}

function request(url, options, cb) {
  if (typeof url === 'string') {
    let parsed;
    try { parsed = new URL(url); } catch (e) {
      const err = new TypeError(`Invalid URL: ${url}`); err.code = 'ERR_INVALID_URL'; err.input = url; throw err;
    }
    if (!parsed.protocol || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      const err = new TypeError(`Invalid URL: ${url}`); err.code = 'ERR_INVALID_URL'; err.input = url; throw err;
    }
    if (!parsed.hostname) {
      const err = new TypeError(`Invalid URL: ${url}`); err.code = 'ERR_INVALID_URL'; err.input = url; throw err;
    }
    // node: `options = ObjectAssign(urlDerivedOptions, options)` (lib/_http_client.js) — the
    // caller's options OVERRIDE the url. This was backwards: it clobbered the caller's
    // hostname/port/path with the url's, so `http.get('http://example.com/p', {hostname:
    // 'localhost', port}, cb)` actually hit example.com over the real internet.
    const urlOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
    };
    if (typeof options === 'function') { cb = options; options = undefined; }
    const opts = Object.assign(urlOpts, options || {});
    return new ClientRequest(opts, cb);
  }
  if (typeof options === 'function') { cb = options; options = url; }
  else { options = Object.assign({}, url, options); }
  return new ClientRequest(options, cb);
}

function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

const Agent_class = class Agent {
  constructor(opts) {
    opts = opts || {};
    this.maxSockets = opts.maxSockets || Infinity;
    this.maxFreeSockets = opts.maxFreeSockets || 256;
    this.maxTotalSockets = opts.maxTotalSockets || Infinity;
    this.keepAlive = opts.keepAlive || false;
    this.keepAliveMsecs = opts.keepAliveMsecs || 1000;
    this.timeout = opts.timeout;
    this.scheduling = opts.scheduling || 'lifo';
    this.requests = {};
    this.sockets = {};
    this.freeSockets = {};
    this.totalSocketCount = 0;
    this.options = opts;
  }
  getName(options) {
    if (!options) options = {};
    let name = options.host || 'localhost';
    name += ':' + (options.port || '');
    name += ':' + (options.localAddress || '');
    const family = options.family;
    if (options.socketPath) name += ':' + options.socketPath;
    else if (family === 4 || family === 6) name += ':' + family;
    return name;
  }
  createConnection(options, cb) {
    const net = require('net');
    const s = net.createConnection(options);
    if (cb) s.once('connect', cb);
    return s;
  }
  addRequest(req, options) {}
  destroy() { this.sockets = {}; this.freeSockets = {}; this.requests = {}; }
};

const METHODS = ['ACL','BIND','CHECKOUT','CONNECT','COPY','DELETE','GET','HEAD','LINK','LOCK','M-SEARCH','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE','NOTIFY','OPTIONS','PATCH','POST','PROPFIND','PROPPATCH','PURGE','PUT','QUERY','REBIND','REPORT','SEARCH','SOURCE','SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE'];
const STATUS_CODES = {
  100:'Continue',101:'Switching Protocols',
  200:'OK',201:'Created',202:'Accepted',204:'No Content',
  301:'Moved Permanently',302:'Found',304:'Not Modified',307:'Temporary Redirect',308:'Permanent Redirect',
  400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',
  408:'Request Timeout',409:'Conflict',410:'Gone',413:'Payload Too Large',
  500:'Internal Server Error',501:'Not Implemented',502:'Bad Gateway',503:'Service Unavailable',504:'Gateway Timeout',
};

// Allow Server() without new (Node.js compat)
const _Server = new Proxy(Server, {
  apply(target, thisArg, args) { return new target(...args); },
});

function validateHeaderName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    const e = new TypeError('Header name must be a valid HTTP token ["' + name + '"]');
    e.code = 'ERR_INVALID_HTTP_TOKEN'; throw e;
  }
  if (!/^[\x21-\x7E]+$/.test(name) || /[():@,;=\[\]{}\\<>\/?"{}]/.test(name)) {
    const e = new TypeError('Header name must be a valid HTTP token ["' + name + '"]');
    e.code = 'ERR_INVALID_HTTP_TOKEN'; throw e;
  }
}
function validateHeaderValue(name, value) {
  if (value === undefined) {
    const e = new TypeError('Invalid value "undefined" for header "' + name + '"');
    e.code = 'ERR_HTTP_INVALID_HEADER_VALUE'; throw e;
  }
  const sval = String(value);
  for (let i = 0; i < sval.length; i++) {
    const c = sval.charCodeAt(i);
    if (c > 0x7E || (c < 0x20 && c !== 0x09)) {
      const e = new TypeError('Invalid character in header content ["' + name + '"]');
      e.code = 'ERR_INVALID_CHAR'; throw e;
    }
  }
}

module.exports = {
  createServer: (opts, handler) => new Server(opts, handler),
  request, get,
  Server: _Server, IncomingMessage, ServerResponse, ClientRequest, OutgoingMessage,
  Agent: new Proxy(Agent_class, { apply(target, _, args) { return new target(...args); } }),
  globalAgent: new Agent_class(),
  METHODS, STATUS_CODES,
  maxHeaderSize: 16384,
  validateHeaderName,
  validateHeaderValue,
};
