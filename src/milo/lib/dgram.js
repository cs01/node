// dgram module — UDP sockets via kqueue + sendto/recvfrom
'use strict';

const EventEmitter = require('events');
const tcp = internalBinding('tcp');
const { isIP } = require('net');
// macOS values; the tcp binding is macOS-only (kqueue). Linux would be 10.
const AF_INET = 2;
const AF_INET6 = 30;
const net = require('net');
const { getSystemErrorName } = require('util');

class Socket extends EventEmitter {
  constructor(type, listener) {
    super();
    this.type = type || 'udp4';
    // createSocket('udp6') used to get an AF_INET socket: the family is fixed at socket()
    // time, so binding '::1' to it was rejected — or, before tcp.milo checked inet_pton,
    // silently became 0.0.0.0 and reported IPv4.
    this._fd = tcp.udpSocket(this.type === 'udp6' ? AF_INET6 : AF_INET);
    this._closed = false;
    this._bound = false;
    this._receiving = false;
    if (listener) this.on('message', listener);
  }

  bind(port, address, cb) {
    if (typeof port === 'object') {
      const opts = port;
      cb = address;
      port = opts.port;
      address = opts.address;
    }
    if (typeof address === 'function') { cb = address; address = undefined; }

    if (this._fd < 0) {
      this._fd = tcp.udpSocket(this.type === 'udp6' ? AF_INET6 : AF_INET);
      if (this._fd < 0) {
        process.nextTick(() => this.emit('error', new Error('socket() failed')));
        return this;
      }
    }

    // A udp6 socket's "any" is ::, not 0.0.0.0 — the family is fixed at socket() time, so
    // handing bind a v4 sockaddr for a v6 fd is rejected outright.
    const host = address || (this.type === 'udp6' ? '::' : '0.0.0.0');
    const bindPort = port || 0;

    const doBind = (ip) => {
      const r = tcp.udpBind(this._fd, bindPort, ip);
      if (r < 0) {
        const code = getSystemErrorName(r);
        const err = new Error('bind ' + code + ' ' + ip);
        err.code = code; err.errno = r; err.syscall = 'bind'; err.address = ip;
        this.emit('error', err);
        return;
      }
      this._bound = true;
      this._startReceiving();
      if (cb) cb();
      this.emit('listening');
    };

    // udpBind takes a numeric address: it builds the sockaddr with inet_pton, which does
    // not resolve names. Node resolves in JS first (lib/dgram.js does lookup4/lookup6 then
    // binds), so a hostname must be resolved here too.
    //
    // This used to "work" only by accident: inet_pton('localhost') failed, the binding
    // discarded the failure, and the zeroed address bound INADDR_ANY — which does include
    // localhost. Once the binding started reporting that failure, bind(0,'localhost')
    // errored. The silent bug was load-bearing.
    if (isIP(host)) {
      process.nextTick(() => { if (!this._closed && this._fd >= 0) doBind(host); });
    } else {
      require('dns').lookup(host, { family: this.type === 'udp6' ? 6 : 4 }, (err, ip) => {
        // Closed while resolving. The synchronous path had no such window, which is what
        // test-dgram-bind-socket-close-before-lookup and -close-in-listening check.
        if (this._closed || this._fd < 0) return;
        if (err) {
          if (!err.host) err.host = host;
          this.emit('error', err);
          return;
        }
        doBind(ip);
      });
    }
    return this;
  }

  _startReceiving() {
    if (this._receiving) return;
    this._receiving = true;
    net._ensurePoll();

    const self = this;
    const pipeObj = {
      _fd: this._fd,
      destroyed: false,
      _onReadable() {
        for (;;) {
          const result = tcp.udpRecv(self._fd);
          if (!result) break;
          self.emit('message', Buffer.from(result.data), result.rinfo);
        }
      }
    };

    net.Socket._sockets.set(this._fd, pipeObj);
    tcp.pollAdd(this._fd, tcp.EVFILT_READ);
    this._pipeObj = pipeObj;
  }

