// process setup — internal bootstrap module
'use strict';

process.emitWarning = (msg) => console.error('Warning:', msg);

const _envB = internalBinding('env');
const _envOverrides = {};
const _envDeleted = new Set();
process.env = new Proxy({}, {
  get(_, key) {
    if (key === Symbol.toStringTag) return 'process.env';
    const k = String(key); if (_envDeleted.has(k)) return undefined; if (k in _envOverrides) return _envOverrides[k]; return _envB.get(k);
  },
  set(_, key, value) { const k = String(key); const v = String(value); _envDeleted.delete(k); _envOverrides[k] = v; if (_envB.set) _envB.set(k, v); return true; },
  has(_, key) { const k = String(key); if (_envDeleted.has(k)) return false; return k in _envOverrides || _envB.get(k) !== undefined; },
  deleteProperty(_, key) { const k = String(key); delete _envOverrides[k]; _envDeleted.add(k); if (_envB.unset) _envB.unset(k); return true; },
  ownKeys() {
    const nativeKeys = (_envB.enumerate ? _envB.enumerate() : []).map(e => e.split('=')[0]);
    const all = new Set([...nativeKeys, ...Object.keys(_envOverrides)]);
    for (const k of _envDeleted) all.delete(k);
    return [...all];
  },
  getOwnPropertyDescriptor(_, key) { const v = this.get(null, key); if (v !== undefined) return { value: v, writable: true, enumerable: true, configurable: true }; return undefined; },
});

process.config = { variables: { asan: 0, v8_enable_i18n_support: 0, node_module_version: 135 }, target_defaults: { default_configuration: 'Release' } };
process.features = { inspector: false, debug: false, uv: true, ipv6: true, tls: false };
if (!process.versions) process.versions = {};
Object.assign(process.versions, {
  node: '24.0.0', v8: '13.6.233.5', modules: '135', napi: '10',
  uv: '1.50.0', zlib: '1.3.1.1-motley-82a5fec', ares: '1.34.4',
  brotli: '1.1.0', zstd: '1.5.7', nghttp2: '1.64.0', nghttp3: '1.6.0',
  ngtcp2: '1.9.1', llhttp: '9.3.0', openssl: '3.0.15+quic',
  unicode: '16.0', icu: '76.1', simdutf: '6.1.1', acorn: '8.14.0',
  ada: '3.2.0', undici: '7.3.0', simdjson: '3.11.2',
});
process.version = 'v24.0.0'; process.release = { name: 'node' };
if (!process.cwd) process.cwd = () => _envB.get('PWD') || '/';
if (!process.chdir) process.chdir = () => {};
if (!process.umask) process.umask = (mask) => { if (mask !== undefined) return 0o22; return 0o22; };

process.getActiveResourcesInfo = () => [];
process.constrainedMemory = () => 0;
process.availableMemory = () => 0;
process.cpuUsage = (prev) => {
  const usage = { user: 0, system: 0 };
  if (prev) { usage.user -= prev.user; usage.system -= prev.system; }
  return usage;
};

if (!process.hrtime) {
  const b = internalBinding('process_methods');
  process.hrtime = (...a) => {
    const r = b.hrtime();
    if (a.length && a[0]) { r[0] -= a[0][0]; r[1] -= a[0][1]; if (r[1] < 0) { r[0]--; r[1] += 1e9; } }
    return r;
  };
  process.hrtime.bigint = b.hrtimeBigint;
}

// Proper nextTick queue — runs before promises, drains recursively
process._nextTickQueue = [];
process._tickCallback = function() {
  while (process._nextTickQueue.length > 0) {
    const entry = process._nextTickQueue.shift();
    try { entry[0](...entry[1]); }
    catch (e) {
      const handlers = process.listeners && process.listeners('uncaughtException');
      if (handlers && handlers.length > 0) process.emit('uncaughtException', e);
      else throw e;
    }
  }
};
process.nextTick = (fn, ...args) => { process._nextTickQueue.push([fn, args]); };

if (!process.on) {
  const _h = {};
  process.on = (ev, fn) => { (_h[ev] ??= []).push(fn); return process; };
  process.addListener = process.on;
  process.once = (ev, fn) => { const w = (...a) => { process.removeListener(ev, w); fn(...a); }; return process.on(ev, w); };
  process.removeListener = (ev, fn) => { const h = _h[ev]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } return process; };
  process.emit = (ev, ...args) => { const hs = _h[ev]; if (!hs || hs.length === 0) return false; for (const fn of [...hs]) fn(...args); return true; };
  process.listeners = (ev) => [...(_h[ev] || [])];
  process.listenerCount = (ev) => (_h[ev] || []).length;
  process.removeAllListeners = (ev) => { if (ev) delete _h[ev]; else for (const k of Object.keys(_h)) delete _h[k]; return process; };
  process.prependListener = (ev, fn) => { (_h[ev] ??= []).unshift(fn); return process; };
  process.prependOnceListener = (ev, fn) => { const w = (...a) => { process.removeListener(ev, w); fn(...a); }; return process.prependListener(ev, w); };
  process.off = process.removeListener;
  process.eventNames = () => Object.keys(_h).filter(k => _h[k] && _h[k].length > 0);
}

