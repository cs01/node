// https module — HTTPS client over TLS + HTTP parsing
'use strict';

const http = require('http');
const tls = require('tls');
const { Readable } = require('stream');

class Agent {
  constructor(opts) { this.maxSockets = (opts && opts.maxSockets) || Infinity; }
  destroy() {}
}

function request(url, options, cb) {
  if (typeof url === 'string') {
    const parsed = new URL(url);
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
      const tlsSock = tls.connect({ port, host: ip, servername: host }, () => {
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
        if (body) tlsSock.write(body.toString());
        this.emit('finish');
      });

      let responseBuf = '';
      let headersParsed = false;
      let res = null;
      let contentLength = -1;
      let bodyReceived = 0;
      let chunked = false;

      tlsSock.on('data', (chunk) => {
        if (!headersParsed) {
          responseBuf += chunk.toString();
          const headerEnd = responseBuf.indexOf('\r\n\r\n');
          if (headerEnd === -1) return;
          const headerPart = responseBuf.substring(0, headerEnd);
          const bodyPart = responseBuf.substring(headerEnd + 4);
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
          contentLength = parseInt(res.headers['content-length']) || -1;
          chunked = (res.headers['transfer-encoding'] || '').includes('chunked');
          this.emit('response', res);

          if (bodyPart.length > 0) {
            if (chunked) {
              _pushChunked(this, res, bodyPart);
            } else {
              res.push(Buffer.from(bodyPart));
              bodyReceived += bodyPart.length;
            }
          }
          if (contentLength >= 0 && bodyReceived >= contentLength) {
            res.complete = true;
            res.push(null);
          }
        } else {
          const str = chunk.toString();
          if (chunked) {
            _pushChunked(this, res, str);
          } else {
            res.push(chunk);
            bodyReceived += chunk.length;
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

function _pushChunked(reqObj, res, data) {
  if (!reqObj._chunkBuf) reqObj._chunkBuf = '';
  reqObj._chunkBuf += data;
  while (true) {
    const nl = reqObj._chunkBuf.indexOf('\r\n');
    if (nl === -1) break;
    const sizeStr = reqObj._chunkBuf.substring(0, nl).trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size)) { reqObj._chunkBuf = reqObj._chunkBuf.substring(nl + 2); continue; }
    if (size === 0) { res.complete = true; res.push(null); return; }
    if (reqObj._chunkBuf.length < nl + 2 + size + 2) break;
    const chunkData = reqObj._chunkBuf.substring(nl + 2, nl + 2 + size);
    res.push(Buffer.from(chunkData));
    reqObj._chunkBuf = reqObj._chunkBuf.substring(nl + 2 + size + 2);
  }
}

function get(url, options, cb) {
  const req = request(url, options, cb);
  if (!req.finished) req.end();
  return req;
}

const globalAgent = new Agent();

module.exports = {
  request,
  get,
  Agent,
  globalAgent,
  Server: http.Server,
  createServer: http.createServer,
  STATUS_CODES: http.STATUS_CODES,
  METHODS: http.METHODS,
};
