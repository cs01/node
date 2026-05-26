// http module — real HTTP client over TCP, basic server
'use strict';

const EventEmitter = require('events');
const net = require('net');
const stream = require('stream');
const { Readable } = stream;

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
  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }
  _addHeaderLines(headers, n) {
    if (headers && headers.length) {
      for (let i = 0; i < headers.length; i += 2) {
        const key = headers[i].toLowerCase();
        const val = headers[i + 1];
        this.rawHeaders.push(headers[i], val);
        if (this.headers[key]) { this.headers[key] += ', ' + val; }
        else { this.headers[key] = val; }
      }
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
  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    if (!this._headersSent && this._implicitHeader) this._implicitHeader();
    const data = typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk;
    this._outputData.push(data);
    this._outputSize += data.length;
    if (cb) cb();
    return true;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk) this.write(chunk, encoding);
    this.finished = true;
    this.writableEnded = true;
    this.emit('finish');
    if (cb) cb();
    return this;
  }
  setHeader(k, v) {
    const lower = k.toLowerCase();
    this._headers[lower] = v;
    this._rawHeaderNames[lower] = k;
  }
  getHeader(k) { return this._headers[k.toLowerCase()]; }
  removeHeader(k) {
    const lower = k.toLowerCase();
    delete this._headers[lower];
    delete this._rawHeaderNames[lower];
  }
  hasHeader(k) { return k.toLowerCase() in this._headers; }
  getHeaderNames() { return Object.keys(this._headers); }
  getHeaders() { return { ...this._headers }; }
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
  addTrailers() {}
}

