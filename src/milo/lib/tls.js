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
    this._ssl = tcp.sslConnectStart(this._fd, hostname);
    if (!this._ssl || this._ssl < 0) {
      this._ssl = 0;
      process.nextTick(() => this.emit('error', new Error('TLS handshake init failed')));
      return false;
    }
    // Non-blocking: handshake will complete via _onReadable
    this._pendingTlsConnect = true;
    return true;
  }

  _onReadable() {
    // Non-blocking TLS handshake for server-accepted sockets
    if (this._pendingTlsAccept) {
      if (!this._ssl) {
        // First call: create SSL object
        this._ssl = tcp.sslAcceptNew(this._sslCtx, this._fd);
        if (!this._ssl) {
          this.destroy(new Error('TLS accept init failed'));
          return;
        }
      }
      const result = tcp.sslAcceptContinue(this._ssl);
      if (result === 1) {
        this._pendingTlsAccept = false;
        this.authorized = true;
        this.encrypted = true;
        tcp.pollRemove(this._fd, tcp.EVFILT_WRITE);
        if (this._tlsServer) this._tlsServer.emit('secureConnection', this);
      } else if (result === -1) {
        this.destroy(new Error('TLS handshake failed'));
      }
      // result === 0 means WANT_READ/WANT_WRITE — wait for next event
      return;
    }

    // Non-blocking client TLS handshake continuation
    if (this._pendingTlsConnect) {
      const result = tcp.sslConnectContinue(this._ssl);
      if (result === 1) {
        this._pendingTlsConnect = false;
        this.authorized = true;
        tcp.pollRemove(this._fd, tcp.EVFILT_WRITE);
        this.emit('secureConnect');
      } else if (result === -1) {
        this.destroy(new Error('TLS client handshake failed'));
      }
      return;
    }

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
      if (data.length === 0) break;
      this.emit('data', Buffer.from(data));
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
    // Delay destroy to let kqueue deliver pending data to the peer
    setTimeout(() => this.destroy(), 50);
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
    // Register for both read and write events — SSL handshake may need either
    tcp.pollAdd(this._fd, tcp.EVFILT_READ);
    tcp.pollAdd(this._fd, tcp.EVFILT_WRITE);
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
    super(options);
    this._tlsOptions = options;
    this._sslCtx = 0;
    if (listener) this.on('secureConnection', listener);
  }

  listen(port, host, backlog, cb) {
    // Initialize SSL context with cert/key before listening
    const cert = this._tlsOptions.cert;
    const key = this._tlsOptions.key;
    if (!cert || !key) {
      process.nextTick(() => this.emit('error', new Error('cert and key required for TLS server')));
      return this;
    }
    const certStr = typeof cert === 'string' ? cert : cert.toString();
    const keyStr = typeof key === 'string' ? key : key.toString();
    this._sslCtx = tcp.sslServerCtxNew(certStr, keyStr);
    if (!this._sslCtx) {
      process.nextTick(() => this.emit('error', new Error('Failed to create SSL context')));
      return this;
    }

    const sslCtx = this._sslCtx;
    const tlsServer = this;

    // Override _onAcceptable: accept TCP, register for read, do TLS on first data
    this._onAcceptable = () => {
      const clientFd = tcp.accept(this._fd);
      if (clientFd < 0) return;

      // Create a pending TLS socket — handshake deferred until data arrives
      const sock = new TLSSocket(null, {});
      sock._fd = clientFd;
      sock._ssl = 0;
      sock._pendingTlsAccept = true;
      sock._tlsServer = tlsServer;
      sock._sslCtx = sslCtx;
      sock.readable = true;
      sock.writable = true;

      net._ensurePoll();
      tcp.pollAdd(clientFd, tcp.EVFILT_READ);
      tcp.pollAdd(clientFd, tcp.EVFILT_WRITE);
      net.Socket._sockets.set(clientFd, sock);

      tlsServer._connections++;
      sock.on('close', () => tlsServer._connections--);
    };

    return net.Server.prototype.listen.call(this, port, host, backlog, cb);
  }

  close(cb) {
    if (this._sslCtx) {
      tcp.sslCtxFree(this._sslCtx);
      this._sslCtx = 0;
    }
    return net.Server.prototype.close.call(this, cb);
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
