// net module — TCP server/client over native POSIX sockets + kqueue
'use strict';

const EventEmitter = require('events');
const tcp = internalBinding('tcp');

const EVFILT_READ = tcp.EVFILT_READ;   // -1
const EVFILT_WRITE = tcp.EVFILT_WRITE; // -2
const EV_EOF = tcp.EV_EOF;             // 0x8000

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
    const data = tcp.recv(this._fd);
    if (data === undefined) {
      // connection closed by remote
      this.readable = false;
      this.emit('end');
      this.destroy();
    } else if (data.length > 0) {
      this.emit('data', Buffer.from(data));
    }
    // empty string = EAGAIN, ignore
  }

  write(data, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (this.destroyed) return false;
    const str = typeof data === 'string' ? data : data.toString();
    const n = tcp.send(this._fd, str);
    if (cb) process.nextTick(cb);
    return n >= 0;
  }

  end(data, encoding, cb) {
    if (typeof data === 'function') { cb = data; data = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (data !== undefined) this.write(data, encoding);
    this.writable = false;
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

  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  setTimeout() { return this; }
  ref() { return this; }
  unref() { return this; }
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
    if (connectionListener) this.on('connection', connectionListener);
  }

  listen(port, host, backlog, cb) {
    if (typeof host === 'function') { cb = host; host = '0.0.0.0'; backlog = 128; }
    if (typeof backlog === 'function') { cb = backlog; backlog = 128; }
    if (typeof port === 'object') {
      const opts = port;
      port = opts.port;
      host = opts.host || '0.0.0.0';
      backlog = opts.backlog || 128;
      cb = host;
      if (typeof opts.host === 'function') { cb = opts.host; host = '0.0.0.0'; }
    }
    if (!host) host = '0.0.0.0';
    if (!backlog) backlog = 128;
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

    // emit listening async like Node does
    process.nextTick(() => this.emit('listening'));
    return this;
  }

  _onAcceptable() {
    const clientFd = tcp.accept(this._fd);
    if (clientFd < 0) return;
    const sock = new Socket({ _fd: clientFd });
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

  ref() { return this; }
  unref() { return this; }
  getConnections(cb) { cb(null, 0); }
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

    if (filter === EVFILT_READ) {
      sock._onReadable();
    }

    if ((flags & EV_EOF) && !sock.destroyed) {
      sock.destroy();
    }
  }
  return events.length;
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

function connect(port, host, cb) {
  const sock = new Socket();
  return sock.connect(port, host, cb);
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
    if (parts.every(p => parseInt(p, 10) <= 255)) return 4;
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
        if (isIP(g) !== 4) return 0;
      } else if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return 0;
    }
    return 6;
  }
  return 0;
}

module.exports = {
  Socket,
  Server,
  createServer,
  connect,
  createConnection: connect,
  isIP,
  isIPv4: (s) => { if (typeof s !== 'string' && s != null) try { s = '' + s; } catch { return false; } return isIP(s) === 4; },
  isIPv6: (s) => { if (typeof s !== 'string' && s != null) try { s = '' + s; } catch { return false; } return isIP(s) === 6; },
  setDefaultAutoSelectFamilyAttemptTimeout: () => {},
  getDefaultAutoSelectFamilyAttemptTimeout: () => 5000,
  _pollOnce,
};
