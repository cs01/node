// net module — TCP server/client over native POSIX sockets + kqueue
'use strict';

const EventEmitter = require('events');
const { Duplex } = require('stream');
const tcp = internalBinding('tcp');
// for the no-kqueue wait in _pollOnce; the loop must block somewhere
const _timersBinding = internalBinding('timers');
// macOS values; the tcp binding is macOS-only (kqueue). Linux would be 10.
const AF_INET = 2;
const AF_INET6 = 30;
// listen() with no host binds dual-stack, as Node does: '::' with IPV6_V6ONLY off, so one
// listener answers both v4 and v6 clients (the kernel presents v4 peers as v4-mapped).
// This defaulted to '0.0.0.0', which is v4-only — and once DNS started resolving localhost
// to ::1, listen(0) + connect('localhost') had the client reaching an address the listener
// was not on. An explicit listen(port, '0.0.0.0') is still v4.
const DEFAULT_HOST = '::';

const EVFILT_READ = tcp.EVFILT_READ;   // -1
const EVFILT_WRITE = tcp.EVFILT_WRITE; // -2
const EVFILT_USER = -10;               // cross-thread wakeup channel
const EV_EOF = tcp.EV_EOF;             // 0x8000
const EVFILT_VNODE = -4;
const EAGAIN = -35; // darwin EAGAIN, returned negated by nm_write

function _writeError(n) {
  const code = _CONNECT_ERRNO[-n] || 'UNKNOWN';
  const e = new Error(`write ${code}`);
  e.code = code; e.errno = n; e.syscall = 'write';
  return e;
}

