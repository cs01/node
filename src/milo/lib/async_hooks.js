// async_hooks module — AsyncLocalStorage with real async propagation
'use strict';

// The async-context "frame" is a Map of ALS-id -> store, stored in V8's
// continuation-preserved embedder data so it propagates across await/promise
// continuations automatically. Timers/immediates/nextTick are NOT continuations,
// so those are still wrapped explicitly below.
const _acs = internalBinding('util');
function _getFrame() { return _acs.asyncContextGet(); }
function _setFrame(f) { _acs.asyncContextSet(f); }
function _withStore(id, store) { const f = new Map(_getFrame() || undefined); f.set(id, store); return f; }
function _withoutStore(id) { const p = _getFrame(); if (!p || !p.has(id)) return p; const f = new Map(p); f.delete(id); return f; }

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
  getStore() {
    const f = _getFrame();
    if (f && f.has(this._id)) return f.get(this._id);
    return this._hasDefault ? this._defaultValue : undefined;
  }
  run(store, fn, ...args) {
    const prev = _getFrame();
    _setFrame(_withStore(this._id, store));
    try { return fn(...args); } finally { _setFrame(prev); }
  }
  exit(fn, ...args) {
    const prev = _getFrame();
    _setFrame(_withoutStore(this._id));
    try { return fn(...args); } finally { _setFrame(prev); }
  }
  enterWith(store) { _setFrame(_withStore(this._id, store)); }
  disable() { _setFrame(_withoutStore(this._id)); }
  static snapshot() {
    const snapshot = _getFrame();
    return (fn, ...args) => {
      const prev = _getFrame();
      _setFrame(snapshot);
      try { return fn(...args); } finally { _setFrame(prev); }
    };
  }
}
AsyncLocalStorage._nextId = 1;

// Capture/restore the current async-context frame (used to carry context onto
// scheduled callbacks that V8 doesn't treat as continuations).
function _captureContext() { return _getFrame(); }
function _runInContext(frame, fn, args) {
  const prev = _getFrame();
  _setFrame(frame);
  try { return fn.apply(undefined, args); }
  finally { _setFrame(prev); }
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

// setImmediate is a scheduled callback (not a promise continuation), so wrap it.
// Promise .then/await are continuations — V8 propagates the frame automatically,
// so they are NOT patched here.
if (typeof globalThis.setImmediate === 'function') {
  const _origSetImmediate = globalThis.setImmediate;
  globalThis.setImmediate = function setImmediate(fn, ...args) {
    return _origSetImmediate.call(globalThis, _wrapCallback(fn), ...args);
  };
  globalThis.setImmediate.__proto__ = _origSetImmediate;
}

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
    const prev = _getFrame();
    _setFrame(this._snapshot);
    try { return fn.apply(thisArg, args); }
    finally { _setFrame(prev); }
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
