// net module — TCP server/client over native POSIX sockets + kqueue
'use strict';

const EventEmitter = require('events');
const { Duplex } = require('stream');
const tcp = internalBinding('tcp');

const EVFILT_READ = tcp.EVFILT_READ;   // -1
const EVFILT_WRITE = tcp.EVFILT_WRITE; // -2
const EV_EOF = tcp.EV_EOF;             // 0x8000
const EVFILT_VNODE = -4;

let pollInited = false;
function ensurePoll() {
  if (!pollInited) {
    tcp.pollInit();
    pollInited = true;
  }
}

// --- Socket ---
class Socket extends Duplex {
  constructor(options) {
    if (options) {
      for (const key of ['objectMode', 'readableObjectMode', 'writableObjectMode']) {
        if (options[key] !== undefined) {
          const e = new TypeError(`The property 'options.${key}' is not supported. Received ${String(options[key])}`);
          e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
        }
      }
    }
    super({ allowHalfOpen: (options && options.allowHalfOpen) || false });
    if (options && options.fd !== undefined) {
      if (typeof options.fd !== 'number') {
        const e = new TypeError(`The "options.fd" property must be of type number. Received type ${typeof options.fd}`);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      if (options.fd < 0) {
        const e = new RangeError(`The value of "options.fd" is out of range. It must be >= 0. Received ${options.fd}`);
        e.code = 'ERR_OUT_OF_RANGE'; throw e;
      }
    }
    this._fd = (options && (options._fd !== undefined ? options._fd : options.fd)) || -1;
    this._connecting = false;
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.localAddress = undefined;
    this.localPort = undefined;
    if (this._fd >= 0) this._startReading();
  }

  _startReading() {
    ensurePoll();
    tcp.pollAdd(this._fd, EVFILT_READ);
    Socket._sockets.set(this._fd, this);
  }

  connect(port, host, cb) {
    if (port === undefined && host === undefined && cb === undefined) {
      const e = new TypeError('The "options" or "port" or "path" argument must be specified');
      e.code = 'ERR_MISSING_ARGS'; throw e;
    }
    let isPipe = false;
    if (typeof port === 'object') {
      const opts = port;
      if (opts !== null && opts.port === undefined && opts.path === undefined) {
        const e = new TypeError('The "options" or "port" or "path" argument must be specified');
        e.code = 'ERR_MISSING_ARGS'; throw e;
      }
      cb = typeof host === 'function' ? host : cb;
      for (const key of ['objectMode', 'readableObjectMode', 'writableObjectMode']) {
        if (opts[key] !== undefined) {
          const e = new TypeError(`The property 'options.${key}' is not supported. Received ${String(opts[key])}`);
          e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
        }
      }
      if (opts.host !== undefined && typeof opts.host !== 'string') {
        const e = new TypeError('The "options.host" property must be of type string. Received type ' + typeof opts.host);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      if (opts.hints !== undefined && opts.hints !== 0) {
        const e = new TypeError(`The argument 'hints' is invalid. Received ${opts.hints}`);
        e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
      }
      if (opts.path) isPipe = true;
      port = opts.port; host = opts.host || opts.hostname;
    } else if (typeof port === 'string' && !Number.isFinite(+port)) {
      isPipe = true;
    }
    if (isPipe) { const e = new Error('Pipe/Unix sockets not yet implemented'); e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'; throw e; }
    if (typeof host === 'function') { cb = host; host = '127.0.0.1'; }
    if (!host) host = '127.0.0.1';
    if (port !== undefined && typeof port !== 'number' && typeof port !== 'string') {
      const e = new TypeError(`The "options.port" option must be of type number or string. Received type ${typeof port} (${String(port)})`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    const _validatePort = require('internal/validators').validatePort;
    port = _validatePort(port, 'options.port');
    if (cb) this.once('connect', cb);
    this._connecting = true;

    ensurePoll();
    this._fd = tcp.socket();
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('socket() failed')));
      return this;
    }

    const r = tcp.connect(this._fd, host, port);
    // connect returns 0 or EINPROGRESS (-36 on macOS)
    // watch for write-ready to know when connected
    tcp.pollAdd(this._fd, EVFILT_WRITE);
    Socket._sockets.set(this._fd, this);
    this.remoteAddress = host;
    this.remotePort = port;
    return this;
  }

  _onConnected() {
    this._connecting = false;
    tcp.pollRemove(this._fd, EVFILT_WRITE);
    this._startReading();
    this.emit('connect');
  }

  _onReadable() {
    if (this.destroyed) return;
    const data = tcp.recvBinary(this._fd);
    if (data === undefined) {
      this.push(null);
    } else if (data.length > 0) {
      this.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  _write(data, encoding, cb) {
    if (this._peerDisconnected) { const e = new Error('write ECONNRESET'); e.code = 'ECONNRESET'; cb(e); return; }
    if (this._fd < 0) { cb(new Error('Socket is closed')); return; }
    let buf;
    if (Buffer.isBuffer(data)) buf = data;
    else if (data instanceof Uint8Array) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else buf = Buffer.from(typeof data === 'string' ? data : String(data), encoding);
    let offset = 0;
    while (offset < buf.length) {
      const chunk = new Uint8Array(buf.buffer, buf.byteOffset + offset, buf.length - offset);
      const n = tcp.sendBinary(this._fd, chunk);
      if (n < 0) { cb(new Error('write failed')); return; }
      if (n === 0) { cb(new Error('write failed')); return; }
      offset += n;
    }
    cb();
  }

  _read(size) {
    // Data is pushed from _onReadable via kqueue events, not pulled
  }

  _final(cb) {
    if (this._fd >= 0) tcp.shutdown(this._fd, 1); // SHUT_WR
    cb();
  }

  _destroy(err, cb) {
    if (this._fd >= 0) {
      Socket._sockets.delete(this._fd);
      try { tcp.pollRemove(this._fd, EVFILT_READ); } catch {}
      try { tcp.pollRemove(this._fd, EVFILT_WRITE); } catch {}
      tcp.close(this._fd);
      this._fd = -1;
    }
    cb(err);
  }

  address() {
    if (this._fd < 0) return {};
    return tcp.getSockName(this._fd) || {};
  }

  setNoDelay(noDelay) {
    if (this._fd >= 0) tcp.setNoDelay(this._fd, noDelay !== false ? 1 : 0);
    return this;
  }

  setKeepAlive(enable, initialDelay) {
    if (this._fd >= 0) tcp.setKeepAlive(this._fd, enable ? 1 : 0);
    return this;
  }

  setTimeout(ms, cb) {
    if (typeof ms !== 'number') {
      const e = new TypeError(`The "msecs" argument must be of type number. Received type ${typeof ms}` + (typeof ms !== 'undefined' ? ` (${String(ms)})` : ''));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (ms < 0 || !Number.isFinite(ms)) {
      const e = new RangeError(`The value of "msecs" is out of range. It must be a non-negative finite number. Received ${ms}`);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    if (cb !== undefined && typeof cb !== 'function') {
      const e = new TypeError(`The "callback" argument must be of type function. Received type ${typeof cb}` + (typeof cb === 'symbol' ? '' : ` (${String(cb)})`));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (cb) this.once('timeout', cb);
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
    if (ms > 0) {
      this._timeoutTimer = setTimeout(() => this.emit('timeout'), ms);
    } else {
      this._timeoutTimer = null;
    }
    return this;
  }


  ref() { this._unref = false; return this; }
  unref() { this._unref = true; return this; }

  resetAndDestroy() {
    // RST instead of FIN — sets SO_LINGER with 0 timeout
    if (this._fd >= 0) {
      try { tcp.setLinger(this._fd, 1, 0); } catch {}
    }
    return this.destroy();
  }

  get readyState() {
    if (this._connecting) return 'opening';
    if (this.readable && this.writable) return 'open';
    if (this.readable && !this.writable) return 'readOnly';
    if (!this.readable && this.writable) return 'writeOnly';
    return 'closed';
  }

  get pending() { return this._connecting || this._fd < 0; }
  get connecting() { return this._connecting; }

  get bytesRead() { return this._bytesRead || 0; }
  get bytesWritten() { return this._bytesWritten || 0; }
}
Socket._sockets = new Map();

// --- Server ---
class Server extends EventEmitter {
  constructor(options, connectionListener) {
    super();
    if (typeof options === 'function') {
      connectionListener = options;
      options = {};
    }
    this._fd = -1;
    this._listening = false;
    this._connections = 0;
    this.allowHalfOpen = options && options.allowHalfOpen || false;
    if (connectionListener) this.on('connection', connectionListener);
  }

  listen(port, host, backlog, cb) {
    if (typeof port === 'function') {
      cb = port; port = 0; host = '0.0.0.0'; backlog = 128;
    } else if (typeof port === 'object' && port !== null) {
      cb = typeof host === 'function' ? host : cb;
      const opts = port;
      if (opts.path) {
        // Unix socket / pipe path
        if (cb) this.once('listening', cb);
        const e = new Error('Pipe/Unix sockets not yet implemented');
        e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM';
        process.nextTick(() => this.emit('error', e));
        return this;
      }
      port = opts.port;
      host = opts.host || '0.0.0.0';
      backlog = opts.backlog || 128;
    } else if (typeof port === 'string' && !Number.isFinite(+port)) {
      // Pipe path as first arg: listen('/tmp/sock')
      if (typeof host === 'function') cb = host;
      if (cb) this.once('listening', cb);
      const e = new Error('Pipe/Unix sockets not yet implemented');
      e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM';
      process.nextTick(() => this.emit('error', e));
      return this;
    } else {
      if (typeof host === 'function') { cb = host; host = '0.0.0.0'; backlog = 128; }
      if (typeof backlog === 'function') { cb = backlog; backlog = 128; }
    }
    if (!host) host = '0.0.0.0';
    if (!backlog) backlog = 128;
    if (port !== undefined && port !== null && port !== '') {
      port = +port;
      if (Number.isNaN(port) || port !== (port >>> 0) || port > 65535) {
        const e = new RangeError(`options.port should be >= 0 and < 65536. Received ${port}.`);
        e.code = 'ERR_SOCKET_BAD_PORT'; throw e;
      }
    } else {
      port = 0;
    }
    if (cb) this.once('listening', cb);

    ensurePoll();
    this._fd = tcp.socket();
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('socket() failed')));
      return this;
    }

    if (tcp.bind(this._fd, host, port) !== 0) {
      tcp.close(this._fd);
      this._fd = -1;
      const err = new Error('bind EADDRINUSE 0.0.0.0:' + port);
      err.code = 'EADDRINUSE'; err.errno = -48; err.syscall = 'bind'; err.address = '0.0.0.0'; err.port = port;
      process.nextTick(() => this.emit('error', err));
      return this;
    }

    if (tcp.listen(this._fd, backlog) !== 0) {
      tcp.close(this._fd);
      this._fd = -1;
      process.nextTick(() => this.emit('error', new Error('listen() failed')));
      return this;
    }

    this._listening = true;
    this._handle = { fd: this._fd };
    tcp.pollAdd(this._fd, EVFILT_READ);
    Server._servers.set(this._fd, this);
    const addr = this.address();
    if (addr) this._connectionKey = `${addr.family === 'IPv6' ? '6' : '4'}:${addr.address}:${addr.port}`;

    // emit listening async like Node does
    process.nextTick(() => this.emit('listening'));
    return this;
  }

  _onAcceptable() {
    const clientFd = tcp.accept(this._fd);
    if (clientFd < 0) return;
    const sock = new Socket({ _fd: clientFd, allowHalfOpen: this.allowHalfOpen });
    sock._server = this;
    const peer = tcp.getPeerName(clientFd);
    if (peer) { sock.remoteAddress = peer.address; sock.remotePort = peer.port; sock.remoteFamily = peer.family; }
    this._connections++;
    sock.on('close', () => this._connections--);
    this.emit('connection', sock);
  }

  address() {
    if (this._fd < 0) return null;
    return tcp.getSockName(this._fd);
  }

  close(cb) {
    if (typeof cb === 'function') this.once('close', cb);
    this._listening = false;
    this._handle = null;
    if (this._fd >= 0) {
      Server._servers.delete(this._fd);
      try { tcp.pollRemove(this._fd, EVFILT_READ); } catch {}
      tcp.close(this._fd);
      this._fd = -1;
    }
    process.nextTick(() => this.emit('close'));
    return this;
  }

  get listening() { return this._listening; }

  ref() { this._unref = false; return this; }
  unref() { this._unref = true; return this; }
  getConnections(cb) { cb(null, this._connections); }
}
Server._servers = new Map();

function _emitSocketError(sock, e) {
  if (typeof sock.listenerCount === 'function' && sock.listenerCount('error') > 0) { sock.emit('error', e); return; }
  const handlers = process.listeners && process.listeners('uncaughtException');
  if (handlers && handlers.length > 0) process.emit('uncaughtException', e);
  else { console.error(e); if (typeof sock.destroy === 'function') sock.destroy(); }
}

// --- I/O pump called from event loop ---
function _pollOnce(timeout) {
  if (!pollInited) return 0;
  const events = tcp.pollWait(timeout);
  if (!events || events.length === 0) return 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const fd = ev.fd;
    const filter = ev.filter;
    const flags = ev.flags;

    // file watcher vnode events
    if (filter === EVFILT_VNODE) {
      const watcher = _fileWatchers.get(fd);
      if (watcher) watcher._onEvent(ev.fflags || 0, fd);
      continue;
    }

    // server accept
    const server = Server._servers.get(fd);
    if (server && filter === EVFILT_READ) {
      server._onAcceptable();
      continue;
    }

    const sock = Socket._sockets.get(fd);
    if (!sock) continue;

    if (sock._connecting && filter === EVFILT_WRITE) {
      sock._onConnected();
      continue;
    }

    // TLS handshake needs both read and write events
    if (filter === EVFILT_WRITE && (sock._pendingTlsConnect || sock._pendingTlsAccept)) {
      try { sock._onReadable(); } catch (e) { _emitSocketError(sock, e); }
      continue;
    }

    if (filter === EVFILT_READ) {
      try { sock._onReadable(); } catch (e) { _emitSocketError(sock, e); }
    }

    if ((flags & EV_EOF) && !sock.destroyed && sock._readableState && !sock._readableState.ended) {
      while (!sock.destroyed && !sock._readableState.ended) {
        const data = tcp.recvBinary(sock._fd);
        if (data === undefined || data.length === 0) break;
        sock.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      }
      if (!sock.destroyed && !sock._readableState.ended) sock.push(null);
    }
  }
  return events.length;
}

// --- file watcher registry (used by fs.watch) ---
const _fileWatchers = new Map();

function createServer(options, connectionListener) {
  if (typeof options === 'function') {
    connectionListener = options;
    options = undefined;
  }
  if (options !== undefined && options !== null && typeof options !== 'object') {
    const e = new TypeError('The "options" argument must be of type object. Received type ' + typeof options + ' (' + JSON.stringify(options) + ')');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  return new Server(options, connectionListener);
}

function connect(...args) {
  const sock = new Socket();
  return sock.connect(...args);
}

function isIP(s) {
  if (typeof s !== 'string') {
    if (s != null && typeof s === 'object') try { s = '' + s; } catch { return 0; }
    else return 0;
  }
  if (s === '') return 0;
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
    const parts = s.split('.');
    if (parts.every(p => (p.length === 1 || p[0] !== '0') && parseInt(p, 10) <= 255)) return 4;
    return 0;
  }
  // IPv6
  if (s.includes(':')) {
    // strip zone ID (e.g. %eth0) — only alphanumeric and dots allowed after %
    let zone = '';
    const pctIdx = s.indexOf('%');
    if (pctIdx >= 0) {
      zone = s.slice(pctIdx + 1);
      if (!zone || /[^a-zA-Z0-9.]/.test(zone)) return 0;
      s = s.slice(0, pctIdx);
    }
    // no leading/trailing single colons (but :: is ok)
    if (/^:[^:]/.test(s) || /[^:]:$/.test(s)) return 0;
    // no triple colons
    if (s.includes(':::')) return 0;
    // no leading IPv4 (1.2.3.4:: is invalid)
    if (/^\d+\.\d+/.test(s)) return 0;
    // at most one :: group
    const dcs = s.split('::');
    if (dcs.length > 2) return 0;
    // split into groups
    const groups = s.split(':').filter(g => g !== '');
    if (dcs.length === 2) {
      const hasV4 = groups.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(groups[groups.length - 1]);
      const maxGroups = hasV4 ? 6 : 7;
      if (groups.length > maxGroups) return 0;
    } else {
      const hasV4 = groups.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(groups[groups.length - 1]);
      if (hasV4) { if (groups.length !== 7) return 0; }
      else { if (groups.length !== 8) return 0; }
    }
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (i === groups.length - 1 && /^\d+\.\d+\.\d+\.\d+$/.test(g)) {
        const v4parts = g.split('.');
        if (!v4parts.every(p => (p.length === 1 || p[0] !== '0') && parseInt(p, 10) <= 255)) return 0;
      } else if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return 0;
    }
    return 6;
  }
  return 0;
}

class SocketAddress {
  constructor(options) {
    if (typeof options === 'string') options = { address: options };
    this.address = options.address || '127.0.0.1';
    this.port = options.port || 0;
    this.family = options.family || (isIP(this.address) === 6 ? 'IPv6' : 'IPv4');
    this.flowlabel = options.flowlabel || 0;
  }
}

class BlockList {
  constructor() { this._rules = []; }
  _validateAddress(address, name) {
    if (typeof address !== 'string') {
      const recv = address === undefined ? 'undefined' : address === null ? 'null' : typeof address === 'object' ? 'an instance of ' + (address.constructor?.name || 'Object') : 'type ' + typeof address + ' (' + (typeof address === 'bigint' ? String(address) + 'n' : String(address)) + ')';
      const e = new TypeError('The "' + name + '" argument must be of type string. Received ' + recv);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
  }
  _validateFamily(family) {
    if (family !== undefined) {
      if (typeof family !== 'string') {
        const recv = family === null ? 'null' : typeof family === 'object' ? 'an instance of ' + (family.constructor?.name || 'Object') : 'type ' + typeof family + ' (' + (typeof family === 'bigint' ? String(family) + 'n' : String(family)) + ')';
        const e = new TypeError('The "family" argument must be of type string. Received ' + recv);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      const f = family.toLowerCase();
      if (f !== 'ipv4' && f !== 'ipv6') {
        const e = new TypeError('The argument \'family\' must be one of: ipv4, ipv6. Received \'' + family + '\'');
        e.code = 'ERR_INVALID_ARG_VALUE'; throw e;
      }
    }
  }
  addAddress(address, family) {
    this._validateAddress(address, 'address');
    this._validateFamily(family);
    this._rules.push({ type: 'address', address, family: family || 'ipv4' });
  }
  addRange(start, end, family) {
    this._validateAddress(start, 'start');
    this._validateAddress(end, 'end');
    this._validateFamily(family);
    this._rules.push({ type: 'range', start, end, family: family || 'ipv4' });
  }
  addSubnet(network, prefix, family) {
    this._validateAddress(network, 'network');
    if (typeof prefix !== 'number') {
      const recv = prefix === undefined ? 'undefined' : prefix === null ? 'null' : 'type ' + typeof prefix;
      const e = new TypeError('The "prefix" argument must be of type number. Received ' + recv);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this._validateFamily(family);
    this._rules.push({ type: 'subnet', network, prefix, family: family || 'ipv4' });
  }
  check(address, family) {
    if (typeof address !== 'string') {
      const recv = address === undefined ? 'undefined' : address === null ? 'null' : typeof address === 'object' ? 'an instance of ' + (address.constructor?.name || 'Object') : 'type ' + typeof address;
      const e = new TypeError('The "address" argument must be of type string. Received ' + recv);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    for (const rule of this._rules) {
      if (rule.type === 'address' && rule.address === address) return true;
      if (rule.type === 'range') {
        const a = _ipToNum(address), s = _ipToNum(rule.start), e = _ipToNum(rule.end);
        if (a >= s && a <= e) return true;
      }
      if (rule.type === 'subnet') {
        const mask = ~((1 << (32 - rule.prefix)) - 1) >>> 0;
        if ((_ipToNum(address) & mask) === (_ipToNum(rule.network) & mask)) return true;
      }
    }
    return false;
  }
  get rules() { return [...this._rules]; }
}

function _ipToNum(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

const _Server = new Proxy(Server, { apply(target, _, args) { return new target(...args); } });
const _Socket = new Proxy(Socket, { apply(target, _, args) { return new target(...args); } });
module.exports = {
  Socket: _Socket,
  Stream: _Socket,
  Server: _Server,
  createServer,
  connect,
  createConnection: connect,
  isIP,
  isIPv4: (s) => { if (typeof s !== 'string' && s != null) try { s = '' + s; } catch { return false; } return isIP(s) === 4; },
  isIPv6: (s) => { if (typeof s !== 'string' && s != null) try { s = '' + s; } catch { return false; } return isIP(s) === 6; },
  SocketAddress,
  BlockList,
  isLoopback: (addr) => addr === '127.0.0.1' || addr === '::1' || addr === 'localhost' || (addr && addr.startsWith('127.')),
  setDefaultAutoSelectFamilyAttemptTimeout: (v) => { module.exports._autoSelectTimeout = v; },
  getDefaultAutoSelectFamilyAttemptTimeout: () => module.exports._autoSelectTimeout || 2500,
  setDefaultAutoSelectFamily: () => {},
  getDefaultAutoSelectFamily: () => false,
  _normalizeArgs: function(args) {
    let arr;
    if (args.length === 0) return [{}, null];
    const arg0 = args[0];
    let options = {};
    if (typeof arg0 === 'object' && arg0 !== null) options = arg0;
    else if (typeof arg0 === 'number') options.port = arg0;
    else if (typeof arg0 === 'string') options.path = arg0;
    const last = args[args.length - 1];
    const cb = typeof last === 'function' ? last : null;
    if (args.length > 1 && typeof args[1] === 'string') options.host = args[1];
    arr = [options, cb];
    arr[Symbol('normalizedArgs')] = true;
    return arr;
  },
  _fileWatchers,
  _ensurePoll: ensurePoll,
  _pollOnce,
};
