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
  // Deprecation flags are honored before the warning is ever emitted:
  // noDeprecation drops it entirely; throwDeprecation turns it into an
  // async uncaughtException (must NOT throw synchronously from emitWarning).
  if (msg.name === 'DeprecationWarning') {
    if (process.noDeprecation) return;
    if (process.throwDeprecation) { process.nextTick(() => { throw msg; }); return; }
  }
  process.nextTick(() => process.emit('warning', msg));
};

const _envB = internalBinding('env');
const _envOverrides = Object.create(null);
const _envDeleted = new Set();
process.env = new Proxy({}, {
  get(_, key) {
    if (typeof key === 'symbol') { if (key === Symbol.toStringTag) return 'process.env'; return undefined; }
    const k = String(key); if (!_envDeleted.has(k)) { if (k in _envOverrides) return _envOverrides[k]; const v = _envB.get(k); if (v !== undefined) return v; } return Object.prototype[key];
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
  getOwnPropertyDescriptor(_, key) { const k = String(key); if (_envDeleted.has(k)) return undefined; let v; if (k in _envOverrides) v = _envOverrides[k]; else v = _envB.get(k); if (v !== undefined) return { value: v, writable: true, enumerable: true, configurable: true }; return undefined; },
});

process.config = Object.freeze({ variables: Object.freeze({ asan: 0, v8_enable_i18n_support: 0, node_module_version: 135, node_builtin_shareable_builtins: Object.freeze([]) }), target_defaults: Object.freeze({ default_configuration: 'Release' }) });
process.features = { inspector: false, debug: false, uv: true, ipv6: true, openssl_is_boringssl: false, quic: false, tls_alpn: true, tls_sni: true, tls_ocsp: true, tls: true, cached_builtins: true, require_module: true, typescript: false };
if (!process.versions) process.versions = {};
process.versions = Object.freeze({
  node: '24.0.0', acorn: '8.14.0', ada: '3.2.0', ares: '1.34.4',
  brotli: '1.1.0', llhttp: '9.3.0', merve: '0.1.0', modules: '135',
  napi: '10', nbytes: '0.1.1', ncrypto: '0.0.1', nghttp2: '1.64.0',
  nghttp3: '1.6.0', ngtcp2: '1.9.1', openssl: '3.0.15+quic',
  simdjson: '3.11.2', simdutf: '6.1.1', sqlite: '3.47.2',
  uv: '1.50.0', uvwasi: '0.0.21', v8: process.versions?.v8 || '13.6.233.5',
  zlib: '1.3.1.1-motley-82a5fec', zstd: '1.5.7',
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
      if (process._fatalException) process._fatalException(e);
      else throw e;
    }
  }
};
process.nextTick = (fn, ...args) => {
  if (typeof fn !== 'function') {
    const e = new TypeError('The "callback" argument must be of type function. Received ' +
      (fn === null ? 'null' : typeof fn === 'object' ? 'an instance of ' + (fn.constructor?.name || 'Object') : 'type ' + typeof fn + ' (' + String(fn) + ')'));
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  process._nextTickQueue.push([fn, args]);
};

if (!process.on) {
  const EventEmitter = require('events');
  function ProcessProto() {}
  Object.setPrototypeOf(ProcessProto.prototype, EventEmitter.prototype);
  Object.setPrototypeOf(process, ProcessProto.prototype);
  EventEmitter.call(process);
}

// Default 'warning' handler — the ONLY place warnings are printed. Mirrors Node:
// non-Error payloads (e.g. process.emit('warning', 'str')) produce no output.
// Registered after EventEmitter is mixed into process (process.on now exists).
process.on('warning', (warning) => {
  if (!(warning instanceof Error)) return;
  let m = `(node:${process.pid}) `;
  if (warning.code) m += `[${warning.code}] `;
  m += `${warning.name}: ${warning.message}`;
  if (warning.detail) m += `\n${warning.detail}`;
  if (process.stderr && process.stderr.write) process.stderr.write(m + '\n');
  else console.error(m);
});

const _startTime = Date.now();
if (!process.uptime) process.uptime = () => (Date.now() - _startTime) / 1000;

// process.ref/unref: symbol-based API (Symbol.for('nodejs.ref')) takes precedence
// over the legacy .ref()/.unref() methods, matching Node's per_thread.js.
{
  const _kRef = Symbol.for('nodejs.ref');
  const _kUnref = Symbol.for('nodejs.unref');
  if (!process.ref) process.ref = function ref(maybeRefable) {
    const fn = maybeRefable == null ? undefined : (maybeRefable[_kRef] ?? maybeRefable.ref);
    if (typeof fn === 'function') fn.call(maybeRefable);
    else { const e = new TypeError('The "maybeRefable" argument must be a referenceable object'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
  };
  if (!process.unref) process.unref = function unref(maybeRefable) {
    const fn = maybeRefable == null ? undefined : (maybeRefable[_kUnref] ?? maybeRefable.unref);
    if (typeof fn === 'function') fn.call(maybeRefable);
    else { const e = new TypeError('The "maybeRefable" argument must be a referenceable object'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
  };
}
// Source maps: we don't remap stack traces yet, but honor the enable/disable
// API surface and its arg validation so callers behave correctly.
if (!process.setSourceMapsEnabled) {
  let _sourceMapsEnabled = false;
  process.setSourceMapsEnabled = function setSourceMapsEnabled(val) {
    if (typeof val !== 'boolean') { const e = new TypeError('The "val" argument must be of type boolean. Received ' + typeof val); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    _sourceMapsEnabled = val;
  };
  if (!process.getSourceMapsSupport) process.getSourceMapsSupport = () => ({ enabled: _sourceMapsEnabled, nodeModules: false, generatedCode: false });
}
// process.execve: replace the current process image. Returns only on failure.
if (!process.execve) {
  process.execve = function execve(execPath, args, env) {
    if (typeof execPath !== 'string') throw _ERR_INVALID_ARG_TYPE('execPath', 'string', execPath);
    if (!Array.isArray(args)) throw _ERR_INVALID_ARG_TYPE('args', 'Array', args);
    for (const a of args) if (typeof a !== 'string') throw _ERR_INVALID_ARG_TYPE('args', 'string[]', a);
    const src = env === undefined ? process.env : env;
    if (src === null || typeof src !== 'object') throw _ERR_INVALID_ARG_TYPE('env', 'object', env);
    const envArr = Object.keys(src).map((k) => `${k}=${src[k]}`);
    const errno = internalBinding('process_methods').execve(execPath, args, envArr);
    // execve only returns on error — surface it the way node does
    const e = new Error(`execve(2) failed, errno ${errno}`);
    e.code = errno === 2 ? 'ENOENT' : errno === 13 ? 'EACCES' : 'EINVAL';
    e.errno = -errno; e.syscall = 'execve';
    throw e;
  };
}
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
// Resolve argv[0] to absolute path for child_process spawning compat
if (process.argv[0] && !process.argv[0].startsWith('/')) {
  process.argv[0] = process.execPath;
}
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
    const origPid = pid;
    if (typeof pid === 'string') pid = Number(pid);
    if (typeof pid !== 'number' || Number.isNaN(pid) || !Number.isFinite(pid)) {
      let received;
      if (origPid === null) received = 'null';
      else if (origPid === undefined) received = 'undefined';
      else if (typeof origPid === 'string') received = "type string ('" + origPid + "')";
      else received = 'type ' + typeof origPid + ' (' + String(origPid) + ')';
      const e = new TypeError('The "pid" argument must be of type number. Received ' + received);
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    let sig;
    if (signal === undefined) { sig = 15; }
    else if (typeof signal === 'number') { sig = signal; }
    else if (typeof signal === 'string') {
      sig = _signals[signal];
      if (sig === undefined) { const e = new TypeError('Unknown signal: ' + signal); e.code = 'ERR_UNKNOWN_SIGNAL'; throw e; }
    } else { sig = signal; }
    if (sig < 0 || sig > 31) { const e = new Error('kill EINVAL'); e.code = 'EINVAL'; throw e; }
    const r = process._kill(pid, sig);
    // nonzero errno → process gone / not permitted (ESRCH/EPERM); sig 0 is an
    // existence probe, so a live process returns success here.
    if (r !== 0 && r !== undefined) { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; e.errno = -3; e.syscall = 'kill'; throw e; }
    return true;
  };
}
// Validate and wrap process.exitCode as a property
let _exitCode = process.exitCode || 0;
function _validateExitCode(code) {
  if (code === null || code === undefined) return 0;
  if (typeof code === 'number') {
    if (!Number.isInteger(code) || code < 0 || code > 255 || Number.isNaN(code) || !Number.isFinite(code)) {
      const v = Number.isNaN(code) ? 'NaN' : !Number.isFinite(code) ? String(code) : String(code);
      const e = new RangeError('The "code" argument is out of range. It must be an integer. Received ' + v);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    return code;
  }
  if (typeof code === 'string') {
    const trimmed = code.trim();
    const n = Number(code);
    if (trimmed.length > 0 && Number.isInteger(n) && n >= 0 && n <= 255) return n;
    const v = "'" + code + "'";
    const e = new TypeError('The "code" argument must be of type number. Received type string (' + v + ')');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  let v;
  if (typeof code === 'boolean') v = 'type boolean (' + code + ')';
  else if (typeof code === 'bigint') v = 'type bigint (' + code + 'n)';
  else if (typeof code === 'object') v = Array.isArray(code) ? 'an instance of Array' : 'an instance of ' + ((code.constructor && code.constructor.name) || 'Object');
  else v = 'type ' + typeof code + ' (' + String(code) + ')';
  const e = new TypeError('The "code" argument must be of type number. Received ' + v);
  e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
}
Object.defineProperty(process, 'exitCode', {
  get() { return _exitCode; },
  set(v) { _exitCode = _validateExitCode(v); },
  configurable: false, enumerable: true
});

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
    throw new Error('No such module: ' + name);
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
if (!process.setgroups) {
  process.setgroups = function(groups) {
    if (!Array.isArray(groups)) {
      const e = new TypeError('The "groups" argument must be an instance of Array. Received ' + (groups === undefined ? 'undefined' : groups === null ? 'null' : typeof groups));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (typeof g !== 'number' && typeof g !== 'string') {
        const v = g === undefined ? 'undefined' : g === null ? 'null' : typeof g === 'boolean' ? 'type boolean (' + g + ')' : typeof g === 'function' ? 'function ' + (g.name || '') : typeof g === 'object' ? (Array.isArray(g) ? 'an instance of Array' : 'an instance of ' + ((g.constructor && g.constructor.name) || 'Object')) : 'type ' + typeof g + ' (' + String(g) + ')';
        const e = new TypeError('The "groups[' + i + ']" argument must be one of type number or string. Received ' + v);
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      if (typeof g === 'number') {
        if (g < 0 || g > 0xFFFFFFFF || !Number.isInteger(g)) {
          const e = new RangeError('The value of "groups[' + i + ']" is out of range. It must be >= 0 && <= 4294967295. Received ' + g);
          e.code = 'ERR_OUT_OF_RANGE'; throw e;
        }
      } else {
        const resolved = _osB.resolveGroup(g);
        if (resolved === -1) {
          const e = new Error('Group identifier does not exist: ' + g);
          e.code = 'ERR_UNKNOWN_CREDENTIAL'; throw e;
        }
      }
    }
  };
}

let _uncaughtExceptionCallback = null;
process.setUncaughtExceptionCaptureCallback = (fn) => {
  if (fn !== null && typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('fn', 'function or null', fn);
  if (fn !== null && _uncaughtExceptionCallback !== null) {
    const e = new Error('`process.setupUncaughtExceptionCapture()` was called while a capture callback was already active');
    e.code = 'ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET'; throw e;
  }
  _uncaughtExceptionCallback = fn;
};
process.hasUncaughtExceptionCaptureCallback = () => _uncaughtExceptionCallback !== null;

// Single funnel for exceptions that escape an async callback. Mirrors Node:
// a capture callback or 'uncaughtException' listener handles it and execution
// continues; otherwise the error is printed and the process exits non-zero.
// Without this, escaped errors were swallowed and the process exited 0.
process._fatalException = function(er) {
  if (_uncaughtExceptionCallback !== null) {
    try { _uncaughtExceptionCallback(er); return true; }
    catch (er2) { er = er2; }
  } else {
    const handlers = process.listeners ? process.listeners('uncaughtException') : [];
    if (handlers && handlers.length > 0) {
      try { process.emit('uncaughtException', er, 'uncaughtException'); return true; }
      catch (er2) { er = er2; } // a handler itself threw → now fatal
    }
  }
  try {
    const msg = er && er.stack ? er.stack : String(er);
    if (process.stderr && process.stderr.write) process.stderr.write(msg + '\n');
    else console.error(msg);
  } catch {}
  if (!process.exitCode) process.exitCode = 1;
  process.exit(process.exitCode || 1);
  return false;
};

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