const _startTime = Date.now();
if (!process.uptime) process.uptime = () => (Date.now() - _startTime) / 1000;
if (!process.title) process.title = 'milo-node';
if (!process.execPath) {
  const _ep = process.argv[0] || '';
  if (_ep) {
    const _path = require('path');
    const _fs = require('fs');
    const _abs = _ep.startsWith('/') ? _ep : _path.resolve(_ep);
    try { process.execPath = _fs.realpathSync(_abs); } catch { process.execPath = _abs; }
  } else {
    process.execPath = _ep;
  }
}
if (!process.argv0) process.argv0 = process.argv[0] || '';
if (!process.execArgv) process.execArgv = [];
if (!process.allowedNodeEnvironmentFlags) process.allowedNodeEnvironmentFlags = new Set();
if (!process.kill) process.kill = () => {};
if (!process.abort) process.abort = () => { process.exit(134); };
if (!process.binding) process.binding = (name) => { throw new Error('process.binding is not supported'); };

const _osB = internalBinding('os');
if (!process.getuid) process.getuid = () => _osB.getUid();
if (!process.getgid) process.getgid = () => _osB.getGid();
if (!process.geteuid) process.geteuid = () => _osB.getEuid();
if (!process.getegid) process.getegid = () => _osB.getEgid();
if (!process.getgroups) process.getgroups = () => [];
if (!process.setuid) process.setuid = () => {};
if (!process.setgid) process.setgid = () => {};

let _uncaughtExceptionCallback = null;
process.setUncaughtExceptionCaptureCallback = (fn) => {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('The "fn" argument must be of type function or null');
  _uncaughtExceptionCallback = fn;
};
process.hasUncaughtExceptionCaptureCallback = () => _uncaughtExceptionCallback !== null;

if (!process.memoryUsage) {
  const _pmb = internalBinding('process_methods');
  process.memoryUsage = () => _pmb.memoryUsage();
  process.memoryUsage.rss = () => _pmb.memoryUsage().rss;
}
if (!process.cpuUsage) process.cpuUsage = () => ({ user: 0, system: 0 });
if (!process.debugPort) process.debugPort = 9229;
if (!process.report) process.report = { getReport: () => ({}) };
if (!process.domain) process.domain = null;
if (!process.resourceUsage) process.resourceUsage = () => ({ userCPUTime: 0, systemCPUTime: 0, maxRSS: 0, sharedMemorySize: 0, unsharedDataSize: 0, unsharedStackSize: 0, minorPageFault: 0, majorPageFault: 0, swappedOut: 0, fsRead: 0, fsWrite: 0, ipcSent: 0, ipcReceived: 0, signalsCount: 0, voluntaryContextSwitches: 0, involuntaryContextSwitches: 0 });

// IPC channel setup for forked processes (fd 3)
(function _setupIPC() {
  if (!process.env.NODE_CHANNEL_FD) { process.connected = false; return; }
  const _spawnB = internalBinding('spawn');
  process.connected = true;
  let _ipcBuf = '';

  process.send = function(message, sendHandle, options, callback) {
    if (typeof sendHandle === 'function') { callback = sendHandle; sendHandle = undefined; }
    if (typeof options === 'function') { callback = options; options = undefined; }
    if (!process.connected) { if (callback) callback(new Error('channel closed')); return false; }
    const data = JSON.stringify(message) + '\n';
    _spawnB.writePipe(3, data);
    if (callback) process.nextTick(callback);
    return true;
  };

  process.disconnect = function() {
    if (!process.connected) return;
    process.connected = false;
    _spawnB.closeFd(3);
    process.emit('disconnect');
  };

  // Register fd 3 with kqueue for async IPC reads
  const net = require('net');
  const tcp = internalBinding('tcp');
  _spawnB.setNonBlocking(3);
  net._ensurePoll();
  const ipcObj = {
    _fd: 3, destroyed: false, _unref: false,
    _onReadable() {
      for (;;) {
        const data = _spawnB.readPipe(3);
        if (data === undefined) {
          net.Socket._sockets.delete(3);
          _spawnB.closeFd(3);
          this.destroyed = true;
          process.connected = false;
          process.emit('disconnect');
          return;
        }
        if (data.length === 0) break;
        _ipcBuf += data.replace(/\0/g, '');
        let nl;
        while ((nl = _ipcBuf.indexOf('\n')) >= 0) {
          const line = _ipcBuf.substring(0, nl);
          _ipcBuf = _ipcBuf.substring(nl + 1);
          if (line.length > 0) {
            try { process.emit('message', JSON.parse(line)); } catch {}
          }
        }
      }
    }
  };
  net.Socket._sockets.set(3, ipcObj);
  tcp.pollAdd(3, tcp.EVFILT_READ);

  process.channel = {
    ref() { ipcObj._unref = false; },
    unref() { ipcObj._unref = true; }
  };
})();
