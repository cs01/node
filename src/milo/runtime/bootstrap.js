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
      dlopen: { RTLD_LAZY: 1, RTLD_NOW: 2, RTLD_GLOBAL: 8, RTLD_LOCAL: 4 },
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
    try { return _nativeBinding(name); } catch { return Object.create(null); }
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
  if (!performance.mark) {
    const _entries = [];
    performance.mark = function(name, options) {
      const entry = { entryType: 'mark', name, startTime: (options && options.startTime != null) ? options.startTime : performance.now(), duration: 0, detail: options?.detail ?? null };
      _entries.push(entry);
      return entry;
    };
    performance.measure = function(name, startOrOptions, end) {
      let startTime = 0, endTime = performance.now(), detail = null;
      if (typeof startOrOptions === 'string') {
        const sm = _entries.find(e => e.entryType === 'mark' && e.name === startOrOptions);
        if (sm) startTime = sm.startTime;
        if (typeof end === 'string') { const em = _entries.find(e => e.entryType === 'mark' && e.name === end); if (em) endTime = em.startTime; }
      } else if (startOrOptions && typeof startOrOptions === 'object') {
        if (startOrOptions.start != null) { if (typeof startOrOptions.start === 'string') { const sm = _entries.find(e => e.entryType === 'mark' && e.name === startOrOptions.start); if (sm) startTime = sm.startTime; } else startTime = startOrOptions.start; }
        if (startOrOptions.end != null) { if (typeof startOrOptions.end === 'string') { const em = _entries.find(e => e.entryType === 'mark' && e.name === startOrOptions.end); if (em) endTime = em.startTime; } else endTime = startOrOptions.end; }
        if (startOrOptions.duration != null) endTime = startTime + startOrOptions.duration;
        detail = startOrOptions.detail ?? null;
      }
      const entry = { entryType: 'measure', name, startTime, duration: endTime - startTime, detail };
      _entries.push(entry);
      return entry;
    };
    performance.clearMarks = function(name) { for (let i = _entries.length - 1; i >= 0; i--) if (_entries[i].entryType === 'mark' && (!name || _entries[i].name === name)) _entries.splice(i, 1); };
    performance.clearMeasures = function(name) { for (let i = _entries.length - 1; i >= 0; i--) if (_entries[i].entryType === 'measure' && (!name || _entries[i].name === name)) _entries.splice(i, 1); };
    performance.getEntries = function() { return [..._entries]; };
    performance.getEntriesByName = function(name, type) { return _entries.filter(e => e.name === name && (!type || e.entryType === type)); };
    performance.getEntriesByType = function(type) { return _entries.filter(e => e.entryType === type); };
    performance.clearResourceTimings = function() {};
    performance.setResourceTimingBufferSize = function() {};
  }
  if (typeof PerformanceObserver === 'undefined') {
    globalThis.PerformanceObserver = class PerformanceObserver { constructor(cb) { this._cb = cb; } observe() {} disconnect() {} takeRecords() { return []; } };
    globalThis.PerformanceObserver.supportedEntryTypes = ['mark', 'measure'];
  }
  if (typeof global === 'undefined') globalThis.global = globalThis;
  if (typeof structuredClone === 'undefined') globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
  if (typeof CustomEvent === 'undefined') globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, opts) { super(type, opts); this.detail = opts?.detail ?? null; } };
  if (typeof Navigator === 'undefined') {
    class Navigator { get userAgent() { return 'milo-node'; } get language() { return 'en-US'; } get languages() { return ['en-US']; } get hardwareConcurrency() { return 1; } get platform() { return process.platform; } }
    globalThis.Navigator = Navigator;
    globalThis.navigator = new Navigator();
  }
  if (typeof Blob === 'undefined') {
    globalThis.Blob = class Blob {
      #parts; #type;
      constructor(parts = [], opts = {}) {
        this.#parts = parts.map(p => typeof p === 'string' ? new TextEncoder().encode(p) : (p instanceof Blob ? p.#parts.flat() : new Uint8Array(p instanceof ArrayBuffer ? p : p.buffer || p))).flat();
        this.#type = (opts.type || '').toLowerCase();
      }
      get size() { return this.#parts.reduce((s, p) => s + p.byteLength, 0); }
      get type() { return this.#type; }
      async text() { const d = new TextDecoder(); return this.#parts.map(p => d.decode(p)).join(''); }
      async arrayBuffer() { const r = new Uint8Array(this.size); let o = 0; for (const p of this.#parts) { r.set(p, o); o += p.byteLength; } return r.buffer; }
      slice(start = 0, end = this.size, type = '') { const buf = new Uint8Array(this.size); let o = 0; for (const p of this.#parts) { buf.set(p, o); o += p.byteLength; } return new Blob([buf.slice(start, end)], { type }); }
      stream() { const buf = this.#parts; return new ReadableStream({ start(c) { for (const p of buf) c.enqueue(p); c.close(); } }); }
    };
    globalThis.File = class File extends Blob { #name; #lastModified; constructor(parts, name, opts = {}) { super(parts, opts); this.#name = name; this.#lastModified = opts.lastModified || Date.now(); } get name() { return this.#name; } get lastModified() { return this.#lastModified; } };
  }

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

      // Handle internal/* requires (--expose-internals compatibility)
      if (id.startsWith('internal/')) {
        let stub;
        if (id === 'internal/test/binding') {
          stub = { internalBinding: globalThis.internalBinding };
        } else if (id === 'internal/errors') {
          const _errCodes = {};
          const _codesProxy = new Proxy(_errCodes, { get(t, k) { return t[k] || class extends Error { constructor(...a) { super(a.join(', ')); this.code = k; } }; } });
          class SystemError extends Error { constructor(msg, ctx) { super(typeof msg === 'string' ? msg : (ctx && ctx.message) || ''); if (typeof msg === 'object') ctx = msg; if (ctx) { this.code = ctx.code; this.syscall = ctx.syscall; if (ctx.path) this.path = ctx.path; if (ctx.dest) this.dest = ctx.dest; this.errno = ctx.errno; } } get info() { return { code: this.code, syscall: this.syscall, path: this.path, dest: this.dest, errno: this.errno, message: this.message }; } }
          function E(code, msgTpl, Base) {
            const Cls = class extends (Base || Error) { constructor(...a) { let msg; if (typeof msgTpl === 'function') msg = msgTpl(...a); else if (typeof msgTpl === 'string') { msg = msgTpl; let i = 0; msg = msg.replace(/%[sd]/g, () => String(a[i++])); } else msg = String(a[0] || ''); super(Base === SystemError ? a[0] : msg, Base === SystemError ? undefined : undefined); if (Base === SystemError && typeof a[0] === 'object') { const ctx = a[0]; this.code = code; this.syscall = ctx.syscall; if (ctx.path) this.path = ctx.path; if (ctx.dest) this.dest = ctx.dest; this.errno = ctx.errno; this.message = msg || ctx.message; } this.code = code; } };
            Object.defineProperty(Cls, 'name', { value: code });
            _errCodes[code] = Cls;
          }
          stub = { codes: _codesProxy, E, SystemError };
        } else if (id === 'internal/options') {
          stub = { getOptionValue: (name) => { if (name === '--insecure-http-parser') return false; if (name === '--use-env-proxy') return false; if (name === '--force-fips') return false; if (name === '--enable-source-maps') return false; if (name === '--pending-deprecation') return false; return undefined; } };
        } else if (id === 'internal/validators') {
          const _throwType = (name, type) => { const e = new TypeError(`The "${name}" argument must be of type ${type}`); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; };
          stub = {
            validateFunction: (v, name) => { if (typeof v !== 'function') _throwType(name, 'function'); },
            validateString: (v, name) => { if (typeof v !== 'string') _throwType(name, 'string'); },
            validateNumber: (v, name) => { if (typeof v !== 'number') _throwType(name, 'number'); },
            validateBoolean: (v, name) => { if (typeof v !== 'boolean') _throwType(name, 'boolean'); },
            validateObject: (v, name) => { if (v === null || typeof v !== 'object') _throwType(name, 'object'); },
            validateArray: (v, name) => { if (!Array.isArray(v)) _throwType(name, 'Array'); },
            validateInt32: (v, name) => { if (typeof v !== 'number' || v !== (v | 0)) _throwType(name, 'int32'); },
            validateUint32: (v, name) => { if (typeof v !== 'number' || v < 0 || v > 0xFFFFFFFF || v !== (v >>> 0)) _throwType(name, 'uint32'); },
            validateInteger: (v, name) => { if (typeof v !== 'number' || !Number.isInteger(v)) _throwType(name, 'integer'); },
            validateBuffer: (v, name) => { if (!Buffer.isBuffer(v)) _throwType(name, 'Buffer'); },
            validateEncoding: (v, name) => { if (typeof v !== 'string') _throwType(name, 'string'); },
            validatePort: (v, name) => { if (typeof v !== 'number' || v < 0 || v > 65535) { const e = new RangeError(`${name || 'port'} should be >= 0 and < 65536`); e.code = 'ERR_SOCKET_BAD_PORT'; throw e; } return v | 0; },
            validateAbortSignal: () => {},
            validateOneOf: (v, name, oneOf) => { if (!oneOf.includes(v)) { const e = new TypeError(`${name} must be one of: ${oneOf.join(', ')}`); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; } },
            validateSignalName: (v) => { if (typeof v !== 'string') _throwType('signal', 'string'); },
            validatePlainFunction: (v, name) => { if (typeof v !== 'function') _throwType(name, 'function'); },
            validateUndefined: (v, name) => { if (v !== undefined) _throwType(name, 'undefined'); },
            isInt32: (v) => typeof v === 'number' && v === (v | 0),
            isUint32: (v) => typeof v === 'number' && v === (v >>> 0),
            kValidateObjectNone: 0, kValidateObjectAllowNullable: 1, kValidateObjectAllowArray: 2,
            kValidateObjectAllowFunction: 4, kValidateObjectAllowObjects: 6, kValidateObjectAllowObjectsAndNull: 7,
          };
        } else if (id === 'internal/util') {
          stub = {
            emitExperimentalWarning: (feature) => { process.emitWarning(`${feature} is an experimental feature`, 'ExperimentalWarning'); },
            getSystemErrorName: (err) => `ERRNO_${err}`,
            promisify: require('util').promisify,
            deprecate: (fn) => fn,
            kEmptyObject: Object.freeze({}),
          };
        } else {
          stub = Object.create(null);
        }
        moduleCache[id] = stub;
        return stub;
      }

      // Handle builtin subpath requires like fs/promises, stream/promises
      const _builtinSubpaths = { 'fs/promises': 'fs', 'stream/promises': 'stream', 'stream/consumers': 'stream', 'stream/web': 'stream', 'dns/promises': 'dns', 'readline/promises': 'readline', 'timers/promises': 'timers', 'util/types': 'util' };
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
  // Polyfill TextDecoder properties missing in V8's minimal implementation
  if (typeof TextDecoder !== 'undefined' && !('encoding' in TextDecoder.prototype)) {
    const _OrigTD = TextDecoder;
    globalThis.TextDecoder = function TextDecoder(label, opts) {
      const td = new _OrigTD(label, opts);
      const _encAliases = { 'utf8': 'utf-8', 'utf-8': 'utf-8', 'unicode-1-1-utf-8': 'utf-8', 'unicode11utf8': 'utf-8', 'unicode20utf8': 'utf-8', 'x-unicode20utf8': 'utf-8', 'ascii': 'windows-1252', 'us-ascii': 'windows-1252', 'iso-8859-1': 'windows-1252', 'latin1': 'windows-1252', 'ucs-2': 'utf-16le', 'utf-16': 'utf-16le' };
      const _raw = (label || 'utf-8').toLowerCase().trim();
      td.encoding = _encAliases[_raw] || _raw;
      td.fatal = !!(opts && opts.fatal);
      td.ignoreBOM = !!(opts && opts.ignoreBOM);
      return td;
    };
    globalThis.TextDecoder.prototype = _OrigTD.prototype;
  }

  // Polyfill URLSearchParams.sort if missing
  if (typeof URLSearchParams !== 'undefined' && !URLSearchParams.prototype.sort) {
    URLSearchParams.prototype.sort = function() {
      const entries = [...this.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      const keys = new Set(this.keys());
      for (const k of keys) this.delete(k);
      for (const [k, v] of entries) this.append(k, v);
    };
  }

  // MessageEvent polyfill
  if (typeof MessageEvent === 'undefined') {
    globalThis.MessageEvent = class MessageEvent extends Event {
      constructor(type, init) {
        super(type, init);
        this.data = (init && init.data !== undefined) ? init.data : null;
        this.origin = init && init.origin != null ? String(init.origin) : '';
        this.lastEventId = init && init.lastEventId != null ? String(init.lastEventId) : '';
        if (init && init.source != null) {
          if (!(init.source instanceof MessagePort)) {
            const v = typeof init.source === 'object' ? '{}' : JSON.stringify(init.source);
            throw new TypeError(`MessageEvent constructor: Expected eventInitDict.source ("${v}") to be an instance of MessagePort.`);
          }
          this.source = init.source;
        } else { this.source = null; }
        if (init && init.ports != null) {
          if (typeof init.ports[Symbol.iterator] !== 'function') throw new TypeError(`MessageEvent constructor: eventInitDict.ports (${init.ports}) is not iterable.`);
          const arr = [...init.ports];
          for (let i = 0; i < arr.length; i++) {
            if (!(arr[i] instanceof MessagePort)) {
              const v = arr[i] === null ? 'null' : typeof arr[i] === 'object' ? '{}' : JSON.stringify(arr[i]);
              throw new TypeError(`MessageEvent constructor: Expected eventInitDict.ports[${i}] ("${v}") to be an instance of MessagePort.`);
            }
          }
          this.ports = arr;
        } else { this.ports = []; }
      }
    };
  }

  // MessageChannel / MessagePort (structured clone via JSON for now)
  if (typeof MessageChannel === 'undefined') {
    class MessagePort extends EventTarget {
      constructor() { super(); this._other = null; this._started = false; this._queue = []; }
      postMessage(data, transfer) {
        const clone = JSON.parse(JSON.stringify(data === undefined ? null : data));
        if (this._other) {
          if (this._other._started) {
            Promise.resolve().then(() => this._other.dispatchEvent(new MessageEvent('message', { data: clone })));
          } else {
            this._other._queue.push(clone);
          }
        }
      }
      start() {
        this._started = true;
        while (this._queue.length > 0) {
          const data = this._queue.shift();
          Promise.resolve().then(() => this.dispatchEvent(new MessageEvent('message', { data })));
        }
      }
      close() { this._other = null; }
      get onmessage() { return this._onmessage || null; }
      set onmessage(fn) {
        if (this._onmessage) this.removeEventListener('message', this._onmessage);
        this._onmessage = fn;
        if (fn) { this.addEventListener('message', fn); this.start(); }
      }
      get onmessageerror() { return this._onmessageerror || null; }
      set onmessageerror(fn) { this._onmessageerror = fn; }
      ref() { return this; }
      unref() { return this; }
    }
    class MessageChannel {
      constructor() {
        this.port1 = new MessagePort();
        this.port2 = new MessagePort();
        this.port1._other = this.port2;
        this.port2._other = this.port1;
      }
    }
    globalThis.MessageChannel = MessageChannel;
    globalThis.MessagePort = MessagePort;
    // BroadcastChannel
    const _bcChannels = new Map();
    class BroadcastChannel extends EventTarget {
      constructor(name) {
        super();
        this.name = name;
        if (!_bcChannels.has(name)) _bcChannels.set(name, new Set());
        _bcChannels.get(name).add(this);
      }
      postMessage(data) {
        const clone = JSON.parse(JSON.stringify(data === undefined ? null : data));
        for (const ch of _bcChannels.get(this.name) || []) {
          if (ch !== this) Promise.resolve().then(() => ch.dispatchEvent(new MessageEvent('message', { data: clone })));
        }
      }
      close() { const s = _bcChannels.get(this.name); if (s) s.delete(this); }
      get onmessage() { return this._onmessage || null; }
      set onmessage(fn) { if (this._onmessage) this.removeEventListener('message', this._onmessage); this._onmessage = fn; if (fn) this.addEventListener('message', fn); }
    }
    globalThis.BroadcastChannel = BroadcastChannel;
  }
})();
