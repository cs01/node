// worker_threads — true OS threads, each with its own V8 isolate.
// Threads/mutex/queue live in the native 'worker' binding (Milo); messages are
// structured-cloned (incl. SharedArrayBuffer by reference) across the boundary.
'use strict';

const EventEmitter = require('events');
const path = require('path');
const _b = internalBinding('worker');

const _isWorker = typeof globalThis.__workerChannel === 'number';
const _chan = _isWorker ? globalThis.__workerChannel : 0;
const _threadId = _isWorker ? (globalThis.__workerThreadId | 0) : 0;

// V8's MessagePort is EventTarget-only; bridge to Node's EventEmitter API so
// `port.on('message', fn)` etc. work on standalone MessageChannel ports.
if (globalThis.MessagePort && !globalThis.MessagePort.prototype.on) {
  const _mpListeners = new WeakMap();
  const _getMap = (port) => { let m = _mpListeners.get(port); if (!m) { m = {}; _mpListeners.set(port, m); } return m; };
  const MP = globalThis.MessagePort.prototype;
  MP.on = MP.addListener = function(event, fn) {
    const map = _getMap(this);
    if (!map[event]) map[event] = [];
    const wrapper = (e) => fn(event === 'message' ? e.data : e);
    map[event].push({ fn, wrapper });
    this.addEventListener(event, wrapper);
    if (event === 'message' && typeof this.start === 'function') this.start();
    return this;
  };
  MP.once = function(event, fn) {
    const wrapper = (...a) => { this.removeListener(event, fn); fn.apply(this, a); };
    wrapper._orig = fn;
    return this.on(event, wrapper);
  };
  MP.off = MP.removeListener = function(event, fn) {
    const arr = _getMap(this)[event];
    if (!arr) return this;
    const idx = arr.findIndex(e => e.fn === fn || e.fn._orig === fn);
    if (idx >= 0) { this.removeEventListener(event, arr[idx].wrapper); arr.splice(idx, 1); }
    return this;
  };
  MP.removeAllListeners = function(event) {
    const map = _getMap(this);
    const evs = event ? [event] : Object.keys(map);
    for (const ev of evs) { for (const e of (map[ev] || [])) this.removeEventListener(ev, e.wrapper); delete map[ev]; }
    return this;
  };
  MP.emit = function(event, ...args) {
    const arr = _getMap(this)[event];
    if (!arr || !arr.length) return false;
    for (const e of arr.slice()) e.fn.apply(this, args);
    return true;
  };
  MP.listenerCount = function(event) { return (_getMap(this)[event] || []).length; };
  MP.eventNames = function() { const map = _getMap(this); return Object.keys(map).filter(k => map[k].length > 0); };
  MP.ref = function() { return this; };
  MP.unref = function() { return this; };
}

function _serializeErr(e) {
  if (e instanceof Error) return { message: e.message, stack: e.stack, name: e.name, code: e.code };
  return { message: String(e), name: 'Error' };
}
function _reviveErr(o) {
  const e = new Error(o && o.message || 'worker error');
  if (o) { if (o.name) e.name = o.name; if (o.stack) e.stack = o.stack; if (o.code) e.code = o.code; }
  return e;
}

// ===========================================================================
// Parent side — Worker handle + the pump the main event loop calls each tick.
// ===========================================================================
const _activeWorkers = new Set();
// Keep-alive accounting is per-worker ref state, not mere liveness: an unref'd
// worker still gets pumped (messages/exit flow if the loop is alive for other
// reasons) but does NOT by itself keep the main event loop running.
Object.defineProperty(globalThis, '__hasActiveWorkers', { value: () => { for (const w of _activeWorkers) if (w._refed) return true; return false; }, enumerable: false });
Object.defineProperty(globalThis, '__pumpParentWorkers', { value: () => { for (const w of [..._activeWorkers]) w._pump(); }, enumerable: false });