  send(msg, offset, length, port, address, cb) {
    if (msg === undefined || (typeof msg !== 'string' && !Buffer.isBuffer(msg) && !ArrayBuffer.isView(msg) && !(msg instanceof ArrayBuffer) && !Array.isArray(msg))) {
      let recv;
      if (msg === undefined) recv = 'undefined';
      else if (msg === null) recv = 'null';
      else if (typeof msg === 'object') recv = 'an instance of ' + (msg.constructor?.name || 'Object');
      else recv = 'type ' + typeof msg + ' (' + String(msg) + ')';
      const e = new TypeError('The "buffer" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ' + recv);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof offset === 'number' && typeof length === 'number' && typeof port === 'number') {
      if (this._connected) {
        const e = new Error('Already connected');
        e.code = 'ERR_SOCKET_DGRAM_IS_CONNECTED'; throw e;
      }
      if (port < 1 || port > 65535 || !Number.isInteger(port)) {
        const e = new RangeError('Port should be > 0 and < 65536. Received ' + port);
        e.code = 'ERR_SOCKET_BAD_PORT'; throw e;
      }
      const msgLen = typeof msg === 'string' ? Buffer.byteLength(msg) : msg.length || msg.byteLength;
      if (offset < 0 || offset >= msgLen) {
        const e = new RangeError('"offset" is outside of buffer bounds');
        e.code = 'ERR_BUFFER_OUT_OF_BOUNDS'; throw e;
      }
      if (length < 0 || offset + length > msgLen) {
        const e = new RangeError('"length" is outside of buffer bounds');
        e.code = 'ERR_BUFFER_OUT_OF_BOUNDS'; throw e;
      }
      msg = typeof msg === 'string' ? msg.substring(offset, offset + length) : msg.slice(offset, offset + length);
    } else if (typeof offset === 'number' && typeof length === 'string') {
      // send(msg, port, address, cb)
      cb = port;
      address = length;
      port = offset;
    } else if (typeof offset === 'number' && typeof length === 'function') {
      // send(msg, port, cb) — connected mode
      cb = length;
      port = offset;
      address = undefined;
    } else if (typeof offset === 'function') {
      // send(msg, cb) — connected mode
      cb = offset;
      port = undefined;
      address = undefined;
    } else if (typeof offset === 'undefined') {
      // send(msg) — connected mode
    } else {
      cb = address;
      address = port;
      port = offset;
    }

    if (typeof address === 'function') { cb = address; address = undefined; }

    if (this._connected) {
      if (port !== undefined && address !== undefined) {
        const e = new Error('Already connected');
        e.code = 'ERR_SOCKET_DGRAM_IS_CONNECTED'; throw e;
      }
      if (port === undefined) port = this._remotePort;
      if (address === undefined) address = this._remoteAddress;
    }
    address = address || '127.0.0.1';

    if (!this._bound) {
      this._fd = tcp.udpSocket(this.type === 'udp6' ? AF_INET6 : AF_INET);
      if (this._fd < 0) {
        if (cb) cb(new Error('socket() failed'));
        return;
      }
    }

    // Handle array of buffers — validate each element
    if (Array.isArray(msg)) {
      for (const item of msg) {
        if (typeof item !== 'string' && !Buffer.isBuffer(item) && !ArrayBuffer.isView(item)) {
          const e = new TypeError('The "buffer list arguments" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of Array');
          e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
        }
      }
      msg = Buffer.concat(msg.map(b => Buffer.isBuffer(b) ? b : Buffer.from(b)));
    }
    const buf = typeof msg === 'string' ? Buffer.from(msg) : (Buffer.isBuffer(msg) ? msg : Buffer.from(msg));
    // buf.toString() ran binary through utf8: every invalid byte became U+FFFD and the
    // payload was corrupted on the wire (verified: 8 binary bytes arrived as 19). Send the
    // raw bytes.
    const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = tcp.udpSendBinary(this._fd, view, port, address);
    if (cb) process.nextTick(() => cb(n < 0 ? new Error('send failed') : null));
  }

  connect(port, address, cb) {
    if (typeof address === 'function') { cb = address; address = undefined; }
    if (port == null || port === 0 || port >= 65536 || (typeof port === 'number' && !Number.isInteger(port))) {
      const e = new RangeError('Port should be > 0 and < 65536. Received ' + (port === undefined ? 'undefined' : port));
      e.code = 'ERR_SOCKET_BAD_PORT'; throw e;
    }
    if (this._connected || this._connectPending) {
      const e = new Error('Already connected');
      e.code = 'ERR_SOCKET_DGRAM_IS_CONNECTED'; throw e;
    }
    this._connectPending = true;
    if (!this._bound) {
      this._fd = tcp.udpSocket(this.type === 'udp6' ? AF_INET6 : AF_INET);
      if (this._fd < 0) {
        this._connectPending = false;
        const err = new Error('socket() failed');
        if (cb) cb(err); else this.emit('error', err);
        return;
      }
      tcp.udpBind(this._fd, 0, '0.0.0.0');
      this._bound = true;
      this._startReceiving();
    }
    process.nextTick(() => {
      this._connectPending = false;
      this._remotePort = port;
      this._remoteAddress = address || '127.0.0.1';
      this._connected = true;
      if (cb) cb();
      this.emit('connect');
    });
  }

  disconnect() {
    if (!this._connected) {
      const e = new Error('Not connected');
      e.code = 'ERR_SOCKET_DGRAM_NOT_CONNECTED'; throw e;
    }
    this._remotePort = undefined;
    this._remoteAddress = undefined;
    this._connected = false;
  }

