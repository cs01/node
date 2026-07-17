// https module — HTTPS client over TLS + HTTP parsing
'use strict';

const EventEmitter = require('events');
const http = require('http');
const tls = require('tls');
const { Readable } = require('stream');

class Agent {
  constructor(opts) { this.maxSockets = (opts && opts.maxSockets) || Infinity; }
  destroy() {}
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
    const opts = typeof options === 'function' ? {} : (options || {});
    opts.hostname = parsed.hostname;
    opts.port = parsed.port || 443;
    opts.path = parsed.pathname + parsed.search;
    opts.protocol = 'https:';
    if (typeof options === 'function') cb = options;
    return _makeRequest(opts, cb);
  }
  if (typeof options === 'function') { cb = options; options = url; }
  else { options = Object.assign({}, url, options); }
  options.port = options.port || 443;
  return _makeRequest(options, cb);
}

function _makeRequest(options, cb) {
  const req = new http.ClientRequest(options, cb);
  const origSend = req._send.bind(req);

  req._send = function() {
    const opts = this._options;
    const host = opts.hostname || opts.host || 'localhost';
    const port = parseInt(opts.port) || 443;
    const dns = require('dns');

    const doConnect = (ip) => {
      // Forward the caller's TLS options. This used to pass ONLY {port, host, servername},
      // silently dropping ca / cert / key / rejectUnauthorized / checkServerIdentity — so
      // every https request ignored what the caller asked for. Harmless while nothing was
      // verified; once verification landed it meant a custom `ca` could never be trusted.
      // `host: ip` last: connect to the RESOLVED address, but keep servername for SNI.
      const tlsOpts = Object.assign({}, opts, {
        port,
        host: ip,
        servername: opts.servername || host,
      });
      // NODE_TLS_REJECT_UNAUTHORIZED=0 disables verification process-wide (node semantics).
      // Only honour it when the caller did not state a preference explicitly.
      if (tlsOpts.rejectUnauthorized === undefined &&
          process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
        tlsOpts.rejectUnauthorized = false;
      }
      const tlsSock = tls.connect(tlsOpts, () => {
        this.socket = tlsSock;
        this.headersSent = true;
        const body = this._body.length > 0 ? Buffer.concat(this._body) : null;
        if (!this._headers['host']) this._headers['host'] = port === 443 ? host : `${host}:${port}`;
        if (body && !this._headers['content-length']) this._headers['content-length'] = String(body.length);
        if (!this._headers['connection']) this._headers['connection'] = 'close';

        let reqStr = `${this.method} ${this.path} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(this._headers)) reqStr += `${k}: ${v}\r\n`;
        reqStr += '\r\n';
        tlsSock.write(reqStr);
        if (body) tlsSock.write(body);
        this.emit('finish');
      });

      let responseChunks = [];
      let responseLen = 0;
      let headersParsed = false;
      let res = null;
      let contentLength = -1;
      let bodyReceived = 0;
      let chunked = false;

      tlsSock.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!headersParsed) {
          responseChunks.push(buf);
          responseLen += buf.length;
          const combined = Buffer.concat(responseChunks, responseLen);
          // Search for \r\n\r\n in binary
          let headerEnd = -1;
          for (let i = 0; i <= combined.length - 4; i++) {
            if (combined[i] === 0x0d && combined[i+1] === 0x0a && combined[i+2] === 0x0d && combined[i+3] === 0x0a) {
              headerEnd = i; break;
            }
          }
          if (headerEnd === -1) return;
          const headerPart = combined.slice(0, headerEnd).toString();
          const bodyPart = combined.slice(headerEnd + 4); // stays as Buffer — preserves binary
          const lines = headerPart.split('\r\n');
          const statusLine = lines[0];
          const match = statusLine.match(/^HTTP\/(\d\.\d) (\d+) ?(.*)$/);

          res = new http.IncomingMessage();
          if (match) {
            res.httpVersion = match[1];
            res.statusCode = parseInt(match[2]);
            res.statusMessage = match[3] || '';
          }
          for (let i = 1; i < lines.length; i++) {
            const idx = lines[i].indexOf(':');
            if (idx > 0) {
              const key = lines[i].substring(0, idx).trim().toLowerCase();
              const val = lines[i].substring(idx + 1).trim();
              res.headers[key] = val;
              res.rawHeaders.push(lines[i].substring(0, idx).trim(), val);
            }
          }
          headersParsed = true;
          responseChunks = null;
          contentLength = parseInt(res.headers['content-length']) || -1;
          chunked = (res.headers['transfer-encoding'] || '').includes('chunked');
          this.emit('response', res);

          if (bodyPart.length > 0) {
            if (chunked) {
              _pushChunkedBuf(this, res, bodyPart);
            } else {
              res.push(bodyPart);
              bodyReceived += bodyPart.length;
            }
          }
          if (contentLength >= 0 && bodyReceived >= contentLength) {
            res.complete = true;
            res.push(null);
          }
        } else {
          if (chunked) {
            _pushChunkedBuf(this, res, buf);
          } else {
            res.push(buf);
            bodyReceived += buf.length;
            if (contentLength >= 0 && bodyReceived >= contentLength) {
              res.complete = true;
              res.push(null);
            }
          }
        }
      });

      tlsSock.on('end', () => {
        if (res && !res.complete) {
          res.complete = true;
          res.push(null);
        }
      });

      tlsSock.on('error', (err) => {
        this.emit('error', err);
      });
    };

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') {
      doConnect(host === 'localhost' ? '127.0.0.1' : host);
    } else {
      dns.lookup(host, 4, (err, address) => {
        if (err) { this.emit('error', err); return; }
        doConnect(address);
      });
    }
  };

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!req.finished) req.end();
  }

  return req;
}

// Binary-safe chunked transfer decoding
function _pushChunkedBuf(reqObj, res, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!reqObj._chunkBuf) reqObj._chunkBuf = buf;
  else reqObj._chunkBuf = Buffer.concat([reqObj._chunkBuf, buf]);
  while (true) {
    // Find \r\n in buffer
    let nl = -1;
    for (let i = 0; i < reqObj._chunkBuf.length - 1; i++) {
      if (reqObj._chunkBuf[i] === 0x0d && reqObj._chunkBuf[i+1] === 0x0a) { nl = i; break; }
    }
    if (nl === -1) break;
    const sizeStr = reqObj._chunkBuf.slice(0, nl).toString().trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size)) { reqObj._chunkBuf = reqObj._chunkBuf.slice(nl + 2); continue; }
    if (size === 0) { res.complete = true; res.push(null); return; }
    if (reqObj._chunkBuf.length < nl + 2 + size + 2) break;
    res.push(reqObj._chunkBuf.slice(nl + 2, nl + 2 + size));
    reqObj._chunkBuf = reqObj._chunkBuf.slice(nl + 2 + size + 2);
  }
}

function get(url, options, cb) {
  const req = request(url, options, cb);
  if (!req.finished) req.end();
  return req;
}

const globalAgent = new Agent();

class Server extends EventEmitter {
  constructor(opts, handler) {
    super();
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    this._tlsOptions = opts;
    if (handler) this.on('request', handler);
    this._server = null;
    this._listening = false;
  }

  listen(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const port = args[0] || 0;
    const host = args[1] || '0.0.0.0';
    this._sockets = new Set();
    this._closing = false;

    this._server = tls.createServer(this._tlsOptions, (socket) => {
      this._sockets.add(socket);
      socket._httpActive = false;
      socket.on('close', () => {
        this._sockets.delete(socket);
        if (this._closing && this._sockets.size === 0) {
          process.nextTick(() => this.emit('close'));
        }
      });

      // A Buffer, not a string: `buf += chunk.toString()` mangles any non-UTF8 body byte.
      // And headers are parsed once, then the body is accumulated until Content-Length is
      // satisfied — the old code fired 'request' and push(null) on the FIRST chunk that
      // contained \r\n\r\n, dropping any body that arrived in a later TLS record and
      // answering 200 on an empty body. (This still assumes one request per connection; the
      // https server does not yet reuse http.js's full parser — see ROADMAP.)
      let buf = Buffer.alloc(0);
      let headerEnd = -1;
      let req = null, res = null, needBody = 0, bodyStart = 0, delivered = false;
      const deliver = () => {
        if (delivered) return;
        delivered = true;
        const body = buf.subarray(bodyStart);
        if (body.length) req.push(body);
        req.push(null);
        req.complete = true;
        socket._httpActive = true;
        res = new http.ServerResponse(socket);
        res.on('finish', () => { socket._httpActive = false; if (this._closing) socket.destroy(); });
        this.emit('request', req, res);
      };
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        if (headerEnd === -1) {
          headerEnd = buf.indexOf('\r\n\r\n');
          if (headerEnd === -1) return;   // headers not complete yet
          const lines = buf.subarray(0, headerEnd).toString('latin1').split('\r\n');
          const [method, url, version] = lines[0].split(' ');
          req = new http.IncomingMessage();
          req.method = method; req.url = url;
          req.httpVersion = (version || '').replace('HTTP/', '');
          for (let i = 1; i < lines.length; i++) {
            const idx = lines[i].indexOf(':');
            if (idx > 0) {
              const key = lines[i].substring(0, idx).trim().toLowerCase();
              const val = lines[i].substring(idx + 1).trim();
              req.headers[key] = val;
              req.rawHeaders.push(lines[i].substring(0, idx).trim(), val);
            }
          }
          needBody = parseInt(req.headers['content-length'], 10) || 0;
          bodyStart = headerEnd + 4;
        }
        // Deliver once the whole declared body has arrived (or there is none).
        if (buf.length - bodyStart >= needBody) deliver();
      });
    });

    this._server.listen(port, host, cb);
    this._listening = true;
    return this;
  }

  close(cb) {
    if (cb) this.once('close', cb);
    this._listening = false;
    this._closing = true;
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
}

function httpsCreateServer(options, listener) {
  return new Server(options, listener);
}

// Allow calling Server() without new
function createServerWrapper(opts, handler) {
  return new Server(opts, handler);
}
Object.setPrototypeOf(createServerWrapper, Server);
createServerWrapper.prototype = Server.prototype;

module.exports = {
  request,
  get,
  Agent,
  globalAgent,
  Server: createServerWrapper,
  createServer: httpsCreateServer,
  STATUS_CODES: http.STATUS_CODES,
  METHODS: http.METHODS,
};
