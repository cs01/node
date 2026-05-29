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
    fs: Object.assign(Object.create(null), { O_RDONLY:0, O_WRONLY:1, O_RDWR:2, O_CREAT:512, O_EXCL:2048, O_TRUNC:1024, O_APPEND:8, O_DIRECTORY:1048576, O_NOFOLLOW:256, O_SYNC:128, O_DSYNC:0x400000, O_SYMLINK:2097152, O_NONBLOCK:4, S_IFMT:61440, S_IFREG:32768, S_IFDIR:16384, S_IFLNK:40960, S_IFCHR:8192, S_IFBLK:24576, S_IFIFO:4096, S_IFSOCK:49152, S_IRWXU:448, S_IRUSR:256, S_IWUSR:128, S_IXUSR:64, S_IRWXG:56, S_IRGRP:32, S_IWGRP:16, S_IXGRP:8, S_IRWXO:7, S_IROTH:4, S_IWOTH:2, S_IXOTH:1, F_OK:0, R_OK:4, W_OK:2, X_OK:1, UV_FS_COPYFILE_EXCL:1, UV_FS_COPYFILE_FICLONE:2, UV_FS_COPYFILE_FICLONE_FORCE:4, COPYFILE_EXCL:1, COPYFILE_FICLONE:2, COPYFILE_FICLONE_FORCE:4 }),
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
      errname(code) {
        const names = { [-2]: 'ENOENT', [-1]: 'EPERM', [-13]: 'EACCES', [-17]: 'EEXIST', [-22]: 'EINVAL', [-4058]: 'ENOENT', [-4048]: 'EPERM', [-48]: 'EADDRINUSE', [-61]: 'ECONNREFUSED', [-54]: 'ECONNRESET', [-60]: 'ETIMEDOUT', [-9]: 'EBADF', [-40]: 'EMSGSIZE', [-56]: 'EISCONN', [-57]: 'ENOTCONN', [-53]: 'ECONNABORTED', [-49]: 'EADDRNOTAVAIL', [-4]: 'EINTR', [-35]: 'EAGAIN', [-32]: 'EPIPE' };
        return names[code] || `Unknown system error ${code}`;
      },
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
    class AbortSignal { #listeners = {}; aborted = false; reason = undefined;
      throwIfAborted() { if (this.aborted) throw this.reason; }
      addEventListener(type, fn) { (this.#listeners[type] ??= []).push(fn); }
      removeEventListener(type, fn) { const a = this.#listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
      dispatchEvent(ev) { for (const fn of (this.#listeners[ev.type] || [])) fn(ev); }
      _abort(reason) { if (this.aborted) return; this.aborted = true; this.reason = reason || new DOMException('The operation was aborted.', 'AbortError'); if (this.onabort) this.onabort(); this.dispatchEvent({ type: 'abort', target: this }); }
      static abort(reason) { const s = new AbortSignal(); s._abort(reason); return s; }
      static timeout(ms) { const s = new AbortSignal(); setTimeout?.(() => s._abort(new DOMException('The operation timed out.', 'TimeoutError')), ms); return s; }
      static any(signals) { const s = new AbortSignal(); for (const sig of signals) { if (sig.aborted) { s._abort(sig.reason); return s; } sig.addEventListener('abort', () => s._abort(sig.reason)); } return s; }
    }
    globalThis.AbortSignal = AbortSignal;
    globalThis.AbortController = class AbortController { #signal = new AbortSignal(); get signal() { return this.#signal; } abort(reason) { this.#signal._abort(reason); } };
  }
  if (typeof DOMException === 'undefined') globalThis.DOMException = class DOMException extends Error {
    constructor(msg, nameOrOpts) {
      super(msg);
      if (typeof nameOrOpts === 'object' && nameOrOpts !== null) {
        this.name = nameOrOpts.name || 'Error';
        if ('cause' in nameOrOpts) this.cause = nameOrOpts.cause;
      } else {
        this.name = nameOrOpts || 'Error';
      }
      this.code = 0;
    }
  };
  if (typeof Event === 'undefined') {
    globalThis.Event = class Event { constructor(type, opts) { this.type = type; this.bubbles = opts?.bubbles || false; this.cancelable = opts?.cancelable || false; this.composed = opts?.composed || false; this.defaultPrevented = false; this.target = null; this.currentTarget = null; this.eventPhase = 0; this.isTrusted = false; } preventDefault() { if (this.cancelable) this.defaultPrevented = true; } stopPropagation() {} stopImmediatePropagation() {} composedPath() { return this.target ? [this.target] : []; } };
    Object.defineProperties(Event, { NONE: { value: 0, writable: false, configurable: false, enumerable: true }, CAPTURING_PHASE: { value: 1, writable: false, configurable: false, enumerable: true }, AT_TARGET: { value: 2, writable: false, configurable: false, enumerable: true }, BUBBLING_PHASE: { value: 3, writable: false, configurable: false, enumerable: true } });
    Object.defineProperties(Event.prototype, { NONE: { value: 0, writable: false, configurable: false, enumerable: true }, CAPTURING_PHASE: { value: 1, writable: false, configurable: false, enumerable: true }, AT_TARGET: { value: 2, writable: false, configurable: false, enumerable: true }, BUBBLING_PHASE: { value: 3, writable: false, configurable: false, enumerable: true } });
  }
  if (typeof EventTarget === 'undefined') globalThis.EventTarget = class EventTarget { #h = {}; addEventListener(t, listener, opts) { if (listener == null) return; (this.#h[t] ??= []).push({ listener, once: !!(opts && opts.once) }); } removeEventListener(t, listener) { const a = this.#h[t]; if (a) { const i = a.findIndex(e => e.listener === listener); if (i >= 0) a.splice(i, 1); } } dispatchEvent(ev) { ev.target = this; ev.currentTarget = this; ev.eventPhase = 2; const list = (this.#h[ev.type] || []).slice(); for (const entry of list) { if (typeof entry.listener === 'function') { entry.listener.call(this, ev); } else if (typeof entry.listener === 'object' && entry.listener !== null && typeof entry.listener.handleEvent === 'function') { entry.listener.handleEvent(ev); } if (entry.once) this.removeEventListener(ev.type, entry.listener); } return !ev.defaultPrevented; } };
  if (typeof ReadableStream === 'undefined') {
    globalThis.ReadableStream = class ReadableStream {
      #controller; #pullFn; #cancelFn; #queue = []; #closed = false; #errored = false; #error; #readers = []; #started = false;
      constructor(underlyingSource, strategy) {
        const self = this;
        const controller = {
          enqueue(chunk) { if (self.#closed || self.#errored) return; self.#queue.push(chunk); for (const r of self.#readers) r._notify(); },
          close() { if (self.#closed) return; self.#closed = true; for (const r of self.#readers) r._notify(); },
          error(e) { if (self.#errored) return; self.#errored = true; self.#error = e; for (const r of self.#readers) r._notify(); },
          get desiredSize() { return self.#queue.length > 0 ? 0 : 1; }
        };
        this.#controller = controller;
        if (underlyingSource) {
          this.#pullFn = underlyingSource.pull;
          this.#cancelFn = underlyingSource.cancel;
          if (underlyingSource.start) { Promise.resolve(underlyingSource.start(controller)).then(() => { self.#started = true; }); self.#started = true; }
          else self.#started = true;
        } else self.#started = true;
      }
      getReader() {
        const stream = this;
        const reader = {
          _stream: stream, _resolve: null,
          read() {
            if (stream.#errored) return Promise.reject(stream.#error);
            if (stream.#queue.length > 0) return Promise.resolve({ value: stream.#queue.shift(), done: false });
            if (stream.#closed) return Promise.resolve({ value: undefined, done: true });
            return new Promise(resolve => { reader._resolve = resolve; if (stream.#pullFn) stream.#pullFn(stream.#controller); });
          },
          _notify() {
            if (!reader._resolve) return;
            const resolve = reader._resolve; reader._resolve = null;
            if (stream.#errored) { resolve(Promise.reject(stream.#error)); return; }
            if (stream.#queue.length > 0) { resolve({ value: stream.#queue.shift(), done: false }); return; }
            if (stream.#closed) { resolve({ value: undefined, done: true }); return; }
          },
          releaseLock() { const i = stream.#readers.indexOf(reader); if (i >= 0) stream.#readers.splice(i, 1); },
          cancel(reason) { return stream.cancel(reason); },
          get closed() { return stream.#closed ? Promise.resolve() : new Promise(() => {}); }
        };
        stream.#readers.push(reader);
        return reader;
      }
      cancel(reason) { this.#closed = true; if (this.#cancelFn) this.#cancelFn(reason); return Promise.resolve(); }
      pipeTo(dest, opts) {
        const reader = this.getReader();
        function pump() { return reader.read().then(({value, done}) => { if (done) { dest.close(); return; } dest.write(value); return pump(); }); }
        return pump();
      }
      pipeThrough(transform, opts) { this.pipeTo(transform.writable); return transform.readable; }
      tee() {
        const reader = this.getReader();
        const q1 = [], q2 = [];
        const s1 = new ReadableStream({ pull(c) { if (q1.length > 0) { c.enqueue(q1.shift()); return; } reader.read().then(({value, done}) => { if (done) { c.close(); return; } c.enqueue(value); q2.push(value); }); } });
        const s2 = new ReadableStream({ pull(c) { if (q2.length > 0) { c.enqueue(q2.shift()); return; } reader.read().then(({value, done}) => { if (done) { c.close(); return; } c.enqueue(value); q1.push(value); }); } });
        return [s1, s2];
      }
      get locked() { return this.#readers.length > 0; }
      [Symbol.asyncIterator]() {
        const reader = this.getReader();
        return { next() { return reader.read(); }, return() { reader.releaseLock(); return Promise.resolve({ done: true }); } };
      }
      static from(iterable) {
        return new ReadableStream({ async start(controller) { for await (const chunk of iterable) controller.enqueue(chunk); controller.close(); } });
      }
    };
    globalThis.WritableStream = class WritableStream {
      #writer; #closeFn; #writeFn; #abortFn; #closed = false;
      constructor(underlyingSink) {
        if (underlyingSink) { this.#writeFn = underlyingSink.write; this.#closeFn = underlyingSink.close; this.#abortFn = underlyingSink.abort; }
      }
      getWriter() {
        const stream = this;
        return {
          write(chunk) { if (stream.#writeFn) return Promise.resolve(stream.#writeFn(chunk)); return Promise.resolve(); },
          close() { stream.#closed = true; if (stream.#closeFn) return Promise.resolve(stream.#closeFn()); return Promise.resolve(); },
          abort(reason) { stream.#closed = true; if (stream.#abortFn) return Promise.resolve(stream.#abortFn(reason)); return Promise.resolve(); },
          releaseLock() {},
          get ready() { return Promise.resolve(); },
          get closed() { return stream.#closed ? Promise.resolve() : new Promise(() => {}); },
          get desiredSize() { return 1; }
        };
      }
      close() { this.#closed = true; if (this.#closeFn) this.#closeFn(); }
      abort(reason) { this.#closed = true; if (this.#abortFn) this.#abortFn(reason); }
      get locked() { return false; }
    };
    globalThis.TransformStream = class TransformStream {
      constructor(transformer) {
        let readableController;
        this.readable = new ReadableStream({ start(c) { readableController = c; } });
        const tc = { enqueue(chunk) { readableController.enqueue(chunk); }, error(e) { readableController.error(e); }, terminate() { readableController.close(); } };
        this.writable = new WritableStream({
          write(chunk) { if (transformer && transformer.transform) transformer.transform(chunk, tc); else tc.enqueue(chunk); },
          close() { if (transformer && transformer.flush) transformer.flush(tc); else readableController.close(); }
        });
      }
    };
    globalThis.ByteLengthQueuingStrategy = class ByteLengthQueuingStrategy { constructor({highWaterMark}) { this.highWaterMark = highWaterMark; } size(chunk) { return chunk?.byteLength ?? 0; } };
    globalThis.CountQueuingStrategy = class CountQueuingStrategy { constructor({highWaterMark}) { this.highWaterMark = highWaterMark; } size() { return 1; } };
  }
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
      get [Symbol.toStringTag]() { return 'URLSearchParams'; }
    };
    globalThis.URL = class URL {
      constructor(url, base) {
        if (url === undefined || url === null) throw new TypeError(`Invalid URL: ${url}`);
        url = String(url);
        if (base) { const b = typeof base === 'string' ? base : base.href; url = b.replace(/\/$/, '') + '/' + url.replace(/^\//, ''); }
        const m = url.match(/^([a-z]+):\/\/(?:([^@]+)@)?([^/:?#]+)?(?::(\d+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i);
        this.protocol = m?.[1] ? m[1] + ':' : ''; this.username = m?.[2]?.split(':')[0] || ''; this.password = m?.[2]?.split(':')[1] || '';
        this.hostname = m?.[3] || ''; this.port = m?.[4] || ''; this.pathname = m?.[5] || '/'; this.search = m?.[6] || ''; this.hash = m?.[7] || '';
        this.host = this.hostname + (this.port ? ':' + this.port : ''); this.origin = this.protocol + '//' + this.host;
        this.href = url; this.searchParams = new URLSearchParams(this.search);
      }
      toString() { return this.href; }
      toJSON() { return this.href; }
      get [Symbol.toStringTag]() { return 'URL'; }
    };
  }
  if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = class TextEncoder {
    encode(s) {
      const a = [];
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { const lo = s.charCodeAt(i + 1); if (lo >= 0xdc00 && lo <= 0xdfff) { c = ((c - 0xd800) << 10) + (lo - 0xdc00) + 0x10000; i++; } }
        if (c < 0x80) a.push(c);
        else if (c < 0x800) { a.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
        else if (c < 0x10000) { a.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
        else { a.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      }
      return new Uint8Array(a);
    }
  };
  // V8 without ICU has a broken TextDecoder (Latin-1 only); always override with proper UTF-8
  globalThis.TextDecoder = class TextDecoder {
    constructor(label, opts) {
      this.encoding = (label || 'utf-8').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (this.encoding === 'utf8') this.encoding = 'utf-8';
      this.fatal = !!(opts && opts.fatal);
      this.ignoreBOM = !!(opts && opts.ignoreBOM);
    }
    decode(buf) {
      if (!buf) return '';
      const a = new Uint8Array(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength != null ? buf.byteLength : buf.length);
      if (this.encoding !== 'utf-8') {
        let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s;
      }
      let s = '', i = 0;
      while (i < a.length) {
        const b = a[i];
        if (b < 0x80) { s += String.fromCharCode(b); i++; }
        else if ((b & 0xe0) === 0xc0 && i + 1 < a.length && (a[i+1] & 0xc0) === 0x80) {
          s += String.fromCharCode(((b & 0x1f) << 6) | (a[i+1] & 0x3f)); i += 2;
        } else if ((b & 0xf0) === 0xe0 && i + 2 < a.length && (a[i+1] & 0xc0) === 0x80 && (a[i+2] & 0xc0) === 0x80) {
          s += String.fromCharCode(((b & 0x0f) << 12) | ((a[i+1] & 0x3f) << 6) | (a[i+2] & 0x3f)); i += 3;
        } else if ((b & 0xf8) === 0xf0 && i + 3 < a.length && (a[i+1] & 0xc0) === 0x80 && (a[i+2] & 0xc0) === 0x80 && (a[i+3] & 0xc0) === 0x80) {
          const cp = ((b & 0x07) << 18) | ((a[i+1] & 0x3f) << 12) | ((a[i+2] & 0x3f) << 6) | (a[i+3] & 0x3f);
          if (cp <= 0x10ffff) s += String.fromCodePoint(cp); else s += '�';
          i += 4;
        } else { s += '�'; i++; }
      }
      return s;
    }
  };
  if (typeof queueMicrotask === 'undefined') globalThis.queueMicrotask = function queueMicrotask(fn) { Promise.resolve().then(fn); };
  if (typeof fetch === 'undefined') globalThis.fetch = function fetch(input, init) {
    return new Promise((resolve, reject) => {
      try {
        let url, method, headers, body, signal;
        if (input instanceof Request) { url = input.url; method = input.method; headers = input.headers; body = input._body; signal = input.signal; }
        else if (input instanceof URL) { url = input.href; }
        else { url = String(input); }
        if (init) { method = init.method || method; headers = init.headers || headers; body = init.body || body; signal = init.signal || signal; }
        method = method || 'GET';
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const mod = isHttps ? require('https') : require('http');
        const reqHeaders = {};
        if (headers) {
          if (headers instanceof Headers) { for (const [k, v] of headers) reqHeaders[k] = v; }
          else if (typeof headers === 'object') { for (const k of Object.keys(headers)) reqHeaders[k.toLowerCase()] = headers[k]; }
        }
        const opts = { hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80), path: parsed.pathname + parsed.search, method, headers: reqHeaders };
        if (signal && signal.aborted) { reject(new DOMException('The operation was aborted.', 'AbortError')); return; }
        const req = mod.request(opts, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const respHeaders = new Headers(res.headers);
            // handle redirects
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) && respHeaders.has('location')) {
              const loc = respHeaders.get('location');
              const redirectUrl = loc.startsWith('/') ? `${parsed.protocol}//${parsed.host}${loc}` : loc;
              const redirectMethod = (res.statusCode === 303) ? 'GET' : method;
              fetch(redirectUrl, { method: redirectMethod, headers, signal }).then(resolve, reject);
              return;
            }
            const resp = new Response(buf, { status: res.statusCode, statusText: res.statusMessage, headers: respHeaders });
            resp.url = url;
            resolve(resp);
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        if (signal) { signal.addEventListener('abort', () => { req.abort(); reject(new DOMException('The operation was aborted.', 'AbortError')); }); }
        if (body && method !== 'GET' && method !== 'HEAD') { req.write(typeof body === 'string' ? body : body); req.end(); }
        else { req.end(); }
      } catch(e) { reject(e); }
    });
  };
  if (typeof atob === 'undefined') globalThis.atob = function atob(s) { if (typeof s !== 'string') s = String(s); const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='; const stripped = s.replace(/[\s]/g, ''); for (let j = 0; j < stripped.length; j++) if (chars.indexOf(stripped[j]) === -1) throw new DOMException('The string to be decoded is not correctly encoded.', 'InvalidCharacterError'); const clean = stripped.replace(/=/g, ''); let r = '', i = 0; while (i < clean.length) { const a = chars.indexOf(clean[i++]), b = chars.indexOf(clean[i++]||'A'), c = chars.indexOf(clean[i++]||'A'), d = chars.indexOf(clean[i++]||'A'); r += String.fromCharCode((a<<2)|(b>>4)); if(clean[i-2]!==undefined) r+=String.fromCharCode(((b&15)<<4)|(c>>2)); if(clean[i-1]!==undefined) r+=String.fromCharCode(((c&3)<<6)|d); } return r; };
  if (typeof btoa === 'undefined') globalThis.btoa = function btoa(s) { if (typeof s !== 'string') s = String(s); for (let j = 0; j < s.length; j++) if (s.charCodeAt(j) > 255) throw new DOMException('The string to be encoded contains characters outside of the Latin1 range.', 'InvalidCharacterError'); const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let r = ''; for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i+1), c = s.charCodeAt(i+2); r += chars[a>>2] + chars[((a&3)<<4)|(b>>4)] + (isNaN(b)?'=':chars[((b&15)<<2)|(c>>6)]) + (isNaN(c)?'=':chars[c&63]); } return r; };
  {
    const _origAtob = globalThis.atob;
    globalThis.atob = function atob(s) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'atob': 1 argument required, but only 0 present.");
      if (typeof s === 'symbol') throw new TypeError("Cannot convert a Symbol value to a string");
      return _origAtob(s);
    };
    const _origBtoa = globalThis.btoa;
    globalThis.btoa = function btoa(s) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'btoa': 1 argument required, but only 0 present.");
      if (typeof s === 'symbol') throw new TypeError("Cannot convert a Symbol value to a string");
      return _origBtoa(s);
    };
  }
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
  if (typeof Headers === 'undefined') {
    globalThis.Headers = class Headers {
      constructor(init) {
        this._map = new Map();
        if (init instanceof Headers) { for (const [k, v] of init) this._map.set(k.toLowerCase(), v); }
        else if (Array.isArray(init)) { for (const [k, v] of init) this._map.set(k.toLowerCase(), v); }
        else if (init && typeof init === 'object') { for (const k of Object.keys(init)) this._map.set(k.toLowerCase(), String(init[k])); }
      }
      get(name) { return this._map.get(name.toLowerCase()) ?? null; }
      set(name, value) { this._map.set(name.toLowerCase(), String(value)); }
      has(name) { return this._map.has(name.toLowerCase()); }
      delete(name) { this._map.delete(name.toLowerCase()); }
      append(name, value) { const k = name.toLowerCase(); const old = this._map.get(k); this._map.set(k, old ? old + ', ' + value : String(value)); }
      forEach(cb, thisArg) { this._map.forEach((v, k) => cb.call(thisArg, v, k, this)); }
      entries() { return this._map.entries(); }
      keys() { return this._map.keys(); }
      values() { return this._map.values(); }
      [Symbol.iterator]() { return this._map.entries(); }
    };
  }
  if (typeof Request === 'undefined') {
    globalThis.Request = class Request {
      constructor(input, init) {
        if (typeof input === 'string') { this.url = input; }
        else if (input instanceof URL) { this.url = input.href; }
        else if (input instanceof Request) { this.url = input.url; this.method = input.method; this.headers = new Headers(input.headers); this._body = input._body; this.signal = input.signal; }
        else { this.url = String(input); }
        this.method = init?.method || this.method || 'GET';
        this.headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers || this.headers);
        this._body = init?.body !== undefined ? init.body : (this._body || null);
        this.signal = init?.signal || this.signal || new AbortController().signal;
        this.duplex = init?.duplex || 'half';
      }
      async text() {
        if (this._body == null) return '';
        if (typeof this._body === 'string') return this._body;
        if (this._body instanceof ReadableStream) {
          const reader = this._body.getReader(); let result = '';
          while (true) { const {value, done} = await reader.read(); if (done) break; result += typeof value === 'string' ? value : new TextDecoder().decode(value); }
          return result;
        }
        return String(this._body);
      }
      async json() { return JSON.parse(await this.text()); }
      async arrayBuffer() { const t = await this.text(); return new TextEncoder().encode(t).buffer; }
      clone() { return new Request(this.url, { method: this.method, headers: this.headers, body: this._body, signal: this.signal }); }
    };
  }
  if (typeof Response === 'undefined') {
    globalThis.Response = class Response {
      constructor(body, init) {
        this.status = init?.status ?? 200; this.statusText = init?.statusText || '';
        this.headers = new Headers(init?.headers); this.ok = this.status >= 200 && this.status < 300;
        this.type = 'default'; this.redirected = false; this.url = '';
        if (body == null) { this.body = null; this._body = null; }
        else if (typeof body === 'string') { this._body = body; this.body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }); }
        else if (body instanceof ReadableStream) { this.body = body; this._body = null; }
        else if (body instanceof Uint8Array || body instanceof ArrayBuffer) { const u8 = body instanceof ArrayBuffer ? new Uint8Array(body) : body; this._body = null; this.body = new ReadableStream({ start(c) { c.enqueue(u8); c.close(); } }); }
        else { const s = String(body); this._body = s; this.body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } }); }
      }
      get bodyUsed() { return this.body?.locked ?? false; }
      async text() {
        if (this._body != null) return this._body;
        if (!this.body) return '';
        const reader = this.body.getReader(); let result = '';
        while (true) { const {value, done} = await reader.read(); if (done) break; result += typeof value === 'string' ? value : new TextDecoder().decode(value); }
        return result;
      }
      async json() { return JSON.parse(await this.text()); }
      async arrayBuffer() { const t = await this.text(); return new TextEncoder().encode(t).buffer; }
      async blob() { const buf = await this.arrayBuffer(); return new Blob([buf]); }
      clone() { return new Response(this._body ?? this.body?.tee?.()[1], { status: this.status, statusText: this.statusText, headers: this.headers }); }
      static json(data, init) { return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }); }
      static redirect(url, status) { return new Response(null, { status: status || 302, headers: { Location: url } }); }
      static error() { const r = new Response(null, { status: 0 }); r.type = 'error'; return r; }
    };
  }
  if (typeof global === 'undefined') globalThis.global = globalThis;
  Object.defineProperty(globalThis, Symbol.toStringTag, { value: 'global', configurable: true });
  if (typeof Error.prepareStackTrace !== 'function') {
    Error.prepareStackTrace = function(error, frames) { return error.toString() + frames.map(f => '\n    at ' + f.toString()).join(''); };
  }
  if (typeof structuredClone === 'undefined') {
    globalThis.structuredClone = function structuredClone(value, options) {
      const seen = new Map();
      const clone = (v) => {
        if (v === null || typeof v !== 'object') {
          if (typeof v === 'function' || typeof v === 'symbol') {
            const e = new Error('could not be cloned'); e.name = 'DataCloneError'; e.code = 25; throw e;
          }
          return v;
        }
        if (seen.has(v)) return seen.get(v);
        if (v instanceof ArrayBuffer) { const c = v.slice(0); seen.set(v, c); return c; }
        if (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer) return v;
        if (ArrayBuffer.isView(v)) {
          if (v instanceof DataView) { const c = new DataView(clone(v.buffer), v.byteOffset, v.byteLength); seen.set(v, c); return c; }
          const c = new v.constructor(clone(v.buffer), v.byteOffset, v.length); seen.set(v, c); return c;
        }
        if (v instanceof Date) { const c = new Date(v.getTime()); seen.set(v, c); return c; }
        if (v instanceof RegExp) { const c = new RegExp(v.source, v.flags); seen.set(v, c); return c; }
        if (v instanceof Map) { const c = new Map(); seen.set(v, c); for (const [k, val] of v) c.set(clone(k), clone(val)); return c; }
        if (v instanceof Set) { const c = new Set(); seen.set(v, c); for (const val of v) c.add(clone(val)); return c; }
        if (Array.isArray(v)) { const c = new Array(v.length); seen.set(v, c); for (let i = 0; i < v.length; i++) c[i] = clone(v[i]); return c; }
        const c = {}; seen.set(v, c);
        for (const k of Object.keys(v)) c[k] = clone(v[k]);
        return c;
      };
      const result = clone(value);
      // Honor the transfer list: transferring an ArrayBuffer detaches the original.
      if (options && options.transfer) {
        for (const t of options.transfer) {
          if (t instanceof ArrayBuffer && typeof t.transfer === 'function' && !t.detached) t.transfer();
        }
      }
      return result;
    };
  }
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

  // --- node error helpers ---
  // Node renders its internal (ERR_*) errors as "TypeError [ERR_X]: msg" via toString
  // while leaving .name untouched — so assert.throws(/ERR_X/) matches String(err) and
  // tests asserting err.name === 'TypeError' both pass. System errors (ENOENT, EACCES)
  // keep the plain "Error: msg" form. Install once on the prototype so every lib's
  // coded errors get this for free, no per-helper change needed.
  {
    const _origErrToString = Error.prototype.toString;
    Object.defineProperty(Error.prototype, 'toString', {
      value: function toString() {
        const c = this.code;
        if (typeof c === 'string' && c.startsWith('ERR_')) {
          return `${this.name} [${c}]: ${this.message}`;
        }
        return _origErrToString.call(this);
      },
      writable: true, configurable: true, enumerable: false,
    });
  }
  function _makeNodeError(Base, code, msg) {
    const e = new Base(msg);
    e.code = code;
    return e;
  }
  globalThis._ERR_INVALID_ARG_TYPE = function(name, expected, actual) {
    let actualStr;
    if (actual === null) actualStr = 'null';
    else if (actual === undefined) actualStr = 'undefined';
    else if (typeof actual === 'function') actualStr = 'function ' + (actual.name || '');
    else if (typeof actual === 'object') actualStr = 'an instance of ' + (actual.constructor?.name || 'Object');
    else if (typeof actual === 'symbol') actualStr = 'type symbol (' + String(actual) + ')';
    else actualStr = 'type ' + typeof actual + ' (' + actual + ')';
    return _makeNodeError(TypeError, 'ERR_INVALID_ARG_TYPE', `The "${name}" argument must be of type ${expected}. Received ${actualStr}`);
  };
  globalThis._ERR_INVALID_ARG_VALUE = function(name, value, reason) {
    const inspected = typeof value === 'string' ? `'${value}'` : String(value);
    return _makeNodeError(TypeError, 'ERR_INVALID_ARG_VALUE', `The argument '${name}' ${reason || 'is invalid'}. Received ${inspected}`);
  };
  globalThis._ERR_OUT_OF_RANGE = function(name, range, input) {
    return _makeNodeError(RangeError, 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be ${range}. Received ${input}`);
  };
  globalThis._ERR_BUFFER_OUT_OF_BOUNDS = function(name) {
    return _makeNodeError(RangeError, 'ERR_BUFFER_OUT_OF_BOUNDS', name ? `"${name}" is outside the bounds of the buffer` : 'Attempt to access memory outside buffer bounds');
  };
  globalThis._ERR_UNKNOWN_ENCODING = function(encoding) {
    return _makeNodeError(TypeError, 'ERR_UNKNOWN_ENCODING', `Unknown encoding: ${encoding}`);
  };
  globalThis._ERR_UNESCAPED_CHARACTERS = function(name) {
    return _makeNodeError(TypeError, 'ERR_UNESCAPED_CHARACTERS', `Request path contains unescaped characters`);
  };
  globalThis._ERR_METHOD_NOT_IMPLEMENTED = function(method) {
    return _makeNodeError(Error, 'ERR_METHOD_NOT_IMPLEMENTED', `The ${method} method is not implemented`);
  };
  globalThis._ERR_MISSING_ARGS = function(...args) {
    const msg = args.length === 1 ? `The "${args[0]}" argument must be specified` : `The ${args.map(a => `"${a}"`).join(', ')} arguments must be specified`;
    return _makeNodeError(TypeError, 'ERR_MISSING_ARGS', msg);
  };

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
  // Persistent map of resolved-path -> Module object (not just exports) so
  // module.children can be populated. moduleCache holds exports and _moduleWrappers
  // is cleared after load; this survives for the lifetime of the process.
  const _moduleObjects = {};
  // Mirror node's updateChildren: link child into parent.children. On a cache hit
  // (scan=true) only add if not already present, so repeated require()s of the same
  // module don't duplicate it; builtins are never linked (they aren't Module objects).
  function _updateChildren(parentMod, child, scan) {
    if (!parentMod || !child) return;
    const kids = parentMod.children;
    if (kids && !(scan && kids.includes(child))) kids.push(child);
  }
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

  function _loadModule(id, resolved, fileSrc, parentMod, isBuiltin) {
    const mod = { id: resolved, exports: {}, filename: resolved, loaded: false, children: [], parent: parentMod || null, paths: [] };
    // Link require.main to actual module object so `module === require.main` works
    if (require.main && require.main.filename === resolved) {
      mod.id = require.main.id;
      mod.filename = require.main.filename;
      mod.paths = require.main.paths || [];
      require.main = mod;
    }
    _moduleWrappers[resolved] = mod;
    _moduleObjects[resolved] = mod;
    if (!isBuiltin) _updateChildren(parentMod, mod, false);
    const isBare = !id.startsWith('./') && !id.startsWith('../') && !id.startsWith('/') && id !== '.' && id !== '..';
    if (isBare && id !== resolved) _moduleWrappers[id] = mod;
    const dname = _path.dirname(resolved);
    const modRequire = _makeRequire(dname, mod);
    mod.require = modRequire;
    if (resolved.endsWith('.json')) {
      try { mod.exports = JSON.parse(fileSrc); }
      catch (e) { e.message = resolved + ': ' + e.message; throw e; }
    }
    else {
      let src = fileSrc;
      // Strip shebang lines — V8 doesn't handle them, Node's C++ loader normally does this
      if (src.charCodeAt(0) === 0x23 && src.charCodeAt(1) === 0x21) src = src.replace(/^#!.*\n/, '');
      if (_isESM(resolved)) src = _esmToCjs(src, resolved);
      (new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', src))(mod.exports, modRequire, mod, resolved, dname, primordials);
    }
    mod.loaded = true;
    moduleCache[resolved] = mod.exports;
    if (isBare && id !== resolved) moduleCache[id] = mod.exports;
    delete _moduleWrappers[resolved];
    if (isBare && id !== resolved) delete _moduleWrappers[id];
    return mod.exports;
  }

  function _makeRequire(parentDir, parentMod) {
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
          const _codesProxy = new Proxy(_errCodes, { get(t, k) {
            if (t[k]) return t[k];
            const C = class extends Error { constructor(...a) { super(a.join(', ')); this.code = k; } };
            Object.defineProperty(C, 'name', { value: k });
            return C;
          } });
          class SystemError extends Error { constructor(msg, ctx) { super(typeof msg === 'string' ? msg : (ctx && ctx.message) || ''); if (typeof msg === 'object') ctx = msg; if (ctx) { this.code = ctx.code; this.syscall = ctx.syscall; if (ctx.path) this.path = ctx.path; if (ctx.dest) this.dest = ctx.dest; this.errno = ctx.errno; } } get info() { return { code: this.code, syscall: this.syscall, path: this.path, dest: this.dest, errno: this.errno, message: this.message }; } }
          function E(code, msgTpl, Base) {
            const Cls = class extends (Base || Error) { constructor(...a) { let msg; if (typeof msgTpl === 'function') msg = msgTpl(...a); else if (typeof msgTpl === 'string') { msg = msgTpl; let i = 0; msg = msg.replace(/%[sd]/g, () => String(a[i++])); } else msg = String(a[0] || ''); super(Base === SystemError ? a[0] : msg, Base === SystemError ? undefined : undefined); if (Base === SystemError && typeof a[0] === 'object') { const ctx = a[0]; this.code = code; this.syscall = ctx.syscall; if (ctx.path) this.path = ctx.path; if (ctx.dest) this.dest = ctx.dest; this.errno = ctx.errno; this.message = msg || ctx.message; } this.code = code; } };
            Object.defineProperty(Cls, 'name', { value: code });
            _errCodes[code] = Cls;
          }
          E('ERR_INVALID_ARG_TYPE', (name, expected, actual) => {
            let msg = `The "${name}" argument must be ${expected.includes('|') ? 'one of type ' : 'of type '}${expected}`;
            if (actual !== undefined) { const t = actual === null ? 'null' : typeof actual; msg += `. Received ${t === 'object' ? 'an instance of ' + actual?.constructor?.name : 'type ' + t}`; }
            return msg;
          }, TypeError);
          E('ERR_INVALID_ARG_VALUE', (name, value, reason) => `The ${typeof name === 'string' && name.startsWith('property') ? name : `argument '${name}'`} ${reason || 'is invalid'}. Received ${String(value)}`, TypeError);
          E('ERR_OUT_OF_RANGE', (name, range, actual) => `The value of "${name}" is out of range. It must be ${range}. Received ${actual}`, RangeError);
          E('ERR_MISSING_ARGS', (...args) => `The ${args.map(a => `"${a}"`).join(', ')} argument${args.length > 1 ? 's' : ''} must be specified`, TypeError);
          E('ERR_INVALID_RETURN_VALUE', (expected, name, actual) => `Expected ${expected} from "${name}" but got ${typeof actual}`, TypeError);
          E('ERR_INVALID_CALLBACK', (v) => `Callback must be a function. Received ${v}`, TypeError);
          E('ERR_UNKNOWN_ENCODING', (enc) => `Unknown encoding: ${enc}`, TypeError);
          stub = { codes: _codesProxy, E, SystemError, isStackOverflowError: (e) => e?.message?.includes?.('Maximum call stack') || false, connResetException: (msg) => { const e = new Error(msg || 'socket hang up'); e.code = 'ECONNRESET'; return e; }, uvExceptionWithHostPort: (err, syscall, address, port) => { const e = new Error(`${syscall} ${err} ${address}:${port}`); e.code = err; e.syscall = syscall; return e; } };
        } else if (id === 'internal/url') {
          // isURL must accept only real URL instances — not legacy url.parse() objects
          // or plain look-alikes (which have href/protocol but aren't branded URLs).
          const _urlMod = globalThis.require('url');
          stub = { isURL: (v) => v instanceof globalThis.URL, URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams, pathToFileURL: _urlMod.pathToFileURL, fileURLToPath: _urlMod.fileURLToPath };
        } else if (id === 'internal/options') {
          stub = { getOptionValue: (name) => { if (name === '--insecure-http-parser') return false; if (name === '--use-env-proxy') return false; if (name === '--force-fips') return false; if (name === '--enable-source-maps') return false; if (name === '--pending-deprecation') return false; return undefined; } };
        } else if (id === 'internal/validators') {
          const _throwType = (name, type, actual) => {
            let r; if (actual == null) r = String(actual); else if (typeof actual === 'object') r = 'an instance of ' + (actual.constructor?.name || 'Object'); else r = 'type ' + typeof actual + ' (' + String(actual) + ')';
            const e = new TypeError(`The "${name}" argument must be of type ${type}. Received ${r}`); e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
          };
          const _throwRange = (name, range, actual) => { const e = new RangeError(`The value of "${name}" is out of range. It must be ${range}. Received ${actual}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; };
          const kNone = 0, kNullable = 1, kAllowArray = 2, kAllowFunction = 4;
          stub = {
            validateFunction: (v, name) => { if (typeof v !== 'function') _throwType(name, 'function', v); },
            validateString: (v, name) => { if (typeof v !== 'string') _throwType(name, 'string', v); },
            validateNumber: (v, name, min, max) => {
              if (typeof v !== 'number') _throwType(name, 'number', v);
              if ((min != null && v < min) || (max != null && v > max) || Number.isNaN(v)) _throwRange(name, `>= ${min != null ? min : '-Infinity'} && <= ${max != null ? max : 'Infinity'}`, v);
            },
            validateBoolean: (v, name) => { if (typeof v !== 'boolean') _throwType(name, 'boolean', v); },
            validateObject: (v, name, options) => {
              const flags = options || 0;
              if (v === null && !(flags & kNullable)) _throwType(name, 'Object', v);
              if (Array.isArray(v) && !(flags & kAllowArray)) _throwType(name, 'Object', v);
              if (typeof v === 'function' && !(flags & kAllowFunction)) _throwType(name, 'Object', v);
              if (typeof v !== 'object' && typeof v !== 'function') _throwType(name, 'Object', v);
            },
            validateArray: (v, name) => { if (!Array.isArray(v)) _throwType(name, 'Array', v); },
            validateInt32: (v, name, min, max) => {
              if (typeof v !== 'number') _throwType(name, 'number', v);
              if (!Number.isInteger(v)) _throwRange(name, 'an integer', v);
              min = min ?? -2147483648; max = max ?? 2147483647;
              if (v < min || v > max) _throwRange(name, `>= ${min} && <= ${max}`, v);
            },
            validateUint32: (v, name, positive) => {
              if (typeof v !== 'number') _throwType(name, 'number', v);
              if (!Number.isInteger(v)) _throwRange(name, 'an integer', v);
              const min = positive ? 1 : 0;
              if (v < min || v > 4294967295) _throwRange(name, `>= ${min} && <= 4294967295`, v);
            },
            validateInteger: (v, name, min, max) => {
              if (typeof v !== 'number') _throwType(name, 'number', v);
              if (!Number.isInteger(v)) _throwRange(name, 'an integer', v);
              if (min == null) min = Number.MIN_SAFE_INTEGER; if (max == null) max = Number.MAX_SAFE_INTEGER;
              if (v < min || v > max) _throwRange(name, `>= ${min} && <= ${max}`, v);
            },
            validateBuffer: (v, name) => { if (!Buffer.isBuffer(v)) _throwType(name, 'Buffer', v); },
            validateEncoding: (v, name) => { if (typeof v !== 'string') _throwType(name, 'string', v); },
            validatePort: (v, name) => { let p; if (typeof v === 'string' && v.trim().length > 0 && v === v.trim()) { p = +v; } else if (typeof v === 'number') { p = v; } else { p = NaN; } if (Number.isNaN(p) || p !== (p >>> 0) || p > 0xFFFF) { const e = new RangeError(`${name || 'port'} should be >= 0 and < 65536. Received ${String(v)}.`); e.code = 'ERR_SOCKET_BAD_PORT'; throw e; } return p | 0; },
            validateAbortSignal: () => {},
            validateOneOf: (v, name, oneOf) => { if (!oneOf.includes(v)) { const e = new TypeError(`${name} must be one of: ${oneOf.join(', ')}`); e.code = 'ERR_INVALID_ARG_VALUE'; throw e; } },
            validateSignalName: (v) => { if (typeof v !== 'string') _throwType('signal', 'string', v); },
            validatePlainFunction: (v, name) => { if (typeof v !== 'function') _throwType(name, 'function', v); },
            validateUndefined: (v, name) => { if (v !== undefined) _throwType(name, 'undefined', v); },
            validateLinkHeaderValue: (v) => { if (typeof v !== 'object' || v === null) _throwType('value', 'Object', v); },
            isInt32: (v) => typeof v === 'number' && v === (v | 0),
            isUint32: (v) => typeof v === 'number' && v === (v >>> 0),
            kValidateObjectNone: kNone, kValidateObjectAllowNullable: kNullable, kValidateObjectAllowArray: kAllowArray,
            kValidateObjectAllowFunction: kAllowFunction, kValidateObjectAllowObjects: kAllowArray | kAllowFunction, kValidateObjectAllowObjectsAndNull: kNullable | kAllowArray | kAllowFunction,
          };
        } else if (id === 'internal/fs/utils') {
          function validateRmOptionsSync(path, options) {
            // defaults
            const defaults = { retryDelay: 100, maxRetries: 0, recursive: false, force: false };
            if (options === undefined) return defaults;
            if (options === null || typeof options !== 'object' || Array.isArray(options)) {
              const e = new TypeError('The "options" argument must be of type object. Received ' + (options === null ? 'null' : typeof options));
              e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
            }
            const result = { ...defaults };
            if ('recursive' in options) {
              if (typeof options.recursive !== 'boolean') {
                const e = new TypeError('The "options.recursive" property must be of type boolean. Received ' + typeof options.recursive);
                e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
              }
              result.recursive = options.recursive;
            }
            if ('force' in options) {
              if (typeof options.force !== 'boolean') {
                const e = new TypeError('The "options.force" property must be of type boolean. Received ' + typeof options.force);
                e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
              }
              result.force = options.force;
            }
            if ('retryDelay' in options) {
              if (typeof options.retryDelay !== 'number' || options.retryDelay < 0) {
                const e = new RangeError('The value of "options.retryDelay" is out of range. It must be >= 0. Received ' + options.retryDelay);
                e.code = 'ERR_OUT_OF_RANGE'; throw e;
              }
              result.retryDelay = options.retryDelay;
            }
            if ('maxRetries' in options) {
              if (typeof options.maxRetries !== 'number' || options.maxRetries < 0) {
                const e = new RangeError('The value of "options.maxRetries" is out of range. It must be >= 0. Received ' + options.maxRetries);
                e.code = 'ERR_OUT_OF_RANGE'; throw e;
              }
              result.maxRetries = options.maxRetries;
            }
            return result;
          }
          const fs = require('fs');
          stub = { validateRmOptionsSync, stringToFlags: fs.stringToFlags };
        } else if (id === 'internal/event_target') {
          stub = { CustomEvent: globalThis.CustomEvent, Event: globalThis.Event, EventTarget: globalThis.EventTarget, NodeEventTarget: globalThis.EventTarget };
        } else if (id === 'internal/util') {
          stub = {
            emitExperimentalWarning: (feature) => { process.emitWarning(`${feature} is an experimental feature`, 'ExperimentalWarning'); },
            getSystemErrorName: (err) => `ERRNO_${err}`,
            promisify: require('util').promisify,
            deprecate: require('util').deprecate,
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
        return _loadModule(id, fname, src, parentMod, true);
      }

      const resolved = _resolve(id, parentDir);
      if (_moduleWrappers[resolved]) { _updateChildren(parentMod, _moduleObjects[resolved], true); return _moduleWrappers[resolved].exports; }
      if (resolved && moduleCache[resolved]) { _updateChildren(parentMod, _moduleObjects[resolved], true); return moduleCache[resolved]; }
      if (resolved) return _loadModule(id, resolved, _fs.readFileSync(resolved), parentMod, false);

      const searchDir = parentDir || (process.cwd ? process.cwd() : '');
      const nmResolved = _resolveNodeModules(id, searchDir);
      if (nmResolved) {
        if (moduleCache[nmResolved]) { _updateChildren(parentMod, _moduleObjects[nmResolved], true); return moduleCache[nmResolved]; }
        return _loadModule(id, nmResolved, _fs.readFileSync(nmResolved), parentMod, false);
      }

      try { const b = _nativeBinding(id); moduleCache[id] = b; return b; } catch {}
      const _mnfErr = new Error("Cannot find module '" + id + "'");
      _mnfErr.code = 'MODULE_NOT_FOUND';
      throw _mnfErr;
    }

    require.resolve = function(id, options) {
      if (typeof id !== 'string') { const e = new TypeError('The "request" argument must be of type string. Received ' + (id === null ? 'null' : typeof id)); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
      const origId = id;
      if (id.startsWith('node:')) id = id.slice(5);
      const flatId = id.replace(/\//g, '_');
      if (moduleCache[id] || _tryMiloLib(id) || _tryMiloLib(flatId) || __loadBuiltin(id)) return origId;
      if (options && options.paths) {
        for (const p of options.paths) {
          const resolved = _resolve(id, p);
          if (resolved) return resolved;
          const nmResolved = _resolveNodeModules(id, p);
          if (nmResolved) return nmResolved;
        }
      } else {
        const resolved = _resolve(id, parentDir);
        if (resolved) return resolved;
        const searchDir = parentDir || (process.cwd ? process.cwd() : '');
        const nmResolved = _resolveNodeModules(id, searchDir);
        if (nmResolved) return nmResolved;
      }
      const _rnfErr = new Error("Cannot find module '" + id + "'");
      _rnfErr.code = 'MODULE_NOT_FOUND';
      throw _rnfErr;
    };
    require.resolve.paths = function(request) {
      if (typeof request !== 'string') { const e = new TypeError('The "request" argument must be of type string. Received ' + typeof request); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
      if (request.startsWith('node:')) return null;
      if (request === '.' || request === '..' || request.startsWith('./') || request.startsWith('../')) {
        return [parentDir || process.cwd()];
      }
      const paths = [];
      let dir = parentDir || process.cwd();
      while (true) {
        paths.push(dir + '/node_modules');
        const parent = dir.substring(0, dir.lastIndexOf('/'));
        if (parent === dir || parent === '') break;
        dir = parent;
      }
      return paths;
    };
    require.cache = moduleCache;
    Object.defineProperty(require, 'extensions', {
      get() { try { return globalThis.require('module')._extensions; } catch { return {}; } },
      configurable: true,
    });
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

  // --- dynamic import() handler ---
  // V8's C++ callback calls this synchronously, resolves/rejects the promise itself.
  globalThis.__dynamicImportHandler = function(specifier) {
    let resolved = specifier;
    if (resolved.startsWith('file://')) resolved = resolved.slice(7);
    const exports = require(resolved);
    const ns = Object.create(null);
    if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
      Object.assign(ns, exports);
    }
    ns.default = exports;
    Object.freeze(ns);
    return ns;
  };

  // --- load internal init modules (order matters) ---
  require('_console_init');
  require('_process_init');
  require('_timers_init');
  require('timers');
  try { const _b = require('buffer'); globalThis.Buffer = _b.Buffer || _b; } catch {}
  // Expose WebCrypto API as globalThis.crypto (Node 19+)
  try { const _c = require('crypto'); if (_c.webcrypto) Object.defineProperty(globalThis, 'crypto', { value: _c.webcrypto, writable: true, enumerable: true, configurable: true }); } catch {}

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

// Node.js C++ sets up most globals as non-enumerable. Make ours match
// so that test/common/index.js leakedGlobals() check passes.
(function() {
  const nonEnum = [
    'internalBinding', 'getInternalBinding', 'primordials', 'require',
    'process', 'Buffer',
    'AbortController', 'AbortSignal', 'DOMException', 'Event', 'EventTarget',
    'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
    'ReadableStream', 'WritableStream', 'TransformStream',
    'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
    'Headers', 'Request', 'Response', 'Blob', 'File',
    'PerformanceObserver', 'Navigator', 'CustomEvent',
    'MessageEvent', 'MessageChannel', 'MessagePort', 'BroadcastChannel',
  ];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith('_') || nonEnum.includes(key)) {
      const desc = Object.getOwnPropertyDescriptor(globalThis, key);
      if (desc && desc.enumerable) Object.defineProperty(globalThis, key, { ...desc, enumerable: false });
    }
  }
  // sessionStorage (Web Storage API stub)
  if (typeof globalThis.sessionStorage === 'undefined') {
    const _store = new Map();
    globalThis.sessionStorage = { getItem(k) { return _store.get(String(k)) ?? null; }, setItem(k, v) { _store.set(String(k), String(v)); }, removeItem(k) { _store.delete(String(k)); }, clear() { _store.clear(); }, get length() { return _store.size; }, key(i) { return [..._store.keys()][i] ?? null; } };
  }
  // crypto and navigator must be enumerable (Node.js behavior)
  for (const k of ['crypto', 'navigator', 'sessionStorage']) {
    const d = Object.getOwnPropertyDescriptor(globalThis, k);
    if (d && !d.enumerable && d.configurable) Object.defineProperty(globalThis, k, { ...d, enumerable: true });
  }
})();
