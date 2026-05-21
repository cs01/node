// events module — EventEmitter
'use strict';

class EventEmitter {
  constructor() { this._events = Object.create(null); this._maxListeners = 10; }

  setMaxListeners(n) { this._maxListeners = n; return this; }
  getMaxListeners() { return this._maxListeners; }

  emit(type, ...args) {
    const handlers = this._events[type];
    if (!handlers || handlers.length === 0) {
      if (type === 'error') {
        const err = args[0];
        if (err instanceof Error) throw err;
        const e = new Error('Unhandled error.' + (err ? ' (' + err + ')' : ''));
        e.context = err;
        throw e;
      }
      return false;
    }
    for (const h of [...handlers]) h.apply(this, args);
    return true;
  }

  on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    (this._events[type] ??= []).push(fn);
    if (type !== 'newListener') this.emit('newListener', type, fn);
    return this;
  }


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
EventEmitter.prototype.addListener = EventEmitter.prototype.on;
EventEmitter.listenerCount = function(emitter, type) { return emitter.listenerCount(type); };
EventEmitter.getEventListeners = function(emitter, type) { return emitter.listeners(type); };
EventEmitter.getMaxListeners = function(emitter) { return emitter.getMaxListeners(); };
EventEmitter.setMaxListeners = function(n, ...emitters) {
  if (emitters.length === 0) { EventEmitter.defaultMaxListeners = n; return; }
  for (const e of emitters) e.setMaxListeners(n);
};

function once(emitter, type) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { emitter.removeListener(type, onRes); reject(e); };
    const onRes = (...args) => { emitter.removeListener('error', onErr); resolve(args); };
    emitter.once(type, onRes);
    if (type !== 'error') emitter.once('error', onErr);
  });
}

EventEmitter.once = once;
EventEmitter.captureRejections = false;
EventEmitter.captureRejectionSymbol = Symbol.for('nodejs.rejection');
EventEmitter.errorMonitor = Symbol('events.errorMonitor');

EventEmitter.on = function on(emitter, event, options) {
  const unconsumedEvents = [];
  const unconsumedPromises = [];
  let error = null;
  let finished = false;

  const eventHandler = (...args) => {
    const value = args.length === 1 ? args[0] : args;
    if (unconsumedPromises.length > 0) {
      unconsumedPromises.shift().resolve({ value, done: false });
    } else {
      unconsumedEvents.push(value);
    }
  };

  const errorHandler = (err) => {
    error = err;
    if (unconsumedPromises.length > 0) {
      unconsumedPromises.shift().reject(err);
    }
  };

  emitter.on(event, eventHandler);
  if (event !== 'error') emitter.on('error', errorHandler);

  const iterator = {
    next() {
      if (unconsumedEvents.length > 0) {
        return Promise.resolve({ value: unconsumedEvents.shift(), done: false });
      }
      if (error) { const err = error; error = null; return Promise.reject(err); }
      if (finished) return Promise.resolve({ done: true });
      return new Promise((resolve, reject) => { unconsumedPromises.push({ resolve, reject }); });
    },
    return() {
      finished = true;
      emitter.removeListener(event, eventHandler);
      emitter.removeListener('error', errorHandler);
      for (const p of unconsumedPromises) p.resolve({ done: true });
      return Promise.resolve({ done: true });
    },
    throw(err) { error = err; return this.return(); },
    [Symbol.asyncIterator]() { return this; },
  };

  if (options?.signal) {
    options.signal.addEventListener('abort', () => { iterator.return(); });
  }

  return iterator;
};

EventEmitter.addAbortListener = function(signal, listener) {
  signal.addEventListener('abort', listener);
  return { [Symbol.dispose]() { signal.removeEventListener('abort', listener); } };
};

module.exports = EventEmitter;
