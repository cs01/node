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
Object.defineProperty(globalThis, '__hasActiveWorkers', { value: () => _activeWorkers.size > 0, enumerable: false });
Object.defineProperty(globalThis, '__pumpParentWorkers', { value: () => { for (const w of [..._activeWorkers]) w._pump(); }, enumerable: false });

class Worker extends EventEmitter {
  constructor(filename, options = {}) {
    super();
    let file = filename;
    if (filename instanceof URL || (typeof filename === 'string' && filename.startsWith('file:'))) {
      file = require('url').fileURLToPath(filename);
    } else if (typeof filename === 'string') {
      file = path.resolve(file);
    } else {
      const e = new TypeError('The "filename" argument must be of type string or an instance of URL.');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this._chan = _b.create(file);
    this.threadId = _b.threadId(this._chan);
    _b.setData(this._chan, options.workerData);
    this._exited = false;
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
    return Promise.resolve(_b.exitCode(this._chan));
  }
  ref() { return this; }
  unref() { return this; }
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

  process.on('uncaughtException', (e) => {
    try { _b.postToParent(_chan, { t: 'error', e: _serializeErr(e) }); } catch {}
    _exitCode = 1; _exited = true;
  });
  process.exit = (code) => { _exitCode = (code | 0); _exited = true; _b.markDone(_chan, _exitCode); };

  // called by the native worker entry each loop iteration; returns "stay alive"
  Object.defineProperty(globalThis, '__workerPump', { value: function __workerPump() {
    for (;;) {
      const env = _b.pollToWorker(_chan);
      if (env === undefined) break;
      if (env && env.t === 'message') parentPort.emit('message', env.v);
    }
    const timersPending = globalThis.__workerTick ? globalThis.__workerTick() : false;
    if (_exited || _b.shouldTerminate(_chan)) { _b.markDone(_chan, _exitCode); return false; }
    const hasListeners = parentPort.listenerCount('message') > 0;
    return timersPending || hasListeners;
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
