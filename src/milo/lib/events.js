// events module — EventEmitter
'use strict';

class EventEmitter {
  constructor() { this._events = Object.create(null); this._maxListeners = 10; }

  setMaxListeners(n) { this._maxListeners = n; return this; }
  getMaxListeners() { return this._maxListeners; }

  emit(type, ...args) {
    const handlers = this._events[type];
    if (!handlers) return type === 'error' ? (() => { throw args[0] || new Error('Unhandled error'); })() : false;
    for (const h of [...handlers]) h.apply(this, args);
    return true;
  }

  on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    (this._events[type] ??= []).push(fn);
    if (type !== 'newListener') this.emit('newListener', type, fn);
    return this;
  }

  addListener(type, fn) { return this.on(type, fn); }

  prependListener(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    (this._events[type] ??= []).unshift(fn);
    return this;
  }

  once(type, fn) {
    const wrapped = (...args) => { this.removeListener(type, wrapped); fn.apply(this, args); };
    wrapped.listener = fn;
    return this.on(type, wrapped);
  }

  prependOnceListener(type, fn) {
    const wrapped = (...args) => { this.removeListener(type, wrapped); fn.apply(this, args); };
    wrapped.listener = fn;
    return this.prependListener(type, wrapped);
  }

  removeListener(type, fn) {
    const list = this._events[type];
    if (!list) return this;
    const idx = list.findIndex(h => h === fn || h.listener === fn);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) delete this._events[type];
    return this;
  }

  off(type, fn) { return this.removeListener(type, fn); }

  removeAllListeners(type) {
    if (type !== undefined) delete this._events[type];
    else this._events = Object.create(null);
    return this;
  }

  listeners(type) { return (this._events[type] || []).map(h => h.listener || h); }
  rawListeners(type) { return [...(this._events[type] || [])]; }
  listenerCount(type) { return (this._events[type] || []).length; }
  eventNames() { return Object.keys(this._events); }
}

EventEmitter.defaultMaxListeners = 10;
EventEmitter.EventEmitter = EventEmitter;

function once(emitter, type) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { emitter.removeListener(type, onRes); reject(e); };
    const onRes = (...args) => { emitter.removeListener('error', onErr); resolve(args); };
    emitter.once(type, onRes);
    if (type !== 'error') emitter.once('error', onErr);
  });
}

EventEmitter.once = once;
module.exports = EventEmitter;
