// net module — TCP server/client over native POSIX sockets + kqueue
'use strict';

const EventEmitter = require('events');
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
class Socket extends EventEmitter {
  constructor(options) {
    super();
    this._fd = (options && options._fd) || -1;
    this.readable = true;
    this.writable = true;
    this.destroyed = false;
    this._connecting = false;
    this._readableState = { ended: false, endEmitted: false, length: 0, objectMode: false };
    this._writableState = { ended: false, finished: false, length: 0, errorEmitted: false, needDrain: false };
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.localAddress = undefined;
    this.localPort = undefined;
    // register for polling if we already have an fd
    if (this._fd >= 0) this._startReading();
  }

  _startReading() {
    ensurePoll();
    tcp.pollAdd(this._fd, EVFILT_READ);
    Socket._sockets.set(this._fd, this);
  }

  connect(port, host, cb) {
    if (typeof port === 'object') {
      const opts = port;
      cb = typeof host === 'function' ? host : cb;
      port = opts.port; host = opts.host || opts.hostname;
    }
    if (typeof host === 'function') { cb = host; host = '127.0.0.1'; }
    if (!host) host = '127.0.0.1';
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
    const data = tcp.recvBinary(this._fd);
    if (data === undefined) {
      if (this.readable) {
        this.readable = false;
        this._readableState.ended = true;
        this._readableState.endEmitted = true;
        this.emit('end');
      }
      this.destroy();
    } else if (data.length > 0) {
      this.emit('data', Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  write(data, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (this.destroyed) return false;
    let n;
    if (Buffer.isBuffer(data)) {
      n = tcp.sendBinary(this._fd, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (data instanceof Uint8Array) {
      n = tcp.sendBinary(this._fd, data);
    } else {
      const str = typeof data === 'string' ? data : String(data);
      n = tcp.send(this._fd, str);
    }
    if (cb) process.nextTick(cb);
    return n >= 0;
  }

  end(data, encoding, cb) {
    if (typeof data === 'function') { cb = data; data = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (data !== undefined) this.write(data, encoding);
    this.writable = false;
    this._writableState.ended = true;
    this._writableState.finished = true;
    if (this._fd >= 0) tcp.shutdown(this._fd, 1); // SHUT_WR
    if (cb) this.once('finish', cb);
    this.emit('finish');
    return this;
  }

  destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    this.writable = false;
    if (this._fd >= 0) {
      Socket._sockets.delete(this._fd);
      tcp.close(this._fd);
      this._fd = -1;
    }
    if (err) this.emit('error', err);
    this.emit('close', !!err);
    return this;
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
    if (cb) this.once('timeout', cb);
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
    if (ms > 0) {
      this._timeoutTimer = setTimeout(() => this.emit('timeout'), ms);
    } else {
      this._timeoutTimer = null;
    }
    return this;
  }

  cork() { this._corked = (this._corked || 0) + 1; }
  uncork() { this._corked = Math.max(0, (this._corked || 0) - 1); }

  read(size) { return null; }
  pause() { this._paused = true; return this; }
  resume() { this._paused = false; return this; }
  pipe(dest, opts) {
    this.on('data', (chunk) => dest.write(chunk));
    this.on('end', () => { if (!opts || opts.end !== false) dest.end(); });
    return dest;
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
    if (connectionListener) this.on('connection', connectionListener);
  }

  listen(port, host, backlog, cb) {
    if (typeof port === 'function') {
      cb = port; port = 0; host = '0.0.0.0'; backlog = 128;
    } else if (typeof port === 'object' && port !== null) {
      cb = typeof host === 'function' ? host : cb;
      const opts = port;
      port = opts.port;
      host = opts.host || '0.0.0.0';
      backlog = opts.backlog || 128;
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
      process.nextTick(() => this.emit('error', new Error('bind() failed on port ' + port)));
      return this;
    }

    if (tcp.listen(this._fd, backlog) !== 0) {
      tcp.close(this._fd);
      this._fd = -1;
      process.nextTick(() => this.emit('error', new Error('listen() failed')));
      return this;
    }

    this._listening = true;
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
    const sock = new Socket({ _fd: clientFd });
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
    if (cb) this.once('close', cb);
    this._listening = false;
    if (this._fd >= 0) {
      Server._servers.delete(this._fd);
      tcp.close(this._fd);
      this._fd = -1;
    }
    process.nextTick(() => this.emit('close'));
    return this;
  }

  ref() { this._unref = false; return this; }
  unref() { this._unref = true; return this; }
  getConnections(cb) { cb(null, this._connections); }
}
Server._servers = new Map();

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
      sock._onReadable();
      continue;
    }

    if (filter === EVFILT_READ) {
      sock._onReadable();
    }

    if ((flags & EV_EOF) && !sock.destroyed) {
      if (typeof sock.emit === 'function') {
        if (sock.readable) {
          sock.readable = false;
          sock.emit('end');
        }
        if (typeof sock.destroy === 'function') sock.destroy();
      } else {
        // Pipe fd — trigger _onReadable which handles EOF internally
        sock._onReadable();
      }
    }
  }
  return events.length;
}

// --- file watcher registry (used by fs.watch) ---
const _fileWatchers = new Map();

function createServer(options, connectionListener) {
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
  addAddress(address, family) {
    this._rules.push({ type: 'address', address, family: family || 'ipv4' });
  }
  addRange(start, end, family) {
    this._rules.push({ type: 'range', start, end, family: family || 'ipv4' });
  }
  addSubnet(network, prefix, family) {
    this._rules.push({ type: 'subnet', network, prefix, family: family || 'ipv4' });
  }
  check(address, family) {
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
module.exports = {
  Socket,
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
  setDefaultAutoSelectFamilyAttemptTimeout: () => {},
  getDefaultAutoSelectFamilyAttemptTimeout: () => 5000,
  setDefaultAutoSelectFamily: () => {},
  getDefaultAutoSelectFamily: () => false,
  _fileWatchers,
  _ensurePoll: ensurePoll,
  _pollOnce,
};
