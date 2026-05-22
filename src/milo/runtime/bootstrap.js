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
    config: { hasIntl: true, hasOpenSSL: true, hasCrypto: true, hasInspector: false },
    errors: { exitCodes: { kNoFailure: 0, kGenericUserError: 1, kUnfinishedTopLevelAwait: 13 }, noSideEffectsToString(v) { try { return ''+v; } catch { return 'Object'; } }, triggerUncaughtException(e) { throw e; } },
    util: {
      getCallerLocation() { return undefined; },
      getPromiseDetails(p) { return [0, undefined]; },
      getProxyDetails() { return undefined; },
      previewEntries(v) { return [[], false]; },
      sleep() {},
      guessHandleType() { return 'UNKNOWN'; },
      defineLazyProperties(target, id, keys) { return target; },
      getOwnNonIndexProperties(obj, filter) { return Object.getOwnPropertyNames(obj).filter(k => !/^\d+$/.test(k)); },
      getConstructorName(obj) { return obj?.constructor?.name || ''; },
      getExternalValue() { return 0n; },
      constants: { ALL_PROPERTIES: 0, ONLY_ENUMERABLE: 2, SKIP_SYMBOLS: 8, SKIP_STRINGS: 16, kPending: 0, kFulfilled: 1, kRejected: 2 },
      privateSymbols: {
        arrow_message_private_symbol: Symbol('arrow_message_private_symbol'),
        decorated_private_symbol: Symbol('decorated_private_symbol'),
        owner_symbol: Symbol('owner_symbol'),
      },
    },
    uv: {
      errname(code) { return 'UV_UNKNOWN'; },
      getErrorMap() {
        return new Map([
          [-2, ['ENOENT', 'no such file or directory']],
          [-1, ['EPERM', 'operation not permitted']],
          [-13, ['EACCES', 'permission denied']],
          [-17, ['EEXIST', 'file already exists']],
          [-22, ['EINVAL', 'invalid argument']],
          [-4058, ['ENOENT', 'no such file or directory']],
          [-4048, ['EPERM', 'operation not permitted']],
        ]);
      },
      UV_EAI_MEMORY: -3000,
    },
    icu: { transcode: (source) => source },
    options: { getOptions() { return new Map(); } },
    credentials: { implementsPosixCredentials: true },
    inspector: { open() {}, url() { return undefined; }, waitForDebugger() {} },
    task_queue: {
      setTickCallback() {},
      setPromiseRejectCallback() {},
      tickInfo: [0, 0],
      promiseRejectEvents: { kPromiseRejectWithNoHandler: 0, kPromiseHandlerAddedAfterReject: 1, kPromiseRejectAfterResolved: 2, kPromiseResolveAfterResolved: 3 },
    },
    messaging: {},
    symbols: {
      arrow_message_private_symbol: Symbol('arrow_message_private_symbol'),
      decorated_private_symbol: Symbol('decorated_private_symbol'),
      owner_symbol: Symbol('owner_symbol'),
      handle_onclose_symbol: Symbol('handle_onclose'),
    },
    worker: { isMainThread: true, threadId: 0 },
    performance: {
      milestones: {},
      loopIdleTime() { return 0; },
      timerify() { return arguments[0]; },
      markBootstrapComplete() {},
      constants: {
        NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN: 0, NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE: 1,
        NODE_PERFORMANCE_MILESTONE_ENVIRONMENT: 2, NODE_PERFORMANCE_MILESTONE_LOOP_START: 3,
        NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: 4, NODE_PERFORMANCE_MILESTONE_V8_START: 5,
        NODE_PERFORMANCE_MILESTONE_NODE_START: 6,
        NODE_PERFORMANCE_ENTRY_TYPE_GC: 0, NODE_PERFORMANCE_ENTRY_TYPE_HTTP: 1,
        NODE_PERFORMANCE_ENTRY_TYPE_HTTP2: 2, NODE_PERFORMANCE_ENTRY_TYPE_NET: 3,
        NODE_PERFORMANCE_ENTRY_TYPE_DNS: 4,
        NODE_PERFORMANCE_GC_MAJOR: 1, NODE_PERFORMANCE_GC_MINOR: 2,
        NODE_PERFORMANCE_GC_INCREMENTAL: 4, NODE_PERFORMANCE_GC_WEAKCB: 8,
        NODE_PERFORMANCE_GC_FLAGS_NO: 0, NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED: 1,
        NODE_PERFORMANCE_GC_FLAGS_FORCED: 2,
      },
      setupObservers() {},
      installGarbageCollectionTracking() {},
      removeGarbageCollectionTracking() {},
      createHistogram() { return { min: 0, max: 0, mean: 0, exceeds: 0, stddev: 0, percentile() { return 0; }, percentiles: new Map(), reset() {} }; },
      timeOrigin: Date.now(),
      timeOriginTimestamp: Date.now(),
      now() { return globalThis.performance ? globalThis.performance.now() : Date.now(); },
    },
    serdes: { Serializer: class { writeHeader() {} writeValue() {} releaseBuffer() { return Buffer.alloc(0); } }, Deserializer: class { readHeader() {} readValue() { return undefined; } } },
    async_wrap: {
      constants: { kInit: 0, kBefore: 1, kAfter: 2, kDestroy: 3, kTotals: 4, kPromiseResolve: 5, kCheck: 6, kExecutionAsyncId: 7, kTriggerAsyncId: 8, kAsyncIdCounter: 9, kDefaultTriggerAsyncId: 10, kStackLength: 11 },
      async_hook_fields: new Uint32Array(12),
      async_id_fields: new Float64Array(4),
      execution_async_resources: [],
      owner_symbol: Symbol('owner_symbol'),
      setCallbackTrampoline() {},
      registerDestroyHook() {},
      clearAsyncIdStack() {},
      pushAsyncContext() {},
      popAsyncContext() { return false; },
      queueDestroyAsyncId() {},
      enablePromiseHook() {},
      disablePromiseHook() {},
      Providers: {},
    },
    contextify: { ContextifyScript: class { constructor() {} runInThisContext() {} runInContext() {} } },
    string_decoder: { encodings: { utf8: 0, ucs2: 1, latin1: 2 } },
    heap_utils: { createHeapSnapshotStream() { throw new Error('heap snapshot not available'); } },
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
    globalThis.URLSearchParams = class URLSearchParams {
      #p = [];
      constructor(init) {
        if (typeof init === 'string') { for (const p of init.replace(/^\?/,'').split('&').filter(Boolean)) { const [k,...v] = p.split('='); this.#p.push([decodeURIComponent(k), decodeURIComponent(v.join('='))]); } }
        else if (init && typeof init === 'object') { for (const [k,v] of (Array.isArray(init) ? init : Object.entries(init))) this.#p.push([String(k), String(v)]); }
      }
      get(k) { const e = this.#p.find(([a])=>a===k); return e ? e[1] : null; }
      getAll(k) { return this.#p.filter(([a])=>a===k).map(([,v])=>v); }
      has(k) { return this.#p.some(([a])=>a===k); }
      set(k, v) { let found = false; this.#p = this.#p.filter(([a]) => { if (a===k && !found) { found = true; return true; } return a!==k; }); if (found) this.#p.find(([a])=>a===k)[1] = String(v); else this.#p.push([k, String(v)]); }
      append(k, v) { this.#p.push([String(k), String(v)]); }
      delete(k) { this.#p = this.#p.filter(([a])=>a!==k); }
      forEach(fn) { for (const [k,v] of this.#p) fn(v, k, this); }
      keys() { return this.#p.map(([k])=>k)[Symbol.iterator](); }
      values() { return this.#p.map(([,v])=>v)[Symbol.iterator](); }
      entries() { return this.#p[Symbol.iterator](); }
      [Symbol.iterator]() { return this.entries(); }
      toString() { return this.#p.map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&'); }
      get size() { return this.#p.length; }
    };
    globalThis.URL = class URL {
      constructor(url, base) {
        if (base) { const b = typeof base === 'string' ? base : base.href; url = b.replace(/\/$/, '') + '/' + url.replace(/^\//, ''); }
        const m = url.match(/^([a-z]+):\/\/(?:([^@]+)@)?([^/:?#]+)?(?::(\d+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i);
        this.protocol = m?.[1] ? m[1] + ':' : ''; this.username = m?.[2]?.split(':')[0] || ''; this.password = m?.[2]?.split(':')[1] || '';
        this.hostname = m?.[3] || ''; this.port = m?.[4] || ''; this.pathname = m?.[5] || '/'; this.search = m?.[6] || ''; this.hash = m?.[7] || '';
        this.host = this.hostname + (this.port ? ':' + this.port : ''); this.origin = this.protocol + '//' + this.host;
        this.href = url; this.searchParams = new URLSearchParams(this.search);
      }
      toString() { return this.href; }
      toJSON() { return this.href; }
    };
  }
  if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = class TextEncoder { encode(s) { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff); return new Uint8Array(a); } };
  if (typeof TextDecoder === 'undefined') globalThis.TextDecoder = class TextDecoder { decode(buf) { if (!buf) return ''; const a = new Uint8Array(buf.buffer || buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; } };
  if (typeof queueMicrotask === 'undefined') globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
  if (typeof fetch === 'undefined') globalThis.fetch = () => Promise.reject(new Error('fetch not implemented'));
  if (typeof atob === 'undefined') globalThis.atob = function(s) { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let r = '', i = 0; s = s.replace(/=/g, ''); while (i < s.length) { const a = chars.indexOf(s[i++]), b = chars.indexOf(s[i++]||'A'), c = chars.indexOf(s[i++]||'A'), d = chars.indexOf(s[i++]||'A'); r += String.fromCharCode((a<<2)|(b>>4)); if(s[i-2]!==undefined) r+=String.fromCharCode(((b&15)<<4)|(c>>2)); if(s[i-1]!==undefined) r+=String.fromCharCode(((c&3)<<6)|d); } return r; };
  if (typeof btoa === 'undefined') globalThis.btoa = function(s) { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let r = ''; for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i+1), c = s.charCodeAt(i+2); r += chars[a>>2] + chars[((a&3)<<4)|(b>>4)] + (isNaN(b)?'=':chars[((b&15)<<2)|(c>>6)]) + (isNaN(c)?'=':chars[c&63]); } return r; };
  if (typeof performance === 'undefined') { const _perfOrigin = Date.now(); globalThis.performance = { now() { return Date.now() - _perfOrigin; }, timeOrigin: _perfOrigin }; }
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

  function _resolveExport(exp) {
    if (typeof exp === 'string') return exp;
    if (exp && typeof exp === 'object') {
      if (exp.require) return _resolveExport(exp.require);
      if (exp.node) return _resolveExport(exp.node);
      if (exp.default) return _resolveExport(exp.default);
    }
    return null;
  }

  // --- ESM support: detect and transform import/export to CJS ---
  const _pkgJsonCache = {};
  function _findPkgJson(dir) {
    if (_pkgJsonCache[dir] !== undefined) return _pkgJsonCache[dir];
    const p = _path.join(dir, 'package.json');
    if (_fs.existsSync(p)) {
      try { const pj = JSON.parse(_fs.readFileSync(p)); _pkgJsonCache[dir] = pj; return pj; } catch {}
    }
    const parent = _path.dirname(dir);
    if (parent === dir) { _pkgJsonCache[dir] = null; return null; }
    const result = _findPkgJson(parent);
    _pkgJsonCache[dir] = result;
    return result;
  }
  function _findPkgJsonDir(dir) {
    const p = _path.join(dir, 'package.json');
    if (_fs.existsSync(p)) return dir;
    const parent = _path.dirname(dir);
    if (parent === dir) return null;
    return _findPkgJsonDir(parent);
  }

  function _isESM(resolved) {
    if (resolved.endsWith('.mjs')) return true;
    if (resolved.endsWith('.cjs')) return false;
    const dir = _path.dirname(resolved);
    const pj = _findPkgJson(dir);
    return pj && pj.type === 'module';
  }

  // Resolve #imports specifiers (package.json "imports" field)
  function _resolveHashImport(specifier, fromDir) {
    const pkgDir = _findPkgJsonDir(fromDir);
    if (!pkgDir) return null;
    const pj = _findPkgJson(pkgDir);
    if (!pj || !pj.imports) return null;
    const mapping = pj.imports[specifier];
    if (!mapping) return null;
    const target = _resolveExport(mapping) || (typeof mapping === 'string' ? mapping : null);
    if (target) return _resolveFile(_path.resolve(pkgDir, target));
    return null;
  }

  function _esmToCjs(src, filePath) {
    const lines = src.split('\n');
    const imports = [];
    const exports = [];
    const transformed = [];
    let hasDefaultExport = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let handled = false;

      // import X, { A, B } from 'source' (combined default + named)
      let m = line.match(/^\s*import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
      if (m) {
        const names = m[2].split(',').map(s => s.trim().replace(/\s+as\s+/g, ': ')).filter(Boolean).join(', ');
        transformed.push(`const __imp_${i} = require('${m[3]}'); const ${m[1]} = __imp_${i} && __imp_${i}.__esModule ? __imp_${i}.default : __imp_${i}; const { ${names} } = __imp_${i};`);
        handled = true;
      }

      // import X from 'source'
      if (!handled) {
        m = line.match(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
        if (m) { transformed.push(`const __imp_${i} = require('${m[2]}'); const ${m[1]} = __imp_${i} && __imp_${i}.__esModule ? __imp_${i}.default : __imp_${i};`); handled = true; }
      }

      // import { A, B } from 'source' (possibly multi-line start)
      if (!handled) {
        m = line.match(/^\s*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
        if (m) {
          const names = m[1].split(',').map(s => s.trim().replace(/\s+as\s+/g, ': ')).filter(Boolean).join(', ');
          transformed.push(`const { ${names} } = require('${m[2]}');`);
          handled = true;
        }
      }

      // import { \n ... } from 'source' (multi-line — brace may be followed by comment)
      if (!handled) {
        m = line.match(/^\s*import\s+\{.*$/);
        if (m && !line.includes('}') && !line.includes(' from ')) {
          let braceContent = '';
          let j = i + 1;
          while (j < lines.length && !lines[j].includes('}')) { braceContent += lines[j].trim() + ' '; j++; }
          if (j < lines.length) {
            const closeLine = lines[j];
            const fromMatch = closeLine.match(/\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
            if (fromMatch) {
              const beforeBrace = closeLine.match(/^([^}]*)\}/);
              if (beforeBrace && beforeBrace[1].trim()) braceContent += beforeBrace[1].trim() + ' ';
              const names = braceContent.split(',').map(s => s.trim().replace(/\s+as\s+/g, ': ')).filter(Boolean).join(', ');
              transformed.push(`const { ${names} } = require('${fromMatch[1]}');`);
              i = j;
              handled = true;
            }
          }
        }
      }

      // import * as X from 'source'
      if (!handled) {
        m = line.match(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
        if (m) { transformed.push(`const ${m[1]} = require('${m[2]}');`); handled = true; }
      }

      // import 'source' (side-effect only)
      if (!handled) {
        m = line.match(/^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/);
        if (m) { transformed.push(`require('${m[1]}');`); handled = true; }
      }

      // export default function/class — strip prefix, defer assignment to end of file
      if (!handled) {
        m = line.match(/^\s*export\s+default\s+function\s+(\w+)/);
        if (m) { transformed.push(line.replace(/^\s*export\s+default\s+/, '')); exports.push(`exports.default = ${m[1]};`); hasDefaultExport = true; handled = true; }
      }
      if (!handled) {
        m = line.match(/^\s*export\s+default\s+class\s+(\w+)/);
        if (m) { transformed.push(line.replace(/^\s*export\s+default\s+/, '')); exports.push(`exports.default = ${m[1]};`); hasDefaultExport = true; handled = true; }
      }
      if (!handled) {
        m = line.match(/^\s*export\s+default\s+/);
        if (m) { transformed.push(line.replace(/^\s*export\s+default\s+/, 'exports.default = ')); hasDefaultExport = true; handled = true; }
      }

      // export { default as X } from 'source' / export { X } from 'source' / export { X, Y }
      if (!handled) {
        m = line.match(/^\s*export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
        if (m) {
          const source = m[2];
          const specs = m[1].split(',').map(s => s.trim()).filter(Boolean);
          const tmpVar = '__reexport_' + i;
          transformed.push(`const ${tmpVar} = require('${source}');`);
          for (const spec of specs) {
            const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
            if (asMatch) {
              if (asMatch[1] === 'default') transformed.push(`Object.defineProperty(exports, '${asMatch[2]}', { enumerable: true, get() { return ${tmpVar} && ${tmpVar}.__esModule ? ${tmpVar}.default : ${tmpVar}; } });`);
              else transformed.push(`Object.defineProperty(exports, '${asMatch[2]}', { enumerable: true, get() { return ${tmpVar}.${asMatch[1]}; } });`);
            } else {
              transformed.push(`Object.defineProperty(exports, '${spec}', { enumerable: true, get() { return ${tmpVar}.${spec}; } });`);
            }
          }
          handled = true;
        }
      }

      // export { X, Y } (local re-export, no from)
      if (!handled) {
        m = line.match(/^\s*export\s+\{([^}]+)\}\s*;?\s*$/);
        if (m) {
          const specs = m[1].split(',').map(s => s.trim()).filter(Boolean);
          for (const spec of specs) {
            const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
            if (asMatch) transformed.push(`Object.defineProperty(exports, '${asMatch[2]}', { enumerable: true, get() { return ${asMatch[1]}; } });`);
            else transformed.push(`Object.defineProperty(exports, '${spec}', { enumerable: true, get() { return ${spec}; } });`);
          }
          handled = true;
        }
      }

      // Multi-line export { ... } from 'source' or export { ... }
      if (!handled) {
        m = line.match(/^\s*export\s+\{\s*$/);
        if (m) {
          let braceContent = '';
          let j = i + 1;
          while (j < lines.length && !lines[j].includes('}')) { braceContent += lines[j].replace(/\/\/.*$/, '').trim() + ' '; j++; }
          if (j < lines.length) {
            const closeLine = lines[j];
            const beforeBrace = closeLine.match(/^([^}]*)\}/);
            if (beforeBrace && beforeBrace[1].trim()) braceContent += beforeBrace[1].replace(/\/\/.*$/, '').trim() + ' ';
            const fromMatch = closeLine.match(/\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
            const specs = braceContent.split(',').map(s => s.trim().replace(/\/\/.*$/, '').trim()).filter(Boolean);
            if (fromMatch) {
              const source = fromMatch[1];
              const tmpVar = '__reexport_' + i;
              transformed.push(`const ${tmpVar} = require('${source}');`);
              for (const spec of specs) {
                const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
                if (asMatch) {
                  if (asMatch[1] === 'default') transformed.push(`Object.defineProperty(exports, '${asMatch[2]}', { enumerable: true, get() { return ${tmpVar} && ${tmpVar}.__esModule ? ${tmpVar}.default : ${tmpVar}; } });`);
                  else transformed.push(`Object.defineProperty(exports, '${asMatch[2]}', { enumerable: true, get() { return ${tmpVar}.${asMatch[1]}; } });`);
                } else {
                  transformed.push(`Object.defineProperty(exports, '${spec}', { enumerable: true, get() { return ${tmpVar}.${spec}; } });`);
                }
              }
            } else {
              for (const spec of specs) {
                const asMatch = spec.match(/^(\w+)\s+as\s+(\w+)$/);
                if (asMatch) transformed.push(`Object.defineProperty(exports, '${asMatch[2]}', { enumerable: true, get() { return ${asMatch[1]}; } });`);
                else transformed.push(`Object.defineProperty(exports, '${spec}', { enumerable: true, get() { return ${spec}; } });`);
              }
            }
            i = j;
            handled = true;
          }
        }
      }

      // export function/class — strip and defer assignment
      if (!handled) {
        m = line.match(/^\s*export\s+(function|class)\s+(\w+)/);
        if (m) { transformed.push(line.replace(/^\s*export\s+/, '')); exports.push(`exports.${m[2]} = ${m[2]};`); handled = true; }
      }
      // export const/let/var — inline assignment is safe (single statement)
      if (!handled) {
        m = line.match(/^\s*export\s+(const|let|var)\s+(\w+)/);
        if (m) { transformed.push(line.replace(/^\s*export\s+/, '')); exports.push(`exports.${m[2]} = ${m[2]};`); handled = true; }
      }

      if (!handled) transformed.push(line);
    }

    let result = 'Object.defineProperty(exports, "__esModule", { value: true });\n' + transformed.join('\n');
    if (exports.length) result += '\n' + exports.join('\n');
    // If module has a default export, make require() return the default with named exports
    if (hasDefaultExport) result += '\nif (exports.default != null && (typeof exports.default === "function" || typeof exports.default === "object")) { const __def = exports.default; for (const __k of Object.keys(exports)) { if (__k !== "default" && __k !== "__esModule") try { Object.defineProperty(__def, __k, Object.getOwnPropertyDescriptor(exports, __k) || { value: exports[__k], enumerable: true }); } catch {} } __def.__esModule = true; __def.default = __def; module.exports = __def; }';
    return result;
  }

  function _resolveFile(p) {
    if (_fs.existsSync(p)) {
      try { if (_fs.statSync(p).isDirectory()) {
        const pkg = _path.join(p, 'package.json');
        if (_fs.existsSync(pkg)) {
          try {
            const pj = JSON.parse(_fs.readFileSync(pkg));
            if (pj.exports) {
              const entry = pj.exports['.'] || pj.exports;
              const target = _resolveExport(entry);
              if (target) { const mp = _resolveFile(_path.resolve(p, target)); if (mp) return mp; }
            }
            if (pj.main) { const mp = _resolveFile(_path.resolve(p, pj.main)); if (mp) return mp; }
          } catch {}
        }
        if (_fs.existsSync(_path.join(p, 'index.js'))) return _path.join(p, 'index.js');
        if (_fs.existsSync(_path.join(p, 'index.json'))) return _path.join(p, 'index.json');
        // directory exists but no entry point — fall through to try .js/.json extensions
      }} catch {}
      // only return bare path if it's a file, not an unresolvable directory
      try { if (!_fs.statSync(p).isDirectory()) return p; } catch { return p; }
    }
    if (_fs.existsSync(p + '.js')) return p + '.js';
    if (_fs.existsSync(p + '.json')) return p + '.json';
    if (_fs.existsSync(p + '/index.js')) return p + '/index.js';
    return null;
  }

  function _resolveExportSubpath(pkgDir, subpath) {
    const pkg = _path.join(pkgDir, 'package.json');
    if (!_fs.existsSync(pkg)) return null;
    try {
      const pj = JSON.parse(_fs.readFileSync(pkg));
      if (!pj.exports || typeof pj.exports !== 'object') return null;
      const key = './' + subpath;
      const entry = pj.exports[key];
      if (entry) { const target = _resolveExport(entry); if (target) return _resolveFile(_path.resolve(pkgDir, target)); }
    } catch {}
    return null;
  }

  function _resolveNodeModules(id, startDir) {
    let dir = startDir;
    const slashIdx = id.indexOf('/');
    const pkgName = slashIdx >= 0 ? (id.startsWith('@') ? id.slice(0, id.indexOf('/', slashIdx + 1)) : id.slice(0, slashIdx)) : id;
    const subpath = slashIdx >= 0 ? id.slice(pkgName.length + 1) : null;
    while (dir && dir !== '/') {
      const pkgDir = _path.join(dir, 'node_modules', pkgName);
      if (subpath && _fs.existsSync(pkgDir)) {
        const exported = _resolveExportSubpath(pkgDir, subpath);
        if (exported) return exported;
        const direct = _resolveFile(_path.join(pkgDir, subpath));
        if (direct) return direct;
      }
      if (!subpath) {
        const resolved = _resolveFile(_path.join(dir, 'node_modules', id));
        if (resolved) return resolved;
      }
      dir = _path.dirname(dir);
    }
    return null;
  }

  function _resolve(id, parentDir) {
    if (id === '.' || id === '..' || id.startsWith('./') || id.startsWith('../') || id.startsWith('/')) {
      const base = parentDir ? _path.resolve(parentDir, id) : _path.resolve(id);
      return _resolveFile(base);
    }
    // bare specifier — try node_modules walk
    if (parentDir) return _resolveNodeModules(id, parentDir);
    return null;
  }

  function _loadModule(id, resolved, fileSrc) {
    const mod = { exports: {} };
    // Link require.main to actual module object so `module === require.main` works
    if (require.main && require.main.filename === resolved) {
      mod.id = require.main.id;
      mod.filename = require.main.filename;
      mod.paths = require.main.paths || [];
      require.main = mod;
    }
    _moduleWrappers[resolved] = mod;
    const isBare = !id.startsWith('./') && !id.startsWith('../') && !id.startsWith('/') && id !== '.' && id !== '..';
    if (isBare && id !== resolved) _moduleWrappers[id] = mod;
    const dname = _path.dirname(resolved);
    const modRequire = _makeRequire(dname);
    mod.require = modRequire;
    if (resolved.endsWith('.json')) { mod.exports = JSON.parse(fileSrc); }
    else {
      let src = fileSrc;
      if (_isESM(resolved)) src = _esmToCjs(src, resolved);
      (new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', src))(mod.exports, modRequire, mod, resolved, dname, primordials);
    }
    moduleCache[resolved] = mod.exports;
    if (isBare && id !== resolved) moduleCache[id] = mod.exports;
    delete _moduleWrappers[resolved];
    if (isBare && id !== resolved) delete _moduleWrappers[id];
    return mod.exports;
  }

  function _makeRequire(parentDir) {
    function require(id) {
      if (id.startsWith('node:')) id = id.slice(5);
      const flatId = id.replace(/\//g, '_');
      if (_moduleWrappers[id]) return _moduleWrappers[id].exports;
      if (moduleCache[id]) return moduleCache[id];

      // Handle builtin subpath requires like fs/promises, stream/promises
      const _builtinSubpaths = { 'fs/promises': 'fs', 'stream/promises': 'stream', 'stream/consumers': 'stream', 'dns/promises': 'dns' };
      if (_builtinSubpaths[id]) {
        const parent = require(_builtinSubpaths[id]);
        const sub = id.split('/')[1];
        if (parent[sub]) { moduleCache[id] = parent[sub]; return parent[sub]; }
      }

      // Resolve #imports specifiers (package.json "imports" field)
      if (id.startsWith('#')) {
        const hashResolved = _resolveHashImport(id, parentDir);
        if (hashResolved) {
          if (moduleCache[hashResolved]) return moduleCache[hashResolved];
          return _loadModule(id, hashResolved, _fs.readFileSync(hashResolved));
        }
      }

      const isRelative = id === '.' || id === '..' || id.startsWith('./') || id.startsWith('../') || id.startsWith('/');
      let src = isRelative ? undefined : (_tryMiloLib(id) || _tryMiloLib(flatId) || __loadBuiltin(id));
      if (src !== undefined) {
        const fname = _path.join(_miloLibDir, id + '.js');
        return _loadModule(id, fname, src);
      }

      const resolved = _resolve(id, parentDir);
      if (_moduleWrappers[resolved]) return _moduleWrappers[resolved].exports;
      if (resolved && moduleCache[resolved]) return moduleCache[resolved];
      if (resolved) return _loadModule(id, resolved, _fs.readFileSync(resolved));

      const searchDir = parentDir || (process.cwd ? process.cwd() : '');
      const nmResolved = _resolveNodeModules(id, searchDir);
      if (nmResolved) {
        if (moduleCache[nmResolved]) return moduleCache[nmResolved];
        return _loadModule(id, nmResolved, _fs.readFileSync(nmResolved));
      }

      try { const b = _nativeBinding(id); moduleCache[id] = b; return b; } catch {}
      throw new Error("Cannot find module '" + id + "'");
    }

    require.resolve = function(id) {
      if (id.startsWith('node:')) id = id.slice(5);
      const flatId = id.replace(/\//g, '_');
      if (moduleCache[id] || _tryMiloLib(id) || _tryMiloLib(flatId) || __loadBuiltin(id)) return id;
      const resolved = _resolve(id, parentDir);
      if (resolved) return resolved;
      const searchDir = parentDir || (process.cwd ? process.cwd() : '');
      const nmResolved = _resolveNodeModules(id, searchDir);
      if (nmResolved) return nmResolved;
      throw new Error("Cannot find module '" + id + "'");
    };
    require.cache = moduleCache;
    Object.defineProperty(require, 'main', {
      get() { return _requireMain; },
      set(v) { _requireMain = v; },
      configurable: true,
    });
    return require;
  }
  let _requireMain = null;

  globalThis._makeRequire = _makeRequire;
  globalThis.require = _makeRequire('');

  // --- load internal init modules (order matters) ---
  require('_console_init');
  require('_process_init');
  require('_timers_init');
  try { const _b = require('buffer'); globalThis.Buffer = _b.Buffer || _b; } catch {}
  // Expose WebCrypto API as globalThis.crypto (Node 19+)
  try { const _c = require('crypto'); if (_c.webcrypto) globalThis.crypto = _c.webcrypto; } catch {}
})();
