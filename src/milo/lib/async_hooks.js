// async_hooks module — stub
'use strict';

class AsyncResource {
  constructor(type, opts) {
    this.type = type;
    this.asyncId = AsyncResource._nextId++;
    this.triggerAsyncId = (opts && opts.triggerAsyncId) || 0;
  }
  runInAsyncScope(fn, thisArg, ...args) { return fn.apply(thisArg, args); }
  emitDestroy() { return this; }
  asyncId() { return this.asyncId; }
  triggerAsyncId() { return this.triggerAsyncId; }
  bind(fn) { return fn; }
  static bind(fn) { return fn; }
}
AsyncResource._nextId = 1;

class AsyncLocalStorage {
  constructor() { this._store = undefined; }
  getStore() { return this._store; }
  run(store, fn, ...args) { const prev = this._store; this._store = store; try { return fn(...args); } finally { this._store = prev; } }
  exit(fn, ...args) { const prev = this._store; this._store = undefined; try { return fn(...args); } finally { this._store = prev; } }
  enterWith(store) { this._store = store; }
  disable() { this._store = undefined; }
}

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
