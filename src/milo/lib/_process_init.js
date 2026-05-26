// process setup — internal bootstrap module
'use strict';

process.emitWarning = (warning, typeOrOptions, code, ctor) => {
  if (warning === undefined || (typeof warning !== 'string' && !(warning instanceof Error))) {
    const e = new TypeError('The "warning" argument must be of type string or an instance of Error');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (typeof typeOrOptions === 'object' && typeOrOptions !== null && !Array.isArray(typeOrOptions)) {
    code = typeOrOptions.code; ctor = typeOrOptions.ctor;
    typeOrOptions = typeOrOptions.type || 'Warning';
  }
  if (typeOrOptions !== undefined && typeof typeOrOptions !== 'string') {
    const e = new TypeError('The "type" argument must be of type string');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  const type = typeOrOptions || 'Warning';
  let msg;
  if (warning instanceof Error) { msg = warning; }
  else { msg = new Error(warning); msg.name = type; if (code) msg.code = code; }
  process.nextTick(() => {
    console.error(`(${msg.name}) ${msg.message}`);
    process.emit('warning', msg);
  });
};

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
if (!process.chdir) {
  const _pmb3 = internalBinding('process_methods');
  process.chdir = (dir) => {
    if (typeof dir !== 'string') throw _ERR_INVALID_ARG_TYPE('directory', 'string', dir);
    _pmb3.chdir(dir);
  };
}
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
  const EventEmitter = require('events');
  function ProcessProto() {}
  Object.setPrototypeOf(ProcessProto.prototype, EventEmitter.prototype);
  Object.setPrototypeOf(process, ProcessProto.prototype);
  EventEmitter.call(process);
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
if (!process.kill) {
  const _signals = { SIGHUP:1, SIGINT:2, SIGQUIT:3, SIGILL:4, SIGTRAP:5, SIGABRT:6, SIGBUS:10, SIGFPE:8, SIGKILL:9, SIGUSR1:30, SIGSEGV:11, SIGUSR2:31, SIGPIPE:13, SIGALRM:14, SIGTERM:15, SIGCHLD:20, SIGCONT:19, SIGSTOP:17, SIGTSTP:18, SIGTTIN:21, SIGTTOU:22, SIGURG:16, SIGXCPU:24, SIGXFSZ:25, SIGVTALRM:26, SIGPROF:27, SIGWINCH:28, SIGIO:23, SIGINFO:29, SIGSYS:12 };
  const _spawnB = internalBinding('spawn');
  process._kill = function(pid, sig) {
    if (_spawnB.killPid) return _spawnB.killPid(pid, sig);
    return 0;
  };
  process.kill = function(pid, signal) {
    if (typeof pid === 'string') pid = Number(pid);
    if (typeof pid !== 'number' || Number.isNaN(pid) || !Number.isFinite(pid)) {
      const e = new TypeError('The "pid" argument must be of type number. Received ' + (pid === null ? 'null' : pid === undefined ? 'undefined' : 'type ' + typeof pid + ' (' + String(pid) + ')'));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    let sig;
    if (signal === undefined) { sig = 15; }
    else if (typeof signal === 'number') { sig = signal; }
    else if (typeof signal === 'string') {
      sig = _signals[signal];
      if (sig === undefined) { const e = new TypeError('Unknown signal: ' + signal); e.code = 'ERR_UNKNOWN_SIGNAL'; throw e; }
    } else { sig = signal; }
    const r = process._kill(pid, sig);
    if (r === -1) { const e = new Error('kill EINVAL'); e.code = 'EINVAL'; throw e; }
  };
}
// Wrap process.exit to emit 'exit' event before native exit
const _nativeExit = process.exit;
process.exit = function(code) {
  if (code !== undefined) process.exitCode = code;
  const exitCode = process.exitCode || 0;
  if (!process._exiting) {
    process._exiting = true;
    try { process.emit('exit', exitCode); } catch {}
  }
  _nativeExit(exitCode);
};
// Called by runtime before normal program completion (via __runExitHandlers global)
process._emitBeforeExit = function() {
  const code = process.exitCode || 0;
  try { process.emit('beforeExit', code); } catch {}
};
process._emitExit = function() {
  const code = process.exitCode || 0;
  if (!process._exiting) {
    process._exiting = true;
    try { process.emit('exit', code); } catch (e) {
      if (e && e.code === 'ERR_ASSERTION') { process.exitCode = 1; _nativeExit(1); }
    }
    if (process.exitCode && process.exitCode !== 0) _nativeExit(process.exitCode);
  }
};
Object.defineProperty(globalThis, '__runExitHandlers', { value: function() { process._emitExit(); }, enumerable: false });
if (!process.abort) process.abort = () => { process.exit(134); };
if (!process.binding) process.binding = (name) => {
  if (name === 'util') {
    return {
      isArrayBuffer: (v) => v instanceof ArrayBuffer,
      isArrayBufferView: (v) => ArrayBuffer.isView(v),
      isAnyArrayBuffer: (v) => v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
      isDataView: (v) => v instanceof DataView,
      isDate: (v) => v instanceof Date,
      isMap: (v) => v instanceof Map,
      isMapIterator: () => false,
      isSet: (v) => v instanceof Set,
      isSetIterator: () => false,
      isRegExp: (v) => v instanceof RegExp,
      isPromise: (v) => v instanceof Promise,
      isNativeError: (v) => v instanceof Error,
      isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
      isUint8Array: (v) => v instanceof Uint8Array,
      isExternal: () => false,
      isAsyncFunction: (v) => typeof v === 'function' && v.constructor && v.constructor.name === 'AsyncFunction',
      isGeneratorFunction: (v) => typeof v === 'function' && v.constructor && v.constructor.name === 'GeneratorFunction',
      isGeneratorObject: (v) => v != null && typeof v.next === 'function' && typeof v.throw === 'function',
      isWeakMap: (v) => v instanceof WeakMap,
      isWeakSet: (v) => v instanceof WeakSet,
      isNumberObject: (v) => typeof v === 'object' && v !== null && v instanceof Number,
      isStringObject: (v) => typeof v === 'object' && v !== null && v instanceof String,
      isBooleanObject: (v) => typeof v === 'object' && v !== null && v instanceof Boolean,
      isSymbolObject: (v) => typeof v === 'object' && v !== null && typeof Object.valueOf.call(v) === 'symbol',
      isBigIntObject: (v) => typeof v === 'object' && v !== null && typeof Object.valueOf.call(v) === 'bigint',
      isProxy: () => false,
      isModuleNamespaceObject: () => false,
    };
  }
  throw new Error('process.binding is not supported');
};

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
  if (fn !== null && typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('fn', 'function or null', fn);
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

// Make internal globals non-enumerable (Node.js C++ sets these up as non-enumerable;
// tests check for leaked enumerable globals)
(function() {
  const internal = [
    'internalBinding', 'getInternalBinding', '__loadBuiltin', '__libDir',
    'primordials', '_requireStack', '_makeRequire', 'require',
    '__eventLoopUtilization', '__ref', '__unref', '__hasIO',
    '_ERR_INVALID_ARG_TYPE', '_ERR_INVALID_ARG_VALUE', '_ERR_OUT_OF_RANGE',
    '_ERR_BUFFER_OUT_OF_BOUNDS', '_ERR_UNKNOWN_ENCODING', '_ERR_UNESCAPED_CHARACTERS',
    '_ERR_METHOD_NOT_IMPLEMENTED', '_ERR_MISSING_ARGS',
    'process', 'Buffer',
  ];
  for (const key of internal) {
    if (key in globalThis) {
      const desc = Object.getOwnPropertyDescriptor(globalThis, key);
      if (desc && desc.enumerable) Object.defineProperty(globalThis, key, { ...desc, enumerable: false });
    }
  }
})();
