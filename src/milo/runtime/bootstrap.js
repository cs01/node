// bootstrap.js — milo-node runtime bootstrap
// Loaded from disk by main.milo at startup. Defines primordials, console,
// internalBinding shim, require(), and module stubs for unimplemented bindings.
'use strict';

(function() {
  // --- primordials ---
  const primordials = {};
  const _pSrc = __loadBuiltin('internal/per_context/primordials');
  if (_pSrc) {
    (new Function('primordials', _pSrc))(primordials);
  }
  globalThis.primordials = primordials;

  // --- JS-defined binding stubs (replacing unimplemented native bindings) ---
  const _constants = {
    os: {
      signals: {
        SIGHUP:1, SIGINT:2, SIGQUIT:3, SIGILL:4, SIGTRAP:5, SIGABRT:6,
        SIGFPE:8, SIGKILL:9, SIGBUS:10, SIGSEGV:11, SIGSYS:12, SIGPIPE:13,
        SIGALRM:14, SIGTERM:15, SIGURG:16, SIGSTOP:17, SIGTSTP:18,
        SIGCONT:19, SIGCHLD:20, SIGTTIN:21, SIGTTOU:22, SIGIO:23,
        SIGXCPU:24, SIGXFSZ:25, SIGVTALRM:26, SIGPROF:27, SIGINFO:29,
        SIGUSR1:30, SIGUSR2:31,
      },
      errno: {
        E2BIG:7, EACCES:13, EADDRINUSE:48, EADDRNOTAVAIL:49,
        EAGAIN:35, EALREADY:37, EBADF:9, EBUSY:16, ECANCELED:89,
        ECHILD:10, ECONNABORTED:53, ECONNREFUSED:61, ECONNRESET:54,
        EDEADLK:11, EDESTADDRREQ:39, EDOM:33, EEXIST:17, EFAULT:14,
        EFBIG:27, EHOSTUNREACH:65, EINPROGRESS:36, EINTR:4, EINVAL:22,
        EIO:5, EISCONN:56, EISDIR:21, ELOOP:62, EMFILE:24, EMLINK:31,
        EMSGSIZE:40, ENAMETOOLONG:63, ENETDOWN:50, ENETUNREACH:51,
        ENFILE:23, ENOBUFS:55, ENODEV:19, ENOENT:2, ENOMEM:12,
        ENOSPC:28, ENOSYS:78, ENOTCONN:57, ENOTDIR:20, ENOTEMPTY:66,
        ENOTSOCK:38, ENOTSUP:45, EPERM:1, EPIPE:32, ERANGE:34,
        EROFS:30, ESPIPE:29, ESRCH:3, ETIMEDOUT:60, EXDEV:18,
      },
      priority: {
        PRIORITY_LOW:19, PRIORITY_BELOW_NORMAL:10, PRIORITY_NORMAL:0,
        PRIORITY_ABOVE_NORMAL:-7, PRIORITY_HIGH:-14, PRIORITY_HIGHEST:-20,
      },
      UV_UDP_REUSEADDR: 4,
    },
    fs: {
      O_RDONLY:0, O_WRONLY:1, O_RDWR:2, O_CREAT:512, O_EXCL:2048,
      O_TRUNC:1024, O_APPEND:8, O_DIRECTORY:1048576, O_NOFOLLOW:256,
      O_SYNC:128, O_SYMLINK:2097152, O_NONBLOCK:4,
      S_IFMT:61440, S_IFREG:32768, S_IFDIR:16384, S_IFLNK:40960,
      S_IFCHR:8192, S_IFBLK:24576, S_IFIFO:4096, S_IFSOCK:49152,
      S_IRWXU:448, S_IRUSR:256, S_IWUSR:128, S_IXUSR:64,
      S_IRWXG:56, S_IRGRP:32, S_IWGRP:16, S_IXGRP:8,
      S_IRWXO:7, S_IROTH:4, S_IWOTH:2, S_IXOTH:1,
      F_OK:0, R_OK:4, W_OK:2, X_OK:1,
      UV_FS_COPYFILE_EXCL:1, UV_FS_COPYFILE_FICLONE:2,
      COPYFILE_EXCL:1, COPYFILE_FICLONE:2,
    },
  };

  const _types = {
    isDate: (v) => v instanceof Date,
    isMap: (v) => v instanceof Map,
    isSet: (v) => v instanceof Set,
    isWeakMap: (v) => v instanceof WeakMap,
    isWeakSet: (v) => v instanceof WeakSet,
    isRegExp: (v) => v instanceof RegExp,
    isPromise: (v) => v instanceof Promise,
    isNativeError: (v) => v instanceof Error,
    isArrayBuffer: (v) => v instanceof ArrayBuffer,
    isSharedArrayBuffer: (v) => typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer,
    isProxy: (v) => false,
    isExternal: (v) => false,
    isAnyArrayBuffer: (v) => v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
    isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
    isDataView: (v) => v instanceof DataView,
  };

  const _mksnapshot = { isBuildingSnapshotBuffer: new Uint8Array(1) };
  const _stringDecoder = { encodings: ['ascii','utf8','base64','base64url','utf16le','hex','buffer','latin1'] };
  const _diagnosticsChannel = {
    linkNativeChannel() {},
    getOrCreateChannelIndex() { return 0; },
    subscriberCounts: new Uint32Array(1),
    subscribers: new Uint32Array(1),
  };
  const _errors = {
    exitCodes: { kNoFailure: 0, kGenericUserError: 1, kInvalidCommandLineArgument: 9, kInvalidNodeOptions: 12 },
    noSideEffectsToString(val) { try { return '' + val; } catch { return 'Object'; } },
    triggerUncaughtException(err) { throw err; },
  };

  const _startTime = Date.now();
  const _performance = {
    constants: {
      NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN: 0,
      NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP: 1,
      NODE_PERFORMANCE_MILESTONE_LOOP_START: 2,
      NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: 3,
      NODE_PERFORMANCE_MILESTONE_ENVIRONMENT: 4,
      NODE_PERFORMANCE_MILESTONE_NODE_START: 5,
      NODE_PERFORMANCE_MILESTONE_V8_START: 6,
      NODE_PERFORMANCE_GC_MAJOR: 4, NODE_PERFORMANCE_GC_MINOR: 1,
      NODE_PERFORMANCE_GC_INCREMENTAL: 8, NODE_PERFORMANCE_GC_WEAKCB: 16,
    },
    milestones: new Float64Array(16),
    now: typeof performance !== 'undefined' ? performance.now.bind(performance) : () => Date.now() - _startTime,
    setupObservers() {},
    loopIdleTime() { return 0; },
  };
  _performance.milestones[0] = _startTime * 1e3;
  _performance.milestones[1] = _startTime * 1e3;

  const _asyncWrap = {
    constants: {
      kInit: 0, kBefore: 1, kAfter: 2, kDestroy: 3, kTotals: 4, kPromiseResolve: 5,
      kCheck: 6, kExecutionAsyncId: 7, kAsyncIdCounter: 8, kTriggerAsyncId: 9,
      kDefaultTriggerAsyncId: 10, kStackLength: 11, kUsesExecutionAsyncResource: 12,
    },
    async_hook_fields: new Uint32Array(16),
    async_id_fields: new Float64Array(8),
    execution_async_resources: [{}],
    pushAsyncContext(asyncId, triggerId, resource) {},
    popAsyncContext(asyncId) { return true; },
    executionAsyncResource() { return {}; },
    clearAsyncIdStack() {},
    registerDestroyHook() {},
    setCallbackTrampoline() {},
    setPromiseHooks() {},
    queueDestroyAsyncId() {},
  };
  _asyncWrap.async_id_fields[8 /*kAsyncIdCounter*/] = 1;

  const _symbols = {};
  // keyed by symbol description (matches C++ PER_ISOLATE_SYMBOL_PROPERTIES)
  ['fs_use_promises_symbol','async_id_symbol','constructor_key_symbol','handle_onclose',
   'no_message_symbol','messaging_deserialize_symbol','imported_cjs_symbol',
   'messaging_transfer_symbol','messaging_clone_symbol','messaging_transfer_list_symbol',
   'oninit','owner_symbol','onpskexchange','resource_symbol','trigger_async_id_symbol',
   'vm_context_no_contextify','vm_dynamic_import_default_internal',
   'vm_dynamic_import_main_context_default','vm_dynamic_import_missing_flag',
   'vm_dynamic_import_no_callback','builtin_source_text_module_hdo',
   'embedder_module_hdo','source_text_module_default_hdo',
  ].forEach(name => { _symbols[name] = Symbol(name); });
  // private symbols — used like Symbols but from C++ private namespace
  _symbols.privateSymbols = new Proxy({}, { get(_, key) { return Symbol('private:' + String(key)); } });
  _symbols.constants = { kDisallowCloneAndTransfer: 0, kTransferable: 1, kCloneable: 2, kTransferableAndCloneable: 3 };

  const _taskQueue = {
    enqueueMicrotask: typeof queueMicrotask !== 'undefined' ? queueMicrotask : (fn) => Promise.resolve().then(fn),
    setTickCallback() {},
    setPromiseRejectCallback() {},
    promiseRejectEvents: {
      kPromiseRejectWithNoHandler: 0,
      kPromiseHandlerAddedAfterReject: 1,
      kPromiseRejectAfterResolved: 2,
      kPromiseResolveAfterResolved: 3,
    },
  };

  const _config = { hasIntl: true, hasOpenSSL: false, hasCrypto: false, hasInspector: false };

  const _timers = {
    scheduleTimer() {},
    toggleTimerRef() {},
    getLibuvNow() { return Date.now(); },
    setupTimers() {},
    immediateInfo: new Uint32Array(4),
    timeoutInfo: new Int32Array(2),
  };

  const _traceEvents = {
    getCategoryEnabledBuffer() { return new Uint8Array(1); },
    trace() {},
    categoryGroupEnabled: 0,
  };

  // Wrap-type stubs — constructors with prototypes so destructuring works
  function _makeHandle(name) {
    function Handle() {}
    Handle.prototype.close = function(cb) { if (cb) cb(); };
    Handle.prototype.ref = function() {};
    Handle.prototype.unref = function() {};
    Handle.prototype.hasRef = function() { return false; };
    Handle.prototype.readStart = function() {};
    Handle.prototype.readStop = function() {};
    return Handle;
  }
  function _makeWrap() { function W() {} return W; }

  const _TCP = _makeHandle('TCP');
  _TCP.prototype.bind = function() { return 0; };
  _TCP.prototype.bind6 = function() { return 0; };
  _TCP.prototype.listen = function() { return 0; };
  _TCP.prototype.connect = function() {};
  _TCP.prototype.open = function() { return 0; };
  _TCP.prototype.setNoDelay = function() {};
  _TCP.prototype.setKeepAlive = function() {};
  _TCP.prototype.getsockname = function(out) { out.address = '0.0.0.0'; out.port = 0; out.family = 'IPv4'; };
  _TCP.prototype.getpeername = function(out) { out.address = '0.0.0.0'; out.port = 0; out.family = 'IPv4'; };
  _TCP.prototype.writeBuffer = function() {};
  _TCP.prototype.writeUtf8String = function() {};
  _TCP.prototype.setSimultaneousAccepts = function() {};

  const _Pipe = _makeHandle('Pipe');
  _Pipe.prototype.bind = function() { return 0; };
  _Pipe.prototype.listen = function() { return 0; };
  _Pipe.prototype.connect = function() {};
  _Pipe.prototype.open = function() { return 0; };

  const _tcpWrap = {
    TCP: _TCP, TCPConnectWrap: _makeWrap(),
    constants: { SOCKET: 0, SERVER: 1, UV_TCP_IPV6ONLY: 1, UV_TCP_REUSEPORT: 2 },
  };
  const _pipeWrap = { Pipe: _Pipe, PipeConnectWrap: _makeWrap(), constants: { SOCKET: 0, SERVER: 1, IPC: 2 } };
  const _streamWrap = { ShutdownWrap: _makeWrap(), WriteWrap: _makeWrap() };
  const _caresWrap = {
    ChannelWrap: _makeHandle('ChannelWrap'),
    GetAddrInfoReqWrap: _makeWrap(), GetNameInfoReqWrap: _makeWrap(), QueryReqWrap: _makeWrap(),
    convertIpv6StringToBuffer() { return new Uint8Array(16); },
  };

  const _uvConstants = {};
  // populate UV error codes
  ['E2BIG','EACCES','EADDRINUSE','EADDRNOTAVAIL','EAFNOSUPPORT','EAGAIN','EALREADY','EBADF',
   'EBUSY','ECANCELED','ECHARSET','ECONNABORTED','ECONNREFUSED','ECONNRESET','EDESTADDRREQ',
   'EEXIST','EFAULT','EFBIG','EHOSTUNREACH','EINTR','EINVAL','EIO','EISCONN','EISDIR',
   'ELOOP','EMFILE','EMSGSIZE','ENAMETOOLONG','ENETDOWN','ENETUNREACH','ENFILE','ENOBUFS',
   'ENODEV','ENOENT','ENOMEM','ENONET','ENOPROTOOPT','ENOSPC','ENOSYS','ENOTCONN','ENOTDIR',
   'ENOTEMPTY','ENOTSOCK','ENOTSUP','EOVERFLOW','EPERM','EPIPE','EPROTO','EPROTONOSUPPORT',
   'EPROTOTYPE','ERANGE','EROFS','ESHUTDOWN','ESPIPE','ESRCH','ETIMEDOUT','ETXTBSY',
   'EXDEV','UNKNOWN','EOF','ENXIO','EMLINK','EHOSTDOWN','EREMOTEIO','ENOTTY','EFTYPE',
   'EILSEQ','ESOCKTNOSUPPORT','EUNATCH'].forEach((code, i) => { _uvConstants[code] = -(i + 1); });
  const _uv = {
    errname(code) { for (const k of Object.keys(_uvConstants)) { if (_uvConstants[k] === code) return k; } return 'UNKNOWN'; },
    errmap: new Map(),
    getErrorMap() { return _uv.errmap; },
    UV_UDP_REUSEADDR: 4,
  };
  // populate errmap
  for (const [code, num] of Object.entries(_uvConstants)) {
    _uv.errmap.set(num, [code, '']);
  }

  const _TTY = _makeHandle('TTY');
  _TTY.prototype.getWindowSize = function(out) { out[0] = 80; out[1] = 24; return 0; };
  _TTY.prototype.setMode = function() { return 0; };
  const _ttyWrap = { TTY: _TTY, isTTY(fd) { return fd === 0 || fd === 1 || fd === 2; }, guessHandleType() { return 'FILE'; } };

  const _Process = _makeHandle('Process');
  _Process.prototype.spawn = function() { return 0; };
  _Process.prototype.kill = function() { return 0; };
  const _processWrap = { Process: _Process };

  const _spawnSync = { spawn() { return { status: 1, signal: null, output: [null, null, null], pid: 0, error: { code: 'ENOSYS' } }; } };

  const _worker = {
    isMainThread: true, isInternalThread: false,
    ownsProcessState: true, threadId: 0, threadName: '',
    resourceLimits: new Float64Array(5),
    kMaxYoungGenerationSizeMb: 0, kMaxOldGenerationSizeMb: 1, kCodeRangeSizeMb: 2, kStackSizeMb: 3, kTotalResourceLimitCount: 5,
    Worker: function WorkerImpl() {},
  };

  const _messaging = {
    MessagePort: function MessagePort() {},
    MessageChannel: function MessageChannel() { this.port1 = new _messaging.MessagePort(); this.port2 = new _messaging.MessagePort(); },
    markAsUncloneable() {}, moveMessagePortToContext() {}, receiveMessageOnPort() {},
    BroadcastChannel: function BroadcastChannel() {},
    markAsUntransferable() {}, isMarkedAsUntransferable() { return false; },
  };

  const _icu = { toUnicode(s) { return s; }, toASCII(s) { return s; } };
  const _inspector = { open() {}, url() { return undefined; }, isEnabled() { return false; }, waitForDebugger() {}, console: {} };

  const _jsBindings = {
    constants: _constants, types: _types, mksnapshot: _mksnapshot,
    string_decoder: _stringDecoder, diagnostics_channel: _diagnosticsChannel,
    errors: _errors, performance: _performance, async_wrap: _asyncWrap,
    symbols: _symbols, task_queue: _taskQueue, config: _config,
    timers: _timers, trace_events: _traceEvents,
    tcp_wrap: _tcpWrap, pipe_wrap: _pipeWrap, stream_wrap: _streamWrap,
    cares_wrap: _caresWrap, uv: _uv,
    tty_wrap: _ttyWrap, process_wrap: _processWrap, spawn_sync: _spawnSync,
    worker: _worker, messaging: _messaging,
    icu: _icu, inspector: _inspector,
    udp_wrap: { UDP: _makeHandle('UDP'), SendWrap: _makeWrap(), constants: { UV_UDP_IPV6ONLY: 1, UV_UDP_REUSEPORT: 2 } },
    http_parser: { HTTPParser: Object.assign(_makeHandle('HTTPParser'), { REQUEST: 1, RESPONSE: 2, kOnHeaders: 0, kOnHeadersComplete: 1, kOnBody: 2, kOnMessageComplete: 3, kOnExecute: 4, kLenientNone: 0 }), methods: [] },
    signal_wrap: { Signal: _makeHandle('Signal') },
  };

  // --- internalBinding shim ---
  const _origInternalBinding = internalBinding;
  const _emptyBinding = Object.freeze(Object.create(null));
  const _bindingPatches = {
    util(b) {
      b.defineLazyProperties = function(target, id, keys, enumerable) {
        const en = enumerable !== false;
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          Object.defineProperty(target, key, {
            get() { const mod = require(id); const v = mod[key]; Object.defineProperty(target, key, {value: v, writable: true, enumerable: en, configurable: true}); return v; },
            set(v) { Object.defineProperty(target, key, {value: v, writable: true, enumerable: en, configurable: true}); },
            configurable: true, enumerable: en,
          });
        }
      };
      return b;
    },
  };
  globalThis.internalBinding = function(name) {
    if (_jsBindings[name]) return _jsBindings[name];
    try {
      let b = _origInternalBinding(name);
      if (_bindingPatches[name]) b = _bindingPatches[name](b);
      return b;
    }
    catch(e) { return _emptyBinding; }
  };
  globalThis.getInternalBinding = globalThis.internalBinding;

  // --- internal module stubs (these replace unimplemented lib/internal/*.js) ---
  const _encodings = ['ascii','utf8','base64','base64url','utf16le','hex','buffer','latin1'];
  const _encodingsMap = { __proto__: null };
  for (let i = 0; i < _encodings.length; i++) _encodingsMap[_encodings[i]] = i;

  const _internalModules = {
    'internal/util': {
      isWindows: false,
      isMacOS: process.platform === 'darwin',
      getLazy(init) { let v; return () => (v ??= init()); },
      spliceOne(list, idx) { for (let i=idx; i<list.length-1; i++) list[i]=list[i+1]; list.pop(); },
      kEmptyObject: Object.freeze(Object.create(null)),
      normalizeEncoding(enc) {
        if (!enc || enc === 'utf8' || enc === 'utf-8') return 'utf8';
        const low = enc.toLowerCase();
        const aliases = {'utf-8':'utf8','ucs2':'utf16le','ucs-2':'utf16le','utf-16le':'utf16le','binary':'latin1'};
        return aliases[low] || low;
      },
      isError(e) { return e instanceof Error; },
      setOwnProperty(obj, key, val) { Object.defineProperty(obj, key, {value:val, writable:true, enumerable:true, configurable:true}); },
      customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
      kIsEncodingSymbol: Symbol('kIsEncoding'),
      lazyDOMException(msg, name) { return new Error(msg); },
      defineLazyProperties(target, id, keys, en) {
        for (const key of keys) {
          Object.defineProperty(target, key, {
            get() { const mod = require(id); const v = mod[key]; Object.defineProperty(target, key, {value:v, writable:true, enumerable:true, configurable:true}); return v; },
            configurable: true, enumerable: en !== false,
          });
        }
      },
      encodingsMap: _encodingsMap,
      encodings: _encodings,
      pendingDeprecation: false,
      deprecate(fn) { return fn; },
      getSystemErrorName(err) { return 'UNKNOWN'; },
      kEnumerableProperty: Object.freeze({ __proto__: null, enumerable: true }),
      getConstructorOf(obj) { const c = obj?.constructor; return c && c.prototype === Object.getPrototypeOf(obj) ? c : null; },
      removeColors(str) { return String(str).replace(/\[\d+m/g, ''); },
      SideEffectFreeRegExpPrototypeSymbolReplace: RegExp.prototype[Symbol.replace].bind(RegExp.prototype),
      once(fn) { let called = false; return function(...args) { if (called) return; called = true; return fn(...args); }; },
      createDeferredPromise() { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise: p, resolve, reject }; },
      promisify: Object.assign(function promisify(fn) {
        return function(...args) { return new Promise((resolve, reject) => { fn(...args, (err, val) => err ? reject(err) : resolve(val)); }); };
      }, { custom: Symbol('util.promisify.custom') }),
      constructSharedArrayBuffer(size) { return new SharedArrayBuffer(size); },
      guessHandleType(fd) { if (fd >= 0 && fd <= 2) return 'TTY'; return 'UNKNOWN'; },
      assignFunctionName(name, fn, descriptor) {
        const n = typeof name === 'symbol' ? `[${name.description || ''}]` : name;
        return Object.defineProperty(fn, 'name', { value: n, writable: false, enumerable: false, configurable: true, ...(descriptor || {}) });
      },
      WeakReference: class WeakReference {
        #weak = null; #strong = null; #refCount = 0;
        constructor(obj) { this.#weak = new WeakRef(obj); }
        incRef() { this.#refCount++; if (this.#refCount === 1) { const d = this.#weak.deref(); if (d !== undefined) this.#strong = d; } return this.#refCount; }
        decRef() { this.#refCount--; if (this.#refCount === 0) this.#strong = null; return this.#refCount; }
        get() { return this.#weak.deref(); }
      },
    },
    'internal/constants': {
      CHAR_FORWARD_SLASH: 47, CHAR_BACKWARD_SLASH: 92, CHAR_DOT: 46,
      CHAR_COLON: 58, CHAR_QUESTION_MARK: 63, CHAR_UNDERSCORE: 95,
      CHAR_LINE_FEED: 10, CHAR_CARRIAGE_RETURN: 13, CHAR_TAB: 9,
      CHAR_EXCLAMATION_MARK: 33, CHAR_HASH: 35, CHAR_SPACE: 32,
      CHAR_NO_BREAK_SPACE: 160, CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
      CHAR_LEFT_SQUARE_BRACKET: 91, CHAR_RIGHT_SQUARE_BRACKET: 93,
      CHAR_LEFT_ANGLE_BRACKET: 60, CHAR_RIGHT_ANGLE_BRACKET: 62,
      CHAR_LEFT_CURLY_BRACKET: 123, CHAR_RIGHT_CURLY_BRACKET: 125,
      CHAR_HYPHEN_MINUS: 45, CHAR_PLUS: 43, CHAR_DOUBLE_QUOTE: 34,
      CHAR_SINGLE_QUOTE: 39, CHAR_PERCENT: 37, CHAR_SEMICOLON: 59,
      CHAR_CIRCUMFLEX_ACCENT: 94, CHAR_GRAVE_ACCENT: 96,
      CHAR_AT: 64, CHAR_AMPERSAND: 38, CHAR_EQUAL: 61,
      CHAR_LOWERCASE_A: 97, CHAR_UPPERCASE_A: 65,
      CHAR_LOWERCASE_Z: 122, CHAR_UPPERCASE_Z: 90,
      CHAR_0: 48, CHAR_9: 57,
      EOL: '\n',
    },
    'internal/options': {
      getOptionValue(name) {
        const defaults = { '--network-family-autoselection-attempt-timeout': 250, '--network-family-autoselection': true, '--abort-on-uncaught-exception': false, '--experimental-modules': true, '--trace-warnings': false, '--trace-deprecation': false, '--throw-deprecation': false, '--pending-deprecation': false, '--no-warnings': false, '--expose-internals': false, '--experimental-vm-modules': false, '--experimental-wasm-modules': false, '--experimental-strip-types': false, '--experimental-transform-types': false, '--max-old-space-size': 0 };
        return defaults[name];
      },
      getEmbedderOptions() { return {}; },
    },
    'internal/validators': {
      validateString(v, name) { if (typeof v !== 'string') throw new TypeError(name + ' must be a string'); },
      validateObject(v, name, opts) { if (typeof v !== 'object' || v === null) throw new TypeError(name + ' must be an object'); },
      validateInt32(v, name) { if (typeof v !== 'number' || v !== (v|0)) throw new RangeError(name + ' must be a 32-bit integer'); },
      validateFunction(v, name) { if (typeof v !== 'function') throw new TypeError(name + ' must be a function'); },
      validateBoolean(v, name) { if (typeof v !== 'boolean') throw new TypeError(name + ' must be a boolean'); },
      validateNumber(v, name) { if (typeof v !== 'number') throw new TypeError(name + ' must be a number'); },
      validateOneOf(v, name, oneOf) { if (!oneOf.includes(v)) throw new TypeError(name + ' must be one of: ' + oneOf.join(', ')); },
      validateAbortSignal(v, name) {},
      kValidateObjectAllowArray: 1,
      kValidateObjectAllowFunction: 2,
    },
    'internal/util/types': _types,
    'internal/assert': function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); },
    'internal/bootstrap/realm': {
      BuiltinModule: {
        normalizeRequirableId(id) { return id; },
        isBuiltin(id) { return false; },
        map: new Map(),
      },
    },
    'internal/events/abort_listener': {
      addAbortListener(signal, listener) { if (signal) signal.addEventListener('abort', listener, {once: true}); return { [Symbol.dispose]() {} }; },
    },
  };
  globalThis.__internalModules = _internalModules;

  // --- process augmentation ---
  // Web globals that V8 doesn't provide in bare isolate
  if (typeof AbortController === 'undefined') {
    globalThis.AbortController = class AbortController { #signal = { aborted: false, reason: undefined, throwIfAborted() { if (this.aborted) throw this.reason; }, addEventListener() {}, removeEventListener() {} }; get signal() { return this.#signal; } abort(reason) { this.#signal.aborted = true; this.#signal.reason = reason || new DOMException('AbortError'); } };
    globalThis.AbortSignal = { abort(reason) { const c = new AbortController(); c.abort(reason); return c.signal; }, timeout(ms) { const c = new AbortController(); setTimeout?.(() => c.abort(new DOMException('TimeoutError')), ms); return c.signal; } };
  }
  if (typeof DOMException === 'undefined') globalThis.DOMException = class DOMException extends Error { constructor(msg, name) { super(msg); this.name = name || 'Error'; this.code = 0; } };
  if (typeof Event === 'undefined') globalThis.Event = class Event { constructor(type, opts) { this.type = type; this.bubbles = opts?.bubbles || false; this.cancelable = opts?.cancelable || false; this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } };
  if (typeof EventTarget === 'undefined') {
    globalThis.EventTarget = class EventTarget { #h = {}; addEventListener(t, fn) { (this.#h[t] ??= []).push(fn); } removeEventListener(t, fn) { const a = this.#h[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } } dispatchEvent(ev) { for (const fn of (this.#h[ev.type] || [])) fn(ev); } };
  }
  if (typeof URL === 'undefined') {
    globalThis.URL = class URL { constructor(url, base) { if (base) url = base.replace(/\/$/, '') + '/' + url.replace(/^\//, ''); const m = url.match(/^([a-z]+):\/\/([^/:]+)?(?::(\d+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i); this.protocol = m?.[1] ? m[1] + ':' : ''; this.hostname = m?.[2] || ''; this.port = m?.[3] || ''; this.pathname = m?.[4] || '/'; this.search = m?.[5] || ''; this.hash = m?.[6] || ''; this.host = this.hostname + (this.port ? ':' + this.port : ''); this.href = url; this.origin = this.protocol + '//' + this.host; } toString() { return this.href; } };
    globalThis.URLSearchParams = class URLSearchParams { #p = []; constructor(init) { if (typeof init === 'string') { for (const p of init.replace(/^\?/,'').split('&')) { const [k,...v] = p.split('='); this.#p.push([decodeURIComponent(k), decodeURIComponent(v.join('='))]); } } } get(k) { const e = this.#p.find(([a])=>a===k); return e ? e[1] : null; } has(k) { return this.#p.some(([a])=>a===k); } };
  }
  if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = class TextEncoder { encode(s) { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff); return new Uint8Array(a); } };
  if (typeof TextDecoder === 'undefined') globalThis.TextDecoder = class TextDecoder { decode(buf) { if (!buf) return ''; const a = new Uint8Array(buf.buffer || buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; } };
  if (typeof queueMicrotask === 'undefined') globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
  if (typeof global === 'undefined') globalThis.global = globalThis;
  if (typeof structuredClone === 'undefined') globalThis.structuredClone = function(v) { return JSON.parse(JSON.stringify(v)); };
  if (typeof Blob === 'undefined') globalThis.Blob = class Blob { #parts; #opts; constructor(parts, opts) { this.#parts = parts || []; this.#opts = opts || {}; } get size() { return this.#parts.reduce((s,p) => s + (typeof p === 'string' ? p.length : p.byteLength || 0), 0); } get type() { return this.#opts.type || ''; } };
  if (typeof setImmediate === 'undefined') { let _imm = []; globalThis.setImmediate = function(fn, ...args) { const id = _imm.length; _imm.push(fn); Promise.resolve().then(() => { const f = _imm[id]; if (f) { _imm[id] = null; f(...args); } }); return id; }; globalThis.clearImmediate = function(id) { _imm[id] = null; }; }
  if (typeof setTimeout === 'undefined') globalThis.setTimeout = function(fn, ms, ...args) { return 0; };
  if (typeof clearTimeout === 'undefined') globalThis.clearTimeout = function() {};
  if (typeof setInterval === 'undefined') globalThis.setInterval = function() { return 0; };
  if (typeof clearInterval === 'undefined') globalThis.clearInterval = function() {};
  process.emitWarning = function(msg) { console.error('Warning:', msg); };
  process.env = new Proxy({}, {
    get(_, key) { return internalBinding('env').get(String(key)); },
    has(_, key) { return internalBinding('env').get(String(key)) !== undefined; },
  });
  process.config = { variables: { asan: 0, v8_enable_i18n_support: 0, node_shared: false, node_use_ffi: false, v8_enable_temporal_support: 0 }, target_defaults: { default_configuration: 'Release' } };
  process.features = { inspector: false, debug: false, uv: true, ipv6: true, tls: false, tls_alpn: false, tls_sni: false, tls_ocsp: false };
  if (!process.versions) process.versions = {};
  process.versions.node = '24.0.0';
  process.versions.v8 = '13.6.233.5';
  process.versions.modules = '135';
  process.version = 'v24.0.0';
  process.release = { name: 'node' };
  if (!process.umask) process.umask = function(mask) { if (mask === undefined) return 0o22; return 0o22; };
  if (!process.getuid) process.getuid = function() { return 0; };
  if (!process.getgid) process.getgid = function() { return 0; };
  if (!process.hrtime) {
    process.hrtime = function(prev) { const n = Date.now(); const s = Math.floor(n/1000); const ns = (n%1000)*1e6; if (prev) { let ds=s-prev[0]; let dn=ns-prev[1]; if(dn<0){ds--;dn+=1e9;} return[ds,dn]; } return[s,ns]; };
    process.hrtime.bigint = function() { return BigInt(Date.now()) * 1000000n; };
  }
  if (!process.cwd) process.cwd = function() { return internalBinding('env').get('PWD') || '/'; };
  if (!process.chdir) process.chdir = function() {};
  if (!process.nextTick) process.nextTick = function(fn, ...args) { Promise.resolve().then(() => fn(...args)); };
  if (!process.on) { const _handlers = {}; process.on = function(ev, fn) { (_handlers[ev] ??= []).push(fn); return process; }; process.once = function(ev, fn) { const w = (...a) => { process.removeListener(ev, w); fn(...a); }; return process.on(ev, w); }; process.removeListener = function(ev, fn) { const h = _handlers[ev]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } return process; }; process.emit = function(ev, ...args) { for (const fn of (_handlers[ev] || [])) fn(...args); return true; }; process.listeners = function(ev) { return _handlers[ev] || []; }; process.listenerCount = function(ev) { return (_handlers[ev] || []).length; }; process.removeAllListeners = function(ev) { if (ev) delete _handlers[ev]; else for (const k of Object.keys(_handlers)) delete _handlers[k]; return process; }; process.prependListener = process.on; process.prependOnceListener = process.once; process.off = process.removeListener; }

  // --- console ---
  globalThis.console = {
    log(...args) {
      const s = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      internalBinding('_console').write(s + '\n');
    },
    error(...args) {
      const s = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      internalBinding('_console').writeError(s + '\n');
    },
    warn(...args) { console.error(...args); },
  };

  // --- require() ---
  const moduleCache = {};
  const moduleFactories = {
    os() {
      const b = internalBinding('os');
      return {
        hostname: () => b.getHostname(),
        cpus: () => ({ length: b.getAvailableParallelism() }),
        availableParallelism: () => b.getAvailableParallelism(),
        freemem: () => b.getFreeMem(),
        totalmem: () => b.getTotalMem(),
        uptime: () => b.getUptime(),
        loadavg: () => [b.getLoadAvg1(), b.getLoadAvg5(), b.getLoadAvg15()],
        release: () => b.getOsRelease(),
        pid: process.pid,
        platform: process.platform,
        type: () => 'Darwin',
        arch: process.arch || 'arm64',
        homedir: () => internalBinding('env').get('HOME') || '/',
        tmpdir: () => internalBinding('env').get('TMPDIR') || '/tmp',
      };
    },
    process() { return internalBinding('process_methods'); },
    fs() {
      const b = internalBinding('fs');
      return {
        readFileSync(path, opts) {
          const r = b.readFile(String(path));
          if (r === -1) throw new Error('ENOENT: no such file: ' + path);
          return r;
        },
        writeFileSync(path, data) {
          const r = b.writeFile(String(path), String(data));
          if (r === -1) throw new Error('EIO: write failed: ' + path);
        },
        statSync(path) {
          const s = b.stat(String(path));
          if (s === -1) throw new Error('ENOENT: no such file: ' + path);
          return { ...s, isFile: () => !!s.isFile, isDirectory: () => !!s.isDirectory };
        },
        existsSync(path) { return !!b.exists(String(path)); },
        mkdirSync(path, opts) {
          const mode = (opts && opts.mode) || 0o777;
          const r = b.mkdir(String(path), mode);
          if (r !== 0) throw new Error('EEXIST: mkdir failed: ' + path);
        },
        unlinkSync(path) { b.unlink(String(path)); },
        rmdirSync(path) { b.rmdir(String(path)); },
        renameSync(old, n) { b.rename(String(old), String(n)); },
        readdirSync(path) { return b.readdir(String(path)) || []; },
        realpathSync(path) { return b.realpath(String(path)); },
        chmodSync(path, mode) { b.chmod(String(path), mode); },
      };
    },
  };

  // Bootstrap path (needs internal/constants + internal/validators stubs available)
  const _pathSrc = __loadBuiltin('path');
  const _pathMod = { exports: {} };
  const _miniRequire = function(id) {
    if (_internalModules[id]) return _internalModules[id];
    throw new Error('path bootstrap cannot require: ' + id);
  };
  (new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', _pathSrc))(
    _pathMod.exports, _miniRequire, _pathMod, 'path', '', primordials);
  const _path = _pathMod.exports;
  moduleCache['path'] = _path;

  const _fs = moduleFactories.fs();
  const _requireStack = globalThis._requireStack = [];

  function _resolve(id, parentDir) {
    if (!id.startsWith('./') && !id.startsWith('../') && !id.startsWith('/')) return null;
    let resolved = parentDir ? _path.resolve(parentDir, id) : _path.resolve(id);
    if (_fs.existsSync(resolved) && _fs.statSync(resolved).isDirectory()) {
      resolved = _path.join(resolved, 'index.js');
    } else if (!resolved.endsWith('.js') && !resolved.endsWith('.json')) {
      if (_fs.existsSync(resolved + '.js')) resolved += '.js';
      else if (_fs.existsSync(resolved + '/index.js')) resolved += '/index.js';
    }
    return resolved;
  }

  // moduleWrappers stores {mod} objects so module.exports reassignment is visible to circular deps
  const _moduleWrappers = {};

  globalThis.require = function require(id) {
    if (_moduleWrappers[id]) return _moduleWrappers[id].exports;
    if (moduleCache[id]) return moduleCache[id];
    if (moduleFactories[id]) {
      moduleCache[id] = moduleFactories[id]();
      return moduleCache[id];
    }
    if (__internalModules[id]) {
      moduleCache[id] = __internalModules[id];
      return moduleCache[id];
    }
    // Resolve relative paths
    const parentDir = _requireStack.length > 0 ? _requireStack[_requireStack.length - 1] : '';
    const resolved = _resolve(id, parentDir);
    if (_moduleWrappers[resolved]) return _moduleWrappers[resolved].exports;
    if (resolved && moduleCache[resolved]) return moduleCache[resolved];
    // Try loading from lib/ (internal modules)
    const src = __loadBuiltin(id);
    if (src !== undefined) {
      const mod = { exports: {} };
      _moduleWrappers[id] = mod;
      const fname = _path.join(globalThis.__libDir || '', id + '.js');
      const dname = _path.dirname(fname);
      _requireStack.push(dname);
      try {
        const wrapped = new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', src);
        wrapped(mod.exports, require, mod, fname, dname, primordials);
      } finally { _requireStack.pop(); }
      moduleCache[id] = mod.exports;
      delete _moduleWrappers[id];
      return mod.exports;
    }
    // Try resolved file path
    if (resolved) {
      const fileSrc = _fs.readFileSync(resolved);
      if (fileSrc !== undefined) {
        const mod = { exports: {} };
        _moduleWrappers[resolved] = mod;
        if (id !== resolved) _moduleWrappers[id] = mod;
        const dname = _path.dirname(resolved);
        _requireStack.push(dname);
        try {
          if (resolved.endsWith('.json')) {
            mod.exports = JSON.parse(fileSrc);
          } else {
            const wrapped = new Function('exports', 'require', 'module', '__filename', '__dirname', 'primordials', fileSrc);
            wrapped(mod.exports, require, mod, resolved, dname, primordials);
          }
        } finally { _requireStack.pop(); }
        moduleCache[resolved] = mod.exports;
        if (id !== resolved) moduleCache[id] = mod.exports;
        delete _moduleWrappers[resolved];
        delete _moduleWrappers[id];
        return mod.exports;
      }
    }
    // Fall back to native bindings
    const binding = internalBinding(id);
    if (binding !== _emptyBinding) {
      moduleCache[id] = binding;
      return binding;
    }
    throw new Error('Cannot find module \'' + id + '\'');
  };
})();