class ServerResponse extends OutgoingMessage {
  constructor(socket) {
    super();
    this._socket = socket;
    this.socket = socket;
    this.connection = socket;
    this.statusCode = 200;
    this.writable = true;
  }
  _implicitHeader() { this._flushHeaders(); }
  writeHead(code, reason, headers) {
    if (typeof reason === 'object') { headers = reason; reason = undefined; }
    this.statusCode = code;
    if (headers) for (const [k,v] of Object.entries(headers)) this.setHeader(k, v);
    return this;
  }
  _flushHeaders() {
    if (this._headersSent) return;
    this._headersSent = true;
    if (!this._headers['content-length'] && !this._headers['transfer-encoding']) {
      this._headers['transfer-encoding'] = 'chunked';
      this._chunked = true;
    }
    const statusMsg = STATUS_CODES[this.statusCode] || 'Unknown';
    let head = `HTTP/1.1 ${this.statusCode} ${statusMsg}\r\n`;
    for (const [k,v] of Object.entries(this._headers)) head += `${k}: ${v}\r\n`;
    head += '\r\n';
    this._socket.write(head);
  }
  write(chunk, encoding, cb) {
    this._flushHeaders();
    if (this._chunked) {
      let data;
      if (Buffer.isBuffer(chunk)) data = chunk;
      else if (chunk instanceof Uint8Array) data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      else data = Buffer.from(typeof chunk === 'string' ? chunk : String(chunk), encoding);
      this._socket.write(data.length.toString(16) + '\r\n');
      this._socket.write(data);
      this._socket.write('\r\n');
    } else {
      this._socket.write(chunk, encoding, cb);
    }
    return true;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    this._flushHeaders();
    if (chunk) this.write(chunk, encoding);
    if (this._chunked) this._socket.write('0\r\n\r\n');
    this.finished = true;
    this.writable = false;
    this.writableEnded = true;
    this._socket.end();
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
    this._server = null;
    this._listening = false;
  }
  listen(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const port = args[0] || 0;
    const host = args[1] || '0.0.0.0';
    this._sockets = new Set();
    this._closing = false;
    this._server = net.createServer((socket) => {
      this._sockets.add(socket);
      socket._httpActive = false;
      socket.on('close', () => {
        this._sockets.delete(socket);
        if (this._closing && this._sockets.size === 0) {
          process.nextTick(() => this.emit('close'));
        }
      });
      let buf = '';
      let headersParsed = false;
      let currentReq = null;
      let bodyReceived = 0;
      let contentLength = -1;

      socket.on('data', (chunk) => {
        if (!headersParsed) {
          buf += chunk.toString();
          const headerEnd = buf.indexOf('\r\n\r\n');
          if (headerEnd === -1) return;
          const headerPart = buf.substring(0, headerEnd);
          const bodyPart = buf.substring(headerEnd + 4);
          const lines = headerPart.split('\r\n');
          const [method, url, version] = lines[0].split(' ');
          const req = new IncomingMessage();
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
              req.headers[key] = val;
              req.rawHeaders.push(lines[i].substring(0, idx).trim(), val);
            }
          }
          headersParsed = true;
          currentReq = req;
          contentLength = parseInt(req.headers['content-length']) || 0;

          if (bodyPart.length > 0) {
            req.push(Buffer.from(bodyPart));
            bodyReceived += bodyPart.length;
          }

          if (bodyReceived >= contentLength) {
            req.push(null);
            req.complete = true;
          }

          if (req.headers['upgrade'] && this.listenerCount('upgrade') > 0) {
            req.push(null);
            req.complete = true;
            this.emit('upgrade', req, socket, Buffer.from(bodyPart));
          } else {
            socket._httpActive = true;
            const res = new ServerResponse(socket);
            res.on('finish', () => {
              socket._httpActive = false;
              if (this._closing) socket.destroy();
            });
            this.emit('request', req, res);
          }
        } else if (currentReq && !currentReq.complete) {
          currentReq.push(chunk);
          bodyReceived += chunk.length;
          if (contentLength >= 0 && bodyReceived >= contentLength) {
            currentReq.push(null);
            currentReq.complete = true;
          }
        }
      });

      socket.on('end', () => {
        if (currentReq && !currentReq.complete) {
          currentReq.push(null);
          currentReq.complete = true;
        }
      });
    });
    this._server.listen(port, host, () => {
      this._listening = true;
      this.emit('listening');
      if (cb) cb();
    });
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
  setTimeout(ms, cb) { this._timeout = ms; if (cb) this.on('timeout', cb); return this; }
  get timeout() { return this._timeout || 0; }
  set timeout(ms) { this._timeout = ms; }
  get listening() { return this._listening; }
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
    this.method = (options.method || 'GET').toUpperCase();
    this.path = options.path || '/';
    if (typeof this.path === 'string' && /[^\x20-\x7e]/.test(this.path)) throw _ERR_UNESCAPED_CHARACTERS('Request path');
    this.host = options.hostname || options.host || 'localhost';
    this.protocol = options.protocol || 'http:';
    this.socket = null;
    this.finished = false;
    this.headersSent = false;

    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) this._headers[k.toLowerCase()] = v;
    }

    if (cb) this.once('response', cb);

    // Auto-end GET/HEAD requests if no body expected
    if (this.method === 'GET' || this.method === 'HEAD') {
      process.nextTick(() => { if (!this.finished) this.end(); });
    }
  }

  setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; }
  getHeader(k) { return this._headers[k.toLowerCase()]; }
  removeHeader(k) { delete this._headers[k.toLowerCase()]; }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    this._body.push(typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk);
    if (cb) process.nextTick(cb);
    return true;
  }

  end(data, encoding, cb) {
    if (typeof data === 'function') { cb = data; data = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (data) this.write(data, encoding);
    this.finished = true;
    if (cb) this.once('finish', cb);
    this._send();
    return this;
  }

  _send() {
    const opts = this._options;
    const host = opts.hostname || opts.host || 'localhost';
    const port = parseInt(opts.port) || 80;
    const dns = require('dns');

    // Resolve hostname to IP first (tcp.connect needs an IP address)
    const doConnect = (ip) => {
      const socket = new net.Socket();
      this.socket = socket;
      socket.connect(port, ip, () => {
      this.headersSent = true;
      // Build HTTP request
      const body = this._body.length > 0 ? Buffer.concat(this._body) : null;
      if (!this._headers['host']) this._headers['host'] = port === 80 ? host : `${host}:${port}`;
      if (body && !this._headers['content-length']) this._headers['content-length'] = String(body.length);
      if (!this._headers['connection']) this._headers['connection'] = 'close';

      let reqStr = `${this.method} ${this.path} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(this._headers)) reqStr += `${k}: ${v}\r\n`;
      reqStr += '\r\n';
      socket.write(reqStr);
      if (body) socket.write(body);
      this.emit('finish');
    });

    let responseChunks = [];
    let responseLen = 0;
    let headersParsed = false;
    let res = null;
    let contentLength = -1;
    let bodyReceived = 0;
    let chunked = false;

    socket.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!headersParsed) {
        responseChunks.push(buf);
        responseLen += buf.length;
        const combined = Buffer.concat(responseChunks, responseLen);
        // Binary-safe header delimiter search
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

        res = new IncomingMessage();
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

        if (res.statusCode === 101 && this.listenerCount('upgrade') > 0) {
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
          }
        }
      }
    });

    socket.on('end', () => {
      if (res && !res.complete) {
        res.complete = true;
        res.push(null);
      }
    });

      socket.on('error', (err) => {
        this.emit('error', err);
      });
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
      if (size === 0) { res.complete = true; res.push(null); return; }
      if (this._chunkBuf.length < nl + 2 + size + 2) break;
      res.push(this._chunkBuf.slice(nl + 2, nl + 2 + size));
      this._chunkBuf = this._chunkBuf.slice(nl + 2 + size + 2);
    }
  }

  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }
  abort() { if (this.socket) this.socket.destroy(); }
}

function request(url, options, cb) {
  if (typeof url === 'string') {
    const parsed = new URL(url);
    const opts = typeof options === 'function' ? {} : (options || {});
    opts.hostname = parsed.hostname;
    opts.port = parsed.port || 80;
    opts.path = parsed.pathname + parsed.search;
    if (typeof options === 'function') cb = options;
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
  constructor(opts) { this.maxSockets = (opts && opts.maxSockets) || Infinity; }
  destroy() {}
};

const METHODS = ['GET','HEAD','POST','PUT','DELETE','CONNECT','OPTIONS','TRACE','PATCH'];
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

module.exports = {
  createServer: (opts, handler) => new Server(opts, handler),
  request, get,
  Server: _Server, IncomingMessage, ServerResponse, ClientRequest, OutgoingMessage,
  Agent: new Proxy(Agent_class, { apply(target, _, args) { return new target(...args); } }),
  globalAgent: new Agent_class(),
  METHODS, STATUS_CODES,
  maxHeaderSize: 16384,
};
