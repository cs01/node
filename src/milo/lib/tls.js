// tls module — TLS client/server over OpenSSL
'use strict';

const EventEmitter = require('events');
const net = require('net');
const tcp = internalBinding('tcp');

// X509_V_ERR_* -> node's authorizationError code string. -2 is our own sentinel for a peer
// that sent no certificate at all (OpenSSL calls that X509_V_OK: nothing to verify).
const X509_VERIFY_ERR = {
  '-2': 'ERR_TLS_CERT_ALTNAME_INVALID',
  2: 'UNABLE_TO_GET_ISSUER_CERT',
  7: 'CERT_SIGNATURE_FAILURE',
  9: 'CERT_NOT_YET_VALID',
  10: 'CERT_HAS_EXPIRED',
  18: 'DEPTH_ZERO_SELF_SIGNED_CERT',
  19: 'SELF_SIGNED_CERT_IN_CHAIN',
  20: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  21: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  62: 'HOSTNAME_MISMATCH',
};

// `ca` accepts a string, a Buffer, or an array of either; OpenSSL wants one PEM blob.
function _caToPem(ca) {
  if (!ca) return '';
  if (Array.isArray(ca)) return ca.map(_caToPem).join('\n');
  return Buffer.isBuffer(ca) ? ca.toString('utf8') : String(ca);
}

// `ca` may arrive directly or inside a secureContext built by tls.createSecureContext().
function _caFromOptions(o) {
  if (o.ca) return _caToPem(o.ca);
  if (o.secureContext && o.secureContext.ca) return _caToPem(o.secureContext.ca);
  return '';
}

// Decide authorized/authorizationError from the chain result. Returns an Error to fail the
// connection with, or null to proceed. rejectUnauthorized defaults TRUE, as in node: until
// this existed milo set authorized = true unconditionally and accepted any certificate.
function _checkVerify(sock) {
  const code = tcp.sslVerifyResult(sock._ssl);
  if (code === 0) {
    sock.authorized = true;
    sock.authorizationError = null;
    return null;
  }
  sock.authorized = false;
  const name = X509_VERIFY_ERR[code] || `CERT_VERIFY_ERROR_${code}`;
  sock.authorizationError = name;
  if (sock._tlsOptions.rejectUnauthorized === false) return null;
  const err = new Error(name);
  err.code = name;
  return err;
}

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
    this._ssl = tcp.sslConnectStart(this._fd, hostname, _caFromOptions(this._tlsOptions));
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
        tcp.pollRemove(this._fd, tcp.EVFILT_WRITE);
        const verifyErr = _checkVerify(this);
        if (verifyErr) { this.destroy(verifyErr); return; }
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
    const toWrite = typeof data === 'string' ? data : (Buffer.isBuffer(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
    const n = tcp.sslWrite(this._ssl, toWrite);
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

  const dns = require('dns');
  // The family is fixed at socket() time, so it must come from the RESOLVED ip. This used to
  // call tcp.socket() with no family (v4-only), map 'localhost' to 127.0.0.1 by hand, and
  // pin dns.lookup to family 4 — a duplicate of net.js's connect that missed all of its
  // dns / IPv6 / autoSelectFamily handling.
  const doConnect = (ip) => {
    // `tls.connect({port:0}, cb); conn.destroy()` destroys BEFORE an async lookup returns —
    // without this guard the callback then builds a socket on a dead object and hangs
    // (test-tls-client-abort). net.js's connect has the same guard.
    if (tlsSock.destroyed) return;
    const family = (ip && ip.includes(':')) ? 30 /* AF_INET6 */ : 2 /* AF_INET */;
    tlsSock._fd = tcp.socket(family);
    if (tlsSock._fd < 0) {
      process.nextTick(() => tlsSock.emit('error', new Error('socket() failed')));
      return;
    }
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

  if (net.isIP(host)) {
    doConnect(host); // literal: no resolution, matching node
  } else {
    dns.lookup(host, (err, address) => {   // no family pin — let the resolver decide
      if (tlsSock.destroyed) return;
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

function serverWrapper(options, listener) {
  return new Server(options, listener);
}
Object.setPrototypeOf(serverWrapper, Server);
serverWrapper.prototype = Server.prototype;

module.exports = {
  TLSSocket,
  Server: serverWrapper,
  connect,
  createServer,
  // Returned object must retain the options: tls.connect({secureContext}) is how several
  // tests pass `ca`, and a stub returning {} silently dropped it — the connection then had
  // no trust roots and (once verification existed) failed for a bogus reason.
  createSecureContext: (opts) => ({ ...(opts || {}) }),
  DEFAULT_MIN_VERSION: 'TLSv1.2',
  DEFAULT_MAX_VERSION: 'TLSv1.3',
  DEFAULT_CIPHERS: '',
  rootCertificates: [],
};
