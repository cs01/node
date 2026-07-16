// net module — TCP server/client over native POSIX sockets + kqueue
'use strict';

const EventEmitter = require('events');
const { Duplex } = require('stream');
const tcp = internalBinding('tcp');

const EVFILT_READ = tcp.EVFILT_READ;   // -1
const EVFILT_WRITE = tcp.EVFILT_WRITE; // -2
const EV_EOF = tcp.EV_EOF;             // 0x8000
const EVFILT_VNODE = -4;
const EAGAIN = -35; // darwin EAGAIN, returned negated by nm_write

function _writeError(n) {
  const code = _CONNECT_ERRNO[-n] || (n === -32 ? 'EPIPE' : 'UNKNOWN');
  const e = new Error(`write ${code}`);
  e.code = code; e.errno = n; e.syscall = 'write';
  return e;
}

// darwin errno → Node error code, for connect() failures surfaced via SO_ERROR
const _CONNECT_ERRNO = {
  13: 'EACCES', 47: 'EAFNOSUPPORT', 48: 'EADDRINUSE', 49: 'EADDRNOTAVAIL',
  51: 'ENETUNREACH', 54: 'ECONNRESET', 60: 'ETIMEDOUT', 61: 'ECONNREFUSED',
  64: 'EHOSTDOWN', 65: 'EHOSTUNREACH',
};

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
    // _handle tracks the live fd: an object while open, null once closed. Node tests
    // assert `socket._handle === null` after 'close' (undefined would fail strictEqual).
    this._handle = this._fd >= 0 ? { fd: this._fd } : null;
    this._connecting = false;
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.localAddress = undefined;
    this.localPort = undefined;
    if (this._fd >= 0) this._startReading();
  }

  _startReading() {
    ensurePoll();
    this._readPollRemoved = false; // re-registering: a stale flag would suppress the dereg
    tcp.pollAdd(this._fd, EVFILT_READ);
    Socket._sockets.set(this._fd, this);
  }

  connect(port, host, cb) {
    if (port === undefined && host === undefined && cb === undefined) {
      const e = new TypeError('The "options" or "port" or "path" argument must be specified');
      e.code = 'ERR_MISSING_ARGS'; throw e;
    }
    let isPipe = false;
    let _signalOpt;
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
      _signalOpt = opts.signal; // capture before `port` is overwritten below
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
    // NOTE: `port` is reassigned to opts.port above, so the signal must be captured from
    // the options object while it is still in scope (_signalOpt), not re-read from `port`.
    const _signal = _signalOpt;
    if (_signal) {
      if (typeof _signal !== 'object' || typeof _signal.addEventListener !== 'function') {
        const e = new TypeError(`The "options.signal" property must be an instance of AbortSignal. Received ${typeof _signal}`);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      const onAbort = () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError'; err.code = 'ABORT_ERR';
        this.destroy(err);
      };
      if (_signal.aborted) process.nextTick(onAbort);
      else _signal.addEventListener('abort', onAbort, { once: true });
    }
    this._connecting = true;

    ensurePoll();
    this._fd = tcp.socket();
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('socket() failed')));
      return this;
    }
    this._handle = { fd: this._fd };

    const r = tcp.connect(this._fd, host, port);
    // connect returns 0 or EINPROGRESS (-36 on macOS)
    // watch for write-ready to know when connected
    tcp.pollAdd(this._fd, EVFILT_WRITE);
    Socket._sockets.set(this._fd, this);
    this.remoteAddress = host;
    this.remotePort = port;
    return this;
  }

  _onConnected(ev) {
    this._connecting = false;
    tcp.pollRemove(this._fd, EVFILT_WRITE);
    // A failed non-blocking connect also makes the socket write-ready. On
    // macOS it surfaces as EV_EOF on the write event with the errno in
    // ev.data (getsockopt(SO_ERROR) is unreliable — kqueue consumes the
    // pending error). Fall back to SO_ERROR, then to ECONNREFUSED.
    // EV_EOF on a connecting socket's write event means the connect failed.
    // The specific errno is unreliable on macOS (kqueue consumes SO_ERROR and
    // leaves fflags=0), so prefer SO_ERROR when nonzero, else default to the
    // dominant case, ECONNREFUSED.
    let soErr = 0;
    if (ev && (ev.flags & EV_EOF)) {
      soErr = (tcp.soError ? tcp.soError(this._fd) : 0) || 61;
    } else if (tcp.soError) {
      soErr = tcp.soError(this._fd);
    }
    if (soErr > 0) {
      const code = _CONNECT_ERRNO[soErr] || ('UNKNOWN');
      const e = new Error(`connect ${code} ${this.remoteAddress}:${this.remotePort}`);
      e.code = code; e.errno = -soErr; e.syscall = 'connect';
      e.address = this.remoteAddress; e.port = this.remotePort;
      this.destroy(e);
      return;
    }
    this._startReading();
    this.emit('connect');
    // node emits 'ready' immediately after 'connect' (lib/net.js:1690-1691). It was missing
    // entirely, so anything gated on socket.on('ready') — a common test idiom — never ran.
    this.emit('ready');
  }

  // Once the peer's FIN is seen, no further read event can be meaningful. The kqueue is
  // level-triggered, so leaving the fd registered makes every pollWait return EV_EOF
  // immediately -> the loop busy-spins and OOMs. Deregister reads exactly once; the fd
  // stays open for writing until _destroy.
  _stopReading() {
    if (this._readPollRemoved) return;
    this._readPollRemoved = true;
    if (this._fd >= 0) { try { tcp.pollRemove(this._fd, EVFILT_READ); } catch {} }
  }

  _onReadable() {
    if (this.destroyed) return;
    if (this._timeoutMs > 0) this._armTimeout(); // activity resets the idle timer
    const data = tcp.recvBinary(this._fd);
    if (data === undefined) {
      this.push(null);
      this._stopReading();
    } else if (data.length > 0) {
      this.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  _write(data, encoding, cb) {
    if (this._timeoutMs > 0) this._armTimeout(); // activity resets the idle timer
    if (this._peerDisconnected) { const e = new Error('write ECONNRESET'); e.code = 'ECONNRESET'; cb(e); return; }
    if (this._fd < 0) { cb(new Error('Socket is closed')); return; }
    let buf;
    if (Buffer.isBuffer(data)) buf = data;
    else if (data instanceof Uint8Array) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else buf = Buffer.from(typeof data === 'string' ? data : String(data), encoding);
    this._sendFrom(buf, 0, cb);
  }

  // Push bytes until the kernel sndbuf refuses them. Sockets are non-blocking, so a full
  // buffer returns EAGAIN rather than sleeping; park the remainder and wait for the fd to
  // become writable. Withholding cb() is what applies backpressure: Writable queues
  // everything behind it and write() starts returning false at the highWaterMark.
  // Only ONE pending write can exist — stream.js serializes _write via state.writing.
  _sendFrom(buf, offset, cb) {
    while (offset < buf.length) {
      const chunk = new Uint8Array(buf.buffer, buf.byteOffset + offset, buf.length - offset);
      const n = tcp.sendBinary(this._fd, chunk);
      if (n === EAGAIN || n === 0) {
        this._pendingWrite = { buf, offset, cb };
        try { tcp.pollAdd(this._fd, EVFILT_WRITE); } catch {}
        return;
      }
      if (n < 0) { this._pendingWrite = null; cb(_writeError(n)); return; }
      offset += n;
      this._bytesWritten = (this._bytesWritten || 0) + n;
    }
    this._pendingWrite = null;
    cb();
  }

  _flushPendingWrite() {
    const p = this._pendingWrite;
    if (!p) return;
    if (this._fd < 0) { this._pendingWrite = null; p.cb(new Error('Socket is closed')); return; }
    this._pendingWrite = null;
    this._sendFrom(p.buf, p.offset, p.cb);
    // fully drained -> stop listening for writability (level-triggered: an always-writable
    // fd would otherwise re-fire every poll and spin the loop)
    if (!this._pendingWrite && this._fd >= 0) { try { tcp.pollRemove(this._fd, EVFILT_WRITE); } catch {} }
  }

  _read(size) {
    // Data is pushed from _onReadable via kqueue events, not pulled
  }

  _final(cb) {
    if (this._fd >= 0) tcp.shutdown(this._fd, 1); // SHUT_WR
    cb();
  }

  _destroy(err, cb) {
    this._clearTimeout();
    // a parked write's cb would never fire otherwise, and Writable would wait forever
    if (this._pendingWrite) {
      const p = this._pendingWrite; this._pendingWrite = null;
      const e = err || (() => { const x = new Error('Cannot call write after a stream was destroyed'); x.code = 'ERR_STREAM_DESTROYED'; return x; })();
      try { p.cb(e); } catch {}
    }
    const fd = this._fd;
    this._handle = null; // Node nulls the handle on destroy; tests assert === null after 'close'
    if (fd >= 0) {
      try { tcp.pollRemove(fd, EVFILT_READ); } catch {}
      try { tcp.pollRemove(fd, EVFILT_WRITE); } catch {}
      tcp.close(fd);
      this._fd = -1;
      if (globalThis.__pendingCloseRef) globalThis.__pendingCloseRef();
      this.once('close', () => {
        // fd numbers are recycled aggressively: close(5) frees 5, and the very next accept()
        // can hand 5 to a NEW socket before this deferred cleanup runs. Deleting by fd alone
        // then evicts the new owner's entry, orphaning a live socket — its events stop being
        // dispatched, 'close' never fires, and the process hangs. Only delete our own entry.
        if (Socket._sockets.get(fd) === this) Socket._sockets.delete(fd);
        if (globalThis.__pendingCloseUnref) globalThis.__pendingCloseUnref();
      });
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
    this._timeoutMs = ms;
    this._armTimeout();
    return this;
  }

  // Node's socket timeout is an IDLE timeout: it measures inactivity, does NOT hold the
  // process open (node uses an unref'd timer), and dies with the socket. An absolute,
  // ref'd, never-cleared timer instead makes the near-universal guard pattern
  // `setTimeout(60000, mustNotCall)` both fire spuriously and pin the loop for 60s.
  _armTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    if (this._timeoutMs > 0 && !this.destroyed) {
      const t = setTimeout(() => { this._timeoutTimer = null; this.emit('timeout'); }, this._timeoutMs);
      if (t && typeof t.unref === 'function') t.unref();
      this._timeoutTimer = t;
    }
  }

  _clearTimeout() {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    this._timeoutMs = 0;
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
  get bytesWritten() { if (this._fd === undefined) return undefined; return this._bytesWritten || 0; } // undefined on the prototype (no instance fd), like node
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

    // Emit 'listening' on a real loop turn (setImmediate), not a microtask, to
    // match Node: a beforeExit handler that listens+closes must span loop
    // iterations so beforeExit can re-fire, rather than collapsing into one
    // nextTick drain.
    setImmediate(() => this.emit('listening'));
    return this;
  }

  _onAcceptable() {
    const clientFd = tcp.accept(this._fd);
    if (clientFd < 0) return;
    // maxConnections was never enforced (the property existed but nothing read it), so a
    // server accepted unboundedly. Node accepts the fd then immediately closes it — the
    // peer sees the connection drop, and no 'connection' event fires.
    if (this.maxConnections > 0 && this._connections >= this.maxConnections) {
      try { tcp.close(clientFd); } catch {}
      return;
    }
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
    const fd = this._fd;
    if (fd >= 0) {
      try { tcp.pollRemove(fd, EVFILT_READ); } catch {}
      tcp.close(fd);
      this._fd = -1;
      if (globalThis.__pendingCloseRef) globalThis.__pendingCloseRef();
      this.once('close', () => {
        // Same fd-recycling hazard as Socket._destroy — only evict our own entry.
        if (Server._servers.get(fd) === this) Server._servers.delete(fd);
        if (globalThis.__pendingCloseUnref) globalThis.__pendingCloseUnref();
      });
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
  if (process._fatalException) { process._fatalException(e); return; }
  console.error(e); if (typeof sock.destroy === 'function') sock.destroy();
}

// MILO_LIFECYCLE_DEBUG=1 traces every kqueue event. A stale fd left registered in the
// level-triggered kqueue re-fires forever (busy-loop -> OOM in pollWait); the repeated fd
// in this trace names it. See lifecycle-probes/PLAYBOOK.md.
// lazy: net.js loads before process.env is populated, so check per-call not at module scope
function _lcOn() { return !!(process.env && process.env.MILO_LIFECYCLE_DEBUG); }
// Hot-path trace: an array push, NO syscall. writeSync here is slow enough to make tight
// lifecycle races vanish (heisenbug); the loop's 500ms dump flushes this later instead.
function _lcTrace(msg) { if (_lcOn()) { (globalThis.__lcTrace || (globalThis.__lcTrace = [])).push(msg); } }
let _lcPollEvents = 0;
function _lcLog(msg) {
  try { require('fs').writeSync(2, `[lc] ${msg}\n`); } catch {}
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
    if (_lcOn() && ++_lcPollEvents % 200 === 0) {
      const sock = Socket._sockets.get(fd);
      _lcLog(`poll#${_lcPollEvents} fd=${fd} filter=${filter} eof=${!!(flags & EV_EOF)} known=${!!sock || Server._servers.has(fd)} destroyed=${sock ? sock.destroyed : 'n/a'} rEnded=${sock && sock._readableState ? sock._readableState.ended : 'n/a'}`);
    }

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
    if (!sock) {
      // Orphaned registration: no owner, so nothing can ever consume this event, and the
      // kqueue is level-triggered — a writable fd is always ready and an EOF'd fd is
      // permanently readable, so it re-fires on every pollWait and spins the loop to a v8
      // OOM. Deregistering is safe for BOTH filters: every legitimate non-Socket consumer
      // (stdin, IPC, child_process pipes) registers its fd in Socket._sockets too
      // (_console_init.js:65, _process_init.js:645, child_process.js:366), so reaching here
      // means the fd truly has no owner.
      try { tcp.pollRemove(fd, filter === EVFILT_WRITE ? EVFILT_WRITE : EVFILT_READ); } catch {}
      continue;
    }

    if (sock._connecting && filter === EVFILT_WRITE) {
      sock._onConnected(ev);
      continue;
    }

    // fd drained enough to take more: resume the parked write. `continue` matters — a WRITE
    // event carrying EV_EOF must not fall through into the read-drain branch below.
    if (filter === EVFILT_WRITE && sock._pendingWrite) {
      try { sock._flushPendingWrite(); } catch (e) { _emitSocketError(sock, e); }
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

    if (flags & EV_EOF) {
      if (!sock.destroyed && sock._readableState && !sock._readableState.ended) {
        while (!sock.destroyed && !sock._readableState.ended) {
          const data = tcp.recvBinary(sock._fd);
          if (data === undefined || data.length === 0) break;
          sock.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        }
        if (!sock.destroyed && !sock._readableState.ended) sock.push(null);
      }
      // Unconditional: an already-ended socket still re-fires EV_EOF forever otherwise.
      // Socket._sockets also holds plain pipe objects (child_process stdio, stdin, IPC)
      // that have no _stopReading — they are only saved today by their _onReadable setting
      // destroyed=true on this same event, which does not hold if readPipe drains empty.
      if (!sock.destroyed && typeof sock._stopReading === 'function') sock._stopReading();
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
  getDefaultAutoSelectFamilyAttemptTimeout: () => module.exports._autoSelectTimeout || 500, // node default is 500ms (test/common bumps it *5)
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