// darwin errno → Node error code, for connect() failures surfaced via SO_ERROR
// darwin errno -> node error code. Used for connect() failures AND write() errors, so it
// needs the write-path errnos too: an unmapped one surfaces as the useless `ERR UNKNOWN`,
// which is exactly what hid the ENOTCONN write-before-connect bug (playbook 5o) — the code
// said UNKNOWN and only `errno=-57` gave it away.
const _CONNECT_ERRNO = {
  9: 'EBADF', 13: 'EACCES', 22: 'EINVAL', 32: 'EPIPE', 35: 'EAGAIN',
  47: 'EAFNOSUPPORT', 48: 'EADDRINUSE', 49: 'EADDRNOTAVAIL',
  50: 'ENETDOWN', 51: 'ENETUNREACH', 53: 'ECONNABORTED', 54: 'ECONNRESET',
  55: 'ENOBUFS', 56: 'EISCONN', 57: 'ENOTCONN', 60: 'ETIMEDOUT', 61: 'ECONNREFUSED',
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
    // localAddress/localPort/localFamily are getters below — do NOT assign own properties
    // here or they shadow the getters (and throw in strict mode).
    if (options && options.signal) this._addAbortSignal(options.signal);
    if (this._fd >= 0) this._startReading();
  }

  // node honors options.signal on BOTH `new net.Socket({signal})` and `connect({signal})`
  // (it inherits the constructor case from Duplex). Aborting destroys the socket with an
  // AbortError. Note the listener is only registered when the signal is NOT already
  // aborted — tests assert listenerCount(signal,'abort') is 0 in the pre-aborted case.
  _addAbortSignal(signal) {
    if (!signal) return;
    if (typeof signal !== 'object' || typeof signal.addEventListener !== 'function') {
      const e = new TypeError(`The "options.signal" property must be an instance of AbortSignal. Received ${typeof signal}`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    const onAbort = () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError'; err.code = 'ABORT_ERR';
      this.destroy(err);
    };
    if (signal.aborted) process.nextTick(onAbort);
    else signal.addEventListener('abort', onAbort, { once: true });
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
    let _signalOpt, _lookupOpt, _familyOpt, _hintsOpt;
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
      _lookupOpt = opts.lookup; _familyOpt = opts.family; _hintsOpt = opts.hints;
      port = opts.port; host = opts.host || opts.hostname;
    } else if (typeof port === 'string' && !Number.isFinite(+port)) {
      isPipe = true;
    }
    if (isPipe) { const e = new Error('Pipe/Unix sockets not yet implemented'); e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'; throw e; }
    // node defaults connect()'s host to 'localhost', NOT 127.0.0.1 (lib/net.js). It matters:
    // `client.connect(server.address())` passes {address, family, port} with no `host` key,
    // so the default decides the family — and on this box localhost resolves to ::1. With
    // 127.0.0.1 milo dialed v4 while the server sat on ::1 -> ECONNREFUSED.
    if (typeof host === 'function') { cb = host; host = 'localhost'; }
    if (!host) host = 'localhost';
    if (port !== undefined && typeof port !== 'number' && typeof port !== 'string') {
      const e = new TypeError(`The "options.port" option must be of type number or string. Received type ${typeof port} (${String(port)})`);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    const _validatePort = require('internal/validators').validatePort;
    port = _validatePort(port, 'options.port');
    if (cb) this.once('connect', cb);
    // node lets a destroyed Socket be reconnected — `new net.Socket()` reused across two
    // connect() calls is a real idiom (test-net-socket-local-address). It calls
    // self._undestroy() and clears the handle (lib/net.js:323, :1317). milo never reset
    // anything, so the second connect() hung. NB milo's _undestroy() resets only the
    // WRITABLE state, so the readable side is reset here too.
    if (this.destroyed) {
      this._undestroy();
      const rs = this._readableState;
      if (rs) { rs._destroyed = false; rs.ended = false; rs.endEmitted = false; rs.flowing = null; rs.buffer = []; rs.length = 0; rs.readable = true; rs.errored = null; rs.errorEmitted = false; }
      this._handle = null;
      this._fd = -1;
      this._readPollRemoved = false;
      this._pendingWrite = null;
      this._preConnectWrites = null;
      this._peerDisconnected = false;
      this._connecting = false;
    }
    // Each connect attempt gets a generation. The deferred map-eviction in _destroy is
    // guarded by `get(fd) === this`, which catches a DIFFERENT socket recycling the fd —
    // but not the SAME socket reconnecting: the user's 'close' handler runs before
    // _destroy's, so connect() re-adds the entry and the stale handler then deletes the
    // fresh one. Same bug class as the fd-reuse race, invisible to an identity check.
    this._gen = (this._gen || 0) + 1;
    // NOTE: `port` is reassigned to opts.port above, so the signal must be captured from
    // the options object while it is still in scope (_signalOpt), not re-read from `port`.
    this._addAbortSignal(_signalOpt);
    this._connecting = true;

    // node resolves the host in JS and emits 'lookup' (lib/net.js:1468) — milo handed the
    // hostname straight to C, so 'lookup' never fired, options.lookup was ignored and a DNS
    // failure surfaced with the wrong error. An IP LITERAL still takes the fully synchronous
    // path: node skips resolution for literals (verified: no 'lookup' emitted), and keeping
    // it sync means the overwhelmingly common case is untouched by this change.
    if (isIP(host)) {
      this._doConnect(host, port);
    } else {
      const lookupFn = _lookupOpt || require('dns').lookup;
      if (typeof lookupFn !== 'function') {
        const e = new TypeError(`The "options.lookup" property must be of type function. Received type ${typeof lookupFn}`);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      lookupFn(host, { family: _familyOpt || 0, hints: _hintsOpt }, (err, ip, family) => {
        this.emit('lookup', err, ip, family, host); // node emits this even on error
        // autoSelectFamily (node's default is TRUE, verified: getDefaultAutoSelectFamily()).
        // 'localhost' resolves to ::1 on this box, so a v6-first connect to a v4-only
        // listener is refused; node tries the other family before giving up. Remember how to
        // retry, unless the caller pinned a family.
        if (!_familyOpt && family === 6) this._afFallback = { host, port, lookupFn };
        if (this.destroyed || !this._connecting) return; // destroyed while resolving
        if (err) {
          if (!err.host) err.host = host;
          this.destroy(err);
          return;
        }
        // a custom options.lookup can hand back anything; node rejects a family that is
        // neither 4 nor 6 rather than trying to connect with it
        if (family !== 4 && family !== 6) {
          const e = new Error(`Invalid address family: ${family} ${host}:${port}`);
          e.code = 'ERR_INVALID_ADDRESS_FAMILY'; e.host = host; e.port = port;
          this.destroy(e);
          return;
        }
        this._doConnect(ip, port);
      });
    }
    return this;
  }

  _doConnect(ip, port) {
    ensurePoll();
    // The family is fixed at socket() time, before connect() ever sees the address — so it
    // must be derived from the resolved ip here. (listen() does the same at net.js:554.)
    // Without this the socket is AF_INET and a v6 literal fails: inet_pton(AF_INET, "::1")
    // returns 0, the sockaddr stays zeroed, and the connect goes to 0.0.0.0 -> ECONNREFUSED.
    const family = (ip && ip.includes(':')) ? AF_INET6 : AF_INET;
    this._fd = tcp.socket(family);
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('socket() failed')));
      return;
    }
    this._handle = { fd: this._fd };
    tcp.connect(this._fd, ip, port); // 0 or EINPROGRESS; readiness comes via EVFILT_WRITE
    tcp.pollAdd(this._fd, EVFILT_WRITE);
    Socket._sockets.set(this._fd, this);
    this.remoteAddress = ip;
    this.remotePort = port;
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
    if (soErr > 0 && this._afFallback && !this._afTried) {
      // autoSelectFamily: retry once on the other family before reporting failure
      this._afTried = true;
      const { host, port, lookupFn } = this._afFallback;
      this._afFallback = null;
      const fd = this._fd;
      try { tcp.pollRemove(fd, EVFILT_WRITE); } catch {}
      try { tcp.pollRemove(fd, EVFILT_READ); } catch {}
      if (Socket._sockets.get(fd) === this) Socket._sockets.delete(fd);
      try { tcp.close(fd); } catch {}
      this._fd = -1;
      this._connecting = true;
      lookupFn(host, { family: 4 }, (e2, ip4) => {
        if (this.destroyed) return;
        if (e2 || !ip4) { const er = new Error(`connect ECONNREFUSED ${host}:${port}`); er.code = 'ECONNREFUSED'; er.syscall = 'connect'; this.destroy(er); return; }
        this._doConnect(ip4, port);
      });
      return;
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
    // drain anything written before the async hostname lookup produced an fd
    if (this._preConnectWrites && this._preConnectWrites.length) {
      const queued = this._preConnectWrites; this._preConnectWrites = null;
      for (const q of queued) this._sendFrom(q.buf, 0, q.cb);
    }
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
    // A hostname connect resolves asynchronously, so the fd does not exist yet when user
    // code writes right after connect(). Node buffers those writes; rejecting them with
    // 'Socket is closed' broke every write-before-connect caller. Park in the same slot the
    // EAGAIN path uses and flush from _onConnected.
    // Park ANY write issued before the connection is up. connect() is ALWAYS async
    // (EINPROGRESS) — http2 writes its preface before 'connect' fires — and since sockets
    // became genuinely non-blocking that write returns ENOTCONN(-57) instead of blocking
    // until connected as it used to. Covers both fd<0 (dns still resolving) and fd>=0
    // (connect in flight). See playbook 5o.
    if (this._connecting) {
      let b;
      if (Buffer.isBuffer(data)) b = data;
      else if (data instanceof Uint8Array) b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      else b = Buffer.from(typeof data === 'string' ? data : String(data), encoding);
      this._bytesWritten = (this._bytesWritten || 0) + b.length; // dispatched, just not sent yet
      this._preConnectWrites = this._preConnectWrites || [];
      this._preConnectWrites.push({ buf: b, cb });
      return;
    }
    if (this._fd < 0) { cb(new Error('Socket is closed')); return; }
    let buf;
    if (Buffer.isBuffer(data)) buf = data;
    else if (data instanceof Uint8Array) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else buf = Buffer.from(typeof data === 'string' ? data : String(data), encoding);
    this._bytesWritten = (this._bytesWritten || 0) + buf.length; // dispatched
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
    // end() before connect: no fd yet, so defer the FIN until 'connect' fires,
    // else the shutdown is silently dropped and the peer never sees EOF (node
    // lib/net.js does the same once('connect') deferral).
    if (this._connecting) { this.once('connect', () => this._final(cb)); return; }
    if (this._fd >= 0) tcp.shutdown(this._fd, 1); // SHUT_WR
    cb();
  }

  _destroy(err, cb) {
    const gen = this._gen; // snapshot: a reconnect before 'close' bumps this
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
        // ...and only if this socket has not begun a NEW connection since (gen check)
        if (Socket._sockets.get(fd) === this && this._gen === gen) Socket._sockets.delete(fd);
        if (globalThis.__pendingCloseUnref) globalThis.__pendingCloseUnref();
      });
    }
    cb(err);
  }

  address() {
    if (this._fd < 0) return {};
    return tcp.getSockName(this._fd) || {};
  }

  // node exposes the local end of the connection as getters (lib/net.js). They were plain
  // `undefined` assignments in the constructor that nothing ever populated, even though
  // getSockName() has been available all along (it already backs address()).
  get localAddress() { const a = this._fd >= 0 ? tcp.getSockName(this._fd) : null; return a ? a.address : undefined; }
  get localPort() { const a = this._fd >= 0 ? tcp.getSockName(this._fd) : null; return a ? a.port : undefined; }
  get localFamily() { const a = this._fd >= 0 ? tcp.getSockName(this._fd) : null; return a ? a.family : undefined; }

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
  // node: _bytesDispatched + every chunk still in writableBuffer (lib/net.js:1047). Counting
  // only bytes that reached the kernel reports 3 instead of 7 for
  // cork(); write('one'); write('two\n') — the test asserts WHILE corked, so the buffered
  // chunks must count. NB _writableState.length is not a byte count here; sum the chunks.
  get bytesWritten() {
    if (this._fd === undefined) return undefined; // undefined on the prototype, like node
    let bytes = this._bytesWritten || 0;
    const buffered = this._writableState && this._writableState.buffered;
    if (buffered) {
      for (const el of buffered) {
        bytes += Buffer.isBuffer(el.chunk) ? el.chunk.length
               : Buffer.byteLength(el.chunk, el.encoding === 'buffer' ? undefined : el.encoding);
      }
    }
    return bytes;
  }
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
      cb = port; port = 0; host = DEFAULT_HOST; backlog = 128;
    } else if (typeof port === 'object' && port !== null) {
      cb = typeof host === 'function' ? host : cb;
      const opts = port;
      if (opts.fd !== undefined) {
        // listen({fd}): adopt an existing fd as the server socket instead of
        // creating+binding one. Milo used to ignore opts.fd and bind a random
        // port, silently "succeeding" on fd 0 (stdin) where node errors EINVAL.
        if (cb) this.once('listening', cb);
        this._listenOnFd(opts.fd, opts.backlog || 128);
        return this;
      }
      if (opts.path) {
        // Unix socket / pipe path
        if (cb) this.once('listening', cb);
        const e = new Error('Pipe/Unix sockets not yet implemented');
        e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM';
        process.nextTick(() => this.emit('error', e));
        return this;
      }
      port = opts.port;
      host = opts.host || DEFAULT_HOST;
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
      if (typeof host === 'function') { cb = host; host = DEFAULT_HOST; backlog = 128; }
      if (typeof backlog === 'function') { cb = backlog; backlog = 128; }
    }
    if (!host) host = DEFAULT_HOST;
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

    // node resolves a hostname before binding: listen(0,'localhost') binds ::1, it does not
    // hand 'localhost' to bind(). milo passed it straight through, buildSockAddr correctly
    // refused a non-literal, and the failure surfaced as a hardcoded 'bind EADDRINUSE'.
    if (host && host !== DEFAULT_HOST && isIP(host) === 0) {
      require('dns').lookup(host, (err, ip) => {
        if (err) { err.syscall = 'listen'; this.emit('error', err); return; }
        this._listenOn(ip, port, backlog);
      });
      return this;
    }
    this._listenOn(host, port, backlog);
    return this;
  }

  _listenOn(host, port, backlog) {
    ensurePoll();
    // A ':' means an IPv6 literal, and the socket's family is fixed at socket() time —
    // long before bind() sees the host. Creating an AF_INET socket and then binding a v6
    // sockaddr to it is rejected by the kernel, which is how '::1' used to end up as
    // 0.0.0.0: the old code discarded inet_pton's failure and bound the zeroed address.
    // No host means dual-stack, matching Node: bind :: with V6ONLY off so one listener
    // answers both v4 and v6 clients (the kernel presents v4 peers as v4-mapped). Binding
    // v4-only here is what made listen(0) + connect('localhost') hang once DNS started
    // resolving localhost to ::1 — the listener simply was not on the address the client
    // reached for.
    const family = (!host || host.includes(':')) ? AF_INET6 : AF_INET;
    this._fd = tcp.socket(family);
    if (this._fd < 0) {
      process.nextTick(() => this.emit('error', new Error('socket() failed')));
      return;
    }

    if (tcp.bind(this._fd, host, port) !== 0) {
      tcp.close(this._fd);
      this._fd = -1;
      // NB the errno is a guess: tcp.bind only reports pass/fail, so a genuine EADDRINUSE
      // and e.g. EAFNOSUPPORT are indistinguishable here. Make tcp.bind return -errno to fix.
      const err = new Error('bind EADDRINUSE ' + (host || '0.0.0.0') + ':' + port);
      err.code = 'EADDRINUSE'; err.errno = -48; err.syscall = 'bind'; err.address = '0.0.0.0'; err.port = port;
      process.nextTick(() => this.emit('error', err));
      return;
    }

    if (tcp.listen(this._fd, backlog) !== 0) {
      tcp.close(this._fd);
      this._fd = -1;
      process.nextTick(() => this.emit('error', new Error('listen() failed')));
      return;
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
  }

  _listenOnFd(fd, backlog) {
    ensurePoll();
    this._fd = fd;
    if (tcp.listen(this._fd, backlog) !== 0) {
      this._fd = -1;
      // tcp.listen reports only pass/fail, not errno (same gap as bind above).
      // Adopting a non-socket fd (fd 0 = stdin) fails EINVAL on macOS; node
      // reports EINVAL here and the test accepts EINVAL or ENOTSOCK.
      const err = new Error('listen EINVAL');
      err.code = 'EINVAL'; err.errno = -22; err.syscall = 'listen';
      process.nextTick(() => this.emit('error', err));
      return;
    }
    this._listening = true;
    this._handle = { fd: this._fd };
    tcp.pollAdd(this._fd, EVFILT_READ);
    Server._servers.set(this._fd, this);
    const addr = this.address();
    if (addr) this._connectionKey = `${addr.family === 'IPv6' ? '6' : '4'}:${addr.address}:${addr.port}`;
    setImmediate(() => this.emit('listening'));
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
  if (!pollInited) {
    // The kqueue is created lazily, the first time something makes a socket. A timer-only
    // program (setTimeout with no sockets — as common as JS gets) therefore lands here, and
    // returning 0 INSTANTLY breaks this function's contract: the caller asked to wait
    // `timeout` ms. The loop's own sleep branch cannot save it, because `poll` is truthy —
    // so the loop spun at 100% CPU (1.58M iterations in 2s; node uses 0.04s where milo
    // burned 2.52s). Honour the wait.
    if (timeout > 0) _timersBinding.sleepMs(timeout);
    return 0;
  }
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

    // Cross-thread wakeup (EVFILT_USER, ident 'milo'). Carries no data — its only job is to
    // return pollWait early so the loop re-checks queues another thread just fed. It must be
    // skipped explicitly: its ident is NOT an fd, so the orphan branch below would try to
    // deregister a bogus fd.
    if (filter === EVFILT_USER) continue;

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

    // A WRITE event that reached here is wanted by nobody: the socket is not connecting,
    // has no parked write, and is not mid-TLS-handshake (those branches are above and
    // `continue`). A connected socket is essentially always writable, so leaving the
    // registration in a level-triggered kqueue re-fires it every poll — this is the last
    // spin class in the suite (tls handshake paths register EVFILT_WRITE and only remove it
    // on success, so any other exit leaks it). Deregister; nothing can consume it.
    if (filter === EVFILT_WRITE) {
      try { tcp.pollRemove(fd, EVFILT_WRITE); } catch {}
      sock._writeRegistered = false; // keep tls.js's _wantWrite bookkeeping honest
      continue;
    }

    if (filter === EVFILT_READ) {
      try { sock._onReadable(); } catch (e) { _emitSocketError(sock, e); }
    }

    if (flags & EV_EOF) {
      // A TLS socket must drain through SSL, never through the raw recvBinary path below:
      // that reads the fd directly, bypasses the SSL layer, and then deregisters reads via
      // _stopReading(). SSL frequently has NOT seen its own EOF at this point (sslRead still
      // reports WANT_READ), so the socket ends up unreadable forever and is never destroyed —
      // it sits in _sockets with io=true and pins the loop (socks=[8] srvs=[]). TCP EOF ends
      // the TLS session; there is no half-open TLS. Drain via SSL, then destroy regardless.
      // Today the WRITE spin masks this by driving _onReadable until sslRead reports closed.
      if (sock._ssl !== undefined) {
        try { sock._onReadable(); } catch (e) { _emitSocketError(sock, e); }
        // Destroy only if the stream did NOT take ownership of the shutdown. sslRead
        // reporting closed makes _onReadable push(null), and stream.js gates its nextTick
        // 'end' emit on !_destroyed — destroying here would swallow 'end' and hang any
        // consumer waiting on it. When the stream ended, autoDestroy finishes the job.
        if (!sock.destroyed && !(sock._readableState && sock._readableState.ended)) {
          try { sock.destroy(); } catch (e) { _emitSocketError(sock, e); }
        }
        continue;
      }
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
