// events module — EventEmitter (function-based for util.inherits/.call() compat)
'use strict';

function _invalidArgTypeHelper(value) {
  if (value == null) return ' Received ' + value;
  if (typeof value === 'function') return ' Received function ' + (value.name || '');
  if (typeof value === 'object') return ' Received an instance of ' + (value.constructor && value.constructor.name || 'Object');
  if (typeof value === 'string') return " Received type string ('" + value + "')";
  return ' Received type ' + typeof value + ' (' + String(value) + ')';
}

function _ERR_INVALID_ARG_TYPE(name, expected, actual) {
  let received;
  if (actual === null) received = 'null';
  else if (actual === undefined) received = 'undefined';
  else if (typeof actual === 'function') received = 'function ' + (actual.name || '');
  else if (typeof actual === 'object') received = 'an instance of ' + (actual.constructor && actual.constructor.name || 'Object');
  else received = 'type ' + typeof actual + ' (' + String(actual) + ')';
  const e = new TypeError('The "' + name + '" argument must be of type ' + expected + '. Received ' + received);
  e.code = 'ERR_INVALID_ARG_TYPE';
  return e;
}

function EventEmitter(opts) {
  if (!(this instanceof EventEmitter)) return new EventEmitter(opts);
  this._events = Object.create(null);
  this._maxListeners = undefined;
  if (opts && opts.captureRejections !== undefined) {
    if (typeof opts.captureRejections !== 'boolean') {
      const e = new TypeError('The "options.captureRejections" property must be of type boolean.' + _invalidArgTypeHelper(opts.captureRejections));
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    this._captureRejections = opts.captureRejections;
  }
}

EventEmitter.prototype.setMaxListeners = function(n) {
  if (typeof n !== 'number') {
    const e = new TypeError('The "n" argument must be of type number. Received type ' + typeof n + ' (' + String(n) + ')');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (n < 0 || Number.isNaN(n)) {
    const e = new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  this._maxListeners = n; return this;
};
EventEmitter.prototype.getMaxListeners = function() { return this._maxListeners !== undefined ? this._maxListeners : EventEmitter.defaultMaxListeners; };

EventEmitter.prototype.emit = function(type) {
  if (!this._events) this._events = Object.create(null);
  if (type === 'error') {
    const monitorEvt = this._events[EventEmitter.errorMonitor];
    if (monitorEvt) {
      const args = new Array(arguments.length - 1);
      for (let j = 1; j < arguments.length; j++) args[j - 1] = arguments[j];
      if (typeof monitorEvt === 'function') monitorEvt.apply(this, args);
      else { const fns = monitorEvt.slice(); for (let j = 0; j < fns.length; j++) fns[j].apply(this, args); }
    }
  }
  const handlers = this._events[type];
  if (!handlers) {
    if (type === 'error') {
      const err = arguments[1];
      if (this.domain) {
        let er;
        if (!err) {
          er = new Error('Unhandled error.' + (err !== undefined ? ` (${err})` : ''));
          er.domainEmitter = this;
          er.domainThrown = false;
          er.domain = this.domain;
          er.context = err;
        } else {
          er = err;
          if (typeof er === 'object') {
            er.domainEmitter = this;
            er.domainThrown = false;
            er.domain = this.domain;
          }
        }
        this.domain.emit('error', er);
        return false;
      }
      if (err instanceof Error) throw err;
      let detail;
      if (err !== undefined) {
        let rep;
        try { const { inspect } = require('util'); rep = inspect(err); } catch { rep = String(err); }
        detail = typeof err === 'string' ? ` ('${err}')` : ` (${rep})`;
      } else {
        detail = '';
      }
      const e = new Error('Unhandled error.' + detail);
      e.code = 'ERR_UNHANDLED_ERROR';
      e.context = err;
      throw e;
    }
    return false;
  }
  const args = new Array(arguments.length - 1);
  for (let i = 1; i < arguments.length; i++) args[i - 1] = arguments[i];
  const capture = this._captureRejections;
  if (typeof handlers === 'function') {
    const r = handlers.apply(this, args);
    if (capture && r && typeof r.then === 'function') _addCatch(this, r, type, args);
  } else {
    const copy = handlers.slice();
    for (let i = 0; i < copy.length; i++) {
      const r = copy[i].apply(this, args);
      if (capture && r && typeof r.then === 'function') _addCatch(this, r, type, args);
    }
  }
  return true;
};

// captureRejections: a listener returning a rejecting promise routes the error to
// the emitter's rejection handler, or 'error' (with capture disabled to avoid loops).
function _addCatch(ee, promise, type, args) {
  promise.then(undefined, function(err) {
    process.nextTick(function() {
      const sym = EventEmitter.captureRejectionSymbol;
      if (typeof ee[sym] === 'function') {
        ee[sym](err, type, ...args);
      } else {
        const prev = ee._captureRejections;
        try { ee._captureRejections = false; ee.emit('error', err); }
        finally { ee._captureRejections = prev; }
      }
    });
  });
}

EventEmitter.prototype.on = function(type, fn) {
  if (typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('listener', 'function', fn);
  if (!this._events) this._events = Object.create(null);
  if (type !== 'newListener' && typeof this.emit === 'function') this.emit('newListener', type, fn.listener || fn);
  const existing = this._events[type];
  if (!existing) this._events[type] = fn;
  else if (typeof existing === 'function') this._events[type] = [existing, fn];
  else existing.push(fn);
  const len = typeof this._events[type] === 'function' ? 1 : this._events[type].length;
  const max = this._maxListeners !== undefined ? this._maxListeners : EventEmitter.defaultMaxListeners;
  if (max > 0 && len > max && !this._events[type].warned) {
    if (typeof this._events[type] !== 'function') this._events[type].warned = true;
    const w = new Error(`Possible EventEmitter memory leak detected. ${len} ${String(type)} listeners added to [${this.constructor.name}]. MaxListeners is ${max}. Use emitter.setMaxListeners() to increase limit`);
    w.name = 'MaxListenersExceededWarning'; w.emitter = this; w.type = type; w.count = len;
    if (typeof process !== 'undefined' && process.emitWarning) process.emitWarning(w);
  }
  return this;
};

EventEmitter.prototype.addListener = EventEmitter.prototype.on;

EventEmitter.prototype.prependListener = function(type, fn) {
  if (typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('listener', 'function', fn);
  if (!this._events) this._events = Object.create(null);
  if (type !== 'newListener' && typeof this.emit === 'function') this.emit('newListener', type, fn.listener || fn);
  const existing = this._events[type];
  if (!existing) this._events[type] = fn;
  else if (typeof existing === 'function') this._events[type] = [fn, existing];
  else existing.unshift(fn);
  return this;
};

EventEmitter.prototype.once = function(type, fn) {
  if (typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('listener', 'function', fn);
  const self = this;
  let fired = false;
  function wrapped() { if (fired) return; fired = true; self.removeListener(type, wrapped); return fn.apply(self, arguments); }
  wrapped.listener = fn;
  return this.on(type, wrapped);
};

EventEmitter.prototype.prependOnceListener = function(type, fn) {
  if (typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('listener', 'function', fn);
  const self = this;
  let fired = false;
  function wrapped() { if (fired) return; fired = true; self.removeListener(type, wrapped); return fn.apply(self, arguments); }
  wrapped.listener = fn;
  return this.prependListener(type, wrapped);
};

EventEmitter.prototype.removeListener = function(type, fn) {
  if (typeof fn !== 'function') throw _ERR_INVALID_ARG_TYPE('listener', 'function', fn);
  if (!this._events) this._events = Object.create(null);
  const list = this._events[type];
  if (!list) return this;
  if (typeof list === 'function') {
    if (list === fn || list.listener === fn) {
      const original = list.listener || list;
      delete this._events[type];
      if (this._events.removeListener) this.emit('removeListener', type, original);
    }
    return this;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === fn || list[i].listener === fn) {
      const original = list[i].listener || list[i];
      if (list.length === 1) delete this._events[type];
      else { list.splice(i, 1); if (list.length === 1) this._events[type] = list[0]; }
      if (this._events.removeListener) this.emit('removeListener', type, original);
      return this;
    }
  }
  return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function(type) {
  if (!this._events) this._events = Object.create(null);
  // No 'removeListener' subscribers → fast delete, no events emitted.
  if (!this._events.removeListener) {
    if (type !== undefined) delete this._events[type];
    else this._events = Object.create(null);
    return this;
  }
  // Emit 'removeListener' for each removed listener (LIFO), via removeListener().
  if (type === undefined) {
    for (const key of Reflect.ownKeys(this._events)) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = Object.create(null);
    return this;
  }
  const list = this._events[type];
  if (typeof list === 'function') this.removeListener(type, list.listener || list);
  else if (Array.isArray(list)) {
    for (let i = list.length - 1; i >= 0; i--) this.removeListener(type, (list[i] && list[i].listener) || list[i]);
  }
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) return [];
  const evt = this._events[type];
  if (!evt) return [];
  if (typeof evt === 'function') return [evt.listener || evt];
  return evt.map(function(h) { return h.listener || h; });
};

EventEmitter.prototype.rawListeners = function(type) {
  if (!this._events) return [];
  const evt = this._events[type];
  if (!evt) return [];
  if (typeof evt === 'function') return [evt];
  return evt.slice();
};

EventEmitter.prototype.listenerCount = function(type, listener) {
  if (!this._events) return 0;
  const evt = this._events[type];
  if (!evt) return 0;
  if (typeof evt === 'function') {
    if (listener === undefined) return 1;
    return (evt === listener || evt.listener === listener) ? 1 : 0;
  }
  if (listener === undefined) return evt.length;
  return evt.filter(function(h) { return h === listener || h.listener === listener; }).length;
};

EventEmitter.prototype.eventNames = function() {
  if (!this._events) return [];
  return Object.keys(this._events).concat(Object.getOwnPropertySymbols(this._events));
};

let _defaultMaxListeners = 10;
Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  get() { return _defaultMaxListeners; },
  set(n) {
    if (typeof n !== 'number') {
      const e = new TypeError('The "defaultMaxListeners" argument must be of type number. Received type ' + typeof n + ' (' + String(n) + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (n < 0 || Number.isNaN(n)) {
      const e = new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + n);
      e.code = 'ERR_OUT_OF_RANGE'; throw e;
    }
    _defaultMaxListeners = n;
  },
  enumerable: true, configurable: true
});
EventEmitter.EventEmitter = EventEmitter;
EventEmitter.listenerCount = function(emitter, type) { return emitter.listenerCount(type); };
EventEmitter.getEventListeners = function(emitterOrTarget, type) {
  // EventTarget keeps its own store; EventEmitter exposes .listeners().
  if (typeof emitterOrTarget.listeners === 'function') return emitterOrTarget.listeners(type);
  if (typeof emitterOrTarget._eventListeners === 'function') return emitterOrTarget._eventListeners(type);
  return [];
};
// Polyfill getMaxListeners/setMaxListeners on EventTarget so static API works
if (typeof EventTarget !== 'undefined' && !EventTarget.prototype.getMaxListeners) {
  EventTarget.prototype.getMaxListeners = function() {
    return this._maxListeners !== undefined ? this._maxListeners : EventEmitter.defaultMaxListeners;
  };
  EventTarget.prototype.setMaxListeners = function(n) { this._maxListeners = n; return this; };
}
// AbortSignal defaults to 0 (unlimited) in Node.js
if (typeof AbortSignal !== 'undefined' && !AbortSignal.prototype.hasOwnProperty('_maxListeners')) {
  Object.defineProperty(AbortSignal.prototype, '_maxListeners', { value: 0, writable: true, configurable: true });
}

EventEmitter.getMaxListeners = function(emitter) {
  if (typeof emitter.getMaxListeners === 'function') return emitter.getMaxListeners();
  return emitter._maxListeners !== undefined ? emitter._maxListeners : EventEmitter.defaultMaxListeners;
};
EventEmitter.setMaxListeners = function(n) {
  if (typeof n !== 'number') {
    const e = new TypeError('The "n" argument must be of type number. Received type ' + typeof n + ' (' + String(n) + ')');
    e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
  }
  if (n < 0 || Number.isNaN(n)) {
    const e = new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n);
    e.code = 'ERR_OUT_OF_RANGE'; throw e;
  }
  if (arguments.length <= 1) { EventEmitter.defaultMaxListeners = n; return; }
  for (let i = 1; i < arguments.length; i++) {
    const emitter = arguments[i];
    if (typeof emitter !== 'object' || emitter === null || (typeof emitter.setMaxListeners !== 'function' && typeof emitter.on !== 'function' && typeof emitter.addEventListener !== 'function')) {
      const e = new TypeError('The "eventTargets" argument must be an instance of EventTarget or EventEmitter. Received ' + typeof emitter + ' (' + String(emitter) + ')');
      e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
    }
    if (typeof emitter.setMaxListeners === 'function') emitter.setMaxListeners(n);
    else emitter._maxListeners = n;
  }
};

function _onceAbortError(signal) {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError'; e.code = 'ABORT_ERR';
  if (signal && signal.reason !== undefined) e.cause = signal.reason;
  return e;
}

function once(emitter, type, options) {
  const signal = options && options.signal;
  // validateAbortSignal: accept any object exposing `aborted` (NodeEventTarget
  // mocks included), reject otherwise. Surface as a rejection, not a sync throw,
  // so `assert.rejects(once(...))` works.
  if (signal !== undefined && (signal === null || typeof signal !== 'object' || !('aborted' in signal))) {
    const e = new TypeError('The "options.signal" argument must be an instance of AbortSignal. Received ' + (signal === null ? 'null' : typeof signal));
    e.code = 'ERR_INVALID_ARG_TYPE';
    return Promise.reject(e);
  }
  if (signal && signal.aborted) return Promise.reject(_onceAbortError(signal));

  const isTarget = typeof emitter.addEventListener === 'function' && typeof emitter.on !== 'function';
  return new Promise(function(resolve, reject) {
    let abortListener = null;
    const cleanup = () => { if (signal && abortListener) signal.removeEventListener('abort', abortListener); };
    if (isTarget) {
      const onRes = function(ev) { emitter.removeEventListener(type, onRes); cleanup(); resolve([ev]); };
      emitter.addEventListener(type, onRes, { once: true });
      abortListener = () => { emitter.removeEventListener(type, onRes); reject(_onceAbortError(signal)); };
    } else {
      const onRes = function() {
        emitter.removeListener('error', onErr); cleanup();
        const args = new Array(arguments.length);
        for (let i = 0; i < arguments.length; i++) args[i] = arguments[i];
        resolve(args);
      };
      const onErr = function(e) { emitter.removeListener(type, onRes); cleanup(); reject(e); };
      emitter.once(type, onRes);
      if (type !== 'error') emitter.once('error', onErr);
      abortListener = () => { emitter.removeListener(type, onRes); if (type !== 'error') emitter.removeListener('error', onErr); reject(_onceAbortError(signal)); };
    }
    if (signal) signal.addEventListener('abort', abortListener, { once: true });
  });
}

EventEmitter.once = once;
EventEmitter.captureRejections = false;
EventEmitter.captureRejectionSymbol = Symbol.for('nodejs.rejection');
EventEmitter.errorMonitor = Symbol('events.errorMonitor');

EventEmitter.on = function on(emitter, event, options) {
  var unconsumedEvents = [];
  var unconsumedPromises = [];
  var error = null;
  var finished = false;

  var eventHandler = function() {
    var value = arguments.length === 1 ? arguments[0] : Array.prototype.slice.call(arguments);
    if (unconsumedPromises.length > 0) {
      unconsumedPromises.shift().resolve({ value: value, done: false });
    } else {
      unconsumedEvents.push(value);
    }
  };

  var errorHandler = function(err) {
    error = err;
    if (unconsumedPromises.length > 0) {
      unconsumedPromises.shift().reject(err);
    }
  };

  emitter.on(event, eventHandler);
  if (event !== 'error') emitter.on('error', errorHandler);

  var iterator = {
    next: function() {
      if (unconsumedEvents.length > 0) {
        return Promise.resolve({ value: unconsumedEvents.shift(), done: false });
      }
      if (error) { var err = error; error = null; return Promise.reject(err); }
      if (finished) return Promise.resolve({ done: true });
      return new Promise(function(resolve, reject) { unconsumedPromises.push({ resolve: resolve, reject: reject }); });
    },
    return: function() {
      finished = true;
      emitter.removeListener(event, eventHandler);
      emitter.removeListener('error', errorHandler);
      for (var i = 0; i < unconsumedPromises.length; i++) unconsumedPromises[i].resolve({ done: true });
      return Promise.resolve({ done: true });
    },
    throw: function(err) { error = err; return this.return(); },
  };
  iterator[Symbol.asyncIterator] = function() { return this; };

  if (options && options.signal) {
    options.signal.addEventListener('abort', function() { iterator.return(); });
  }

  return iterator;
};

EventEmitter.addAbortListener = function(signal, listener) {
  signal.addEventListener('abort', listener);
  return { [Symbol.dispose]: function() { signal.removeEventListener('abort', listener); } };
};

module.exports = EventEmitter;
module.exports.getMaxListeners = EventEmitter.getMaxListeners;
module.exports.setMaxListeners = EventEmitter.setMaxListeners;
module.exports.defaultMaxListeners = EventEmitter.defaultMaxListeners;
module.exports.once = once;
module.exports.on = EventEmitter.on;
module.exports.addAbortListener = EventEmitter.addAbortListener;
module.exports.getEventListeners = EventEmitter.getEventListeners;
module.exports.captureRejectionSymbol = EventEmitter.captureRejectionSymbol;
module.exports.errorMonitor = EventEmitter.errorMonitor;
module.exports.listenerCount = EventEmitter.listenerCount;
module.exports.captureRejections = EventEmitter.captureRejections;
module.exports.captureRejectionSymbol = EventEmitter.captureRejectionSymbol;
module.exports.errorMonitor = EventEmitter.errorMonitor;
