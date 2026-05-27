// process setup — internal bootstrap module
'use strict';

process.emitWarning = (warning, typeOrOptions, code, ctor) => {
  if (warning === undefined || (typeof warning !== 'string' && !(warning instanceof Error))) {
    const e = new TypeError('The "warning" argument must be of type string or an instance of Error');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  let type, detail;
  if (typeof typeOrOptions === 'function') {
    ctor = typeOrOptions;
    typeOrOptions = undefined;
  }
  if (typeof typeOrOptions === 'object' && typeOrOptions !== null && !Array.isArray(typeOrOptions)) {
    code = typeOrOptions.code; ctor = typeOrOptions.ctor;
    detail = typeof typeOrOptions.detail === 'string' ? typeOrOptions.detail : undefined;
    type = typeOrOptions.type || 'Warning';
  } else if (typeof typeOrOptions === 'string') {
    type = typeOrOptions;
  } else if (typeOrOptions !== undefined) {
    const e = new TypeError('The "type" argument must be of type string');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (typeof code === 'function') { ctor = code; code = undefined; }
  if (code !== undefined && typeof code !== 'string') {
    const e = new TypeError('The "code" argument must be of type string');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (!type) type = 'Warning';
  let msg;
  if (warning instanceof Error) { msg = warning; }
  else { msg = new Error(warning); msg.name = type; if (code) msg.code = code; }
  if (detail) msg.detail = detail;
  process.nextTick(() => {
    if (!process.emit('warning', msg)) {
      console.error(`(${msg.name}) ${msg.message}`);
    }
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

process.config = Object.freeze({ variables: Object.freeze({ asan: 0, v8_enable_i18n_support: 0, node_module_version: 135, node_builtin_shareable_builtins: Object.freeze([]) }), target_defaults: Object.freeze({ default_configuration: 'Release' }) });
process.features = { inspector: false, debug: false, uv: true, ipv6: true, openssl_is_boringssl: false, quic: false, tls_alpn: true, tls_sni: true, tls_ocsp: true, tls: true, cached_builtins: true, require_module: true, typescript: false };
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
    const prev = process.cwd();
    const r = _pmb3.chdir(dir);
    if (r !== 0) {
      const e = new Error(`ENOENT: no such file or directory, chdir '${prev}' -> '${dir}'`);
      e.code = 'ENOENT'; e.syscall = 'chdir'; e.path = prev; e.dest = dir;
      throw e;
    }
  };
}
if (!process.umask) {
  const _osb = internalBinding('os');
  process.umask = (mask) => {
    if (mask === undefined) return _osb.umask();
    if (typeof mask === 'string') {
      if (!/^[0-7]+$/.test(mask)) { const e = new TypeError(`The "mask" argument must be a 32-bit unsigned integer or an octal string. Received "${mask}"`); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; }
      mask = parseInt(mask, 8);
    }
    if (typeof mask !== 'number') throw _ERR_INVALID_ARG_TYPE('mask', 'number', mask);
    return _osb.umask(mask);
  };
}

process.getActiveResourcesInfo = () => [];
process.constrainedMemory = () => 0;
process.availableMemory = () => 0;
process.cpuUsage = function cpuUsage(prev) {
  if (prev !== undefined) {
    if (typeof prev !== 'object' || prev === null) { const e = new TypeError('The "prevValue" argument must be of type object. Received type ' + typeof prev + ' (' + prev + ')'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (typeof prev.user !== 'number') { const e = new TypeError('The "prevValue.user" property must be of type number.' + (prev.user === null ? ' Received null' : prev.user === undefined ? ' Received undefined' : " Received type " + typeof prev.user + " ('" + prev.user + "')")); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (typeof prev.system !== 'number') { const e = new TypeError('The "prevValue.system" property must be of type number.' + (prev.system === null ? ' Received null' : prev.system === undefined ? ' Received undefined' : " Received type " + typeof prev.system + " ('" + prev.system + "')")); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (prev.user < 0 || !Number.isFinite(prev.user)) { const e = new RangeError("The property 'prevValue.user' is invalid. Received " + prev.user); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; }
    if (prev.system < 0 || !Number.isFinite(prev.system)) { const e = new RangeError("The property 'prevValue.system' is invalid. Received " + prev.system); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; }
  }
  const usage = { user: 0, system: 0 };
  if (prev) { usage.user -= prev.user; usage.system -= prev.system; }
  return usage;
};

if (!process.hrtime) {
  const b = internalBinding('process_methods');
  process.hrtime = function hrtime(time) {
    if (time !== undefined) {
      if (!Array.isArray(time)) { const e = new TypeError('The "time" argument must be an instance of Array. Received type ' + typeof time + ' (' + time + ')'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
      if (time.length !== 2) { const e = new RangeError('The value of "time" is out of range. It must be 2. Received ' + time.length); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
    }
    const r = b.hrtime();
    if (time) { r[0] -= time[0]; r[1] -= time[1]; if (r[1] < 0) { r[0]--; r[1] += 1e9; } }
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
if (!process.binding) {
  let _utilBindingCache = null;
  const _utilBindingKeys = [
    'isAnyArrayBuffer', 'isArrayBuffer', 'isArrayBufferView', 'isAsyncFunction',
    'isDataView', 'isDate', 'isExternal', 'isMap', 'isMapIterator', 'isNativeError',
    'isPromise', 'isRegExp', 'isSet', 'isSetIterator', 'isTypedArray', 'isUint8Array',
  ];
  process.binding = (name) => {
    if (name === 'util') {
      if (!_utilBindingCache) {
        const t = require('util').types;
        _utilBindingCache = {};
        for (const k of _utilBindingKeys) _utilBindingCache[k] = t[k];
      }
      return _utilBindingCache;
    }
    throw new Error('process.binding is not supported');
  };
}

const _osB = internalBinding('os');
if (!process.getuid) process.getuid = () => _osB.getUid();
if (!process.getgid) process.getgid = () => _osB.getGid();
if (!process.geteuid) process.geteuid = () => _osB.getEuid();
if (!process.getegid) process.getegid = () => _osB.getEgid();
if (!process.getgroups) process.getgroups = () => [];
function _makeSetId(syscall, resolve, label) {
  return function(id) {
    if (typeof id !== 'number' && typeof id !== 'string') {
      const e = new TypeError('The "id" argument must be one of type number or string. Received an instance of ' + (id === null ? 'null' : id === undefined ? 'undefined' : (id.constructor && id.constructor.name) || 'Object'));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    let numId;
    if (typeof id === 'string') {
      numId = resolve(id);
      if (numId === -1) {
        const e = new Error(label + ' does not exist: ' + id);
        e.code = 'ERR_UNKNOWN_CREDENTIAL'; throw e;
      }
    } else {
      numId = id >>> 0;
    }
    const r = syscall(numId);
    if (r !== 0) {
      const e = new Error('EPERM, ' + label.toLowerCase());
      e.code = 'EPERM'; e.errno = -1; throw e;
    }
  };
}
if (!process.setuid || process.setuid.toString().includes('() => {}')) {
  process.setuid = _makeSetId(_osB.setUid.bind(_osB), _osB.resolveUser.bind(_osB), 'User identifier');
}
if (!process.setgid || process.setgid.toString().includes('() => {}')) {
  process.setgid = _makeSetId(_osB.setGid.bind(_osB), _osB.resolveGroup.bind(_osB), 'Group identifier');
}
if (!process.seteuid) {
  process.seteuid = _makeSetId(_osB.setEuid.bind(_osB), _osB.resolveUser.bind(_osB), 'User identifier');
}
if (!process.setegid) {
  process.setegid = _makeSetId(_osB.setEgid.bind(_osB), _osB.resolveGroup.bind(_osB), 'Group identifier');
}

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