  remoteAddress() {
    if (!this._connected) {
      const e = new Error('Not connected');
      e.code = 'ERR_SOCKET_DGRAM_NOT_CONNECTED'; throw e;
    }
    return { address: this._remoteAddress, family: this.type === 'udp6' ? 'IPv6' : 'IPv4', port: this._remotePort };
  }

  close(cb) {
    if (this._fd >= 0) {
      if (this._receiving) {
        net.Socket._sockets.delete(this._fd);
      }
      tcp.close(this._fd);
      this._fd = -1;
    }
    this._closed = true;
    this._bound = false;
    this._receiving = false;
    if (cb) this.once('close', cb);
    process.nextTick(() => this.emit('close'));
    return this;
  }

  address() {
    if (this._fd < 0 || !this._bound) throw new Error('getsockname EBADF');
    const info = tcp.getSockName(this._fd);
    // getSockName reports the socket's real family; this used to overwrite it with
    // 'IPv4', so a udp6 socket bound to ::1 still answered IPv4.
    return { address: info.address, port: info.port, family: info.family };
  }

  sendto(buffer, offset, length, port, address, cb) {
    if (typeof offset !== 'number') {
      const v = offset === undefined ? 'undefined' : "type " + typeof offset + " ('" + offset + "')";
      const e = new TypeError('The "offset" argument must be of type number. Received ' + v);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof length !== 'number') {
      const v = length === undefined ? 'undefined' : "type " + typeof length + " ('" + length + "')";
      const e = new TypeError('The "length" argument must be of type number. Received ' + v);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof port !== 'number') {
      const v = typeof port === 'boolean' ? 'type boolean (' + port + ')' : "type " + typeof port + " ('" + port + "')";
      const e = new TypeError('The "port" argument must be of type number. Received ' + v);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof address !== 'string') {
      const v = typeof address === 'boolean' ? 'type boolean (' + address + ')' : 'type ' + typeof address;
      const e = new TypeError('The "address" argument must be of type string. Received ' + v);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this.send(buffer, offset, length, port, address, cb);
  }

  setBroadcast(flag) { if (this._fd >= 0) tcp.udpSetOpt(this._fd, 1, flag ? 1 : 0); }
  setTTL(ttl) { if (this._fd >= 0) tcp.udpSetOpt(this._fd, 2, ttl); }
  setMulticastTTL(ttl) { if (this._fd >= 0) tcp.udpSetOpt(this._fd, 3, ttl); }
  addMembership(mcast, iface) {
    if (mcast === undefined) { const e = new TypeError('The "multicastAddress" argument must be specified'); e.code = 'ERR_MISSING_ARGS'; throw e; }
    if (this._closed) { const e = new Error('Not running'); e.code = 'ERR_SOCKET_DGRAM_NOT_RUNNING'; throw e; }
    const r = tcp.udpAddMembership(this._fd, mcast, iface || '');
    if (r < 0) throw new Error('addMembership EINVAL');
  }
  dropMembership(mcast, iface) {
    if (mcast === undefined) { const e = new TypeError('The "multicastAddress" argument must be specified'); e.code = 'ERR_MISSING_ARGS'; throw e; }
    if (this._closed) { const e = new Error('Not running'); e.code = 'ERR_SOCKET_DGRAM_NOT_RUNNING'; throw e; }
    const r = tcp.udpDropMembership(this._fd, mcast, iface || '');
    if (r < 0) throw new Error('dropMembership EINVAL');
  }
  setMulticastLoopback() {}
  ref() { return this; }
  unref() { return this; }
  setRecvBufferSize() {}
  setSendBufferSize() {}
  getRecvBufferSize() { return 65536; }
  getSendBufferSize() { return 65536; }
}

function createSocket(options, listener) {
  if (typeof options === 'string') options = { type: options };
  else if (options == null || typeof options !== 'object') options = {};
  if (options.signal !== undefined && (options.signal === null || typeof options.signal !== 'object' || !('aborted' in options.signal))) {
    const e = new TypeError('The "options.signal" property must be an instance of AbortSignal. Received ' + (options.signal === null ? 'null' : typeof options.signal === 'object' ? 'an instance of ' + (options.signal.constructor?.name || 'Object') : 'type ' + typeof options.signal + ' (' + options.signal + ')'));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  const type = options.type;
  if (type !== 'udp4' && type !== 'udp6') {
    const e = new TypeError(`Bad socket type specified. Valid types are: udp4, udp6`);
    e.code = 'ERR_SOCKET_BAD_TYPE'; throw e;
  }
  const socket = new Socket(type, listener);
  if (options.signal) {
    if (options.signal.aborted) {
      process.nextTick(() => socket.close());
    } else {
      const onAbort = () => socket.close();
      options.signal.addEventListener('abort', onAbort, { once: true });
      socket.once('close', () => options.signal.removeEventListener('abort', onAbort));
    }
  }
  return socket;
}

module.exports = { createSocket, Socket };
