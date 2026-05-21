// tls module — TLS client/server over OpenSSL
'use strict';

const EventEmitter = require('events');
const net = require('net');
const tcp = internalBinding('tcp');

class TLSSocket extends net.Socket {
  constructor(socket, options) {
    super();
    this._tlsOptions = options || {};
    this._ssl = 0;
    this._wrapSocket = socket || null;
    this.encrypted = true;
    this.authorized = false;
    this._connecting = false;
    if (socket && socket._fd >= 0) {
      this._fd = socket._fd;
    }
  }

  _startTLS() {
    const hostname = this._tlsOptions.servername || this._tlsOptions.host || '';
    this._ssl = tcp.sslConnect(this._fd, hostname);
    if (!this._ssl) {
      process.nextTick(() => this.emit('error', new Error('TLS handshake failed')));
      return false;
    }
    this.authorized = true;
    return true;
  }

  _onReadable() {
    if (!this._ssl) return;
    for (;;) {
      const data = tcp.sslRead(this._ssl);
      if (data === undefined) {
        if (this.readable) {
          this.readable = false;
          this.emit('end');
        }
        this.destroy();
        return;
      }
      if (data.length > 0) {
        this.emit('data', Buffer.from(data));
      }
      if (!tcp.sslPending(this._ssl)) break;
    }
  }

  write(data, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (this.destroyed || !this._ssl) return false;
    const str = typeof data === 'string' ? data : data.toString();
    const n = tcp.sslWrite(this._ssl, str);
    if (cb) process.nextTick(cb);
    return n >= 0;
  }

  end(data, encoding, cb) {
    if (typeof data === 'function') { cb = data; data = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (data !== undefined) this.write(data, encoding);
    this.writable = false;
    if (cb) this.once('finish', cb);
    this.emit('finish');
    return this;
  }

  destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    this.writable = false;
    if (this._ssl) {
      tcp.sslShutdown(this._ssl);
      this._ssl = 0;
    }
    if (this._fd >= 0) {
      net.Socket._sockets.delete(this._fd);
      tcp.close(this._fd);
      this._fd = -1;
    }
    if (err) this.emit('error', err);
    this.emit('close', !!err);
    return this;
  }

  getPeerCertificate() { return {}; }
  getCipher() { return { name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' }; }
  getProtocol() { return 'TLSv1.3'; }
}

function connect(options, cb) {
  if (typeof options === 'number') {
    options = { port: options, host: arguments[1] };
    cb = arguments[2];
  }
  const port = options.port;
  const host = options.host || options.hostname || 'localhost';
  const servername = options.servername || host;

  const tlsSock = new TLSSocket(null, { servername, host, ...options });
  if (cb) tlsSock.once('secureConnect', cb);

  net._ensurePoll();
  tlsSock._fd = tcp.socket();
  if (tlsSock._fd < 0) {
    process.nextTick(() => tlsSock.emit('error', new Error('socket() failed')));
    return tlsSock;
  }

  const dns = require('dns');
  const doConnect = (ip) => {
    tcp.connect(tlsSock._fd, ip, port);
    tcp.pollAdd(tlsSock._fd, tcp.EVFILT_WRITE);
    net.Socket._sockets.set(tlsSock._fd, tlsSock);
    tlsSock._connecting = true;
    tlsSock.remoteAddress = ip;
    tlsSock.remotePort = port;
  };

  tlsSock._onConnected = function() {
    this._connecting = false;
    tcp.pollRemove(this._fd, tcp.EVFILT_WRITE);
    if (!this._startTLS()) return;
    tcp.pollAdd(this._fd, tcp.EVFILT_READ);
    this.emit('secureConnect');
  };

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') {
    doConnect(host === 'localhost' ? '127.0.0.1' : host);
  } else {
    dns.lookup(host, 4, (err, address) => {
      if (err) { tlsSock.emit('error', err); return; }
      doConnect(address);
    });
  }

  return tlsSock;
}

class Server extends net.Server {
  constructor(options, listener) {
    if (typeof options === 'function') { listener = options; options = {}; }
    super(options, listener);
  }
}

function createServer(options, listener) {
  return new Server(options, listener);
}

module.exports = {
  TLSSocket,
  Server,
  connect,
  createServer,
  createSecureContext: () => ({}),
  DEFAULT_MIN_VERSION: 'TLSv1.2',
  DEFAULT_MAX_VERSION: 'TLSv1.3',
  DEFAULT_CIPHERS: '',
  rootCertificates: [],
};
