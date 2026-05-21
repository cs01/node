// bootstrap.js — milo-node runtime bootstrap
// Sets up primordials, internalBinding, web globals, and require(). Minimal.
'use strict';

(function() {
  // --- primordials ---
  const primordials = {};
  const _pSrc = __loadBuiltin('internal/per_context/primordials');
  if (_pSrc) { (new Function('primordials', _pSrc))(primordials); }
  globalThis.primordials = primordials;

  // --- internalBinding shim ---
  const _constants = {
    os: {
      signals: { SIGHUP:1, SIGINT:2, SIGQUIT:3, SIGILL:4, SIGTRAP:5, SIGABRT:6, SIGFPE:8, SIGKILL:9, SIGBUS:10, SIGSEGV:11, SIGSYS:12, SIGPIPE:13, SIGALRM:14, SIGTERM:15, SIGURG:16, SIGSTOP:17, SIGTSTP:18, SIGCONT:19, SIGCHLD:20, SIGTTIN:21, SIGTTOU:22, SIGIO:23, SIGXCPU:24, SIGXFSZ:25, SIGVTALRM:26, SIGPROF:27, SIGINFO:29, SIGUSR1:30, SIGUSR2:31 },
      errno: { E2BIG:7, EACCES:13, EADDRINUSE:48, EADDRNOTAVAIL:49, EAGAIN:35, EALREADY:37, EBADF:9, EBUSY:16, ECANCELED:89, ECHILD:10, ECONNABORTED:53, ECONNREFUSED:61, ECONNRESET:54, EDEADLK:11, EDESTADDRREQ:39, EDOM:33, EEXIST:17, EFAULT:14, EFBIG:27, EHOSTUNREACH:65, EINPROGRESS:36, EINTR:4, EINVAL:22, EIO:5, EISCONN:56, EISDIR:21, ELOOP:62, EMFILE:24, EMLINK:31, EMSGSIZE:40, ENAMETOOLONG:63, ENETDOWN:50, ENETUNREACH:51, ENFILE:23, ENOBUFS:55, ENODEV:19, ENOENT:2, ENOMEM:12, ENOSPC:28, ENOSYS:78, ENOTCONN:57, ENOTDIR:20, ENOTEMPTY:66, ENOTSOCK:38, ENOTSUP:45, EPERM:1, EPIPE:32, ERANGE:34, EROFS:30, ESPIPE:29, ESRCH:3, ETIMEDOUT:60, EXDEV:18 },
      priority: { PRIORITY_LOW:19, PRIORITY_BELOW_NORMAL:10, PRIORITY_NORMAL:0, PRIORITY_ABOVE_NORMAL:-7, PRIORITY_HIGH:-14, PRIORITY_HIGHEST:-20 },
      UV_UDP_REUSEADDR: 4,
    },
    fs: { O_RDONLY:0, O_WRONLY:1, O_RDWR:2, O_CREAT:512, O_EXCL:2048, O_TRUNC:1024, O_APPEND:8, O_DIRECTORY:1048576, O_NOFOLLOW:256, O_SYNC:128, O_SYMLINK:2097152, O_NONBLOCK:4, S_IFMT:61440, S_IFREG:32768, S_IFDIR:16384, S_IFLNK:40960, S_IFCHR:8192, S_IFBLK:24576, S_IFIFO:4096, S_IFSOCK:49152, S_IRWXU:448, S_IRUSR:256, S_IWUSR:128, S_IXUSR:64, S_IRWXG:56, S_IRGRP:32, S_IWGRP:16, S_IXGRP:8, S_IRWXO:7, S_IROTH:4, S_IWOTH:2, S_IXOTH:1, F_OK:0, R_OK:4, W_OK:2, X_OK:1, UV_FS_COPYFILE_EXCL:1, UV_FS_COPYFILE_FICLONE:2, COPYFILE_EXCL:1, COPYFILE_FICLONE:2 },
  };
  const _types = {
    isDate: (v) => v instanceof Date, isMap: (v) => v instanceof Map, isSet: (v) => v instanceof Set,
    isWeakMap: (v) => v instanceof WeakMap, isWeakSet: (v) => v instanceof WeakSet,
    isRegExp: (v) => v instanceof RegExp, isPromise: (v) => v instanceof Promise,
    isNativeError: (v) => v instanceof Error, isArrayBuffer: (v) => v instanceof ArrayBuffer,
    isSharedArrayBuffer: (v) => typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer,
    isProxy: () => false, isExternal: () => false,
    isAnyArrayBuffer: (v) => v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
    isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView), isDataView: (v) => v instanceof DataView,
  };
  const _jsBindings = {
    constants: _constants, types: _types,
    config: { hasIntl: true, hasOpenSSL: false, hasCrypto: false, hasInspector: false },
    errors: { exitCodes: { kNoFailure: 0, kGenericUserError: 1 }, noSideEffectsToString(v) { try { return ''+v; } catch { return 'Object'; } }, triggerUncaughtException(e) { throw e; } },
  };
  const _nativeBinding = internalBinding;
  globalThis.internalBinding = function(name) {
    if (_jsBindings[name]) return _jsBindings[name];
    try { return _nativeBinding(name); } catch { return Object.freeze(Object.create(null)); }
  };
  globalThis.getInternalBinding = globalThis.internalBinding;

  // --- web globals (bare V8 isolate lacks these) ---
  if (typeof AbortController === 'undefined') {
    globalThis.AbortController = class AbortController { #signal = { aborted: false, reason: undefined, throwIfAborted() { if (this.aborted) throw this.reason; }, addEventListener() {}, removeEventListener() {} }; get signal() { return this.#signal; } abort(reason) { this.#signal.aborted = true; this.#signal.reason = reason || new DOMException('AbortError'); } };
    globalThis.AbortSignal = { abort(reason) { const c = new AbortController(); c.abort(reason); return c.signal; }, timeout(ms) { const c = new AbortController(); setTimeout?.(() => c.abort(new DOMException('TimeoutError')), ms); return c.signal; } };
  }
  if (typeof DOMException === 'undefined') globalThis.DOMException = class DOMException extends Error { constructor(msg, name) { super(msg); this.name = name || 'Error'; this.code = 0; } };
  if (typeof Event === 'undefined') globalThis.Event = class Event { constructor(type, opts) { this.type = type; this.bubbles = opts?.bubbles || false; this.cancelable = opts?.cancelable || false; this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } };
  if (typeof EventTarget === 'undefined') globalThis.EventTarget = class EventTarget { #h = {}; addEventListener(t, fn) { (this.#h[t] ??= []).push(fn); } removeEventListener(t, fn) { const a = this.#h[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } } dispatchEvent(ev) { for (const fn of (this.#h[ev.type] || [])) fn(ev); } };
  if (typeof URL === 'undefined') {
    globalThis.URL = class URL { constructor(url, base) { if (base) url = base.replace(/\/$/, '') + '/' + url.replace(/^\//, ''); const m = url.match(/^([a-z]+):\/\/([^/:]+)?(?::(\d+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i); this.protocol = m?.[1] ? m[1] + ':' : ''; this.hostname = m?.[2] || ''; this.port = m?.[3] || ''; this.pathname = m?.[4] || '/'; this.search = m?.[5] || ''; this.hash = m?.[6] || ''; this.host = this.hostname + (this.port ? ':' + this.port : ''); this.href = url; this.origin = this.protocol + '//' + this.host; } toString() { return this.href; } };
    globalThis.URLSearchParams = class URLSearchParams { #p = []; constructor(init) { if (typeof init === 'string') { for (const p of init.replace(/^\?/,'').split('&')) { const [k,...v] = p.split('='); this.#p.push([decodeURIComponent(k), decodeURIComponent(v.join('='))]); } } } get(k) { const e = this.#p.find(([a])=>a===k); return e ? e[1] : null; } has(k) { return this.#p.some(([a])=>a===k); } };
  }
  if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = class TextEncoder { encode(s) { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff); return new Uint8Array(a); } };
  if (typeof TextDecoder === 'undefined') globalThis.TextDecoder = class TextDecoder { decode(buf) { if (!buf) return ''; const a = new Uint8Array(buf.buffer || buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; } };
  if (typeof queueMicrotask === 'undefined') globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
  if (typeof fetch === 'undefined') globalThis.fetch = () => Promise.reject(new Error('fetch not implemented'));
  if (typeof atob === 'undefined') globalThis.atob = function(s) { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let r = '', i = 0; s = s.replace(/=/g, ''); while (i < s.length) { const a = chars.indexOf(s[i++]), b = chars.indexOf(s[i++]||'A'), c = chars.indexOf(s[i++]||'A'), d = chars.indexOf(s[i++]||'A'); r += String.fromCharCode((a<<2)|(b>>4)); if(s[i-2]!==undefined) r+=String.fromCharCode(((b&15)<<4)|(c>>2)); if(s[i-1]!==undefined) r+=String.fromCharCode(((c&3)<<6)|d); } return r; };
  if (typeof btoa === 'undefined') globalThis.btoa = function(s) { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let r = ''; for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i+1), c = s.charCodeAt(i+2); r += chars[a>>2] + chars[((a&3)<<4)|(b>>4)] + (isNaN(b)?'=':chars[((b&15)<<2)|(c>>6)]) + (isNaN(c)?'=':chars[c&63]); } return r; };
  if (typeof performance === 'undefined') globalThis.performance = { now() { return Date.now(); }, timeOrigin: Date.now() };
  if (typeof global === 'undefined') globalThis.global = globalThis;
  if (typeof structuredClone === 'undefined') globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));

  // --- require() ---
  const _fsBinding = _nativeBinding('fs');
  const _fs = {
    readFileSync(path) { const r = _fsBinding.readFile(String(path)); if (r === -1) throw new Error('ENOENT: ' + path); return r; },
    existsSync(path) { return !!_fsBinding.exists(String(path)); },
    statSync(path) { const s = _fsBinding.stat(String(path)); if (s === -1) throw new Error('ENOENT: ' + path); return { ...s, isFile: () => !!s.isFile, isDirectory: () => !!s.isDirectory }; },
  };

  const _miloLibDir = globalThis.__libDir.replace(/\/lib$/, '/src/milo/lib');
  function _tryMiloLib(id) {
    const path = _miloLibDir + '/' + id + '.js';
    if (_fs.existsSync(path)) return _fs.readFileSync(path);
    return undefined;
  }

  const _pathSrc = _tryMiloLib('path') || __loadBuiltin('path');
  const _pathMod = { exports: {} };
  (new Function('exports', 'module', 'primordials', _pathSrc))(_pathMod.exports, _pathMod, primordials);
  const _path = _pathMod.exports;

  const moduleCache = { path: _path };
  const _moduleWrappers = {};
  const _requireStack = [];
  globalThis._requireStack = _requireStack;

  function _resolve(id, parentDir) {
    if (!id.startsWith('./') && !id.startsWith('../') && !id.startsWith('/')) return null;
    let resolved = parentDir ? _path.resolve(parentDir, id) : _path.resolve(id);
    if (_fs.existsSync(resolved) && _fs.statSync(resolved).isDirectory()) resolved = _path.join(resolved, 'index.js');
    else if (!resolved.endsWith('.js') && !resolved.endsWith('.json')) {
      if (_fs.existsSync(resolved + '.js')) resolved += '.js';
      else if (_fs.existsSync(resolved + '/index.js')) resolved += '/index.js';
    }
    return resolved;
  }

  globalThis.require = function require(id) {
    if (id.startsWith('node:')) id = id.slice(5);
    const flatId = id.replace(/\//g, '_');
    if (_moduleWrappers[id]) return _moduleWrappers[id].exports;
    if (moduleCache[id]) return moduleCache[id];

    let src = _tryMiloLib(id) || _tryMiloLib(flatId) || __loadBuiltin(id);
    if (src !== undefined) {
      const mod = { exports: {} };
      _moduleWrappers[id] = mod;
      const fname = _path.join(_miloLibDir, id + '.js');
      const dname = _path.dirname(fname);
      _requireStack.push(dname);
      try { (new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', src))(mod.exports, require, mod, fname, dname, primordials); }
      finally { _requireStack.pop(); }
      moduleCache[id] = mod.exports;
      delete _moduleWrappers[id];
      return mod.exports;
    }

    const parentDir = _requireStack.length > 0 ? _requireStack[_requireStack.length - 1] : '';
    const resolved = _resolve(id, parentDir);
    if (_moduleWrappers[resolved]) return _moduleWrappers[resolved].exports;
    if (resolved && moduleCache[resolved]) return moduleCache[resolved];
    if (resolved) {
      const fileSrc = _fs.readFileSync(resolved);
      const mod = { exports: {} };
      _moduleWrappers[resolved] = mod;
      if (id !== resolved) _moduleWrappers[id] = mod;
      const dname = _path.dirname(resolved);
      _requireStack.push(dname);
      try {
        if (resolved.endsWith('.json')) mod.exports = JSON.parse(fileSrc);
        else (new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', fileSrc))(mod.exports, require, mod, resolved, dname, primordials);
      } finally { _requireStack.pop(); }
      moduleCache[resolved] = mod.exports;
      if (id !== resolved) moduleCache[id] = mod.exports;
      delete _moduleWrappers[resolved]; delete _moduleWrappers[id];
      return mod.exports;
    }

    try { const b = _nativeBinding(id); moduleCache[id] = b; return b; } catch {}
    throw new Error("Cannot find module '" + id + "'");
  };

  // --- load internal init modules (order matters) ---
  require('_console_init');
  require('_process_init');
  require('_timers_init');
  try { const _b = require('buffer'); globalThis.Buffer = _b.Buffer || _b; } catch {}
})();
