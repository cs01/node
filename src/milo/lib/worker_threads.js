// worker_threads module — MessageChannel/MessagePort with EventEmitter shim
'use strict';

// Node's MessagePort supports both EventTarget and EventEmitter APIs.
// V8's MessagePort is EventTarget-only — bridge to EventEmitter interface.
if (globalThis.MessagePort && !globalThis.MessagePort.prototype.on) {
  const _listeners = new WeakMap();
  function _getMap(port) { let m = _listeners.get(port); if (!m) { m = {}; _listeners.set(port, m); } return m; }

  globalThis.MessagePort.prototype.on = function(event, fn) {
    const map = _getMap(this);
    if (!map[event]) map[event] = [];
    const wrapper = (e) => fn(event === 'message' ? e.data : e);
    map[event].push({ fn, wrapper });
    this.addEventListener(event, wrapper);
    if (event === 'message' && typeof this.start === 'function') this.start();
    return this;
  };
  globalThis.MessagePort.prototype.addListener = globalThis.MessagePort.prototype.on;

  globalThis.MessagePort.prototype.once = function(event, fn) {
    const wrapper = (...args) => { this.removeListener(event, fn); fn.apply(this, args); };
    wrapper._orig = fn;
    return this.on(event, wrapper);
  };

  globalThis.MessagePort.prototype.off =
  globalThis.MessagePort.prototype.removeListener = function(event, fn) {
    const map = _getMap(this);
    const arr = map[event];
    if (!arr) return this;
    const idx = arr.findIndex(e => e.fn === fn || e.fn._orig === fn);
    if (idx >= 0) { this.removeEventListener(event, arr[idx].wrapper); arr.splice(idx, 1); }
    return this;
  };

  globalThis.MessagePort.prototype.removeAllListeners = function(event) {
    const map = _getMap(this);
    if (event) {
      const arr = map[event] || [];
      for (const e of arr) this.removeEventListener(event, e.wrapper);
      delete map[event];
    }
    return this;
  };

  globalThis.MessagePort.prototype.emit = function(event, ...args) {
    const map = _getMap(this);
    const arr = map[event];
    if (!arr || arr.length === 0) return false;
    for (const e of arr.slice()) e.fn.apply(this, args);
    return true;
  };

  globalThis.MessagePort.prototype.listenerCount = function(event) {
    const map = _getMap(this);
    return (map[event] || []).length;
  };

  globalThis.MessagePort.prototype.eventNames = function() {
    const map = _getMap(this);
    return Object.keys(map).filter(k => map[k].length > 0);
  };

  globalThis.MessagePort.prototype.ref = function() { return this; };
  globalThis.MessagePort.prototype.unref = function() { return this; };
}

module.exports = {
  isMainThread: true,
  parentPort: null,
  workerData: null,
  threadId: 0,
  Worker: class Worker { constructor() { throw new Error('worker_threads not implemented'); } },
  MessageChannel: globalThis.MessageChannel,
  MessagePort: globalThis.MessagePort,
  BroadcastChannel: globalThis.BroadcastChannel,
  receiveMessageOnPort: function(port) { return undefined; },
  markAsUntransferable: function() {},
  moveMessagePortToContext: function() { throw new Error('Not implemented'); },
  SHARE_ENV: Symbol('nodejs.worker_threads.SHARE_ENV'),
  resourceLimits: {},
  setEnvironmentData: function() {},
  getEnvironmentData: function() { return undefined; },
};
