// async_hooks module — AsyncLocalStorage with real async propagation
'use strict';

// Global registry of all active AsyncLocalStorage instances and their current stores
const _stores = new Map();

class AsyncLocalStorage {
  constructor(opts) {
    if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
      const e = new TypeError('The "options" argument must be of type object'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this._id = AsyncLocalStorage._nextId++;
    if (opts && 'defaultValue' in opts) {
      this._defaultValue = opts.defaultValue;
      this._hasDefault = true;
    }
    if (opts && opts.name !== undefined) this.name = opts.name;
  }
  getStore() { return _stores.has(this._id) ? _stores.get(this._id) : (this._hasDefault ? this._defaultValue : undefined); }
  run(store, fn, ...args) {
    const prev = _stores.get(this._id);
    _stores.set(this._id, store);
    try { return fn(...args); }
    finally {
      if (prev === undefined) _stores.delete(this._id);
      else _stores.set(this._id, prev);
    }
  }
  exit(fn, ...args) {
    const prev = _stores.get(this._id);
    _stores.delete(this._id);
    try { return fn(...args); }
    finally {
      if (prev === undefined) _stores.delete(this._id);
      else _stores.set(this._id, prev);
    }
  }
  enterWith(store) { _stores.set(this._id, store); }
  disable() { _stores.delete(this._id); }
  static snapshot() {
    const snapshot = new Map(_stores);
    return (fn, ...args) => {
      const prev = new Map(_stores);
      for (const [k, v] of snapshot) _stores.set(k, v);
      for (const k of _stores.keys()) { if (!snapshot.has(k)) _stores.delete(k); }
      try { return fn(...args); }
      finally {
        _stores.clear();
        for (const [k, v] of prev) _stores.set(k, v);
      }
    };
  }
}
AsyncLocalStorage._nextId = 1;

// Capture current async context as a snapshot
function _captureContext() {
  return new Map(_stores);
}

// Restore a captured context, run fn, then put back previous
function _runInContext(snapshot, fn, args) {
  const prev = new Map(_stores);
  _stores.clear();
  for (const [k, v] of snapshot) _stores.set(k, v);
  try { return fn.apply(undefined, args); }
  finally {
    _stores.clear();
    for (const [k, v] of prev) _stores.set(k, v);
  }
}

// Wrap a callback to carry its creation-time async context
function _wrapCallback(fn) {
  if (typeof fn !== 'function') return fn;
  const snapshot = _captureContext();
  return function(...args) { return _runInContext(snapshot, fn, args); };
}

// Patch setTimeout/setInterval/process.nextTick to propagate context
const _origSetTimeout = globalThis.setTimeout;
const _origSetInterval = globalThis.setInterval;

globalThis.setTimeout = function setTimeout(fn, delay, ...args) {
  return _origSetTimeout.call(globalThis, _wrapCallback(fn), delay, ...args);
};
globalThis.setTimeout.__proto__ = _origSetTimeout;

globalThis.setInterval = function setInterval(fn, delay, ...args) {
  return _origSetInterval.call(globalThis, _wrapCallback(fn), delay, ...args);
};
globalThis.setInterval.__proto__ = _origSetInterval;

if (typeof process !== 'undefined' && process.nextTick) {
  const _origNextTick = process.nextTick;
  process.nextTick = function(fn, ...args) {
    return _origNextTick.call(process, _wrapCallback(fn), ...args);
  };
}

// Patch Promise.prototype.then/catch/finally to propagate context
const _origThen = Promise.prototype.then;
Promise.prototype.then = function(onFulfilled, onRejected) {
  return _origThen.call(this,
    onFulfilled ? _wrapCallback(onFulfilled) : onFulfilled,
    onRejected ? _wrapCallback(onRejected) : onRejected
  );
};

class AsyncResource {
  constructor(type, opts) {
    if (typeof type !== 'string') { const e = new TypeError('The "type" argument must be of type string. Received ' + (type === undefined ? 'undefined' : typeof type)); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (type === '') { const e = new TypeError(`Invalid name for async "type": ${type}`); e.code = 'ERR_ASYNC_TYPE'; throw e; }
    // opts may be a number (triggerAsyncId) or { triggerAsyncId, requireManualDestroy }
    let triggerAsyncId = typeof opts === 'number' ? opts : (opts && opts.triggerAsyncId !== undefined ? opts.triggerAsyncId : executionAsyncId());
    if (typeof triggerAsyncId !== 'number' || !Number.isInteger(triggerAsyncId) || triggerAsyncId < -1) {
      const e = new RangeError(`Invalid triggerAsyncId value: ${triggerAsyncId}`); e.code = 'ERR_INVALID_ASYNC_ID'; throw e;
    }
    this.type = type;
    this._asyncId = AsyncResource._nextId++;
    this._triggerAsyncId = triggerAsyncId;
    this._snapshot = _captureContext();
  }
  runInAsyncScope(fn, thisArg, ...args) {
    const prev = new Map(_stores);
    _stores.clear();
    for (const [k, v] of this._snapshot) _stores.set(k, v);
    try { return fn.apply(thisArg, args); }
    finally {
      _stores.clear();
      for (const [k, v] of prev) _stores.set(k, v);
    }
  }
  emitDestroy() { return this; }
  asyncId() { return this._asyncId; }
  triggerAsyncId() { return this._triggerAsyncId; }
  bind(fn) {
    const resource = this;
    return function(...args) { return resource.runInAsyncScope(fn, this, ...args); };
  }
  static bind(fn) {
    const resource = new AsyncResource('bound');
    return resource.bind(fn);
  }
}
AsyncResource._nextId = 1;

function createHook(callbacks) {
  return { enable() { return this; }, disable() { return this; } };
}

function executionAsyncId() { return 1; }
function triggerAsyncId() { return 0; }
function executionAsyncResource() { return {}; }

module.exports = {
  AsyncResource, AsyncLocalStorage, createHook,
  executionAsyncId, triggerAsyncId, executionAsyncResource,
};