class Worker extends EventEmitter {
  constructor(filename, options = {}) {
    super();
    let file = filename;
    const isEval = !!options.eval;
    if (isEval) {
      if (typeof filename !== 'string') {
        const e = new TypeError('The "filename" argument must be of type string.');
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
      file = filename; // inline source, run as-is
    } else if (filename instanceof URL || (typeof filename === 'string' && filename.startsWith('file:'))) {
      file = require('url').fileURLToPath(filename);
    } else if (typeof filename === 'string') {
      file = path.resolve(file);
    } else {
      const e = new TypeError('The "filename" argument must be of type string or an instance of URL.');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this._chan = _b.create(file, isEval ? 1 : 0);
    this.threadId = _b.threadId(this._chan);
    _b.setData(this._chan, options.workerData);
    this._exited = false;
    this._refed = true;
    _activeWorkers.add(this);
    _b.start(this._chan);
    process.nextTick(() => this.emit('online'));
  }
  postMessage(value) { _b.postToWorker(this._chan, { t: 'message', v: value }); }
  _pump() {
    for (;;) {
      const env = _b.pollFromWorker(this._chan);
      if (env === undefined) break;
      if (env && env.t === 'error') this.emit('error', _reviveErr(env.e));
      else if (env && env.t === 'message') this.emit('message', env.v);
    }
    if (!this._exited && _b.isDone(this._chan)) {
      this._exited = true;
      _activeWorkers.delete(this);
      _b.join(this._chan);
      this.emit('exit', _b.exitCode(this._chan));
    }
  }
  terminate() {
    _b.requestTerminate(this._chan);
    // Modern Node resolves terminate() with no value (the legacy exitCode arg was removed).
    return Promise.resolve();
  }
  ref() { this._refed = true; return this; }
  unref() { this._refed = false; return this; }
  get stdout() { return null; }
  get stderr() { return null; }
}

// ===========================================================================
// Worker side — parentPort + the pump the worker's thread entry calls.
// ===========================================================================
let parentPort = null;
let workerData = null;

if (_isWorker) {
  workerData = _b.getData(_chan);
  let _exitCode = 0;
  let _exited = false;

  parentPort = new EventEmitter();
  parentPort.postMessage = (value) => { _b.postToParent(_chan, { t: 'message', v: value }); };
  parentPort.close = () => { _exited = true; };
  parentPort.start = () => {};
  parentPort.ref = () => parentPort;
  parentPort.unref = () => parentPort;
  // EventTarget-style onmessage: handler receives a MessageEvent-like { data }.
  // Coexists with the EventEmitter .on('message') API (which gets the raw value).
  let _onmessage = null;
  const _onmessageWrap = (v) => { if (_onmessage) _onmessage({ data: v }); };
  Object.defineProperty(parentPort, 'onmessage', {
    configurable: true,
    get() { return _onmessage; },
    set(fn) {
      if (_onmessage) parentPort.removeListener('message', _onmessageWrap);
      _onmessage = fn;
      if (fn) parentPort.on('message', _onmessageWrap);
    },
  });

  // Worker-side uncaught-exception -> parent. This is a FALLBACK (invoked by
  // _fatalException only when no user 'uncaughtException' handler handled the
  // throw), NOT a standing listener. Matching Node: a worker whose own handler
  // calls process.exit() exits cleanly with that code and does NOT propagate an
  // 'error' to the parent. Registering this as a plain listener instead made the
  // worker ALWAYS post an error and race the user's exit handler.
  globalThis.__workerUncaughtFallback = (e) => {
    try { _b.postToParent(_chan, { t: 'error', e: _serializeErr(e) }); } catch {}
    _exitCode = 1; _exited = true; _b.markDone(_chan, _exitCode);
  };
  process.exit = (code) => { _exitCode = (code | 0); _exited = true; _b.markDone(_chan, _exitCode); };

  // called by the native worker entry each loop iteration; returns "stay alive"
  Object.defineProperty(globalThis, '__workerPump', { value: function __workerPump() {
    // A worker can itself own child workers. Drain their queues here exactly as
    // the main loop does — without this a nested worker's messages/errors/exit
    // are never delivered. A child 'error' handler may re-throw; that must surface
    // as THIS worker's uncaughtException (which already posts to our parent), so
    // the whole tick runs under one guard.
    try {
      for (;;) {
        const env = _b.pollToWorker(_chan);
        if (env === undefined) break;
        if (env && env.t === 'message') parentPort.emit('message', env.v);
      }
      if (globalThis.__pumpParentWorkers) globalThis.__pumpParentWorkers();
    } catch (e) {
      // A child worker's unhandled 'error' (EventEmitter throws) lands here.
      // Route through _fatalException — NOT a bare emit — so it honors a user
      // 'uncaughtException' handler if present, and otherwise hits the worker
      // fallback that posts {t:'error'} to OUR parent. A bare emit would be a
      // no-op when no user listener exists, silently dropping the nested error.
      if (process._fatalException) process._fatalException(e);
    }
    const childWorkersAlive = globalThis.__hasActiveWorkers ? globalThis.__hasActiveWorkers() : false;
    const timersPending = globalThis.__workerTick ? globalThis.__workerTick() : false;
    if (_exited || _b.shouldTerminate(_chan)) { _b.markDone(_chan, _exitCode); return false; }
    const hasListeners = parentPort.listenerCount('message') > 0;
    return timersPending || hasListeners || childWorkersAlive;
  }, enumerable: false });
}

module.exports = {
  isMainThread: !_isWorker,
  parentPort,
  workerData,
  threadId: _threadId,
  Worker,
  MessageChannel: globalThis.MessageChannel,
  MessagePort: globalThis.MessagePort,
  BroadcastChannel: globalThis.BroadcastChannel,
  receiveMessageOnPort: function() { return undefined; },
  markAsUntransferable: function() {},
  isMarkedAsUntransferable: function() { return false; },
  moveMessagePortToContext: function() { throw new Error('Not implemented'); },
  SHARE_ENV: Symbol.for('nodejs.worker_threads.SHARE_ENV'),
  resourceLimits: {},
  setEnvironmentData: function() {},
  getEnvironmentData: function() { return undefined; },
};
